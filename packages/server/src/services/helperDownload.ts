import { spawn, type ChildProcess } from 'node:child_process';
import { HELPER_DOWNLOAD_STALL_MS } from '@vibisual/shared';
import { appNodeRuntimeIn, type AppNodeRuntime } from './appNodeRuntime.js';
import { killTree, processGroupSpawnOptions } from './processTree.js';

/**
 * §4 (앱 전용 엔진) ⑬ — **큰 파일 받기는 앱 메인 프로세스 밖의 도우미가 한다.** 2026-10-26 실측: 앱 안에서 받은 283MiB 가 3/3 해시 불일치(크기 같고 16KiB×7 구간이 뒤 내용으로 덮임), 앱 밖은 매번 맞음 — 범인 미특정.
 * 실행 환경은 앱 자신의 것(패키지 앱은 `ELECTRON_RUN_AS_NODE=1`) — 사용자 PC 의 Node 에 기대지 않는다. 스크립트는 `-e` 로, 큰따옴표·역슬래시 없이(시험이 지킨다).
 * 해시 둘(받은 바이트·다시 읽은 파일)로 부르는 쪽이 망가진 곳을 가른다. `HELPER_DOWNLOAD_STALL_MS` 무진행이면 트리째 끊는다(POSIX 그룹 리더 — `processGroupSpawnOptions`).
 * 서버가 아니라 §3.7 child spawn 금지 대상이 아니다 — 일이 끝나면 스스로 끝난다.
 */

export interface HelperDownloadResult {
  /** 받은 바이트 수. */
  received: number;
  /** 응답이 알려 준 길이(`content-length`) — 모르면 0. */
  total: number;
  /** 받은 바이트를 그 자리에서 먹인 SHA-256(소문자 hex). */
  streamSha256: string;
  /** 다 쓴 파일을 디스크에서 다시 읽은 SHA-256(소문자 hex). */
  fileSha256: string;
}

export interface HelperDownloadOptions {
  /** 무진행 상한(ms). */
  stallMs?: number;
  platform?: NodeJS.Platform;
  /** 띄울 실행 환경 — 시험이 갈아 끼운다. */
  runtime?: AppNodeRuntime;
  /** 띄우는 함수 — 시험이 갈아 끼운다. */
  spawnFn?: typeof spawn;
}

/**
 * 도우미가 도는 스크립트(CommonJS). argv = [실행본, 주소, 받을 파일].
 * stdout 에 한 줄짜리 JSON 을 낸다 — `{t:'progress',received,total}` · `{t:'done',…}` · `{t:'error',message}`.
 * 쓰기는 동기(`writeSync`)로 한 조각씩 끝내고 다음 조각을 읽는다 — 쓰기를 기다리는 조각이 메모리에 남지 않는다.
 */
export const HELPER_DOWNLOAD_SCRIPT = [
  "const fs = require('fs');",
  "const crypto = require('crypto');",
  'const url = process.argv[1];',
  'const dest = process.argv[2];',
  "const emit = (o) => { try { process.stdout.write(JSON.stringify(o) + String.fromCharCode(10)); } catch (e) {} };",
  "const fail = (m) => { emit({ t: 'error', message: String(m) }); process.exitCode = 1; };",
  '(async () => {',
  "  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'vibisual' } });",
  "  if (!res.ok || !res.body) { fail('download ' + res.status + ' ' + url); return; }",
  "  const total = Number(res.headers.get('content-length') || 0);",
  "  const hash = crypto.createHash('sha256');",
  "  const fd = fs.openSync(dest, 'w');",
  '  let received = 0;',
  '  let last = 0;',
  '  try {',
  '    const reader = res.body.getReader();',
  '    for (;;) {',
  '      const step = await reader.read();',
  '      if (step.done) break;',
  '      const buf = Buffer.from(step.value);',
  '      hash.update(buf);',
  '      let off = 0;',
  '      while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);',
  '      received += buf.length;',
  '      const now = Date.now();',
  "      if (now - last >= 200) { last = now; emit({ t: 'progress', received, total }); }",
  '    }',
  '    fs.fsyncSync(fd);',
  '  } finally {',
  '    fs.closeSync(fd);',
  '  }',
  "  emit({ t: 'progress', received, total });",
  "  const check = crypto.createHash('sha256');",
  "  const rfd = fs.openSync(dest, 'r');",
  '  try {',
  '    const chunk = Buffer.allocUnsafe(1048576);',
  '    for (;;) {',
  '      const n = fs.readSync(rfd, chunk, 0, chunk.length, null);',
  '      if (n <= 0) break;',
  '      check.update(chunk.subarray(0, n));',
  '    }',
  '  } finally {',
  '    fs.closeSync(rfd);',
  '  }',
  "  emit({ t: 'done', received, total, streamSha256: hash.digest('hex'), fileSha256: check.digest('hex') });",
  '})().catch((e) => fail(e && e.message ? e.message : e));',
].join('\n');

