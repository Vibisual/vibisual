import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalModelDownloadProgress } from '@vibisual/shared';

vi.mock('../broadcastBus.js', () => ({ broadcast: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./localEngineService.js', () => ({ getEngineState: () => ({ build: 'test' }) }));
vi.mock('./localArchService.js', () => ({
  probeRemoteArchitecture: vi.fn(async () => null),
  getArchVerdict: () => 'unknown',
  archBrokenReason: () => '',
}));

import {
  cancelDownload, downloadModel, listDownloads, listModels, listRepoFiles,
  modelsDir, searchCatalog, setModelDownloadedHook,
} from './localModelService.js';

let home: string;
const fetchMock = vi.fn<typeof fetch>();
const checked = vi.fn();

function gguf(size = 64): Buffer {
  const bytes = Buffer.alloc(size, 1);
  bytes.write('GGUF');
  bytes.writeUInt32LE(3, 4);
  bytes.writeBigUInt64LE(200n, 8);
  bytes.writeBigUInt64LE(0n, 16);
  return bytes;
}

function response(bytes: Buffer, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), {
    status, headers: { 'content-length': String(bytes.length), ...headers },
  });
}

function mockFile(bytes = gguf()): void {
  fetchMock.mockImplementation(async (_url, init) => init?.method === 'HEAD'
    ? new Response(null, { headers: { 'content-length': String(bytes.length) } })
    : response(bytes));
}

async function finished(progress: LocalModelDownloadProgress): Promise<LocalModelDownloadProgress> {
  await vi.waitFor(() => {
    const current = listDownloads().find((download) => download.downloadId === progress.downloadId);
    expect(current?.status).not.toBe('starting');
    expect(current?.status).not.toBe('downloading');
  });
  const result = listDownloads().find((download) => download.downloadId === progress.downloadId);
  if (!result) throw new Error('Missing download');
  return result;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-model-download-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  fs.mkdirSync(modelsDir(), { recursive: true });
  fetchMock.mockReset();
  checked.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setModelDownloadedHook(checked);
});

