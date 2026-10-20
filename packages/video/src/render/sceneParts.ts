/**
 * §5.13 (V) 37-6 — 기본 씬 **안쪽**: 화면의 한 점 아래 씬의 어느 글자(값)인가 (순수 — DOM 없음).
 *
 * 기본 씬은 상자를 지정하지 않으면 화면 전체라, 아이템 단위로만 고르면 제목 씬 위 어디를 가리켜도 "화면 전체"가 잡혔다
 * (사용자 보고 — Alt 로 집으면 영상 화면이 통째로 선택된다, 세 번째 지시). 씬이 그리는 글자는 문서 값(`props`) 하나씩에서
 * 오므로 그 자리를 같은 계산으로 다시 낸다 — 제목·부제·이름·직함·머리말·목록 줄·코드 줄·인용·출처.
 *
 * **그리기와 같은 계산이어야 한다** — 이 파일의 숫자는 `scenes.ts` 의 그리기 함수를 그대로 옮긴 것이다(글꼴 문자열·줄
 * 나눔·등장 이동까지). 한쪽만 고치면 가리킨 자리와 그림이 어긋나므로, `sceneParts.test.ts` 가 실제 그리기 함수를 기록용
 * 캔버스에 돌려 글자가 찍힌 자리가 이 상자 안에 드는지 대조한다.
 *
 * 좌표는 씬 상자 안(변환 전, 문서 픽셀)이고, 문서 좌표로는 `toDocRect` 가 옮긴다 — 회전은 무시한다(`opRect` 와 같다).
 * DOM 무대(컴포지션이 있는 문서)는 CSS 배치라 이 계산과 다르다 — 그쪽은 `htmlStage.ts` 가 실제 요소(`data-vibi-prop`)로 답한다.
 */

import type { Ctx2D, SceneEnv } from './canvas2d.js';
import type { PickedElement } from './compositionFrame.js';
import type { DrawOp } from './drawList.js';
import type { HitRect } from './hitTest.js';

/** 글꼴 문자열 그대로 글자 폭을 잰다(캔버스 `font` 와 같은 꼴 — 예: `800 92px sans-serif`). */
export type TextMeasure = (font: string, text: string) => number;

export interface ScenePart {
  /** 그 글자가 묶인 문서 값의 자리 — `title` · `subtitle` · `items[1]` 처럼. */
  readonly prop: string;
  /** 그 값의 글자(목록 줄이면 그 줄). */
  readonly text: string;
  /** 씬 상자 안 좌표(변환 전, 문서 픽셀). */
  readonly rect: HitRect;
  /** 그 글자의 크기(씬 상자 안 픽셀) — 제자리 고치기 칸이 같은 크기로 선다. */
  readonly size: number;
}

export interface SceneLayout {
  /** 위에 그려지는 것이 뒤에 온다(맨 위부터 찾을 때 끝에서 거슬러 본다). */
  readonly parts: readonly ScenePart[];
  /** 글자 말고도 그 씬이 칠하는 자리(이름표 상자·코드 상자·따옴표) — 가리켜도 그 씬이 잡혀야 하는 곳. */
  readonly decor: readonly HitRect[];
}

type SceneLayoutFn = (measure: TextMeasure, op: DrawOp, env: SceneEnv) => SceneLayout;

// ─── 그리기와 같은 도우미 (scenes.ts 와 같은 정의) ───

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
}

function intro(op: DrawOp, sec: number): number {
  return sec <= 0 ? 1 : easeOutCubic(Math.min(1, op.localTime / sec));
}

function prop(op: DrawOp, key: string, fallback: string): string {
  const v = op.resolved.item.props?.[key];
  return typeof v === 'string' ? v : fallback;
}

