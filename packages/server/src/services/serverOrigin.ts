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
 * 판정은 **포트를 LISTEN 중인 실제 프로세스**에서 읽는다(명령어 정규식 추측 ❌).
 *
 * ── 2026-10-01: **포트가 아니라 "그 주소가 닿는 리스너"로 가른다.** ──
 * 사용자 신고 "A 에서 테스트하던 프리뷰 버블에 B 프로젝트 것이 열린다 — 지난번에도 그랬다".
 * 두 구멍이 겹쳐 있었다. ① Windows 조회가 `netstat -p TCP`(IPv4 표)만 봐서 `[::1]` 에만 묶이는
 * Vite 를 **영영 못 봤다** → 늘 `unresolved` → 붙이고 안 걷었다(위 두 문이 Windows Vite 에는 한 번도
 * 실제로 서지 않았다). ② 한 포트에 주인이 둘일 수 있다 — A 의 서버가 `::`, B 의 vite 가 `[::1]` 에
 * 같은 8080 으로 공존하면 `localhost` 는 B 에, `127.0.0.1` 은 A 에 닿는다. 그래서 판정 단위는
 * (포트)가 아니라 (위성 주소 → 그 주소가 닿는 리스너)다 — `judgeIframeSatellite`.
 */
import { isPathWithin, loopbackUrlVariants, normalizePathShape, pathKey, type IframeTabVerdict, type PlatformName } from '@vibisual/shared';
import {
  findPortListeners,
  isVibisualOwnPort,
  listenerPids,
  reachableListeners,
  urlHostname,
  type PortListener,
} from './processChecker.js';
import { readProcessStart } from './portTakeover.js';

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
 * 어느 쪽을 붙일지는 `admitsServer` 한 곳이 정한다.
 */
export type ServerOrigin = 'ours' | 'foreign' | 'unknown' | 'unresolved';

/**
 * 이 위성이 **왜** 여기 있는가 — 우리 쪽 증거의 종류.
 * - `observed` — 감지 폴백·신고·클릭. "그 주소에 서버가 있더라"는 관찰일 뿐, 우리가 띄웠다는 증거가 아니다.
 * - `launch` — 우리 프로젝트의 셸이 띄웠다(살아 있는 owning shell, 또는 방금 우리가 띄운 기록 =
 *   PreToolUse·respawn). 상대경로로 띄운 우리 서버(`node serve.js`)는 명령줄만으로는 `unknown` 이라,
 *   이 증거가 없으면 우리 것을 우리가 걷는다.
 */
export type ServerEvidence = 'observed' | 'launch';

/**
 * §3.5 — **이 서버를 우리 캔버스에 붙여도(두어도) 되는가.** 판정 해석은 여기 한 곳이다.
 *
 * - `foreign` — 증거와 무관하게 거절. 남의 프로젝트 서버다.
 * - `unknown` — `launch` 증거가 있을 때만. 사용자 결정(2026-09-11) "판정 불가는 붙이지 않는다"는
 *   **관찰**로 들어온 위성(감지·신고)에 대한 것이다 — 3456 이 정확히 그 구멍으로 들어왔다.
 *   우리 셸이 띄운 서버까지 같은 잣대로 걷으면 상대경로로 띄운 우리 서버가 걷혔다가 rehydrate 로
 *   되살아나며 깜빡인다(반대 방향 사고).
 * - `ours` · `unresolved` — 통과. 못 읽은 것은 그 서버에 대한 진술이 아니라 우리 조회 능력에 대한
 *   진술이라, 이걸로 막으면 조회가 한 번 흔들릴 때마다 멀쩡한 프리뷰가 사라진다.
 */
export function admitsServer(origin: ServerOrigin, evidence: ServerEvidence): boolean {
  if (origin === 'foreign') return false;
  if (origin === 'unknown') return evidence === 'launch';
  return true;
}

