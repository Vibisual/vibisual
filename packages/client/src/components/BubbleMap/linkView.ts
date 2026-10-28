/**
 * §5.4 #36 (H) — 연결 보기 판정 한 벌: ① `linksHidden` ② `linkLens`(앱 관련만 ↔ 전부) ③ 구슬 줄. 캔버스 선·위성줄·메뉴·앱 노드가 같은 답을 낸다.
 * 표시 계층일 뿐 — 서버 활동 엣지·`linkedAgentIds`·위성 칩·결과 전달·#31 무리 판정과 무관하다.
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

/** 앱 노드가 안 이어진 에이전트는 늘 작업 파일, 이어졌으면 기본이 연결 위주(`linkLens:'files'` 로 바꿨을 때만 작업 파일). */
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

/** 활동·위성 선(`curved`·기본)만 — Task Edge·플레이 프리뷰 소유 선은 대상 아님, 위성줄은 `refLinkPairs` 가 거른다. */
export function isActivityEdge(edge: Pick<Edge, 'id' | 'type'>): boolean {
  return (edge.type === undefined || edge.type === 'curved') && !edge.id.startsWith('play-owner-');
}

/** 감출 선은 `hidden` 으로 — 목록에서 빼면 폴더 생존·선택·#31 무리 판정이 엣지를 못 봐 폴더째 사라진다. 흐릴 선은 `LINK_VIEW.dimOpacity` 곱. 무변화면 같은 배열. */
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

/** 노드에서 끈 것(①)만 접는다. 에이전트의 보기(②)·끄기(①)는 묻지 않는다 — "버블 전부"에서 접으면 이름이 거짓이고, 에이전트가 감추는 건 자기에게 닿는 선이다. */
export function appNodeShowsLinkedItems(bubble: Pick<AppBubble, 'linksHidden'>): boolean {
  return bubble.linksHidden !== true;
}