function propNum(op: DrawOp, key: string, fallback: number): number {
  const v = op.resolved.item.props?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function propList(op: DrawOp, key: string): string[] {
  const v = op.resolved.item.props?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/** `canvas2d.wrapText` 와 같은 줄 나눔 — 캔버스 대신 재는 함수를 받는다. */
export function wrapMeasured(measure: TextMeasure, font: string, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = words[0] ?? '';
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i] ?? '';
      const candidate = `${line} ${word}`;
      if (measure(font, candidate) <= maxWidth) line = candidate;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** 글자 한 개의 폭 비율 — 라틴·숫자·기호는 좁고, 그 밖(한글·한자·가나)은 정사각에 가깝다. */
export function glyphRatio(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  return code < 0x2e80 ? 0.55 : 1;
}

/**
 * 캔버스가 없는 자리(서버·시험)의 어림 — 글자 크기 × 폭 비율(`hitTest` 의 글자 상자 어림과 같은 규칙, 고정폭은 0.6).
 * 미리보기는 캔버스로 잰다(`ctxTextMeasure`) — 그리기와 같은 값이 나온다.
 */
export const estimateTextMeasure: TextMeasure = (font, text) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const mono = /monospace/.test(font);
  let width = 0;
  for (const ch of text) width += (mono ? 0.6 : glyphRatio(ch)) * size;
  return width;
};

/** 캔버스로 잰다 — 같은 글꼴 문자열이면 그리기와 같은 폭이다. */
export function ctxTextMeasure(ctx: Ctx2D): TextMeasure {
  return (font, text) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/** 가운데 기준선(`middle`) 한 줄의 상자 — 줄 높이 `lineHeight` 를 가운데에 둔다. */
function middleBox(left: number, cy: number, width: number, lineHeight: number): HitRect {
  return { x: left, y: cy - lineHeight / 2, width, height: lineHeight };
}

/** 글자 기준선(`alphabetic`) 한 줄의 상자 — 위로 0.8, 아래로 0.2 글자 크기. */
function baselineBox(left: number, baseline: number, width: number, size: number): HitRect {
  return { x: left, y: baseline - size * 0.8, width, height: size };
}

/** 두 상자를 감싸는 상자. */
export function unionRect(a: HitRect | null, b: HitRect): HitRect {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** 줄 여럿(가운데 맞춤 · 가운데 기준선)을 한 값의 상자로 묶는다. 빈 줄만 있으면 null. */
function centeredLines(measure: TextMeasure, font: string, lines: readonly string[], cx: number, firstCy: number, step: number): HitRect | null {
  let rect: HitRect | null = null;
  lines.forEach((line, i) => {
    const w = measure(font, line);
    if (w <= 0) return;
    rect = unionRect(rect, middleBox(cx - w / 2, firstCy + i * step, w, step));
  });
  return rect;
}

// ─── 씬마다 (scenes.ts 의 같은 이름 함수와 한 쌍) ───

const title: SceneLayoutFn = (measure, op, env) => {
  const { width, height } = op.transform;
  const t = prop(op, 'title', '');
  const sub = prop(op, 'subtitle', '');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.085));
  const p = intro(op, 0.5);
  const parts: ScenePart[] = [];
  if (p <= 0) return { parts, decor: [] };
  const dy = (1 - p) * 40;

  const mainFont = `800 ${size}px sans-serif`;
  const lines = wrapMeasured(measure, mainFont, t, width * 0.82);
  const step = size * 1.18;
  const firstCy = height / 2 - (step * lines.length) / 2 + step / 2 - (sub === '' ? 0 : size * 0.5) + dy;
  const main = centeredLines(measure, mainFont, lines, width / 2, firstCy, step);
  if (main) parts.push({ prop: 'title', text: t, rect: main, size });

  if (sub !== '') {
    const subSize = Math.round(size * 0.42);
    const subFont = `600 ${subSize}px sans-serif`;
    const w = measure(subFont, sub);
    const cy = firstCy + lines.length * step + size * 0.35;
    if (w > 0) parts.push({ prop: 'subtitle', text: sub, rect: middleBox(width / 2 - w / 2, cy, w, subSize * 1.2), size: subSize });
  }
  return { parts, decor: [] };
};

const lowerThird: SceneLayoutFn = (measure, op, env) => {
  const { height } = op.transform;
  const name = prop(op, 'name', '');
  const role = prop(op, 'role', '');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.038));
  const p = intro(op, 0.45);
  if (p <= 0) return { parts: [], decor: [] };

  const padX = size * 0.9;
  const padY = size * 0.6;
  const roleSize = Math.round(size * 0.66);
  const nameW = measure(`700 ${size}px sans-serif`, name);
  const roleW = role === '' ? 0 : measure(`500 ${roleSize}px sans-serif`, role);
  const boxW = Math.max(nameW, roleW) + padX * 2;
  const boxH = role === '' ? size + padY * 2 : size * 1.9 + padY * 2;
  const boxX = size * 1.4 - (1 - p) * 80;
  const boxY = height - boxH - size * 2.4;

  const parts: ScenePart[] = [];
  if (nameW > 0) parts.push({ prop: 'name', text: name, rect: baselineBox(boxX + padX, boxY + padY + size * 0.82, nameW, size), size });
  if (roleW > 0) parts.push({ prop: 'role', text: role, rect: baselineBox(boxX + padX, boxY + padY + size * 1.72, roleW, roleSize), size: roleSize });
  return { parts, decor: [{ x: boxX, y: boxY, width: boxW, height: boxH }] };
};

