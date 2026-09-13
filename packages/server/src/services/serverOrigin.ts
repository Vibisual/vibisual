/**
 * §7.11 — **이 포트의 서버가 어느 프로젝트의 것인가.**
 *
 * v1.48("owning shell 검증")은 iframe 위성의 *생사* 판정에 프로젝트 격리를 못 박았다:
 * "같은 포트를 다른 프로젝트가 점유하면 stale 위성이 부활하는 §3.5 격리 위반이 발생한다".
 * 그런데 그 문은 `checkIframesAlive`(생사) 한쪽에만 서 있고 **생성 경로**(감지 폴백
 * `sniffLoopbackServers` · 신고 `reportIframeFromAgent`)에는 없었다. 그래서 다른 프로젝트에서
 * 띄운 dev server 의 주소가 우리 Bash 출력에 한 번 스치기만 해도 — 문서를 grep 한 출력이어도 —
 * 우리 캔버스에 **남의 프리뷰**가 섰다. 실측(2026-09-09): 옆 프로젝트의 vite(8080) 가 vibisual
 * 그래프의 커스텀 에이전트 위성(`special-1620649350`)으로 등록됐고, 정작 그 프로젝트 쪽
 * 체크포인트의 iframe 위성은 0개였다.
 *
 * v3.69 가 남긴 교훈이 방향만 뒤집혀 그대로 적용된다 — "생성 경로는 알고 생사 확인 경로는
 * 모르던 비대칭이 원인이었으므로, 두 경로의 스캔 대상은 앞으로도 같이 움직여야 한다".
 * 이번엔 생사 경로가 알고 생성 경로가 몰랐다. 여기서 그 문을 생성 쪽에도 세운다.
 *
 * 판정은 **포트를 LISTEN 중인 실제 프로세스**에서 읽는다(명령어 정규식 추측 ❌) —
 * 이미 있는 `takeoverPortCommand`(§7.11 포트 인계)를 그대로 재사용하므로 새 조회 레일이 없다.
 */
import { isPathWithin, normalizePathShape, pathKey, type PlatformName } from '@vibisual/shared';
import { logger } from '../logger.js';
import { takeoverPortCommand } from './portTakeover.js';

/**
 * 이 서버가 누구 것인가.
 * - `ours` — 우리 프로젝트 안에서 돈다(또는 우리가 띄웠다).
 * - `foreign` — **다른 열린 프로젝트** 안에서 돈다. 우리 캔버스에 붙이면 안 된다.
 * - `unknown` — 기동 정보는 **읽었는데** 아는 프로젝트 어디에도 없다.
 * - `unresolved` — 기동 정보 자체를 **못 읽었다**(권한 없음·조회 실패·도구 없음).
 *
 * 뒤 둘을 가르는 것이 이 판정의 전부다. 종전에는 하나(`unknown`)로 뭉쳐 통과시켰고,
 * 그래서 `node src/server.js` 처럼 **명령줄에 절대경로가 없는** 남의 서버가 그대로 들어왔다
 * (실측 2026-09-11: 옆 프로젝트의 3456 이 vibisual 캔버스에 위성으로 박혀 있었다 — win32 는
 * 프로세스 cwd 를 읽는 공개 API 가 없고 조상 프로세스는 이미 죽어 추적도 끊겼다).
 * 읽고도 모르는 것(`unknown`)과 아예 못 읽은 것(`unresolved`)은 증거의 무게가 다르다.
 * 어느 쪽을 붙일지는 `shouldAttachServer` 한 곳이 정한다.
 */
export type ServerOrigin = 'ours' | 'foreign' | 'unknown' | 'unresolved';

