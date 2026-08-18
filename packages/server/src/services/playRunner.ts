/**
 * §5.14 v4.62 — 플레이 버블의 기동/정지.
 *
 * **새 실행 레이어를 만들지 않는다** — 프로세스 도구는 §7.11 이 이미 쓰고 있는
 * `processChecker`(`respawn`/`killByPort`/`isPortAlive`/`isUrlServing`)를 그대로 쓴다.
 * 여기서 하는 일은 그 도구들을 "사용자가 버튼을 눌렀을 때의 한 흐름"으로 엮는 것뿐이다:
 * 띄운다 → 살아날 때까지 지켜본다 → URL 을 돌려준다(또는 왜 안 떴는지 한 줄로 말한다).
 *
 * §7.11 의 `ServerEntry`·iframe 위성으로는 **등록하지 않는다**. 그 파이프라인은
 * "Claude 의 background bash 가 띄운 서버"를 전제로 owning-shell 검사와 strict 1:1 을
 * 걸어 두었는데, 여기서 띄우는 것은 Vibisual 이 직접 낳은 detached child 라 그 전제 밖이다
 * (등록하면 1:1 self-healing 이 곧바로 지워 버린다).
 */
import net from 'node:net';
import fs from 'node:fs';

import type { PlayBubble, PlayRecipe } from '@vibisual/shared';
import { PLAY_PROBE_INTERVAL_MS, PLAY_START_TIMEOUT_MS } from '@vibisual/shared';

import { logger } from '../logger.js';
import { isPortAlive, isUrlServing, killByPort, respawn } from './processChecker.js';
import { registerStaticRoot, unregisterStaticRoot } from './playStaticHost.js';

/** 기동 결과. 실패해도 던지지 않는다 — 버블에 사유를 적어 보여 주는 게 목적이다. */
export interface PlayStartOutcome {
  ok: boolean;
  url?: string;
  port?: number;
  error?: string;
}

/**
 * 포트를 모르는 명령을 위한 후보 목록.
 *
 * 명령에서 포트를 못 뽑았을 때, 기동 **전후로 새로 열린 포트**를 이 목록에서 찾아 채택한다
 * (정규식으로 배너를 뜯는 것보다 정확하다 — 실제로 listen 한 포트만 잡힌다).
 */
const COMMON_DEV_PORTS: readonly number[] = [
  3000, 3001, 3333, 4000, 4173, 4200, 4321, 5000, 5173, 5174, 5175, 5273,
  7357, 8000, 8080, 8081, 8082, 8787, 8788, 8888, 9000, 1420,
];

/** 우리가 띄운 포트 — 앱 종료 시 함께 정리한다(고아 서버 방지). */
const startedPorts = new Set<number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** OS 에게 비어 있는 포트를 하나 받아 온다(`{port}` 토큰 치환용). */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

function buildUrl(port: number, openPath?: string): string {
  const suffix = openPath && openPath !== '/' ? (openPath.startsWith('/') ? openPath : `/${openPath}`) : '/';
  return `http://127.0.0.1:${port}${suffix}`;
}

async function aliveSet(ports: readonly number[]): Promise<Set<number>> {
  const out = new Set<number>();
  await Promise.all(
    ports.map(async (p) => {
      if (await isPortAlive(p)) out.add(p);
    }),
  );
  return out;
}

/** 정적 서빙 — 명령 없이 폴더를 그대로 연다. */
async function startStatic(bubble: PlayBubble, recipe: PlayRecipe): Promise<PlayStartOutcome> {
  const root = recipe.root;
  if (!root) return { ok: false, error: 'recipe.root missing' };
  try {
    if (!fs.statSync(root).isDirectory()) return { ok: false, error: `not a directory: ${root}` };
  } catch {
    return { ok: false, error: `folder not found: ${root}` };
  }

  const { port, base } = await registerStaticRoot(bubble.id, root);
  const suffix = recipe.openPath && recipe.openPath !== '/' ? (recipe.openPath.startsWith('/') ? recipe.openPath : `/${recipe.openPath}`) : '/';
  const url = `${base}${suffix}`;

  // 우리가 서빙하므로 응답 확인이 곧 "그 파일이 실제로 있다" 는 확인이다.
  for (let i = 0; i < 5; i += 1) {
    if (await isUrlServing(url)) return { ok: true, url, port };
    await sleep(120);
  }
  unregisterStaticRoot(bubble.id);
  return { ok: false, error: `no page at ${suffix} — check the folder` };
}

