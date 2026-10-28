/**
 * §5.1 #2-1 (B) — **묶음 안 배치**(고리가 아니라 무리). 순수 함수 — 캔버스와 IDE 세션 지도가 같은 `useInteriorLayout` 으로 탄다.
 * 지름은 **사용 횟수**(넓이 비례) — 재는 곳은 `calcBubbleSize` 한 곳(`withBundleUsageRange` 사본의 `_usageRange` — 렌더·물리·선 끝점이 같은 자).
 * 많이 쓴 것이 가운데, 나머지는 차례로 맞닿는 빈자리 중 가운데에 가장 가까운 곳(가로로 긴 타원으로 잰다). 이름 줄(`FileFaceRim`)까지 몸으로 친다 —
 * 폭은 글자 수로 어림한다(렌더 중 DOM 측정은 리플로). 같은 입력은 같은 그림(동률은 최근 것 → id).
 */
import type { XYPosition } from '@xyflow/react';
import type { BubbleData, HeatScale } from '@vibisual/shared';
import { BUNDLE_BUBBLE, FILE_FACE, fileFaceKindOf } from '@vibisual/shared';

import { calcBubbleSize, fileUsageOf } from './sizeCalc.js';

/** 이름 줄 글자 폭 어림(px) — `FileFaceRim` 의 `text-[12px]` 기준. 한글·한자·가나는 한 칸, 나머지는 반 칸 남짓. */
const CAPTION_WIDE_CHAR_PX = 12;
const CAPTION_NARROW_CHAR_PX = 7;
/** 넓은 글자로 치는 코드 포인트 하한 — 한글 자모(U+1100)부터 위는 전각 폭으로 본다. */
const CAPTION_WIDE_CODE_POINT = 0x1100;
/** 영상·소리 이름 뒤에 붙는 길이(` · 0:16`)의 폭 어림(px). */
const CAPTION_DURATION_PX = 44;
/** 같은 구성을 다시 앉히지 않으려고 기억해 두는 배치 수(스냅샷마다 같은 묶음을 다시 잰다). */
const LAYOUT_CACHE_MAX = 8;
/**
 * 맞닿음 판정의 여유(px) — 후보 자리는 이웃과 꼭 틈만큼 떨어지게 cos·sin 으로 짓는데, 부동소수 끝자리가 그 거리를 아주 조금 줄이면
 * 맞닿은 자리가 "겹친다"로 버려져 무리가 헐거워진다.
 */
const TOUCH_EPSILON = 1e-6;

/** 앉힐 몸 하나 — 원(가운데 · 반지름)과 그 아래 이름 줄(반폭). */
interface Body {
  readonly id: string;
  readonly r: number;
  readonly half: number;
  x: number;
  y: number;
}

/** 원 아래 이름 줄의 폭 어림(px) — 최대 폭은 `FileFaceRim` 과 같은 `FILE_FACE.captionMaxWidth`. */
export function captionWidthOf(bubble: Pick<BubbleData, 'label' | 'path' | 'absolutePath'>, diameter: number): number {
  let width = 0;
  for (const ch of bubble.label ?? '') {
    width += (ch.codePointAt(0) ?? 0) >= CAPTION_WIDE_CODE_POINT ? CAPTION_WIDE_CHAR_PX : CAPTION_NARROW_CHAR_PX;
  }
  const kind = fileFaceKindOf(bubble.absolutePath || bubble.path || bubble.label || '');
  if (kind === 'video' || kind === 'audio') width += CAPTION_DURATION_PX;
  return Math.min(width, Math.max(diameter * FILE_FACE.captionMaxWidth.ratio, FILE_FACE.captionMaxWidth.min));
}