/**
 * §3.5 — **이 서버를 우리 캔버스에 붙여도 되는가.** 네 판정의 해석은 여기 한 곳이다.
 *
 * 사용자 결정(2026-09-11): **판정 불가는 붙이지 않는다.** 종전 규약은 "확실하지 않은데
 * 거절하면 왜 프리뷰가 안 뜨냐는 반대 방향 사고가 난다"며 `unknown` 을 통과시켰는데,
 * 실제로 난 사고는 그 반대였다 — 남의 프로젝트 서버가 우리 탭에 박혀 앱을 껐다 켜도
 * 사라지지 않았다(§3.5 "탭 A 의 버블·체크포인트가 탭 B 로 누수되면 안 된다").
 *
 * 다만 **못 읽은 것은 거절하지 않는다**(`unresolved`). 조회 실패는 그 서버에 대한 진술이
 * 아니라 우리 조회 능력에 대한 진술이라, 이걸로 막으면 조회가 한 번 흔들릴 때마다
 * 멀쩡한 프리뷰가 사라진다.
 */
export function shouldAttachServer(origin: ServerOrigin): boolean {
  return origin === 'ours' || origin === 'unresolved';
}

/** 포트 점유 프로세스에서 읽어 낸 것 — `takeoverPortCommand` 반환의 부분집합. */
export interface ProcessStartInfo {
  command: string;
  cwd?: string;
}

/**
 * 명령줄 문자열 안에 그 루트 경로가 **경로로서** 등장하는가.
 *
 * 단순 `includes` 는 `…/game2d` 가 `…/game2d_backup` 에 걸린다. 루트 바로 뒤가
 * 경로 문자(단어·점·하이픈)면 다른 폴더라는 뜻이라 제외한다.
 */