/** 명령 기동 — 띄우고, 살아날 때까지 지켜본다. */
async function startCommand(recipe: PlayRecipe): Promise<PlayStartOutcome> {
  const raw = recipe.command?.trim();
  if (!raw) return { ok: false, error: 'recipe.command missing' };

  let port = recipe.port;
  if (raw.includes('{port}') && port === undefined) {
    try {
      port = await findFreePort();
    } catch {
      return { ok: false, error: 'could not reserve a free port' };
    }
  }
  const command = port !== undefined ? raw.replace(/\{port\}/g, String(port)) : raw;

  // 포트를 모르면 "기동 전에 이미 열려 있던 포트"를 먼저 찍어 둔다 — 새로 열린 것만 우리 것이다.
  const before = port === undefined ? await aliveSet(COMMON_DEV_PORTS) : new Set<number>();

  respawn(command, recipe.cwd);

  const deadline = Date.now() + PLAY_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(PLAY_PROBE_INTERVAL_MS);
    if (port !== undefined) {
      if (await isPortAlive(port)) {
        const url = buildUrl(port, recipe.openPath);
        // 포트가 열렸으면 성공으로 본다. 그 경로가 404 인지는 프리뷰 화면이 정직하게 보여 준다.
        void isUrlServing(url).then((serving) => {
          if (!serving) logger.info(`play: port ${port} alive but ${url} not serving (2xx/3xx) yet`);
        });
        startedPorts.add(port);
        return { ok: true, url, port };
      }
      continue;
    }
    const now = await aliveSet(COMMON_DEV_PORTS);
    for (const candidate of now) {
      if (before.has(candidate)) continue;
      startedPorts.add(candidate);
      return { ok: true, url: buildUrl(candidate, recipe.openPath), port: candidate };
    }
  }

  return {
    ok: false,
    error:
      port !== undefined
        ? `no response on port ${port} within ${Math.round(PLAY_START_TIMEOUT_MS / 1000)}s`
        : `could not find the port within ${Math.round(PLAY_START_TIMEOUT_MS / 1000)}s — set it in the recipe`,
  };
}

/** 버블 하나를 켠다. 실패는 예외가 아니라 사유 문자열로 돌아온다. */
export async function startPlay(bubble: PlayBubble): Promise<PlayStartOutcome> {
  const recipe = bubble.recipe;
  if (!recipe) return { ok: false, error: 'no recipe' };
  try {
    return recipe.kind === 'static' ? await startStatic(bubble, recipe) : await startCommand(recipe);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** 버블 하나를 끈다. static 은 서빙 해제, command 는 그 포트를 죽인다. */
export async function stopPlay(bubble: PlayBubble): Promise<void> {
  if (bubble.recipe?.kind === 'static') {
    unregisterStaticRoot(bubble.id);
    return;
  }
  if (bubble.port !== undefined) {
    startedPorts.delete(bubble.port);
    await killByPort(bubble.port);
  }
}

/** running 버블이 아직 살아 있는지 — 5초 스윕이 쓴다. */
export async function isPlayAlive(bubble: PlayBubble): Promise<boolean> {
  if (bubble.port === undefined) return false;
  return isPortAlive(bubble.port);
}

/** 앱 종료 — 우리가 띄운 것만 정리한다(사용자가 직접 켠 서버는 건드리지 않는다). */
export async function stopAllPlays(): Promise<void> {
  const ports = [...startedPorts];
  startedPorts.clear();
  await Promise.all(ports.map((p) => killByPort(p).catch(() => false)));
}
