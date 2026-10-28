import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WORKSPACE_MEDIA_PATH, appIdOfMediaPath, isAppMediaPath, isWorkspaceMediaFile, mediaContentType, mediaEtag, parseByteRange,
  summarizeProcessMetrics, workspaceMediaMime,
} from '@vibisual/shared';

import { appMediaResponse, type MediaStreamDone } from './appMediaResponse';

/**
 * §5.13 (Y) 40-1 — 앱 미디어 흘려 보내기: 코어가 파일을 조각으로 **당겨** 읽는다(응답 전체를 모아 IPC 로 싣지 않는다).
 * 구간 · HEAD · 416 · 지문 · 끊으면 그 자리에서 멈춤을 고정한다.
 */

let dir: string;
let file: string;
const SIZE = 10_000;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-media-'));
  file = path.join(dir, 'clip.mp4');
  const bytes = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i += 1) bytes[i] = i % 251;
  fs.writeFileSync(file, bytes);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function request(method: string, range?: string): { method: string; headers: { get(name: string): string | null } } {
  return { method, headers: { get: (name: string) => (name.toLowerCase() === 'range' ? range ?? null : null) } };
}

describe('§5.13 (Y) 40-1 — parseByteRange', () => {
  it('reads one range in its three shapes and clips the end to the file', () => {
    expect(parseByteRange(null, 100)).toEqual({ kind: 'full' });
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ kind: 'range', start: 10, end: 19 });
    expect(parseByteRange('bytes=90-', 100)).toEqual({ kind: 'range', start: 90, end: 99 });
    expect(parseByteRange('bytes=-5', 100)).toEqual({ kind: 'range', start: 95, end: 99 });
    expect(parseByteRange('bytes=50-500', 100)).toEqual({ kind: 'range', start: 50, end: 99 });
  });

  it('ignores multi-range and malformed headers (full body) and refuses a start past the end (416)', () => {
    expect(parseByteRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'full' });
    expect(parseByteRange('items=0-1', 100)).toEqual({ kind: 'full' });
    expect(parseByteRange('bytes=30-10', 100)).toEqual({ kind: 'full' });
    expect(parseByteRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' });
  });

  it('names media paths without knowing the app, types by extension, and fingerprints by size and time', () => {
    expect(isAppMediaPath('/api/app/some-app/media')).toBe(true);
    expect(appIdOfMediaPath('/api/app/some-app/media')).toBe('some-app');
    expect(isAppMediaPath('/api/app/some-app/asset')).toBe(false);
    expect(isAppMediaPath('/api/app/../media')).toBe(false);
    expect(mediaContentType('a/B.MP4')).toBe('video/mp4');
    expect(mediaContentType('a/b.unknown')).toBe('application/octet-stream');
    expect(mediaEtag(10, 1234.4)).toBe('W/"10-1234"');
  });
});

describe('§5.13 (Y) 40-1 — appMediaResponse', () => {
  it('serves a range as 206 with Content-Range, nosniff and a weak ETag', async () => {
    const res = await appMediaResponse(file, request('GET', 'bytes=100-199'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 100-199/${SIZE}`);
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('etag')).toMatch(/^W\/"10000-\d+"$/);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(100);
    expect(body[0]).toBe(100 % 251);
    expect(body[99]).toBe(199 % 251);
  });

  it('serves the whole file as 200 in pulled chunks', async () => {
    let done: MediaStreamDone | null = null;
    const res = await appMediaResponse(file, request('GET'), (info) => { done = info; }, 1_024);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(SIZE);
    expect(done).toMatchObject({ bytes: SIZE, cancelled: false });
  });

  it('answers HEAD without opening the file body and 416 past the end', async () => {
    const head = await appMediaResponse(file, request('HEAD'));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(SIZE));
    expect(head.body).toBeNull();
    const past = await appMediaResponse(file, request('GET', `bytes=${SIZE}-`));
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe(`bytes */${SIZE}`);
  });

  it('stops reading where the reader cancels (an open-ended range does not drag the rest of the file over)', async () => {
    let done: MediaStreamDone | null = null;
    const res = await appMediaResponse(file, request('GET', 'bytes=0-'), (info) => { done = info; }, 1_000);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.value?.length).toBe(1_000);
    await reader.cancel();
    expect(done).not.toBeNull();
    expect(done!.cancelled).toBe(true);
    expect(done!.bytes).toBeLessThan(SIZE);
  });

  it('is 404 for a missing file or a folder', async () => {
    expect((await appMediaResponse(path.join(dir, 'gone.mp4'), request('GET'))).status).toBe(404);
    expect((await appMediaResponse(dir, request('GET'))).status).toBe(404);
  });

  it('takes the type from the caller when its route types files by another table (the core media window)', async () => {
    // §5.13 40-1 — 코어 미디어 창구는 그 라우트와 같은 표(`workspaceMediaMime`)로 형식을 정한다 — 패키지 앱에서만 다르게 읽히지 않게.
    const model = path.join(dir, 'robot.glb');
    fs.writeFileSync(model, Buffer.alloc(16));
    expect(mediaContentType(model)).toBe('application/octet-stream');
    const typed = await appMediaResponse(model, request('GET', 'bytes=0-3'), undefined, 1_024, workspaceMediaMime(model));
    expect(typed.status).toBe(206);
    expect(typed.headers.get('content-type')).toBe('model/gltf-binary');
    expect(typed.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await appMediaResponse(model, request('HEAD'))).headers.get('content-type')).toBe('application/octet-stream');
  });
});

describe('§5.13 40-1 — the core media window streams only media types', () => {
  it('names the path and accepts only files in the media table', () => {
    expect(WORKSPACE_MEDIA_PATH).toBe('/api/workspace-media');
    for (const name of ['a/b.png', 'a/B.JPG', 'clip.mp4', 'hit.wav', 'robot.glb', 'spec.pdf', 'icon.svg', 'C:\\x\\y.webp']) {
      expect(isWorkspaceMediaFile(name), name).toBe(true);
    }
    for (const name of ['.env', 'src/app.ts', 'config.json', 'id_rsa', 'notes.txt', 'archive.zip', 'folder/']) {
      expect(isWorkspaceMediaFile(name), name).toBe(false);
    }
  });
});

describe('§5.13 (Y) 40-12 — summarizeProcessMetrics', () => {
  it('sums per process type and keeps privateBytes only where the platform gives it', () => {
    const rows = summarizeProcessMetrics([
      { type: 'Tab', memory: { workingSetSize: 100, privateBytes: 80 } },
      { type: 'Tab', memory: { workingSetSize: 50, privateBytes: 40 } },
      { type: 'GPU', memory: { workingSetSize: 300 } },
      { type: 'Browser', memory: { workingSetSize: 200 } },
    ]);
    expect(rows).toEqual([
      { type: 'Browser', count: 1, workingSetKB: 200 },
      { type: 'GPU', count: 1, workingSetKB: 300 },
      { type: 'Tab', count: 2, workingSetKB: 150, privateKB: 120 },
    ]);
  });
});