/** 묶음 안 차례 — 많이 쓴 것 → 최근에 쓴 것 → id(같은 입력은 같은 그림). */
function compareMembers(a: BubbleData, b: BubbleData): number {
  return (fileUsageOf(b) - fileUsageOf(a))
    || ((b.lastActivity ?? 0) - (a.lastActivity ?? 0))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 이름 줄의 위·아래(원 가운데 기준 절대 좌표). */
function captionTop(b: Body): number {
  return b.y + b.r + FILE_FACE.captionGap;
}

/** 원 `c` 가 `owner` 의 이름 줄 상자에 틈 `gap` 안으로 닿는가. */
function circleHitsCaption(c: Body, owner: Body, gap: number): boolean {
  if (owner.half <= 0) return false;
  const top = captionTop(owner);
  const nx = Math.max(owner.x - owner.half, Math.min(c.x, owner.x + owner.half));
  const ny = Math.max(top, Math.min(c.y, top + FILE_FACE.captionLineHeight));
  const dx = c.x - nx;
  const dy = c.y - ny;
  const reach = c.r + gap - TOUCH_EPSILON;
  return dx * dx + dy * dy < reach * reach;
}

/** 두 이름 줄 상자가 틈 `gap` 안으로 겹치는가. */
function captionsOverlap(a: Body, b: Body, gap: number): boolean {
  if (a.half <= 0 || b.half <= 0) return false;
  const aTop = captionTop(a);
  const bTop = captionTop(b);
  const span = FILE_FACE.captionLineHeight + gap - TOUCH_EPSILON;
  return Math.abs(a.x - b.x) < a.half + b.half + gap - TOUCH_EPSILON && aTop < bTop + span && bTop < aTop + span;
}

/** 두 몸(원 + 이름 줄)이 틈 `gap` 안으로 부딪히는가. */
function clash(a: Body, b: Body, gap: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r + gap - TOUCH_EPSILON;
  if (dx * dx + dy * dy < rr * rr) return true;
  return circleHitsCaption(a, b, gap) || circleHitsCaption(b, a, gap) || captionsOverlap(a, b, gap);
}

const layoutCache = new Map<string, Map<string, XYPosition>>();

/**
 * 묶음 안 자리(React Flow 노드의 좌상단). `members` 는 사용 횟수 범위가 실린 사본(`withBundleUsageRange`)이어야 지름이 사용
 * 횟수로 잰다. `back` 은 무리의 왼쪽 위 바깥에 선다.
 */
export function packBundleInterior(
  members: readonly BubbleData[],
  back: BubbleData | null,
  center: { readonly x: number; readonly y: number },
  heat: HeatScale | undefined,
): Map<string, XYPosition> {
  const gap = BUNDLE_BUBBLE.interiorGap;
  const order = [...members].sort(compareMembers);
  const bodies: Body[] = order.map((m) => {
    const d = calcBubbleSize(m, undefined, heat);
    return { id: m.id, r: d / 2, half: captionWidthOf(m, d) / 2, x: center.x, y: center.y };
  });
  const backSize = back ? calcBubbleSize(back, undefined, heat) : 0;
  const signature = `${center.x},${center.y},${back?.id ?? ''}:${backSize}|${bodies.map((b) => `${b.id}:${b.r}:${b.half}`).join('|')}`;
  const hit = layoutCache.get(signature);
  if (hit) return hit;

  const aspect = BUNDLE_BUBBLE.interiorAspect;
  const directions = Math.max(4, BUNDLE_BUBBLE.interiorSeatDirections);
  const captionDrop = FILE_FACE.captionGap + FILE_FACE.captionLineHeight;
  const scoreOf = (x: number, y: number): number => {
    const dx = (x - center.x) / aspect;
    const dy = y - center.y;
    return dx * dx + dy * dy;
  };

  const positions = new Map<string, XYPosition>();
  const placed: Body[] = [];
  for (const body of bodies) {
    if (placed.length > 0) {
      let bestX = 0;
      let bestY = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const p of placed) {
        // 맞닿는 고리 둘 — 원끼리 맞닿는 거리 · 이름 줄 하나만큼 더 먼 거리(아래 이웃의 이름 줄 밑이나, 내 이름 줄이 이웃의 원 위에 걸릴 때).
        for (const dist of [p.r + body.r + gap, p.r + captionDrop + body.r + gap]) {
          for (let k = 0; k < directions; k += 1) {
            const angle = (2 * Math.PI * k) / directions;
            const x = p.x + Math.cos(angle) * dist;
            const y = p.y + Math.sin(angle) * dist;
            const score = scoreOf(x, y);
            if (score >= bestScore) continue;
            body.x = x;
            body.y = y;
            if (placed.some((q) => clash(body, q, gap))) continue;
            bestX = x;
            bestY = y;
            bestScore = score;
          }
        }
      }
      if (bestScore === Number.POSITIVE_INFINITY) {
        // 바깥 둘레에는 늘 빈자리가 있어 오지 않는다 — 와도 겹치지 않게 무리 아래에 선다.
        bestX = center.x;
        bestY = Math.max(...placed.map((q) => captionTop(q) + FILE_FACE.captionLineHeight)) + gap + body.r;
      }
      body.x = bestX;
      body.y = bestY;
    }
    placed.push(body);
    positions.set(body.id, { x: body.x - body.r, y: body.y - body.r });
  }

  if (back) {
    // 무리의 왼쪽 위 바깥 — 가장 왼쪽(원·이름 줄 중 넓은 쪽) 끝에서 틈 둘만큼, 가운데 높이는 무리의 위 끝.
    let minX = center.x;
    let minY = center.y;
    for (const b of placed) {
      minX = Math.min(minX, b.x - Math.max(b.r, b.half));
      minY = Math.min(minY, b.y - b.r);
    }
    positions.set(back.id, { x: minX - gap * 2 - backSize, y: minY - backSize / 2 });
  }

  if (layoutCache.size >= LAYOUT_CACHE_MAX) {
    const oldest = layoutCache.keys().next().value;
    if (oldest !== undefined) layoutCache.delete(oldest);
  }
  layoutCache.set(signature, positions);
  return positions;
}
