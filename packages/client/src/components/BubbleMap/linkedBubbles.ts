/**
 * 연결 무리 계산 — "이 에이전트에 지금 무엇이 매달려 있는가"(React 없이 시험하는 순수 함수).
 * 근거는 **화면에 그려진 엣지**다 — 뷰마다 선이 달라, 스토어 관계(`nodeAgentRefs` 등)로 바꾸면 폴더 안에서 화면에 없는 버블까지 든다.
 * 범위는 1촉 + 그 이웃의 위성 — 전이적이면 캔버스 전체가 한 덩어리가 되고, 위성을 빼면 부모만 움직여 무리가 찢어진다.
 */

import { LINK_FOCUS } from '@vibisual/shared';

/** 무리 계산이 보는 엣지의 최소 모양 — React Flow `Edge` 도 그대로 들어맞는다. */
export interface LinkEdgeRef {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

/** 위성(부모에 매달려 도는 작은 버블) 관계의 최소 모양. */
export interface LinkSatelliteRef {
  readonly parentId: string;
  readonly id: string;
}

export interface LinkGroup {
  /** 무리의 중심 — 사용자가 잡은 그 버블. */
  readonly focusId: string;
  /** 중심에 매달린 버블들(중심 자신은 넣지 않는다). */
  readonly nodeIds: ReadonlySet<string>;
  /** 무리 안쪽을 잇는 엣지들 — 양 끝이 모두 무리(중심 포함) 안에 있는 선. */
  readonly edgeIds: ReadonlySet<string>;
}

/** 아무것도 잡지 않은 상태 — 스토어 초기값·해제 시 같은 참조를 재사용한다. */
export const EMPTY_LINK_GROUP: LinkGroup = {
  focusId: '',
  nodeIds: new Set<string>(),
  edgeIds: new Set<string>(),
};

/**
 * @param edges      지금 화면에 그려진 엣지 전부(활동 · 위성 · Task Edge · 소유)
 * @param satellites 위성 → 부모(부모가 무리에 들면 그 위성도 든다)
 */
export function computeLinkGroup(
  focusId: string,
  edges: readonly LinkEdgeRef[],
  satellites: readonly LinkSatelliteRef[] = [],
): LinkGroup {
  if (!focusId) return EMPTY_LINK_GROUP;

  // ① 1촉 이웃 — 중심에 직접 닿은 선의 반대편.
  const nodeIds = new Set<string>();
  for (const e of edges) {
    if (e.source === focusId && e.target !== focusId) nodeIds.add(e.target);
    else if (e.target === focusId && e.source !== focusId) nodeIds.add(e.source);
  }

  // ② 이웃의 위성 — 부모가 들어왔으면 그 위에 붙은 점들도 같은 덩어리다.
  //    중심 자신의 위성은 ①이 이미 잡았지만(위성 엣지), 엣지가 아직 안 그려진 프레임을
  //    위해 여기서도 한 번 더 본다(집합이라 중복은 무해하다).
  if (satellites.length > 0) {
    for (const s of satellites) {
      if (s.id === focusId) continue;
      if (s.parentId === focusId || nodeIds.has(s.parentId)) nodeIds.add(s.id);
    }
  }

  // ③ 무리 안쪽 선 — 양 끝이 모두 무리(중심 포함) 안이면 그 선도 무리의 것이다.
  //    이웃끼리 이어진 선(폴더 ↔ 그 폴더의 파일)까지 함께 밝아져야 덩어리로 읽힌다.
  const edgeIds = new Set<string>();
  for (const e of edges) {
    const srcIn = e.source === focusId || nodeIds.has(e.source);
    const tgtIn = e.target === focusId || nodeIds.has(e.target);
    if (srcIn && tgtIn) edgeIds.add(e.id);
  }

  return { focusId, nodeIds, edgeIds };
}

/** 이 버블이 무리에서 맡은 자리 — 강조 세기를 이 한 글자로 가른다. */
export type LinkRole = 'off' | 'focus' | 'linked' | 'dim';

/** 반환은 **문자열 원시값**이어야 한다 — 노드가 그대로 구독해 자기 자리가 바뀔 때만 깨어난다(§9). */
export function linkRoleOf(group: LinkGroup | null, nodeId: string): LinkRole {
  if (group === null || group.focusId === '') return 'off';
  if (nodeId === group.focusId) return 'focus';
  return group.nodeIds.has(nodeId) ? 'linked' : 'dim';
}

/** 엣지판 {@link linkRoleOf} — 엣지에는 중심이 없으므로 `linked` / `dim` 둘뿐이다. */
export function linkEdgeRoleOf(group: LinkGroup | null, edgeId: string): 'off' | 'linked' | 'dim' {
  if (group === null || group.focusId === '') return 'off';
  return group.edgeIds.has(edgeId) ? 'linked' : 'dim';
}

// ─── 강조 세기 → 실제 CSS 값 (순수 계산) ───

/** 강조를 얼마나 세게 거는가 — 미리보기(hover)와 확정(grab)이 같은 축 위의 두 점이다. */
export type LinkFocusStrengthPhase = 'off' | 'hover' | 'grab';

/** `1`(안 걸림)과 `to` 사이를 세기 `k` 로 보간. */
function lerpFromOne(to: number, k: number): number {
  return 1 + (to - 1) * k;
}

/** 이 단계의 세기(0~1). 미리보기는 확정보다 옅다. */
export function linkFocusStrength(phase: LinkFocusStrengthPhase): number {
  if (phase === 'grab') return 1;
  if (phase === 'hover') return LINK_FOCUS.HOVER_STRENGTH;
  return 0;
}

export interface LinkNodeVisual {
  /** 이 버블의 원래 불투명도에 **곱할** 값(1 = 그대로). */
  readonly opacityMul: number;
  /** CSS `filter` — 걸 것이 없으면 `null`. */
  readonly filter: string | null;
  /** 링·글로우 `box-shadow` — 걸 것이 없으면 `null`. */
  readonly boxShadow: string | null;
}

const NO_NODE_VISUAL: LinkNodeVisual = { opacityMul: 1, filter: null, boxShadow: null };

/** 불투명도는 **곱으로** 돌려준다 — 덮어쓰면 사라지는 중(`disappearing`)·죽은 프리뷰(`iframeAlive===false`)의 제 투명도가 지워진다. */
export function linkFocusNodeStyle(role: LinkRole, phase: LinkFocusStrengthPhase): LinkNodeVisual {
  if (role === 'off' || phase === 'off') return NO_NODE_VISUAL;
  const k = linkFocusStrength(phase);
  const rgb = LINK_FOCUS.TINT_RGB;

  if (role === 'dim') {
    return {
      opacityMul: lerpFromOne(LINK_FOCUS.DIM_OPACITY, k),
      filter: `saturate(${lerpFromOne(LINK_FOCUS.DIM_SATURATE, k).toFixed(3)})`,
      boxShadow: null,
    };
  }

  const isFocus = role === 'focus';
  const ringW = isFocus ? LINK_FOCUS.FOCUS_RING_WIDTH : LINK_FOCUS.RING_WIDTH;
  const ringA = (isFocus ? LINK_FOCUS.FOCUS_RING_ALPHA : LINK_FOCUS.RING_ALPHA) * k;
  const glowA = (isFocus ? LINK_FOCUS.FOCUS_GLOW_ALPHA : LINK_FOCUS.GLOW_ALPHA) * k;
  const glowB = isFocus ? LINK_FOCUS.FOCUS_GLOW_BLUR : LINK_FOCUS.GLOW_BLUR;
  return {
    opacityMul: 1,
    filter: `brightness(${lerpFromOne(LINK_FOCUS.LIT_BRIGHTNESS, k).toFixed(3)})`,
    boxShadow:
      `0 0 0 ${ringW}px rgba(${rgb},${ringA.toFixed(3)}), `
      + `0 0 ${glowB}px ${Math.round(glowB / 4)}px rgba(${rgb},${glowA.toFixed(3)})`,
  };
}

export interface LinkEdgeVisual {
  /** 엣지 불투명도에 **곱할** 값. */
  readonly opacityMul: number;
  /** 선 굵기에 **곱할** 값. */
  readonly widthMul: number;
}

const NO_EDGE_VISUAL: LinkEdgeVisual = { opacityMul: 1, widthMul: 1 };

/** 엣지 한 줄의 강조 표현. 무리 밖 선은 버블보다 더 물러난다(선이 남으면 시야가 어지럽다). */
export function linkFocusEdgeStyle(
  role: 'off' | 'linked' | 'dim',
  phase: LinkFocusStrengthPhase,
): LinkEdgeVisual {
  if (role === 'off' || phase === 'off') return NO_EDGE_VISUAL;
  const k = linkFocusStrength(phase);
  if (role === 'dim') {
    return { opacityMul: lerpFromOne(LINK_FOCUS.EDGE_DIM_OPACITY, k), widthMul: 1 };
  }
  return {
    opacityMul: lerpFromOne(LINK_FOCUS.EDGE_LIT_OPACITY, k),
    widthMul: lerpFromOne(LINK_FOCUS.EDGE_LIT_WIDTH, k),
  };
}
