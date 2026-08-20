/**
 * 콘티 → 타임라인 (SCENARIO.md §5.13 (Q)).
 *
 * 캔버스에 그려 둔 스토리보드 한 벌을 이 앱의 문서로 **옮기는** 순수 함수다. 문서를
 * 직접 쓰지 않고 §5.13 (G) 편집 연산 배열만 만든다 — 그래야 낙관적 잠금·검증·진단이
 * 평소 경로 그대로 걸리고, 이 파일은 파일 시스템도 네트워크도 모른 채 남는다.
 *
 * 지키는 것 셋:
 *
 * 1. **컷의 좌표계는 320×180 고정.** 프리셋은 *출력* 판형이지 스케치 판형이 아니다.
 *    옮길 때 그 상자를 출력 화면 안으로 담아(contain) 배치하고 좌표만 비례로 옮긴다.
 * 2. **스탬프 SVG 를 복제하지 않는다.** 스탬프는 카탈로그 기본 치수를 가진 라벨 도형으로
 *    내린다. 복제하면 보드와 영상에 같은 그림이 두 벌 생기고, 그 순간부터 어긋나기 시작한다.
 * 3. **시각은 절대 초로 적는다.** 이 문서의 컷은 고정 격자이고 자막 큐는 스키마상 절대
 *    시각이라(§5.13 (D) `CaptionCue.start/end`), 아이템만 상대 앵커로 두면 나중에 컷을
 *    하나 끼울 때 그림과 자막이 서로 다른 곳으로 밀린다. 둘을 같은 좌표계에 둔다.
 */

import type { ContiElement, ContiFrame, StoryboardPreset } from '@vibisual/shared';
import { CONTI_DEFAULTS, STAMP_CATALOG } from '@vibisual/shared';
import { applyPatch, createEmptyDoc } from './ops.js';
import {
  STORYBOARD_CAPTION_TRACK,
  STORYBOARD_MARGIN_RATIO,
  STORYBOARD_MAX_ITEMS,
  STORYBOARD_VISUAL_TRACK,
} from './constants.js';
import type { VideoDoc, VideoDocOp, VideoItem } from './types.js';

/** 콘티 좌표계 — 프리셋과 무관하게 고정이다. */
const VB_W = CONTI_DEFAULTS.viewBoxWidth;
const VB_H = CONTI_DEFAULTS.viewBoxHeight;

/** 콘티 디자인 토큰(§5.3 #28 v1.61)과 같은 값. 보드와 영상의 톤을 하나로 둔다. */
const COLOR_CANVAS = '#0F1117';
const COLOR_PANEL = '#242833';
const COLOR_EDGE = 'rgba(255,255,255,0.10)';
const COLOR_TEXT = '#E8E8E8';
const COLOR_SUB = '#9CA3AF';
const COLOR_STAMP_FILL = 'rgba(255,255,255,0.04)';
const COLOR_STAMP_EDGE = '#4B5563';

export interface StoryboardRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 한 컷이 출력 화면 어디에 앉는가. 프리셋 하나당 한 벌이며 컷마다 같다. */
export interface StoryboardLayout {
  /** 320×180 스케치가 담기는 상자. */
  readonly panel: StoryboardRect;
  /** 컷 제목이 앉는 띠. */
  readonly title: StoryboardRect;
  /** `stacked` 프리셋에서만 — 판넬 아래 인쇄 블록. 아니면 null(행동은 자막으로 간다). */
  readonly action: StoryboardRect | null;
  /** 콘티 좌표 → 출력 좌표 배율. */
  readonly scale: number;
  readonly titleFontSize: number;
  readonly actionFontSize: number;
}

/**
 * 프리셋 하나의 배치를 정한다.
 *
 * 세 판형이 다른 것은 **판넬을 어디에 두고 행동을 어떻게 보여 주느냐**뿐이다.
 * 가로는 판넬이 화면을 채우고 행동은 자막으로, 세로는 판넬이 가운데 띠로,
 * 웹툰은 판넬을 위에 두고 아래에 행동을 인쇄한다.
 */