/** 관찰(`observed`)로 들어온 서버를 붙여도 되는가 — {@link admitsServer} 의 관찰 쪽. */
export function shouldAttachServer(origin: ServerOrigin): boolean {
  return admitsServer(origin, 'observed');
}

/** 포트 점유 프로세스에서 읽어 낸 것 — `readProcessStart` 반환의 부분집합. */
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
 * 여러 리스너의 판정을 하나로 접는다. **하나라도 남의 것이면 남의 것**이다 — 같은 주소를 두
 * 프로세스가 나눠 받는 경우(SO_REUSEPORT·클러스터) 연결은 어느 쪽으로든 갈 수 있다.
 */
export function combineServerOrigins(origins: readonly ServerOrigin[]): ServerOrigin {
  if (origins.includes('foreign')) return 'foreign';
  if (origins.includes('ours')) return 'ours';
  if (origins.includes('unknown')) return 'unknown';
  return 'unresolved';
}

/** 포트 하나의 소유 사실 — 리스너(pid + 묶인 주소) 목록과 pid 별 기동 정보(`null` = 못 읽음). */
export interface PortOwnership {
  listeners: readonly PortListener[];
  starts: ReadonlyMap<number, ProcessStartInfo | null>;
}

/** 포트 → 소유 사실. `null` = 볼 도구가 없거나 조회가 실패했다(판정 불가). */
export type PortOwnershipLookup = (port: number) => Promise<PortOwnership | null>;

/** 기동 정보 하나짜리 소유 사실(주소 미상 = 모든 주소의 후보). 옛 단일 프로세스 조회를 잇는 다리. */
export function singleProcessOwnership(start: ProcessStartInfo | null): PortOwnership | null {
  if (!start) return null;
  return { listeners: [{ pid: 1 }], starts: new Map([[1, start]]) };
}

/** 주어진 리스너들의 판정(그 pid 들의 기동 정보로). 리스너가 없으면 `unresolved`. */
export function originOfListeners(
  ownership: PortOwnership,
  listeners: readonly PortListener[],
  ownRoots: readonly string[],
  foreignRoots: readonly string[],
  platform: PlatformName,
): ServerOrigin {
  const pids = listenerPids(listeners);
  if (pids.length === 0) return 'unresolved';
  return combineServerOrigins(
    pids.map((pid) => classifyServerOrigin(ownership.starts.get(pid) ?? null, ownRoots, foreignRoots, platform)),
  );
}

/**
 * **그 호스트로 접속하면 닿는 서버**의 판정. 닿는 리스너가 없으면 `unresolved`(그 주소의 서버는
 * 없다 — 같은 포트의 다른 리스너는 이 주소와 무관하다).
 */
export function originForHost(
  ownership: PortOwnership | null,
  host: string,
  ownRoots: readonly string[],
  foreignRoots: readonly string[],
  platform: PlatformName,
): ServerOrigin {
  if (!ownership || ownership.listeners.length === 0) return 'unresolved';
  return originOfListeners(ownership, reachableListeners(ownership.listeners, host), ownRoots, foreignRoots, platform);
}

/**
 * `launch` 증거가 **지금 닿는 리스너**에도 유효한가.
 *
 * 증거는 처음 본 리스너 pid 에 묶인다(`boundPids`). 닿는 리스너가 묶인 pid 안에 있으면 유효하다.
 * 아니라면 둘 중 하나다 — ① 묶인 pid 가 같은 포트에 **아직 살아 있다**: 남이 같은 포트를 다른
 * 주소로 겹쳐 묶었고 그쪽이 지금 이 주소를 받는다(한 포트 두 주인) → 무효. ② 묶인 pid 가 사라졌다:
 * 우리 서버가 재기동해 pid 가 바뀌었다(nodemon 등) → 유효(호출부가 새 pid 로 다시 묶는다).
 */