afterEach(async () => {
  for (const download of listDownloads()) {
    if (download.status === 'starting' || download.status === 'downloading') {
      cancelDownload(download.downloadId);
      await finished(download);
    }
  }
  setModelDownloadedHook(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('downloadModel — 받은 뒤 실제로 사용할 수 있는 파일만 완료한다', () => {
  it('둘째 조각을 직접 요청해도 첫째부터 전부 받고 하나의 모델로 완료한다', async () => {
    mockFile();
    const result = await finished(downloadModel('owner/repo', 'Q4/model-Q4_K_M-00002-of-00002.gguf'));
    expect(result.status).toBe('done');
    const requests = fetchMock.mock.calls.filter(([, init]) => init?.method !== 'HEAD').map(([url]) => String(url));
    expect(requests).toEqual([
      'https://huggingface.co/owner/repo/resolve/main/Q4/model-Q4_K_M-00001-of-00002.gguf?download=true',
      'https://huggingface.co/owner/repo/resolve/main/Q4/model-Q4_K_M-00002-of-00002.gguf?download=true',
    ]);
    expect(listModels()).toMatchObject([{ id: 'model-Q4_K_M', partCount: 2, sizeBytes: 128 }]);
    expect(listModels()[0]?.missingParts).toBeUndefined();
    expect(checked).toHaveBeenCalledExactlyOnceWith('model-Q4_K_M');
  });

  it('다른 모델을 섞은 조각·부속 모델·경로 주입 요청은 파일을 만들기 전에 거절한다', () => {
    for (const file of ['../model.gguf', '..\\model.gguf', '/model.gguf', 'C:model.gguf', 'mmproj-test.gguf']) {
      expect(() => downloadModel('owner/repo', file)).toThrow('Invalid GGUF');
    }
    expect(() => downloadModel('owner/repo', 'a-00001-of-00002.gguf', ['b-00001-of-00002.gguf'])).toThrow('one GGUF model');
    expect(() => downloadModel('../repo', 'a.gguf')).toThrow('repository');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('불완전한 기존 gguf 파일은 완료로 건너뛰지 않고 다시 받는다', async () => {
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf'), gguf(32));
    mockFile(gguf(64));
    expect((await finished(downloadModel('owner/repo', 'model.gguf'))).status).toBe('done');
    expect(fs.readFileSync(path.join(modelsDir(), 'model.gguf'))).toEqual(gguf(64));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method !== 'HEAD')).toBe(true);
  });

  it('길이와 GGUF 헤더가 확인된 기존 파일은 다시 받지 않는다', async () => {
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf'), gguf());
    mockFile();
    const result = await finished(downloadModel('owner/repo', 'model.gguf'));
    expect(result).toMatchObject({ status: 'done', receivedBytes: 64, totalBytes: 64 });
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'HEAD')).toBe(true);
  });

  it('잘못된 이어받기 offset은 남은 조각을 훼손하지 않고 거절한다', async () => {
    const partial = gguf(32);
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf.part'), partial);
    fetchMock.mockImplementation(async (_url, init) => init?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-length': '64' } })
      : response(gguf().subarray(16), 206, { 'content-range': 'bytes 16-63/64' }));
    const result = await finished(downloadModel('owner/repo', 'model.gguf'));
    expect(result).toMatchObject({ status: 'error', error: expect.stringContaining('range') });
    expect(fs.readFileSync(path.join(modelsDir(), 'model.gguf.part'))).toEqual(partial);
    expect(listModels()).toEqual([]);
    expect(checked).not.toHaveBeenCalled();
  });

  it('206 Content-Range의 전체 길이에 못 미치면 완료하지 않고 이어받을 조각을 남긴다', async () => {
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf.part'), gguf(32));
    fetchMock.mockImplementation(async (_url, init) => init?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-length': '96' } })
      : response(gguf().subarray(32), 206, { 'content-range': 'bytes 32-63/96' }));
    const result = await finished(downloadModel('owner/repo', 'model.gguf'));
    expect(result).toMatchObject({ status: 'error', error: expect.stringContaining('truncated') });
    expect(fs.statSync(path.join(modelsDir(), 'model.gguf.part')).size).toBe(64);
    expect(listModels()).toEqual([]);
  });

  it('정상 206 응답은 기존 조각 뒤에 이어 써 완성한다', async () => {
    const bytes = gguf();
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf.part'), bytes.subarray(0, 32));
    fetchMock.mockImplementation(async (_url, init) => init?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-length': '64' } })
      : response(bytes.subarray(32), 206, { 'content-range': 'bytes 32-63/64' }));
    expect((await finished(downloadModel('owner/repo', 'model.gguf'))).status).toBe('done');
    expect(fs.readFileSync(path.join(modelsDir(), 'model.gguf'))).toEqual(bytes);
  });

  it('이미 다 받은 .part의 Range 416은 정확한 원격 길이를 대조한 뒤 완료한다', async () => {
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf.part'), gguf());
    fetchMock.mockImplementation(async (_url, init) => init?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-length': '64' } })
      : new Response(null, { status: 416, headers: { 'content-range': 'bytes */64' } }));
    expect((await finished(downloadModel('owner/repo', 'model.gguf'))).status).toBe('done');
    expect(fs.readFileSync(path.join(modelsDir(), 'model.gguf'))).toEqual(gguf());
  });

  it('원격보다 큰 옛 조각의 416은 Range 없이 재시도해 복구한다', async () => {
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf.part'), gguf(96));
    const ranges: (string | null)[] = [];
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': '64' } });
      const range = new Headers(init?.headers).get('range');
      ranges.push(range);
      return range ? new Response(null, { status: 416, headers: { 'content-range': 'bytes */64' } }) : response(gguf());
    });
    expect((await finished(downloadModel('owner/repo', 'model.gguf'))).status).toBe('done');
    expect(ranges).toEqual(['bytes=96-', null]);
    expect(fs.readFileSync(path.join(modelsDir(), 'model.gguf'))).toEqual(gguf());
  });

  it('서버가 Range를 무시한 200 응답은 처음부터 덮어써 중복 바이트를 만들지 않는다', async () => {
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf.part'), gguf(32));
    mockFile();
    expect((await finished(downloadModel('owner/repo', 'model.gguf'))).status).toBe('done');
    expect(fs.readFileSync(path.join(modelsDir(), 'model.gguf'))).toEqual(gguf());
  });

  it('HTTP 200 오류 페이지를 모델로 등록하지 않는다', async () => {
    mockFile(Buffer.from('<html>upstream error</html>'));
    const result = await finished(downloadModel('owner/repo', 'model.gguf'));
    expect(result).toMatchObject({ status: 'error', error: expect.stringContaining('GGUF') });
    expect(listModels()).toEqual([]);
    expect(checked).not.toHaveBeenCalled();
  });

  it('남은 오류 페이지 뒤에 이어 붙이지 않고 다음 시도에서 정상 모델을 받는다', async () => {
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf.part'), Buffer.from('<html>upstream service unavailable</html>'));
    mockFile();
    expect((await finished(downloadModel('owner/repo', 'model.gguf'))).status).toBe('done');
    const get = fetchMock.mock.calls.find(([, init]) => init?.method !== 'HEAD');
    expect(new Headers(get?.[1]?.headers).has('range')).toBe(false);
    expect(fs.readFileSync(path.join(modelsDir(), 'model.gguf'))).toEqual(gguf());
  });

  it('취소 직후 디스크 파일이 있어도 done이나 자동 점검으로 바뀌지 않는다', async () => {
    fs.writeFileSync(path.join(modelsDir(), 'model.gguf'), gguf());
    mockFile();
    const progress = downloadModel('owner/repo', 'model.gguf');
    cancelDownload(progress.downloadId);
    expect((await finished(progress)).status).toBe('canceled');
    expect(checked).not.toHaveBeenCalled();
  });

  it('받는 중 취소는 열린 스트림도 닫고 재시도할 .part만 남긴다', async () => {
    const canceled = vi.fn();
    fetchMock.mockImplementation(async (_url, init) => init?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-length': '64' } })
      : new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(gguf(32))); },
        cancel: canceled,
      }), { headers: { 'content-length': '64' } }));
    const progress = downloadModel('owner/repo', 'model.gguf');
    await vi.waitFor(() => expect(listDownloads().find((item) => item.downloadId === progress.downloadId)?.receivedBytes).toBe(32));
    cancelDownload(progress.downloadId);
    expect((await finished(progress)).status).toBe('canceled');
    expect(canceled).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(modelsDir(), 'model.gguf.part'))).toBe(true);
    expect(listModels()).toEqual([]);
    expect(checked).not.toHaveBeenCalled();
  });
});

describe('catalog — 사용할 수 없는 목록과 검색 장애를 구별한다', () => {
  it('불완전한 분할 모델을 제외하고 크기 미상 조각이 있으면 전체도 미상으로 표시한다', async () => {
    fetchMock.mockResolvedValue(Response.json({ siblings: [
      { rfilename: 'incomplete-Q4_K_M-00002-of-00002.gguf', size: 64 },
      { rfilename: 'complete-Q4_K_M-00002-of-00002.gguf', size: 64 },
      { rfilename: 'complete-Q4_K_M-00001-of-00002.gguf' },
      { rfilename: 'solo-Q5_K_M.gguf', size: 64 },
    ] }));
    expect(await listRepoFiles('owner/repo')).toMatchObject([
      { id: 'complete-Q4_K_M', sizeBytes: 0, file: 'complete-Q4_K_M-00001-of-00002.gguf' },
      { id: 'solo-Q5_K_M', sizeBytes: 64 },
    ]);
  });

  it('429나 연결 오류를 검색 결과 없음으로 숨기지 않는다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    await expect(searchCatalog('model')).rejects.toThrow('429');
    await expect(listRepoFiles('owner/repo')).rejects.toThrow('429');
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  });
});
