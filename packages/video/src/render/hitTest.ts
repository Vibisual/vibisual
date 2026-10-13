/**
 * §5.13 (V) 37-6·37-7 — 화면의 한 점 아래 **무엇이 있나** (순수 — DOM 없음).
 *
 * 미리보기에서 가리키기(`P`)·메모(`N`)·더블클릭 제자리 고치기가 쓴다. 그리기 목록(`buildDrawList`)의 상자로 맨 위에 있는
 * 것부터 찾는다 — 그리는 순서가 곧 앞뒤이므로 목록의 끝이 맨 앞이다. 컴포지션 **안쪽**(글자 하나)은 여기서 모른다 —
 * 무대가 그 상자를 받아 샌드박스에 읽기 전용 `pick` 을 묻는다.
 *
 * 글자 아이템은 상자를 지정하지 않으면 화면 전체라, 화면 어디를 눌러도 글자가 잡히는 일이 없도록 **글자가 실제로 차지하는
 * 크기**를 어림한다(줄 수 × 글자 크기 × 줄 높이, 글자 수 × 글자 크기 × 폭 비율 — 라틴은 0.55, 그 밖(한글·한자)은 1).
 */

import type { ResolvedTimeline, VideoDoc } from '../types.js';
import { buildDrawList, type DrawOp } from './drawList.js';

export interface HitRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HitResult {
  readonly op: DrawOp;
  /** 그 아이템이 화면에서 차지하는 상자(문서 픽셀). 글자 아이템은 어림한 글자 상자. */
  readonly rect: HitRect;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 글자 한 개의 폭 비율 — 라틴·숫자·기호는 좁고, 그 밖(한글·한자·가나)은 정사각에 가깝다. */
function glyphRatio(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  return code < 0x2e80 ? 0.55 : 1;
}

/** 글자 아이템이 실제로 차지하는 상자 어림(상자 안 가운데·왼쪽·오른쪽 맞춤 반영). */
export function textBounds(op: DrawOp): HitRect {
  const box = op.transform;
  const props = op.resolved.item.props ?? {};
  const text = typeof props['text'] === 'string' ? props['text'] : '';
  const fontSize = num(props['fontSize'], 64);
  const lineHeight = num(props['lineHeight'], 1.3);
  const lines = text.split('\n');
  let widest = 0;
  for (const line of lines) {
    let w = 0;
    for (const ch of line) w += glyphRatio(ch) * fontSize;
    widest = Math.max(widest, w);
  }
  const width = Math.min(box.width, Math.max(fontSize, widest));
  const height = Math.min(box.height, Math.max(fontSize, lines.length * fontSize * lineHeight));
  const align = props['align'];
  const x = align === 'left' ? box.x : align === 'right' ? box.x + box.width - width : box.x + (box.width - width) / 2;
  return { x, y: box.y + (box.height - height) / 2, width, height };
}

/** 그 아이템의 상자 — 배치 + 크기 배율(가운데 기준). 회전은 무시한다(가리키기에는 충분하다). */
export function opRect(op: DrawOp): HitRect {
  if (op.kind === 'text') return textBounds(op);
  const t = op.transform;
  const w = t.width * t.scale;
  const h = t.height * t.scale;
  return { x: t.x + (t.width - w) / 2, y: t.y + (t.height - h) / 2, width: w, height: h };
}

function inside(r: HitRect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/** 시각 t, 문서 픽셀 (x, y) 아래 맨 위의 것. 없으면 undefined. 자막 트랙은 큐가 보일 때만 잡힌다. */
export function hitTest(doc: VideoDoc, timeline: ResolvedTimeline, t: number, x: number, y: number): HitResult | undefined {
  const ops = buildDrawList(doc, timeline, t);
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    if (!op) continue;
    // §5.13 (V) 37-8 — 전환 덧그림(빛 번짐)은 문서에 없는 것이라 고를 수 없다.
    if (op.synthetic) continue;
    if (op.kind === 'caption' && op.cues.length === 0) continue;
    if (op.kind === 'caption') {
      // 자막은 아래쪽 띠 — 화면 아래에서 `bottom` 만큼 위, 큐 글자 크기 두 줄 높이.
      const fontSize = num(op.resolved.item.props?.['fontSize'], 48);
      const bottom = num(op.resolved.item.props?.['bottom'], 96);
      const band: HitRect = { x: doc.size.width * 0.07, y: doc.size.height - bottom - fontSize * 2.6, width: doc.size.width * 0.86, height: fontSize * 2.6 };
      if (inside(band, x, y)) return { op, rect: band };
      continue;
    }
    const rect = opRect(op);
    if (inside(rect, x, y)) return { op, rect };
  }
  return undefined;
}