export function launchEvidenceHolds(
  reachPids: readonly number[],
  allPids: readonly number[],
  boundPids?: readonly number[],
): boolean {
  if (!boundPids || boundPids.length === 0) return true;
  if (reachPids.every((p) => boundPids.includes(p))) return true;
  return !boundPids.some((p) => allPids.includes(p));
}

/** {@link judgeIframeSatellite} 의 입력. */
export interface IframeJudgeInput {
  /** 위성이 지금 여는(또는 열려는) 주소. */
  url: string;
  ownership: PortOwnership | null;
  evidence: ServerEvidence;
  /** `launch` 증거가 묶인 리스너 pid(처음 본 것). 없으면 아직 안 묶였다. */
  boundPids?: readonly number[];
  ownRoots: readonly string[];
  foreignRoots: readonly string[];
  platform: PlatformName;
}

/**
 * 위성 하나에 대한 결론.
 * - `keep` — 그대로 둔다(또는 그 주소로 만든다).
 * - `repoint` — 그 주소는 남의 리스너에 닿지만 **다른 루프백 별칭이 우리 서버에 닿는다** → 그 별칭으로 바꾼다.
 * - `reject` — 우리 것이라는 판정이 서지 않는다 → 만들지 않는다 / 걷는다.
 *
 * `bindPids` 는 `launch` 증거를 이번에 묶을(또는 다시 묶을) 리스너 pid 다.
 */
export type IframeVerdict =
  | { action: 'keep'; origin: ServerOrigin; bindPids?: number[] }
  | { action: 'repoint'; url: string; origin: ServerOrigin; bindPids?: number[] }
  | { action: 'reject'; origin: ServerOrigin };

/**
 * §7.11 / §3.5 — **이 위성 주소를 이 캔버스에 둬도 되는가**(순수 함수 — 생성 입구·생사 sweep 공용).
 *
 * 1. 위성 주소와 그 루프백 별칭(`localhost` · `127.0.0.1` · `[::1]` — 원래 주소가 맨 앞)을 차례로 본다.
 * 2. 각 주소가 **실제로 닿는 리스너**(`reachableListeners`)를 판정한다. 닿는 것이 없는 별칭은 건너뛴다.
 * 3. 원래 주소가 통과하면 `keep`. 원래 주소가 남의 것인데 별칭이 **긍정 증거**(`ours`, 또는
 *    `launch`+`unknown`)로 통과하면 `repoint` — 테스트하던 화면을 지우지 않고 우리 서버로 되돌린다.
 *    못 읽은 별칭(`unresolved`)으로는 옮기지 않는다(옮긴 곳도 남의 것일 수 있다).
 * 4. 닿는 리스너가 하나도 없으면(주소를 모르는 도구 등) 포트 전체로 판정한다.
 *
 * 볼 것이 없으면(조회 실패·리스너 0) `keep` — 판정 불가로 지우지 않는다(사용자 결정 2026-09-11).
 */