export function storyboardLayout(preset: StoryboardPreset): StoryboardLayout {
  const W = preset.output.width;
  const H = preset.output.height;
  const shortEdge = Math.min(W, H);
  const margin = Math.round(shortEdge * STORYBOARD_MARGIN_RATIO);

  // 판넬 가로폭은 항상 여백을 뺀 전폭이되, 화면보다 높아지지 않게 담는다(contain).
  const maxPanelW = W - margin * 2;
  const maxPanelH = preset.stacked ? Math.round(H * 0.5) : H - margin * 2;
  const scale = Math.min(maxPanelW / VB_W, maxPanelH / VB_H);
  const panelW = Math.round(VB_W * scale);
  const panelH = Math.round(VB_H * scale);

  const titleFontSize = Math.max(18, Math.round(shortEdge * 0.036));
  const actionFontSize = Math.max(16, Math.round(shortEdge * 0.030));
  const titleH = Math.round(titleFontSize * 2.0);

  const panelX = Math.round((W - panelW) / 2);
  const panelY = preset.stacked
    ? margin + titleH + Math.round(margin * 0.5)
    : Math.round((H - panelH) / 2);

  const panel: StoryboardRect = { x: panelX, y: panelY, width: panelW, height: panelH };

  // 제목 띠 — 판넬 위에 자리가 있으면 그 위에, 없으면(가로 판형) 판넬 안쪽 위에 얹는다.
  const roomAbove = panelY - margin;
  const title: StoryboardRect =
    roomAbove >= titleH
      ? { x: panelX, y: panelY - titleH - Math.round(margin * 0.3), width: panelW, height: titleH }
      : { x: panelX + margin, y: panelY + margin, width: panelW - margin * 2, height: titleH };

  const actionTop = panelY + panelH + margin;
  const action: StoryboardRect | null = preset.stacked
    ? { x: panelX, y: actionTop, width: panelW, height: Math.max(actionFontSize * 3, H - actionTop - margin) }
    : null;

  return { panel, title, action, scale, titleFontSize, actionFontSize };
}

export interface StoryboardBuildArgs {
  /** 옮길 컷들. 순서가 곧 시간 순서다. */
  readonly frames: readonly ContiFrame[];
  readonly preset: StoryboardPreset;
  /** 문서 제목(콘티 제목을 그대로 쓴다). */
  readonly title: string;
}

/**
 * 컷들을 편집 연산 배열로 옮긴다.
 *
 * 트랙은 새로 만들지 않는다 — 빈 문서가 이미 `visual`/`audio`/`caption` 셋을 갖고
 * 나오므로(`createEmptyDoc`) 거기에 얹기만 하면 사람이 나중에 쓰던 트랙 구성이 흔들리지 않는다.
 */
