import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HELPER_DOWNLOAD_STALL_MS } from '@vibisual/shared';

const mocks = vi.hoisted(() => ({ killTree: vi.fn() }));
vi.mock('./processTree.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./processTree.js')>()),
  killTree: mocks.killTree,
}));

import { HELPER_DOWNLOAD_SCRIPT, downloadInHelper, helperDownloadRuntime, parseHelperLine } from './helperDownload.js';

/**
 * §4 (앱 전용 엔진) ⑬ — 큰 파일 받기는 앱 메인 프로세스 밖의 도우미가 한다.
 * 판정 규칙은 가짜 자식으로, 스크립트 자체는 진짜 자식 + 로컬 HTTP 서버로 본다(외부 네트워크 ❌).
 */

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function fakeChild() {
  const child = Object.assign(new EventEmitter(), { pid: 4321, stdout: new PassThrough(), stderr: new PassThrough() });
  return child;
}

/** 진짜 ChildProcess 처럼 — stdout·stderr 가 다 읽힌 뒤에 'close' 를 낸다. */
function closeAfterStreams(child: ReturnType<typeof fakeChild>, code: number): void {
  let open = 2;
  const done = (): void => {
    open -= 1;
    if (open === 0) child.emit('close', code);
  };
  child.stdout.once('end', done);
  child.stderr.once('end', done);
  child.stdout.end();
  child.stderr.end();
}

afterEach(() => {
  vi.useRealTimers();
  mocks.killTree.mockClear();
});

describe('도우미 스크립트 · 실행 환경', () => {
  it('스크립트에 큰따옴표 · 역슬래시가 없다 — Windows 명령줄 인용이 단순해야 `-e` 로 그대로 건너간다', () => {
    expect(HELPER_DOWNLOAD_SCRIPT).not.toMatch(/["\\]/);
  });

  it('쓰기는 동기로 한 조각씩 끝내고 다음 조각을 읽는다 — 쓰기를 기다리는 조각이 메모리에 남지 않는다', () => {
    expect(HELPER_DOWNLOAD_SCRIPT).toContain('fs.writeSync(fd, buf, off, buf.length - off)');
    expect(HELPER_DOWNLOAD_SCRIPT).not.toContain('createWriteStream');
    expect(HELPER_DOWNLOAD_SCRIPT).toContain("crypto.createHash('sha256')");
  });

  it('패키지 앱은 앱 실행본 + ELECTRON_RUN_AS_NODE, 그 밖은 그 Node — 사용자 Node 에는 기대지 않는다', () => {
    expect(helperDownloadRuntime('C:/Apps/Vibisual/Vibisual.exe', true)).toEqual({ nodeBin: 'C:/Apps/Vibisual/Vibisual.exe', nodeEnv: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(helperDownloadRuntime('/usr/bin/node', false)).toEqual({ nodeBin: '/usr/bin/node' });
  });

  it.each(['win32', 'darwin', 'linux'] as const)('%s — POSIX 는 그룹 리더로 띄운다(끊을 때 손자까지), 환경에 실행 모드를 얹는다', async (platform) => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child);
    const p = downloadInHelper('https://example.invalid/x', '/tmp/x', () => undefined, {
      platform,
      runtime: { nodeBin: '/app/Vibisual', nodeEnv: { ELECTRON_RUN_AS_NODE: '1' } },
      spawnFn: spawnFn as never,
    });
    const [bin, args, options] = spawnFn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(bin).toBe('/app/Vibisual');
    expect(args).toEqual(['-e', HELPER_DOWNLOAD_SCRIPT, 'https://example.invalid/x', '/tmp/x']);
    expect((options['env'] as Record<string, string>)['ELECTRON_RUN_AS_NODE']).toBe('1');
    expect(options['detached']).toBe(platform === 'win32' ? undefined : true);
    expect(options['windowsHide']).toBe(true);
    child.stdout.write(`${JSON.stringify({ t: 'error', message: 'stop' })}\n`);
    closeAfterStreams(child, 1);
    await expect(p).rejects.toThrow('stop');
  });
});

describe('도우미 줄 읽기', () => {
  it('진행 · 끝 · 오류를 읽고, 모르는 줄은 버린다', () => {
    expect(parseHelperLine('{"t":"progress","received":10,"total":20}')).toEqual({ t: 'progress', received: 10, total: 20 });
    const h = 'a'.repeat(64);
    expect(parseHelperLine(JSON.stringify({ t: 'done', received: 3, total: 3, streamSha256: h, fileSha256: h }))).toEqual({ t: 'done', received: 3, total: 3, streamSha256: h, fileSha256: h });
    expect(parseHelperLine('{"t":"error","message":"download 404 x"}')).toEqual({ t: 'error', message: 'download 404 x' });
    expect(parseHelperLine('(node:1) ExperimentalWarning: something')).toBeNull();
    expect(parseHelperLine('{"t":"other"}')).toBeNull();
  });

  it('지문이 없거나 hex 가 아닌 끝 줄은 오류다(대조 없는 파일을 통과시키지 않는다)', () => {
    expect(parseHelperLine('{"t":"done","received":1,"total":1,"streamSha256":"zz","fileSha256":"zz"}')).toMatchObject({ t: 'error' });
  });
});

describe('받기 판정(가짜 자식)', () => {
  function run(lines: unknown[], code = 0, opts: { stallMs?: number } = {}) {
    const child = fakeChild();
    const onBytes = vi.fn();
    const p = downloadInHelper('https://example.invalid/f', '/tmp/f', onBytes, {
      platform: 'linux',
      runtime: { nodeBin: '/usr/bin/node' },
      spawnFn: (() => child) as never,
      ...opts,
    });
    for (const l of lines) child.stdout.write(`${JSON.stringify(l)}\n`);
    closeAfterStreams(child, code);
    return { p, onBytes, child };
  }

  it('진행을 알리고, 끝 줄의 지문 둘을 돌려준다', async () => {
    const h = 'b'.repeat(64);
    const { p, onBytes } = run([{ t: 'progress', received: 5, total: 10 }, { t: 'progress', received: 10, total: 10 }, { t: 'done', received: 10, total: 10, streamSha256: h, fileSha256: h }]);
    await expect(p).resolves.toEqual({ received: 10, total: 10, streamSha256: h, fileSha256: h });
    expect(onBytes).toHaveBeenLastCalledWith(10, 10);
  });

  it('받은 길이가 content-length 보다 짧으면(끊긴 응답) 실패다', async () => {
    const h = 'c'.repeat(64);
    await expect(run([{ t: 'done', received: 9, total: 10, streamSha256: h, fileSha256: h }]).p).rejects.toThrow('download truncated');
  });

  it('도우미의 오류 줄이 실패 사유가 된다', async () => {
    await expect(run([{ t: 'error', message: 'download 404 https://example.invalid/f' }], 1).p).rejects.toThrow('download 404');
  });

  it('끝 줄 없이 끝나면 종료 코드와 stderr 마지막 줄을 적는다', async () => {
    const child = fakeChild();
    const p = downloadInHelper('https://example.invalid/f', '/tmp/f', () => undefined, { platform: 'linux', runtime: { nodeBin: 'node' }, spawnFn: (() => child) as never });
    child.stderr.write('SyntaxError: Unexpected token\n');
    closeAfterStreams(child, 9);
    await expect(p).rejects.toThrow('download helper exited 9: SyntaxError: Unexpected token');
  });

  it('무진행 상한을 넘기면 트리째 끊고 실패로 돌려준다 — 멎은 받기가 엔진을 영영 붙잡지 않는다', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const p = downloadInHelper('https://example.invalid/f', '/tmp/f', () => undefined, { platform: 'darwin', runtime: { nodeBin: 'node' }, spawnFn: (() => child) as never });
    const settled = p.catch((e: unknown) => e);
    child.stdout.write(`${JSON.stringify({ t: 'progress', received: 1, total: 10 })}\n`);
    await vi.advanceTimersByTimeAsync(HELPER_DOWNLOAD_STALL_MS - 1);
    expect(mocks.killTree).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(mocks.killTree).toHaveBeenCalledWith(4321, 'darwin');
    expect(String(await settled)).toContain('download stalled');
  });

  it('바이트가 늘면 무진행 시계를 다시 감는다', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const p = downloadInHelper('https://example.invalid/f', '/tmp/f', () => undefined, { platform: 'linux', runtime: { nodeBin: 'node' }, spawnFn: (() => child) as never, stallMs: 1000 });
    for (let i = 1; i <= 5; i += 1) {
      child.stdout.write(`${JSON.stringify({ t: 'progress', received: i, total: 5 })}\n`);
      await vi.advanceTimersByTimeAsync(900);
    }
    expect(mocks.killTree).not.toHaveBeenCalled();
    const h = 'd'.repeat(64);
    child.stdout.write(`${JSON.stringify({ t: 'done', received: 5, total: 5, streamSha256: h, fileSha256: h })}\n`);
    closeAfterStreams(child, 0);
    await expect(p).resolves.toMatchObject({ received: 5 });
  });
});