export function judgeIframeSatellite(input: IframeJudgeInput): IframeVerdict {
  const { url, ownership, evidence, boundPids, ownRoots, foreignRoots, platform } = input;
  if (!ownership || ownership.listeners.length === 0) return { action: 'keep', origin: 'unresolved' };

  const all = ownership.listeners;
  const allPids = listenerPids(all);
  // 별칭 목록의 첫 항목은 원래 주소의 **정규화된 모양**(`http://localhost:8080` → `…:8080/`)이다 —
  // 문자열 그대로 비교하면 원래 주소를 "다른 별칭"으로 읽어 쓸데없이 교정한다.
  let original = url;
  try { original = new URL(url).toString(); } catch { /* 파싱 불가 — 그대로 비교 */ }
  const variants = loopbackUrlVariants(url);
  const candidates = variants.length > 0 ? variants : [original];

  let firstReachedOrigin: ServerOrigin | null = null;
  let unconfirmedAlias = false;
  for (const candidate of candidates) {
    const host = urlHostname(candidate);
    if (host === null) continue;
    const reach = reachableListeners(all, host);
    if (reach.length === 0) continue;
    const pids = listenerPids(reach);
    const origin = originOfListeners(ownership, reach, ownRoots, foreignRoots, platform);
    firstReachedOrigin ??= origin;
    const launchHolds = evidence === 'launch' && launchEvidenceHolds(pids, allPids, boundPids);
    if (!admitsServer(origin, launchHolds ? 'launch' : 'observed')) continue;
    const bindPids = launchHolds ? pids : undefined;
    if (candidate === original) return { action: 'keep', origin, ...(bindPids ? { bindPids } : {}) };
    // 별칭으로 옮기려면 그곳이 우리 서버라는 **긍정 증거**가 있어야 한다.
    if (origin === 'unresolved') { unconfirmedAlias = true; continue; }
    return { action: 'repoint', url: candidate, origin, ...(bindPids ? { bindPids } : {}) };
  }

  // 닿은 별칭이 못 읽은 것뿐이었다 — 판정 불가로 지우지 않는다.
  if (unconfirmedAlias) return { action: 'keep', origin: 'unresolved' };
  if (firstReachedOrigin !== null) return { action: 'reject', origin: firstReachedOrigin };

  // 어느 별칭도 닿는 리스너가 없다(포트는 살아 있는데 주소 계층 밖) — 포트 전체로 판정한다.
  const origin = originOfListeners(ownership, all, ownRoots, foreignRoots, platform);
  return admitsServer(origin, evidence) ? { action: 'keep', origin } : { action: 'reject', origin };
}

/** {@link judgeIframeTab} 의 입력 — 위성 판정과 같은 사실에서 증거·묶인 pid 만 뺀 것. */
export interface IframeTabJudgeInput {
  /** 탭이 지금 보여 주려는 주소. */
  url: string;
  ownership: PortOwnership | null;
  ownRoots: readonly string[];
  foreignRoots: readonly string[];
  platform: PlatformName;
}

/**
 * §7.11 / §3.5 — **열어 둔 프리뷰 탭이 이 주소를 지금 보여 줘도 되는가**(순수 함수).
 *
 * 위성과 기준이 반대다. 위성은 이 캔버스에 **새로 세울 근거**(긍정 증거)가 있어야 하지만, 탭은
 * 사용자가 이미 열어 둔 화면이라 **남의 것이라는 긍정 증거가 있을 때만** 막는다 — 주인 미상
 * (`unknown`)·못 읽음(`unresolved`)은 그대로 보여 준다(판정 불가로 지우지 않는다와 같은 원칙).
 *
 * 1. 그 주소가 닿는 리스너가 다른 열린 프로젝트의 것이 아니면 `show`.
 * 2. 남의 것이면, 루프백 별칭 중 **우리 서버(`ours`)에 닿는 것**으로 `follow`(한 포트 두 주인 —
 *    `localhost` 는 옆 프로젝트 vite, `127.0.0.1` 은 우리 서버).
 * 3. 그런 별칭도 없으면 `block` — 탭은 그 주소를 불러오지 않는다.
 */
export function judgeIframeTab(input: IframeTabJudgeInput): IframeTabVerdict {
  const { url, ownership, ownRoots, foreignRoots, platform } = input;
  if (!ownership || ownership.listeners.length === 0) return { action: 'show' };
  const host = urlHostname(url);
  if (host === null) return { action: 'show' };
  if (originForHost(ownership, host, ownRoots, foreignRoots, platform) !== 'foreign') return { action: 'show' };
  let original = url;
  try { original = new URL(url).toString(); } catch { /* 파싱 불가 — 그대로 비교 */ }
  for (const candidate of loopbackUrlVariants(url)) {
    if (candidate === original) continue;
    const aliasHost = urlHostname(candidate);
    if (aliasHost === null) continue;
    if (originForHost(ownership, aliasHost, ownRoots, foreignRoots, platform) === 'ours') {
      return { action: 'follow', url: candidate };
    }
  }
  return { action: 'block' };
}