/** 도우미 실행 환경 — 늘 앱 자신의 런타임(사용자 Node ❌). */
export function helperDownloadRuntime(
  execPath: string = process.execPath,
  electron: boolean = !!process.versions['electron'],
): AppNodeRuntime {
  return appNodeRuntimeIn(null, execPath, electron);
}

/** 도우미 한 줄을 읽는다 — 모르는 줄은 null(도우미의 다른 출력이 섞여도 무시한다). */
export function parseHelperLine(line: string):
  | { t: 'progress'; received: number; total: number }
  | ({ t: 'done' } & HelperDownloadResult)
  | { t: 'error'; message: string }
  | null {
  const text = line.trim();
  if (!text.startsWith('{')) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const hex = (v: unknown): string => (typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : '');
  if (o['t'] === 'progress') return { t: 'progress', received: num(o['received']), total: num(o['total']) };
  if (o['t'] === 'error') return { t: 'error', message: typeof o['message'] === 'string' ? o['message'].slice(0, 300) : 'download failed' };
  if (o['t'] === 'done') {
    const streamSha256 = hex(o['streamSha256']);
    const fileSha256 = hex(o['fileSha256']);
    if (!streamSha256 || !fileSha256) return { t: 'error', message: 'download helper returned no checksum' };
    return { t: 'done', received: num(o['received']), total: num(o['total']), streamSha256, fileSha256 };
  }
  return null;
}

/** 도우미 프로세스에서 받는다. 받은 길이가 `content-length` 와 다르면(중간에 끊긴 응답) 실패다. */
export function downloadInHelper(
  url: string,
  dest: string,
  onBytes: (received: number, total: number) => void,
  opts: HelperDownloadOptions = {},
): Promise<HelperDownloadResult> {
  const platform = opts.platform ?? process.platform;
  const runtime = opts.runtime ?? helperDownloadRuntime();
  const stallMs = opts.stallMs ?? HELPER_DOWNLOAD_STALL_MS;
  const spawnFn = opts.spawnFn ?? spawn;
  return new Promise<HelperDownloadResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnFn(runtime.nodeBin, ['-e', HELPER_DOWNLOAD_SCRIPT, url, dest], {
        env: { ...process.env, ...(runtime.nodeEnv ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...processGroupSpawnOptions(platform),
      });
    } catch (err) {
      reject(new Error(`could not start the download helper: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    let settled = false;
    let pending = '';
    let errTail = '';
    let done: HelperDownloadResult | null = null;
    let failure: string | null = null;
    let lastReceived = -1;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      if (done && !failure) {
        if (done.total > 0 && done.received !== done.total) {
          reject(new Error(`download truncated (${String(done.received)}/${String(done.total)} bytes) ${url}`));
          return;
        }
        resolve(done);
        return;
      }
      reject(new Error(failure ?? `download helper ended without a result ${url}`));
    };
    const armStall = (): void => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        failure = `download stalled — no data for ${String(Math.round(stallMs / 1000))}s (${url})`;
        killTree(child.pid, platform);
        finish();
      }, stallMs);
    };
    const handle = (line: string): void => {
      const msg = parseHelperLine(line);
      if (!msg) return;
      if (msg.t === 'progress') {
        if (msg.received > lastReceived) {
          lastReceived = msg.received;
          armStall();
        }
        try { onBytes(msg.received, msg.total); } catch { /* 표시 실패는 받기와 무관 */ }
      } else if (msg.t === 'done') {
        done = { received: msg.received, total: msg.total, streamSha256: msg.streamSha256, fileSha256: msg.fileSha256 };
      } else {
        failure = msg.message;
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      pending += chunk;
      for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
        handle(pending.slice(0, i));
        pending = pending.slice(i + 1);
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      errTail = `${errTail}${chunk}`.slice(-2000);
    });
    child.on('error', (err) => {
      failure = failure ?? `could not start the download helper: ${err.message}`;
      finish();
    });
    child.on('close', (code) => {
      if (pending) handle(pending);
      pending = '';
      if (!done && !failure) {
        const last = errTail.trim().split(/\r?\n/).filter(Boolean).pop();
        failure = `download helper exited ${String(code)}${last ? `: ${last.slice(0, 200)}` : ''}`;
      }
      finish();
    });
    armStall();
  });
}