const bulletList: SceneLayoutFn = (measure, op, env) => {
  const { width, height } = op.transform;
  const heading = prop(op, 'heading', '');
  const items = propList(op, 'items');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.045));
  const stagger = propNum(op, 'stagger', 0.28);
  const parts: ScenePart[] = [];

  const left = width * 0.12;
  let y = height * 0.28;
  if (heading !== '') {
    const headSize = Math.round(size * 1.5);
    const font = `800 ${headSize}px sans-serif`;
    const w = measure(font, heading);
    if (intro(op, 0.4) > 0 && w > 0) parts.push({ prop: 'heading', text: heading, rect: middleBox(left, y, w, headSize * 1.2), size: headSize });
    y += size * 2.1;
  }

  const itemFont = `500 ${size}px sans-serif`;
  items.forEach((text, i) => {
    const p = easeOutCubic(Math.min(1, Math.max(0, (op.localTime - 0.35 - i * stagger) / 0.42)));
    // 그리기와 같이 — 아직 안 나온 줄은 자리도 차지하지 않는다(다음 줄이 그 자리에서 시작한다).
    if (p <= 0) return;
    const dx = (1 - p) * 26;
    // 머리점도 그 줄이다 — 점을 가리켜도 그 항목이 잡힌다.
    const dotR = size * 0.19;
    let rect: HitRect = { x: left + 8 + dx - dotR, y: y - dotR, width: dotR * 2, height: dotR * 2 };
    const lines = wrapMeasured(measure, itemFont, text, width - left * 2 - size);
    let ly = y;
    for (const line of lines) {
      const w = measure(itemFont, line);
      if (w > 0) rect = unionRect(rect, middleBox(left + size * 0.85 + dx, ly, w, size * 1.25));
      ly += size * 1.25;
    }
    parts.push({ prop: `items[${i}]`, text, rect, size });
    y = ly + size * 0.55;
  });
  return { parts, decor: [] };
};

const codeBlock: SceneLayoutFn = (measure, op, env) => {
  const { width, height } = op.transform;
  const lines = propList(op, 'lines');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.032));
  const perLine = propNum(op, 'perLine', 0.14);
  const family = prop(op, 'fontFamily', 'ui-monospace, monospace');
  if (intro(op, 0.35) <= 0) return { parts: [], decor: [] };

  const padding = size * 1.4;
  const boxX = width * 0.08;
  const boxW = width * 0.84;
  const boxH = Math.min(height * 0.8, lines.length * size * 1.55 + padding * 2);
  const boxY = (height - boxH) / 2;
  const font = `500 ${size}px ${family}`;
  const parts: ScenePart[] = [];
  lines.forEach((line, i) => {
    const p = Math.min(1, Math.max(0, (op.localTime - 0.3 - i * perLine) / 0.2));
    if (p <= 0) return;
    const cy = boxY + padding + i * size * 1.55 + size * 0.5;
    // 줄 번호부터 글자 끝까지가 그 줄이다.
    const from = boxX + padding * 0.6;
    const to = boxX + padding * 2.1 + measure(font, line);
    parts.push({ prop: `lines[${i}]`, text: line, rect: middleBox(from, cy, to - from, size * 1.55), size });
  });
  return { parts, decor: [{ x: boxX, y: boxY, width: boxW, height: boxH }] };
};

const quote: SceneLayoutFn = (measure, op, env) => {
  const { width, height } = op.transform;
  const text = prop(op, 'text', '');
  const by = prop(op, 'by', '');
  const size = propNum(op, 'fontSize', Math.round(env.size.height * 0.058));
  if (intro(op, 0.5) <= 0) return { parts: [], decor: [] };

  const markSize = size * 2.4;
  const markW = measure(`800 ${markSize}px Georgia, serif`, '“');
  const decor: HitRect[] = [middleBox(width / 2 - markW / 2, height * 0.28, markW, markSize)];

  const font = `600 ${size}px sans-serif`;
  const lines = wrapMeasured(measure, font, text, width * 0.74);
  const step = size * 1.34;
  const firstCy = height / 2 - (step * lines.length) / 2 + step / 2;
  const parts: ScenePart[] = [];
  const body = centeredLines(measure, font, lines, width / 2, firstCy, step);
  if (body) parts.push({ prop: 'text', text, rect: body, size });
  if (by !== '') {
    const bySize = Math.round(size * 0.5);
    const shown = `— ${by}`;
    const w = measure(`500 ${bySize}px sans-serif`, shown);
    const cy = firstCy + lines.length * step + size * 0.6;
    parts.push({ prop: 'by', text: by, rect: middleBox(width / 2 - w / 2, cy, w, bySize * 1.2), size: bySize });
  }
  return { parts, decor };
};