// ─── 조회 + 캐시 ───

/**
 * 리스너 목록 캐시 수명. 조회는 싸다(netstat 실측 35ms) — 남이 같은 포트를 잡으면 **다음 sweep 에서**
 * 갈려야 하므로 짧게 둔다(종전 60초 동안은 남의 화면이 그대로 떠 있었다).
 */
export const PORT_LISTENER_TTL_MS = 5_000;

/**
 * 프로세스 기동 정보 캐시 수명(pid 단위). 비싸다(win32 = PowerShell 기동 + WMI 질의, 바쁜 기기에서
 * 수 초). 한 pid 의 명령줄은 그 프로세스가 사는 동안 바뀌지 않으므로 길게 둔다 — 대신 그 포트의
 * 리스너에서 빠진 pid 는 바로 버린다(pid 재사용 대비).
 */
export const PROCESS_START_TTL_MS = 10 * 60_000;

/** 못 읽은 결과(`null`)는 짧게만 기억한다 — 바쁜 순간의 시간 초과를 10분 동안 들고 있지 않게. */
export const PROCESS_START_MISS_TTL_MS = 30_000;

/** 한 포트에서 기동 정보를 읽을 pid 상한(조회 한 번이 PowerShell 한 번이다). */
const MAX_PIDS_PER_PORT = 6;

/** 캐시 상한 — 키 개수에 캡이 없으면 오래 켜 둔 앱에서 조용히 자란다. */
const CACHE_MAX = 256;

