/**
 * §7.11 / §3.5 — 열어 둔 iframe 탭이 **그 탭을 연 위성의 주소**를 따라간다.
 *
 * 서버는 위성 주소를 바꿀 수 있다 — 한 포트에 주인이 둘이라 `localhost` 가 옆 프로젝트 서버에 닿으면
 * 우리 서버에 닿는 별칭(`127.0.0.1`)으로 옮긴다(2026-10-01 사고: A 에서 열어 둔 프리뷰에 B 의 화면).
 * 그런데 탭은 연 순간의 주소를 들고 있어서, 캔버스 버블이 고쳐져도 **열어 둔 탭은 남의 화면을 계속** 보였다.
 *
 * 탭 id 는 캔버스 위성 노드 id(`sat-` + 서버 위성 id)다. 위성 id 는 (세션, 포트)로 정해져 주소가 바뀌어도
 * 그대로라 탭과 위성의 짝이 끊기지 않는다.
 */
import type { BubbleData, IframeTabVerdict } from '@vibisual/shared';

/** 따라갈 수 있는 탭의 최소 모양(스토어의 `IframeTab`). */
export interface FollowableIframeTab {
  id: string;
  url: string;
}

/** 탭 id → 서버 위성 id(`sat-` 접두를 벗긴다 — `utils/satellite.ts` 가 붙인다). */
export function satelliteIdOfIframeTab(tabId: string): string {
  return tabId.startsWith('sat-') ? tabId.slice(4) : tabId;
}

/**
 * 스냅샷의 위성 주소로 탭 주소를 맞춘다. 바뀐 탭이 없으면 **같은 배열을 그대로** 돌려준다
 * (스냅샷은 자주 오므로 구독자를 괜히 깨우지 않게).
 *
 * 스냅샷에 그 위성이 없으면 손대지 않는다 — 배경 프로젝트가 스냅샷에서 빠지는 것(§9 스코프 구독)이나
 * 사용자가 버블을 지운 것을 "주소가 바뀌었다"로 읽으면 안 된다.
 */
export function followIframeTabUrls<T extends FollowableIframeTab>(
  tabs: T[],
  nodeMap: Readonly<Record<string, BubbleData | undefined>>,
): T[] {
  let out: T[] | null = null;
  tabs.forEach((tab, i) => {
    const sat = nodeMap[satelliteIdOfIframeTab(tab.id)];
    if (!sat || sat.bubbleType !== 'iframe' || !sat.url || sat.url === tab.url) return;
    out ??= [...tabs];
    out[i] = { ...tab, url: sat.url };
  });
  return out ?? tabs;
}

/**
 * 프리뷰 화면이 새 탭 주소로 옮겨야 하는가.
 * - 다른 탭으로 바뀌었다(본창은 key 없이 같은 칸을 이어 쓴다) → 언제나.
 * - 같은 탭의 주소가 바뀌었다(위성 주소를 따라감) → 사용자가 주소창으로 딴 데를 보고 있지 않을 때만.
 */
export function shouldIframeViewFollow(
  prev: { tabId: string; url: string },
  next: { tabId: string; url: string },
  currentUrl: string,
): boolean {
  if (prev.tabId !== next.tabId) return true;
  if (prev.url === next.url) return false;
  return currentUrl === prev.url;
}

// ─── 불러오기 전에 묻기 ───
//
// 스냅샷을 따라가는 것(위)만으로는 모자란다. 스냅샷은 창이 구독한 프로젝트만 싣는다(§9) — B 를 보는 동안
// A 에서 연 탭을 누르면 클라는 A 의 위성이 옮겨졌는지·걷혔는지 모른다. 그 사이 A 의 서버가 내려가고 B 가
// 같은 주소를 잡았으면 탭은 B 의 화면을 다시 불러온다. 그래서 탭은 화면을 불러오기 직전(그리고 떠 있는
// 동안)에 **그 탭을 연 프로젝트 기준으로** 서버에 묻는다(`GET /api/iframe-tab-check`).

/** 탭이 떠 있는 동안 소속을 다시 묻는 간격 — 서버의 리스너 캐시 수명(5초)과 같은 리듬. */
export const IFRAME_TAB_RECHECK_MS = 5_000;

/** 첫 판정을 기다리는 상한. 넘으면 판정 불가로 보고 보여 준다(막지 않는다 — 다음 확인에서 갈린다). */
export const IFRAME_TAB_FIRST_CHECK_TIMEOUT_MS = 4_000;

/** 소속 판정 요청 경로. 물을 근거(연 프로젝트 · 위성 id)가 둘 다 없으면 null — 묻지 않고 보여 준다. */
export function iframeTabCheckPath(tab: { tabId: string; projectPath?: string | undefined; url: string }): string | null {
  const satellite = tab.tabId.startsWith('sat-') ? tab.tabId.slice(4) : '';
  if (!tab.projectPath && !satellite) return null;
  const q = new URLSearchParams();
  if (tab.projectPath) q.set('project', tab.projectPath);
  if (satellite) q.set('satellite', satellite);
  q.set('url', tab.url);
  return `/api/iframe-tab-check?${q.toString()}`;
}

/** 서버 응답 → 판정. 모양이 어긋나면 `show`(판정 불가로 막지 않는다). */
export function parseIframeTabVerdict(raw: unknown): IframeTabVerdict {
  if (!raw || typeof raw !== 'object') return { action: 'show' };
  const r = raw as Record<string, unknown>;
  if (r['action'] === 'block') return { action: 'block' };
  if (r['action'] === 'follow' && typeof r['url'] === 'string' && r['url']) return { action: 'follow', url: r['url'] };
  return { action: 'show' };
}

/** 판정 하나를 탭 화면에 옮기는 규칙. */
export type IframeTabGuardStep =
  | { kind: 'set'; action: 'show' | 'block' }
  | { kind: 'follow'; url: string }
  | { kind: 'keep' };

/**
 * 판정(`null` = 시간 초과·실패) → 화면이 할 일.
 * - 판정 불가: 첫 확인이면 보여 준다(막지 않는다), 그 뒤로는 지금 상태를 유지한다 — 느린 확인 한 번이
 *   막아 둔 화면을 남의 화면으로 되돌리면 안 된다.
 * - `follow`: 탭 주소를 옮긴다(옮긴 주소로 다시 묻는다).
 */
export function iframeTabGuardStep(result: IframeTabVerdict | null, isFirst: boolean): IframeTabGuardStep {
  if (result === null) return isFirst ? { kind: 'set', action: 'show' } : { kind: 'keep' };
  if (result.action === 'follow') return { kind: 'follow', url: result.url };
  return { kind: 'set', action: result.action };
}