describe('진짜 도우미 — 로컬 HTTP 서버에서 받는다(외부 네트워크 ❌)', () => {
  const body = randomBytes(3 * 1024 * 1024 + 123);
  let server: http.Server;
  let base: string;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-helper-dl-'));
    server = http.createServer((req, res) => {
      if (req.url === '/file') {
        res.writeHead(200, { 'content-length': String(body.length) });
        // 여러 조각으로 나눠 보낸다(진짜 받기처럼).
        let off = 0;
        const step = (): void => {
          if (off >= body.length) { res.end(); return; }
          const next = Math.min(body.length, off + 256 * 1024);
          res.write(body.subarray(off, next));
          off = next;
          setImmediate(step);
        };
        step();
        return;
      }
      res.writeHead(404);
      res.end('nope');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('받은 바이트 · 다시 읽은 파일의 지문이 원본과 같고, 파일도 같다', async () => {
    const dest = path.join(dir, 'got.bin');
    const seen: number[] = [];
    const r = await downloadInHelper(`${base}/file`, dest, (received) => seen.push(received), { runtime: { nodeBin: process.execPath } });
    expect(r).toEqual({ received: body.length, total: body.length, streamSha256: sha(body), fileSha256: sha(body) });
    expect(fs.readFileSync(dest).equals(body)).toBe(true);
    expect(seen[seen.length - 1]).toBe(body.length);
  }, 30_000);

  it('404 면 그 상태를 사유로 실패한다', async () => {
    await expect(downloadInHelper(`${base}/missing`, path.join(dir, 'x.bin'), () => undefined, { runtime: { nodeBin: process.execPath } }))
      .rejects.toThrow('download 404');
  }, 30_000);
});
