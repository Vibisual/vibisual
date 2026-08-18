/**
 * §5.14 v4.62 — 플레이 버블의 정적 호스트.
 *
 * HTML 앱은 "서버를 켜는 명령"이 애초에 필요 없다 — 폴더를 그대로 내보내면 된다. 그래서
 * 4단 계단의 1단은 명령이 아니라 **우리가 서빙**하는 것이다(사용자가 `python -m http.server`
 * 를 외우거나 에이전트에게 부탁할 이유가 사라진다).
 *
 * 서버는 **하나만** 뜬다(등록된 루트가 있을 때만). 경로는 `/<bubbleId>/<파일>` 이고, 등록되지
 * 않은 id 는 404 다. loopback 바인딩 + 루트 이탈 차단(`..`) 이 이 파일의 보안 계약 전부다 —
 * in-process Express(REST)와는 **다른 소켓**이라 우리 API 가 이 포트로 새어 나가지 않는다.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { logger } from '../logger.js';

/** 등록된 정적 루트 (bubbleId → 절대 경로). */
const roots = new Map<string, string>();

let server: http.Server | null = null;
let listenPort: number | null = null;
/** 동시에 여러 버블이 start 될 때 서버를 두 번 띄우지 않게 하는 부팅 약속. */
let booting: Promise<number> | null = null;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
  } catch {
    res.statusCode = 400;
    res.end('bad request');
    return;
  }

  const segments = pathname.split('/').filter((s) => s.length > 0);
  const bubbleId = segments.shift();
  const root = bubbleId ? roots.get(bubbleId) : undefined;
  if (!root) {
    res.statusCode = 404;
    res.end('play: not registered');
    return;
  }

  // 루트 이탈 차단 — `..` 은 resolve 후 접두 검사로 걸러진다(문자열 필터 ❌).
  const requested = path.resolve(root, ...segments);
  if (requested !== root && !requested.startsWith(root + path.sep)) {
    res.statusCode = 403;
    res.end('play: outside root');
    return;
  }

  let target = requested;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  } catch {
    res.statusCode = 404;
    res.end('play: not found');
    return;
  }

  let data: Buffer;
  try {
    data = fs.readFileSync(target);
  } catch {
    res.statusCode = 404;
    res.end('play: not found');
    return;
  }

  res.statusCode = 200;
  res.setHeader('content-type', contentType(target));
  // 프리뷰는 "지금 고친 것"을 보는 자리다 — 캐시가 남으면 새로고침해도 옛 화면이 나온다.
  res.setHeader('cache-control', 'no-store');
  res.end(data);
}

/** 정적 호스트를 (필요하면) 띄우고 포트를 돌려준다. 이미 떠 있으면 그 포트. */
async function ensureServer(): Promise<number> {
  if (listenPort !== null) return listenPort;
  if (booting) return booting;
  booting = new Promise<number>((resolve, reject) => {
    const s = http.createServer(handle);
    s.on('error', (err) => {
      booting = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    });
    // 포트 0 = OS 가 비어 있는 포트를 준다(고정 포트 충돌·점유 사고 없음).
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      server = s;
      listenPort = port;
      booting = null;
      logger.info(`playStaticHost: listening on 127.0.0.1:${port}`);
      resolve(port);
    });
  });
  return booting;
}

/** 이 버블의 폴더를 서빙 목록에 올리고 접근 가능한 base URL 을 돌려준다. */
export async function registerStaticRoot(bubbleId: string, root: string): Promise<{ port: number; base: string }> {
  const port = await ensureServer();
  roots.set(bubbleId, path.resolve(root));
  return { port, base: `http://127.0.0.1:${port}/${bubbleId}` };
}

/** 서빙 중단. 남은 루트가 없으면 소켓까지 닫는다(안 쓰는 포트를 열어 두지 않는다). */
export function unregisterStaticRoot(bubbleId: string): void {
  roots.delete(bubbleId);
  if (roots.size === 0 && server) {
    server.close();
    server = null;
    listenPort = null;
    logger.info('playStaticHost: closed (no roots left)');
  }
}

/** 이 버블이 지금 서빙 중인가. */
export function isStaticRootRegistered(bubbleId: string): boolean {
  return roots.has(bubbleId);
}

/** 앱 종료용 — 전부 내린다. */
export function closeStaticHost(): void {
  roots.clear();
  if (server) {
    server.close();
    server = null;
    listenPort = null;
  }
}
