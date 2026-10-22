/**
 * linkView.ts — §5.4 #36 (H) **연결 보기**의 화면 쪽 순수 판정 한 벌.
 *
 * ① 켜고 끄기(`linksHidden`) · ② 보기 전환(`linkLens` — "앱 관련 버블만" 기본 ↔ "버블 전부") · ③ 앱 노드가 구슬 줄
 * (연결된 것 위성)을 펴는가를, 캔버스 선(`BubbleMap`) · 위성줄(`refLinkPairs`) · 메뉴(`BubbleContextMenu`) · 앱 노드
 * (`AppBubbleNode`)가 **같은 답**으로 내야 한다. 한 곳만 고쳐져 "메뉴는 숨겼다는데 선이 보이는" 자리가 생기지 않게
 * 판정을 여기 모은다. DOM·store 를 만지지 않으므로 그대로 단위 테스트된다.
 *
 * 전부 **표시 계층**이다 — 서버의 활동 엣지·`linkedAgentIds`·위성 칩·결과 전달·#31 무리 판정은 이 파일과 무관하게 그대로 돈다.
 */

import type { Edge } from '@xyflow/react';
import type { AppBubble, BubbleData, LinkLens } from '@vibisual/shared';
import { LINK_VIEW } from '@vibisual/shared';

type AgentView = Pick<BubbleData, 'id' | 'bubbleType' | 'linksHidden' | 'linkLens'>;
type AppLinkView = Pick<AppBubble, 'projectName' | 'linkedAgentIds'>;

/** 이 에이전트를 참조하는 앱 노드가 하나라도 있는가 — "연결 버블"인가. `projectName` 을 주면 그 프로젝트 것만(§3.5). */
export function agentHasAppLinks(
  appBubbles: readonly AppLinkView[],
  agentId: string,
  projectName?: string | null,
): boolean {
  return appBubbles.some(
    (b) => (projectName ? b.projectName === projectName : true) && (b.linkedAgentIds ?? []).includes(agentId),
  );
}

/**
 * 지금 보기. 앱 노드가 이어지지 않은 에이전트는 늘 **작업 파일**이다 — 위주로 볼 연결된 것이 없다.
 * 이어졌으면 기본이 **연결된 것 위주**이고(사용자 지시), 사용자가 바꿨을 때만(`linkLens:'files'`) 작업 파일이다.
 */
export function effectiveLinkLens(
  agent: Pick<BubbleData, 'linkLens'> | null | undefined,
  hasAppLinks: boolean,
): LinkLens {
  if (!hasAppLinks) return 'files';
  return agent?.linkLens === 'files' ? 'files' : 'linked';
}

/** 캔버스가 한 번 모아 두는 판정 재료 — 선을 감춘 에이전트(①), 활동 선을 흐릴 에이전트(② 연결된 것 위주). */
export interface LinkViewSets {
  readonly hidden: ReadonlySet<string>;
  readonly dimmed: ReadonlySet<string>;
}

/** 아무것도 바꾸지 않는 재료 — 한 객체를 돌려 써서 무변화 비교가 참조로 끝나게. */
export const EMPTY_LINK_VIEW: LinkViewSets = { hidden: new Set<string>(), dimmed: new Set<string>() };

/** 화면에 있는 에이전트들과 앱 노드들에서 판정 재료를 모은다. 끈 에이전트는 흐릴 목록에 넣지 않는다(① 이 이긴다). */
export function linkViewSets(
  agents: readonly AgentView[],
  appBubbles: readonly AppLinkView[],
  projectName?: string | null,
): LinkViewSets {
  const linked = new Set<string>();
  for (const b of appBubbles) {
    if (projectName && b.projectName !== projectName) continue;
    for (const id of b.linkedAgentIds ?? []) linked.add(id);
  }
  const hidden = new Set<string>();
  const dimmed = new Set<string>();
  for (const a of agents) {
    if (a.bubbleType !== 'agent') continue;
    if (a.linksHidden === true) {
      hidden.add(a.id);
      continue;
    }
    if (effectiveLinkLens(a, linked.has(a.id)) === 'linked') dimmed.add(a.id);
  }
  if (hidden.size === 0 && dimmed.size === 0) return EMPTY_LINK_VIEW;
  return { hidden, dimmed };
}