function capMap<K, V>(map: Map<K, V>): void {
  while (map.size > CACHE_MAX) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/** {@link createPortOwnershipReader} 의 재료 — 실제 OS 조회를 시험에서 바꿔 끼우기 위해 연다. */
export interface PortOwnershipReaderDeps {
  findListeners: (port: number) => Promise<{ listeners: readonly PortListener[]; anyToolWorked: boolean }>;
  readStart: (pid: number) => Promise<ProcessStartInfo | null>;
  now?: () => number;
  /** 우리 자신(과 부모)의 pid — 우리가 쥔 소켓은 판정 대상이 아니다. */
  selfPids?: readonly number[];
}

/**
 * 포트 → 소유 사실 조회기. 리스너는 짧게({@link PORT_LISTENER_TTL_MS}), 기동 정보는 pid 단위로 길게
 * ({@link PROCESS_START_TTL_MS}) 캐시하고, 같은 포트의 동시 조회는 하나로 합친다.
 */
export function createPortOwnershipReader(deps: PortOwnershipReaderDeps): {
  read: PortOwnershipLookup;
  clear: () => void;
} {
  const now = deps.now ?? Date.now;
  const self = new Set(deps.selfPids ?? []);
  const listenerCache = new Map<number, { at: number; listeners: PortListener[] | null }>();
  const startCache = new Map<number, { at: number; start: ProcessStartInfo | null }>();
  const inflight = new Map<number, Promise<PortOwnership | null>>();

  async function readListeners(port: number): Promise<PortListener[] | null> {
    const cached = listenerCache.get(port);
    if (cached && now() - cached.at < PORT_LISTENER_TTL_MS) return cached.listeners;
    let listeners: PortListener[] | null;
    try {
      const found = await deps.findListeners(port);
      listeners = found.anyToolWorked ? found.listeners.filter((l) => !self.has(l.pid)) : null;
    } catch {
      listeners = null;
    }
    // 이 포트에서 빠진 pid 의 기동 정보는 버린다 — 같은 pid 가 다른 프로세스로 재사용될 수 있다.
    if (cached?.listeners && listeners) {
      const still = new Set(listenerPids(listeners));
      for (const pid of listenerPids(cached.listeners)) if (!still.has(pid)) startCache.delete(pid);
    }
    listenerCache.set(port, { at: now(), listeners });
    capMap(listenerCache);
    return listeners;
  }

  async function readStart(pid: number): Promise<ProcessStartInfo | null> {
    const cached = startCache.get(pid);
    if (cached) {
      const ttl = cached.start ? PROCESS_START_TTL_MS : PROCESS_START_MISS_TTL_MS;
      if (now() - cached.at < ttl) return cached.start;
    }
    let start: ProcessStartInfo | null;
    try {
      start = await deps.readStart(pid);
    } catch {
      start = null; // 조회 실패는 판정 불가일 뿐 — 막지 않는다.
    }
    startCache.set(pid, { at: now(), start });
    capMap(startCache);
    return start;
  }

  async function readUncached(port: number): Promise<PortOwnership | null> {
    const listeners = await readListeners(port);
    if (listeners === null) return null;
    const starts = new Map<number, ProcessStartInfo | null>();
    for (const pid of listenerPids(listeners).slice(0, MAX_PIDS_PER_PORT)) starts.set(pid, await readStart(pid));
    return { listeners: listeners.filter((l) => starts.has(l.pid)), starts };
  }

  return {
    read(port: number): Promise<PortOwnership | null> {
      const pending = inflight.get(port);
      if (pending) return pending;
      const p = readUncached(port).finally(() => { inflight.delete(port); });
      inflight.set(port, p);
      return p;
    },
    clear(): void {
      listenerCache.clear();
      startCache.clear();
      inflight.clear();
    },
  };
}

/** 실제 OS 를 읽는 기본 조회기 — kill·인계와 **같은 조회 경로**(`findPortListeners`)를 쓴다. */
const defaultOwnershipReader = createPortOwnershipReader({
  findListeners: (port) => findPortListeners(port),
  readStart: async (pid) => {
    const start = await readProcessStart(pid, process.platform);
    return start ? { command: start.command, ...(start.cwd ? { cwd: start.cwd } : {}) } : null;
  },
  selfPids: [process.pid, process.ppid],
});

/** 포트의 소유 사실(실제 OS). 우리 자신의 포트(앱 서버·훅 리스너·프리뷰 프록시)는 판정 대상이 아니다. */
export function readPortOwnership(port: number): Promise<PortOwnership | null> {
  if (isVibisualOwnPort(port)) return Promise.resolve({ listeners: [], starts: new Map() });
  return defaultOwnershipReader.read(port);
}

/** 테스트·재시작 사이에 캐시를 비운다. */
export function clearPortOriginCache(): void {
  defaultOwnershipReader.clear();
}

/**
 * 포트(와 그 포트를 부르는 호스트)의 소속 — **그 호스트로 접속하면 닿는 서버**를 판정한다.
 *
 * @param lookup 조회 함수(기본 = 실제 OS). 테스트가 OS 도구 없이 지나가도록 열어 둔다.
 * @param host 그 서버를 부르는 주소의 호스트(기본 `localhost` — 위성 기본 주소).
 */
export async function resolvePortOrigin(
  port: number,
  ownRoots: readonly string[],
  foreignRoots: readonly string[],
  platform: PlatformName,
  lookup: PortOwnershipLookup = readPortOwnership,
  host = 'localhost',
): Promise<ServerOrigin> {
  // 다른 프로젝트가 하나도 안 열려 있으면 **가를 대상 자체가 없다** — 조회를 건너뛰고 통과시킨다.
  // 이건 판정의 예외가 아니라 전제다: §3.5 가 막는 것은 "탭 A → 탭 B 누수"이고, 탭이 하나뿐인
  // 앱에는 새어 나갈 곳이 없다. 여기서 막으면 혼자 쓰는 사용자의 프리뷰만 통째로 사라진다.
  if (foreignRoots.length === 0) return 'unresolved';
  let ownership: PortOwnership | null;
  try {
    ownership = await lookup(port);
  } catch {
    ownership = null; // 조회 실패는 판정 불가일 뿐 — 막지 않는다.
  }
  return originForHost(ownership, host, ownRoots, foreignRoots, platform);
}