export function buildStoryboardOps(args: StoryboardBuildArgs): VideoDocOp[] {
  const { frames, preset } = args;
  const layout = storyboardLayout(preset);
  const ops: VideoDocOp[] = [
    {
      op: 'setDoc',
      patch: {
        title: args.title,
        size: { width: preset.output.width, height: preset.output.height },
        fps: preset.fps,
      },
    },
  ];

  /** 같은 id 가 두 번 나오면 패치가 통째로 거절된다 — 여기서 먼저 갈라 준다. */
  const used = new Set<string>();
  const uniqueId = (base: string): string => {
    let id = base;
    let n = 2;
    while (used.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    used.add(id);
    return id;
  };

  let count = 0;
  const push = (trackId: string, item: VideoItem): void => {
    if (count >= STORYBOARD_MAX_ITEMS) return;
    count += 1;
    ops.push({ op: 'addItem', trackId, item });
  };

  frames.forEach((frame, index) => {
    const start = round3(index * preset.secondsPerFrame);
    const duration = preset.secondsPerFrame;
    const base = `sb-${frame.id}`;

    // 바탕 — transform 을 비우면 문서 전체 크기가 된다.
    push(STORYBOARD_VISUAL_TRACK, {
      id: uniqueId(`${base}-bg`),
      kind: 'shape',
      at: start,
      duration,
      props: { shape: 'rect', fill: COLOR_CANVAS },
    });

    // 판넬 — 컷이 스케치를 그리지 않았을 때도 판형이 보이게 하는 바닥.
    push(STORYBOARD_VISUAL_TRACK, {
      id: uniqueId(`${base}-panel`),
      kind: 'shape',
      at: start,
      duration,
      transform: layout.panel,
      props: {
        shape: 'rect',
        fill: COLOR_PANEL,
        stroke: COLOR_EDGE,
        strokeWidth: Math.max(1, Math.round(layout.scale * 1.5)),
        radius: Math.round(layout.scale * 4),
      },
    });

    for (const el of frame.elements) {
      for (const item of mapElement(el, layout, base, start, duration, uniqueId)) {
        push(STORYBOARD_VISUAL_TRACK, item);
      }
    }

    if (frame.title.trim() !== '') {
      push(STORYBOARD_VISUAL_TRACK, {
        id: uniqueId(`${base}-title`),
        kind: 'text',
        at: start,
        duration,
        transform: layout.title,
        props: {
          text: frame.title,
          fontSize: layout.titleFontSize,
          fontWeight: '700',
          color: COLOR_TEXT,
          align: 'left',
        },
      });
    }

    const action = frame.action.trim();
    if (action === '') return;

    if (layout.action) {
      // 웹툰 판형 — 판넬 아래 인쇄 블록(자막 ❌, 같은 글이 두 번 나오지 않게).
      push(STORYBOARD_VISUAL_TRACK, {
        id: uniqueId(`${base}-action`),
        kind: 'text',
        at: start,
        duration,
        transform: layout.action,
        props: {
          text: action,
          fontSize: layout.actionFontSize,
          fontWeight: '500',
          color: COLOR_SUB,
          align: 'left',
          lineHeight: 1.45,
        },
      });
      return;
    }

    push(STORYBOARD_CAPTION_TRACK, {
      id: uniqueId(`${base}-caption`),
      kind: 'caption',
      at: start,
      duration,
      // 큐는 문서 전체 기준 절대 시각이다 — 아이템 시작과 같은 좌표계로 둔다.
      cues: [{ start, end: round3(start + duration), text: action }],
      props: { fontSize: layout.actionFontSize, color: COLOR_TEXT },
    });
  });

  return ops;
}

/**
 * 컷들을 문서 한 벌로 만든다.
 *
 * 서버·테스트가 "이 콘티는 어떤 영상이 되나"를 파일 없이 물어볼 수 있게 하는 자리다.
 * 실제 저장은 언제나 REST 패치 경로로 간다.
 */
export function buildStoryboardDoc(args: StoryboardBuildArgs & { docId: string; now?: number }): VideoDoc {
  const empty = createEmptyDoc(args.docId, args.title, args.now ?? Date.now());
  const result = applyPatch(empty, { baseVersion: empty.version, ops: buildStoryboardOps(args) });
  if (!result.ok) {
    const why = result.reason === 'version-conflict' ? 'version-conflict' : `${result.reason}@${result.opIndex}: ${result.message}`;
    throw new Error(`스토리보드를 문서로 옮기지 못했습니다 (${why}).`);
  }
  return result.doc;
}

/** 컷 하나가 차지하는 시간의 합. 화면이 "얼마짜리 영상이 되나"를 미리 말해 줄 때 쓴다. */
export function storyboardDuration(frameCount: number, preset: StoryboardPreset): number {
  return round3(Math.max(0, frameCount) * preset.secondsPerFrame);
}

// ---------------------------------------------------------------------------
// element → 아이템
// ---------------------------------------------------------------------------

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * 콘티 element 하나를 아이템 0~2개로 옮긴다.
 *
 * 라벨이 붙은 도형은 도형 + 글자 두 아이템이 된다(보드의 SVG 가 `<rect>`+`<text>` 인 것과 같다).
 */
function mapElement(
  el: ContiElement,
  layout: StoryboardLayout,
  base: string,
  at: number,
  duration: number,
  uniqueId: (base: string) => string,
): VideoItem[] {
  const s = layout.scale;
  const px = (x: number): number => layout.panel.x + num(x, 0) * s;
  const py = (y: number): number => layout.panel.y + num(y, 0) * s;
  const stroke = el.stroke ?? COLOR_STAMP_EDGE;
  const strokeWidth = Math.max(1, num(el.strokeWidth, CONTI_DEFAULTS.defaultStrokeWidth) * s);
  const idBase = `${base}-el-${el.id}`;
  const out: VideoItem[] = [];

  const withLabel = (box: StoryboardRect, text: string | undefined, color: string): void => {
    if (!text || text.trim() === '') return;
    out.push({
      id: uniqueId(`${idBase}-label`),
      kind: 'text',
      at,
      duration,
      transform: box,
      props: {
        text,
        fontSize: Math.max(10, num(el.fontSize, CONTI_DEFAULTS.defaultFontSize) * s),
        fontWeight: '600',
        color,
        align: 'center',
      },
    });
  };

  if (el.type === 'rect' || el.type === 'stamp') {
    // 스탬프는 카탈로그 기본 치수를 가진 라벨 도형으로 내린다(§5.13 (Q-3)).
    const spec = el.type === 'stamp' && el.stampName ? STAMP_CATALOG[el.stampName as keyof typeof STAMP_CATALOG] : undefined;
    const w = num(el.w, spec?.defaultW ?? 80) * s;
    const h = num(el.h, spec?.defaultH ?? 50) * s;
    const box: StoryboardRect = { x: px(el.x), y: py(el.y), width: w, height: h };
    out.push({
      id: uniqueId(idBase),
      kind: 'shape',
      at,
      duration,
      transform: box,
      props: {
        shape: 'rect',
        fill: el.fill ?? (el.type === 'stamp' ? COLOR_STAMP_FILL : 'none'),
        stroke,
        strokeWidth,
        radius: Math.round(6 * s),
      },
    });
    withLabel(box, el.label, el.stroke ?? COLOR_TEXT);
    return out;
  }

  if (el.type === 'circle') {
    // 보드의 `<circle>` 은 x,y 가 중심이고 w 가 반지름이다.
    const r = num(el.w, 24);
    const box: StoryboardRect = { x: px(el.x - r), y: py(el.y - r), width: r * 2 * s, height: r * 2 * s };
    out.push({
      id: uniqueId(idBase),
      kind: 'shape',
      at,
      duration,
      transform: box,
      props: { shape: 'ellipse', fill: el.fill ?? 'none', stroke, strokeWidth },
    });
    withLabel(box, el.label, el.stroke ?? COLOR_TEXT);
    return out;
  }

  if (el.type === 'line') {
    // 대각선은 이 스키마의 도형으로 표현되지 않는다 — 가로/세로 중 가까운 쪽으로 눕힌다.
    const dx = num(el.w, 40);
    const dy = num(el.h, 0);
    const x0 = Math.min(el.x, el.x + dx);
    const y0 = Math.min(el.y, el.y + dy);
    const horizontal = Math.abs(dy) <= Math.abs(dx);
    const box: StoryboardRect = horizontal
      ? { x: px(x0), y: py(y0) - strokeWidth / 2, width: Math.abs(dx) * s, height: Math.max(strokeWidth, Math.abs(dy) * s) }
      : { x: px(x0) - strokeWidth / 2, y: py(y0), width: strokeWidth, height: Math.abs(dy) * s };
    out.push({
      id: uniqueId(idBase),
      kind: 'shape',
      at,
      duration,
      transform: box,
      props: horizontal
        ? { shape: 'line', stroke, strokeWidth, fill: 'none' }
        : { shape: 'rect', fill: stroke, stroke: 'none', strokeWidth: 0 },
    });
    return out;
  }

  // text — 보드의 `<text>` 는 x,y 가 글자 시작점(baseline)이라 상자를 그만큼 올려 잡는다.
  const fontSize = Math.max(10, num(el.fontSize, CONTI_DEFAULTS.defaultFontSize) * s);
  const label = el.label ?? '';
  if (label.trim() === '') return out;
  const width = Math.max(fontSize * 2, label.length * fontSize * 0.62);
  out.push({
    id: uniqueId(idBase),
    kind: 'text',
    at,
    duration,
    transform: {
      x: px(el.x),
      y: py(el.y) - fontSize * 0.85,
      width,
      height: fontSize * 1.5,
    },
    props: {
      text: label,
      fontSize,
      fontWeight: '500',
      color: el.fill && el.fill !== 'none' ? el.fill : (el.stroke ?? COLOR_SUB),
      align: 'left',
    },
  });
  return out;
}