function commandMentionsRoot(haystack: string, root: string, platform: PlatformName): boolean {
  const key = pathKey(root, platform);
  if (key.length === 0) return false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}(?![\\w.\\-])`).test(haystack);
}

/**
 * 포트 점유 프로세스의 기동 정보로 **소속 프로젝트**를 가른다.
 *
 * @param start 포트를 잡고 있는 프로세스의 명령줄·작업 폴더(`null` = 못 읽음).
 * @param ownRoots 이 그래프가 그리는 프로젝트 경로들.
 * @param foreignRoots 지금 열려 있는 **다른** 프로젝트 경로들.
 * @param platform 세 OS 를 한 기기에서 단위 테스트하기 위해 인자로 받는다
 *   (`process.platform` 을 안에서 읽으면 그 분기는 영영 검증되지 않는다).
 */
export function classifyServerOrigin(
  start: ProcessStartInfo | null,
  ownRoots: readonly string[],
  foreignRoots: readonly string[],
  platform: PlatformName,
): ServerOrigin {
  // 기동 정보를 못 읽었다 — 그 서버에 대한 진술이 아니라 우리 조회에 대한 진술이다.
  if (!start) return 'unresolved';

  // ① 작업 폴더를 읽었으면 그게 진실이다 — linux `/proc/<pid>/cwd`, mac `lsof -a -d cwd`.
  //    명령줄보다 강한 증거라 명령줄은 보지 않는다(예: 우리 폴더의 스크립트로 남의 폴더에서
  //    띄운 서버는 남의 것이다).
  const cwd = start.cwd;
  if (cwd) {
    if (ownRoots.some((r) => isPathWithin(cwd, r, platform))) return 'ours';
    if (foreignRoots.some((r) => isPathWithin(cwd, r, platform))) return 'foreign';
    // 아는 프로젝트 어디에도 없다 — 임시 폴더에서 띄운 서버일 수 있어 막지 않는다.
    return 'unknown';
  }

  // ② win32 는 cwd 에 공개 API 가 없다(`portTakeover` 의 probe 표 참조 — PEB 를 읽어야 한다).
  //    남은 단서는 명령줄이고, 실제로 대부분의 dev server 는 거기에 절대경로를 싣는다
  //    (실측: `"node" "C:\…\Game2D\node_modules\…\vite.js"`).
  //    경로 모양·케이스는 `pathKey` 규칙 하나로 접는다(Linux 에서 케이스를 접으면 남의 폴더가 통과한다).
  const haystack = pathKey(normalizePathShape(start.command), platform);
  // 우리 것을 먼저 본다 — 우리 세션이 남의 폴더를 가리키며 띄운 경우, 그건 우리가 띄운 서버다.
  if (ownRoots.some((r) => commandMentionsRoot(haystack, r, platform))) return 'ours';
  if (foreignRoots.some((r) => commandMentionsRoot(haystack, r, platform))) return 'foreign';
  return 'unknown';
}

/**
 * 포트 점유 프로세스 조회 결과 캐시 — (포트 → 기동 정보).
 *
 * 조회는 OS 도구를 띄운다(win32 는 PowerShell `Get-CimInstance`). 감지 폴백은 에이전트가
 * Bash 를 돌릴 때마다 지나가는 자리라, 캐시가 없으면 세션이 길수록 조용히 느려진다
 * (§7.11 의 `LOOPBACK_SNIFF_PROBE_TTL_MS` 문과 같은 이유·같은 리듬).
 */
const lookupCache = new Map<number, { at: number; start: ProcessStartInfo | null }>();

/** 조회 캐시 수명. 서버가 죽고 다른 프로젝트가 같은 포트를 잡을 수 있어 길게 두지 않는다. */
export const PORT_ORIGIN_LOOKUP_TTL_MS = 60_000;

/** 캐시 상한 — 키 개수에 캡이 없으면 오래 켜 둔 앱에서 조용히 자란다. */
const LOOKUP_CACHE_MAX = 256;

/** 테스트·재시작 사이에 캐시를 비운다. */
export function clearPortOriginCache(): void {
  lookupCache.clear();
}

/**
 * 포트를 잡고 있는 프로세스를 읽어 소속을 가른다.
 *
 * @param lookup 조회 함수(기본 `takeoverPortCommand`). 테스트가 OS 도구 없이 지나가도록 열어 둔다.
 */
export async function resolvePortOrigin(
  port: number,
  ownRoots: readonly string[],
  foreignRoots: readonly string[],
  platform: PlatformName,
  lookup: (p: number) => Promise<ProcessStartInfo | null> = (p) =>
    takeoverPortCommand(p, platform as NodeJS.Platform),
  now: number = Date.now(),
): Promise<ServerOrigin> {
  // 다른 프로젝트가 하나도 안 열려 있으면 **가를 대상 자체가 없다** — 조회를 건너뛰고 통과시킨다.
  // 이건 판정의 예외가 아니라 전제다: §3.5 가 막는 것은 "탭 A → 탭 B 누수"이고, 탭이 하나뿐인
  // 앱에는 새어 나갈 곳이 없다. 여기서 막으면 혼자 쓰는 사용자의 프리뷰만 통째로 사라진다.
  if (foreignRoots.length === 0) return 'unresolved';

  let start: ProcessStartInfo | null;
  const cached = lookupCache.get(port);
  if (cached && now - cached.at < PORT_ORIGIN_LOOKUP_TTL_MS) {
    start = cached.start;
  } else {
    try {
      start = await lookup(port);
    } catch {
      start = null; // 조회 실패는 판정 불가일 뿐 — 막지 않는다.
    }
    lookupCache.set(port, { at: now, start });
    if (lookupCache.size > LOOKUP_CACHE_MAX) {
      const oldest = lookupCache.keys().next();
      if (!oldest.done) lookupCache.delete(oldest.value);
    }
  }

  const origin = classifyServerOrigin(start, ownRoots, foreignRoots, platform);
  if (!shouldAttachServer(origin)) {
    const why = origin === 'foreign' ? '다른 프로젝트의 서버' : '어느 프로젝트 것인지 판정 불가';
    logger.info(
      `iframe 위성 보류(port ${String(port)}): ${why} — ${start?.cwd ?? start?.command.slice(0, 80) ?? '?'}`,
    );
  }
  return origin;
}