/** 판정 재료의 **지문** — memo 열쇠로 쓴다(집합째 의존하면 매 스냅샷 새 참조라 선이 매번 다시 지어진다). */
export function linkViewKey(sets: LinkViewSets): string {
  if (sets.hidden.size === 0 && sets.dimmed.size === 0) return '';
  return `${[...sets.hidden].sort().join(',')}|${[...sets.dimmed].sort().join(',')}`;
}

export type ActivityEdgeView = 'show' | 'dim' | 'hide';

/** 활동·위성 선 하나를 어떻게 그리나. 에이전트 끝점만 본다 — 끈 쪽이 이긴다(감춤 > 흐림). */
export function activityEdgeView(source: string, target: string, sets: LinkViewSets): ActivityEdgeView {
  if (sets.hidden.has(source) || sets.hidden.has(target)) return 'hide';
  if (sets.dimmed.has(source) || sets.dimmed.has(target)) return 'dim';
  return 'show';
}

/**
 * 이 판정이 맡는 선인가 — 활동·위성 선(`curved`, 기본 타입)만이다. Task Edge(사용자가 그은 위임)·플레이 프리뷰 소유 선은
 * 대상이 아니고, 위성줄은 `refLinkPairs` 가 따로 거른다.
 */
export function isActivityEdge(edge: Pick<Edge, 'id' | 'type'>): boolean {
  return (edge.type === undefined || edge.type === 'curved') && !edge.id.startsWith('play-owner-');
}

/**
 * 선 목록에 연결 보기를 입힌다. 감출 선은 `hidden` — **목록에서 빼지 않는다**(폴더 버블의 생존·고른 것·#31 무리 판정이
 * 활동 엣지를 그대로 보므로, 위에서 거르면 폴더째 사라진다). 흐릴 선은 불투명도에 `LINK_VIEW.dimOpacity` 를 곱한다.
 * 바꿀 것이 없으면 **같은 배열**을 돌려준다 — React Flow 가 무변화에 다시 그리지 않게.
 */
export function applyLinkViewToEdges(edges: readonly Edge[], sets: LinkViewSets): Edge[] {
  if (sets.hidden.size === 0 && sets.dimmed.size === 0) return edges as Edge[];
  let changed = false;
  const out = edges.map((e) => {
    if (!isActivityEdge(e)) return e;
    const view = activityEdgeView(e.source, e.target, sets);
    if (view === 'show') return e;
    changed = true;
    if (view === 'hide') return { ...e, hidden: true };
    const base = typeof e.style?.opacity === 'number' ? e.style.opacity : 1;
    return { ...e, style: { ...e.style, opacity: base * LINK_VIEW.dimOpacity } };
  });
  return changed ? out : (edges as Edge[]);
}

/** 위성줄 한 가닥이 그려지는가 — 양 끝 중 하나라도 끄면 숨는다(①). */
export function refLinkVisible(
  agentId: string,
  appBubble: Pick<AppBubble, 'linksHidden'>,
  hiddenAgentIds: ReadonlySet<string> | undefined,
): boolean {
  return appBubble.linksHidden !== true && hiddenAgentIds?.has(agentId) !== true;
}

/**
 * 앱 노드가 "연결된 것" 구슬 줄을 펴는가(③). 노드에서 끈 것(①)만 접는다.
 *
 * 이어진 에이전트의 보기(②)는 묻지 않는다 — [앱 관련 버블만 보기]에서도 [버블 전부 보기]에서도 편다(2026-10-21 — "버블
 * 전부"에서 구슬을 접으면 이름이 거짓이 된다. 종전에는 이어진 에이전트가 모두 "작업 파일" 보기면 접었다). 에이전트 쪽 끄기(①)도
 * 구슬 줄을 접지 않는다 — 구슬은 그 노드의 것이고, 에이전트가 감춘 것은 자기에게 닿는 선이다.
 */
export function appNodeShowsLinkedItems(bubble: Pick<AppBubble, 'linksHidden'>): boolean {
  return bubble.linksHidden !== true;
}