/** 안쪽 자리를 아는 기본 씬. `solid` 는 화면 전체를 칠하므로 여기 없다(아이템 상자 그대로가 맞다). */
export const BUILTIN_SCENE_LAYOUTS: Readonly<Record<string, SceneLayoutFn>> = {
  title,
  lowerThird,
  bulletList,
  codeBlock,
  quote,
};

/** 이 씬 아이템의 안쪽 배치(씬 상자 안 좌표). 모르는 씬(호스트 씬·`solid`)이면 null — 아이템 상자 그대로 쓴다. */
export function sceneLayout(op: DrawOp, env: SceneEnv, measure: TextMeasure = estimateTextMeasure): SceneLayout | null {
  if (op.kind !== 'scene') return null;
  const sceneId = op.resolved.item.sceneId;
  const fn = sceneId === undefined ? undefined : BUILTIN_SCENE_LAYOUTS[sceneId];
  return fn ? fn(measure, op, env) : null;
}

/** 씬 상자 안 좌표 → 문서 좌표(배치 + 크기 배율, 가운데 기준). 회전은 무시한다(`opRect` 와 같다). */
export function toDocRect(op: DrawOp, r: HitRect): HitRect {
  const t = op.transform;
  const cx = t.x + t.width / 2;
  const cy = t.y + t.height / 2;
  return {
    x: cx + (r.x - t.width / 2) * t.scale,
    y: cy + (r.y - t.height / 2) * t.scale,
    width: r.width * t.scale,
    height: r.height * t.scale,
  };
}

function inside(r: HitRect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/** `items[2]` 같은 배열 칸 자리를 가른다 — 아니면 null. */
export function parsePropIndex(prop: string): { readonly key: string; readonly index: number } | null {
  const m = /^([A-Za-z_$][\w$]*)\[(\d+)\]$/.exec(prop);
  return m && m[1] !== undefined && m[2] !== undefined ? { key: m[1], index: Number(m[2]) } : null;
}

/** 그 자리(`title` · `items[1]`)의 문서 값 글자 — 화면 글자(`— 출처` 같은 장식)가 아니라 값 자체. 글자가 아니면 null. */
export function scenePropText(op: DrawOp, prop: string): string | null {
  const props = op.resolved.item.props ?? {};
  const slot = parsePropIndex(prop);
  const value = slot ? (Array.isArray(props[slot.key]) ? (props[slot.key] as unknown[])[slot.index] : undefined) : props[prop];
  return typeof value === 'string' ? value : null;
}

/**
 * 씬이 **실제로 칠하는 자리**(문서 좌표) — 글자들과 장식의 합. 고르기가 이 상자로 판정하면 씬 위 빈 곳을 가리켰을 때 그 아래
 * 것(배경)이 잡힌다. 모르는 씬이면 null(아이템 상자 그대로), 아무것도 안 그리는 시각이면 빈 상자 대신 `'empty'`.
 */
export function sceneFootprint(op: DrawOp, env: SceneEnv, measure: TextMeasure = estimateTextMeasure): HitRect | 'empty' | null {
  const layout = sceneLayout(op, env, measure);
  if (!layout) return null;
  let rect: HitRect | null = null;
  for (const part of layout.parts) rect = unionRect(rect, part.rect);
  for (const d of layout.decor) rect = unionRect(rect, d);
  return rect ? toDocRect(op, rect) : 'empty';
}

/**
 * 문서 좌표 (x, y) 아래 그 씬의 글자 하나 — 가리키기·메모·Alt 인스펙터가 같은 답을 쓴다(`PickedElement` 꼴이라 컴포지션 안쪽
 * 고르기와 같은 길로 흐른다: `prop` = 묶인 값, `path` = `props.<자리>`).
 */
export function scenePartAt(op: DrawOp, env: SceneEnv, x: number, y: number, measure: TextMeasure = estimateTextMeasure): PickedElement | null {
  const layout = sceneLayout(op, env, measure);
  if (!layout) return null;
  for (let i = layout.parts.length - 1; i >= 0; i -= 1) {
    const part = layout.parts[i];
    if (!part) continue;
    const rect = toDocRect(op, part.rect);
    if (!inside(rect, x, y)) continue;
    return { path: `props.${part.prop}`, tag: 'scene', text: part.text, prop: part.prop, rect, fontSize: part.size * op.transform.scale };
  }
  return null;
}
