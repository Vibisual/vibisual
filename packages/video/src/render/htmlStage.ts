/**
 * HTML 씬 무대 (SCENARIO.md §5.13 (F)).
 *
 * `html-in-canvas` 와 `offscreen-capture` 백엔드가 그릴 **살아 있는 DOM** 을 만든다.
 * 이 무대가 있어야 그 두 백엔드가 의미를 갖는다 — 없으면 CSS 충실도라는 장점이
 * 그릴 것이 없어 무의미해진다(그게 1차 구현에서 비어 있던 자리다).
 *
 * 설계에서 지키는 것:
 *
 * - **아이템마다 DOM 노드를 재사용한다.** 프레임마다 `innerHTML` 을 갈아 끼우면 브라우저가
 *   매번 레이아웃을 처음부터 다시 하고, 그게 정확히 "쓸수록 느려지는" 형태다.
 * - **영상 프레임은 `<canvas>` 에 그린다.** `<video>` 를 프레임마다 seek 시키는 것이 다른
 *   도구에서 후반부 감속을 만든 그 경로라, DOM 안에서도 캔버스에 직접 blit 한다.
 * - **씬은 HTML 문자열이 아니라 노드를 갱신한다.** 문자열을 매번 파싱하면 같은 문제가 난다.
 */

import type { VideoAsset, VideoDoc } from '../types.js';
import type { MediaProvider } from './canvas2d.js';
import { buildDrawList, type DrawOp } from './drawList.js';
import { fadeFactor } from './canvas2d.js';
import type { DomStage } from './htmlInCanvas.js';
import type { ResolvedTimeline } from '../types.js';
import { CompositionFrame, type CompositionFrameEvent, type FrameRect, type InspectedText, type PickedElement } from './compositionFrame.js';
import { hitTest } from './hitTest.js';
import { captionWordSpans, wantsWordHighlight } from './captionWords.js';
import { vignetteCss } from './effects.js';

/** §5.13 (V) 37-6 — 무대에서 고른 것(사각형은 문서 픽셀). 컴포지션 안 요소면 `element` 가 붙는다. */
export interface StagePick {
  readonly op: DrawOp;
  readonly rect: FrameRect;
  readonly element?: PickedElement;
}

/** §5.13 (V) 37-9 — 컴포지션 안의 보이는 글자 상자(사각형은 문서 픽셀). */
export interface StageText extends InspectedText {
  readonly itemId: string;
}

/** 값(props)을 주소에 실을 때의 상한(글자) — 넘으면 싣지 않는다(디스크의 값이 쓰인다). */
const PROPS_OVERRIDE_MAX_CHARS = 24_000;

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

/** 브라우저에서 base64url(UTF-8). */
function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * §5.13 (V) 37-5 — 지금 값을 실은 주소. 무대가 갖고 있는 값(낙관 갱신 포함)이 디스크보다 앞설 수 있어, 프레임을 열 때 그 값을
 * 그대로 싣는다(서버가 시작 값으로 넣는다). 너무 크면 싣지 않는다.
 */
export function withPropsOverride(src: string, props: Readonly<Record<string, unknown>> | undefined): string {
  if (!props || Object.keys(props).length === 0) return src;
  const encoded = base64url(JSON.stringify(props));
  if (encoded.length > PROPS_OVERRIDE_MAX_CHARS) return src;
  return `${src}${src.includes('?') ? '&' : '?'}props=${encoded}`;
}

/** 씬 하나의 DOM 을 만들고 갱신하는 쪽. */
export interface HtmlScene {
  /** 처음 한 번 — 뼈대를 만든다. */
  create: (doc: VideoDoc) => HTMLElement;
  /** 매 프레임 — 값만 바꾼다. 여기서 새 노드를 만들지 않는다. */
  update: (el: HTMLElement, op: DrawOp, doc: VideoDoc) => void;
}

export type HtmlSceneRegistry = Readonly<Record<string, HtmlScene>>;

function str(op: DrawOp, key: string, fallback: string): string {
  const v = op.resolved.item.props?.[key];
  return typeof v === 'string' ? v : fallback;
}

function numProp(op: DrawOp, key: string, fallback: number): number {
  const v = op.resolved.item.props?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function list(op: DrawOp, key: string): string[] {
  const v = op.resolved.item.props?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

/** 기본 HTML 씬 — 캔버스 씬과 같은 이름·같은 props 를 받아 결과가 어긋나지 않게 한다. */
export const BUILTIN_HTML_SCENES: HtmlSceneRegistry = {
  title: {
    create: () => {
      const root = div('vs-scene vs-title');
      root.appendChild(div('vs-title-main'));
      root.appendChild(div('vs-title-sub'));
      return root;
    },
    update: (el, op) => {
      const p = easeOutCubic(Math.min(1, op.localTime / 0.5));
      const main = el.children[0] as HTMLElement | undefined;
      const sub = el.children[1] as HTMLElement | undefined;
      el.style.transform = `translateY(${(1 - p) * 40}px)`;
      el.style.opacity = String(p);
      if (main) {
        main.textContent = str(op, 'title', '');
        main.style.fontSize = `${numProp(op, 'fontSize', Math.round(op.transform.height * 0.085))}px`;
        main.style.color = str(op, 'color', '#FFFFFF');
      }
      if (sub) {
        const text = str(op, 'subtitle', '');
        sub.textContent = text;
        sub.style.display = text === '' ? 'none' : 'block';
        sub.style.color = str(op, 'accent', '#3B82F6');
      }
    },
  },
  lowerThird: {
    create: () => {
      const root = div('vs-scene vs-lower');
      const box = div('vs-lower-box');
      box.appendChild(div('vs-lower-bar'));
      box.appendChild(div('vs-lower-name'));
      box.appendChild(div('vs-lower-role'));
      root.appendChild(box);
      return root;
    },
    update: (el, op) => {
      const p = easeOutCubic(Math.min(1, op.localTime / 0.45));
      const box = el.firstElementChild as HTMLElement | null;
      if (!box) return;
      box.style.transform = `translateX(${(1 - p) * -80}px)`;
      box.style.opacity = String(p);
      const bar = box.children[0] as HTMLElement | undefined;
      const name = box.children[1] as HTMLElement | undefined;
      const role = box.children[2] as HTMLElement | undefined;
      if (bar) bar.style.background = str(op, 'accent', '#3B82F6');
      if (name) name.textContent = str(op, 'name', '');
      if (role) {
        const text = str(op, 'role', '');
        role.textContent = text;
        role.style.display = text === '' ? 'none' : 'block';
      }
    },
  },
  bulletList: {
    create: () => {
      const root = div('vs-scene vs-bullets');
      root.appendChild(div('vs-bullets-heading'));
      root.appendChild(div('vs-bullets-items'));
      return root;
    },
    update: (el, op) => {
      const heading = el.children[0] as HTMLElement | undefined;
      const holder = el.children[1] as HTMLElement | undefined;
      if (heading) {
        const text = str(op, 'heading', '');
        heading.textContent = text;
        heading.style.display = text === '' ? 'none' : 'block';
      }
      if (!holder) return;

      const items = list(op, 'items');
      const stagger = numProp(op, 'stagger', 0.28);
      // 개수가 바뀔 때만 노드를 만든다 — 매 프레임 다시 만들지 않는다.
      while (holder.children.length > items.length) holder.lastElementChild?.remove();
      while (holder.children.length < items.length) {
        const row = div('vs-bullet-row');
        row.appendChild(div('vs-bullet-dot'));
        row.appendChild(div('vs-bullet-text'));
        holder.appendChild(row);
      }
      items.forEach((text, i) => {
        const row = holder.children[i] as HTMLElement | undefined;
        if (!row) return;
        const p = easeOutCubic(Math.min(1, Math.max(0, (op.localTime - 0.35 - i * stagger) / 0.42)));
        row.style.opacity = String(p);
        row.style.transform = `translateX(${(1 - p) * 26}px)`;
        const dot = row.children[0] as HTMLElement | undefined;
        const label = row.children[1] as HTMLElement | undefined;
        if (dot) dot.style.background = str(op, 'accent', '#3B82F6');
        if (label) label.textContent = text;
      });
    },
  },
  codeBlock: {
    create: () => {
      const root = div('vs-scene vs-code');
      root.appendChild(div('vs-code-box'));
      return root;
    },
    update: (el, op) => {
      const box = el.firstElementChild as HTMLElement | null;
      if (!box) return;
      const lines = list(op, 'lines');
      const perLine = numProp(op, 'perLine', 0.14);
      while (box.children.length > lines.length) box.lastElementChild?.remove();
      while (box.children.length < lines.length) {
        const row = div('vs-code-row');
        row.appendChild(div('vs-code-num'));
        row.appendChild(div('vs-code-text'));
        box.appendChild(row);
      }
      lines.forEach((line, i) => {
        const row = box.children[i] as HTMLElement | undefined;
        if (!row) return;
        row.style.opacity = String(Math.min(1, Math.max(0, (op.localTime - 0.3 - i * perLine) / 0.2)));
        const numEl = row.children[0] as HTMLElement | undefined;
        const textEl = row.children[1] as HTMLElement | undefined;
        if (numEl) numEl.textContent = String(i + 1).padStart(2, ' ');
        if (textEl) textEl.textContent = line;
      });
    },
  },
  quote: {
    create: () => {
      const root = div('vs-scene vs-quote');
      root.appendChild(div('vs-quote-mark'));
      root.appendChild(div('vs-quote-text'));
      root.appendChild(div('vs-quote-by'));
      return root;
    },
    update: (el, op) => {
      el.style.opacity = String(easeOutCubic(Math.min(1, op.localTime / 0.5)));
      const mark = el.children[0] as HTMLElement | undefined;
      const text = el.children[1] as HTMLElement | undefined;
      const by = el.children[2] as HTMLElement | undefined;
      if (mark) mark.style.color = str(op, 'accent', '#3B82F6');
      if (text) text.textContent = str(op, 'text', '');
      if (by) {
        const name = str(op, 'by', '');
        by.textContent = name === '' ? '' : `— ${name}`;
        by.style.display = name === '' ? 'none' : 'block';
      }
    },
  },
  solid: {
    create: () => div('vs-scene vs-solid'),
    update: (el, op) => {
      el.style.background = str(op, 'color', '#0B1120');
    },
  },
};

/** 무대가 쓰는 스타일. 백엔드가 어느 문서에 붙든 같은 그림이 나오도록 한 벌로 주입한다. */
export const HTML_STAGE_CSS = `
.vs-stage { position: relative; overflow: hidden; background: #000; }
.vs-item { position: absolute; display: flex; }
.vs-scene { width: 100%; height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; font-family: system-ui, sans-serif; color: #fff; }
.vs-title-main { font-weight: 800; text-align: center; line-height: 1.18; max-width: 82%; }
.vs-title-sub { margin-top: 0.5em; font-weight: 600; font-size: 0.42em; }
.vs-lower { align-items: flex-start; justify-content: flex-end; padding: 0 0 6% 4%; }
.vs-lower-box { position: relative; padding: 1.1em 1.6em; border-radius: 10px;
  background: rgba(9,12,20,0.86); }
.vs-lower-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; border-radius: 10px 0 0 10px; }
.vs-lower-name { font-weight: 700; font-size: 2.2rem; }
.vs-lower-role { margin-top: 0.25em; font-size: 1.4rem; color: rgba(255,255,255,0.68); }
.vs-bullets { align-items: flex-start; justify-content: center; padding: 0 12%; }
.vs-bullets-heading { font-weight: 800; font-size: 3.6rem; margin-bottom: 1.4rem; }
.vs-bullets-items { display: flex; flex-direction: column; gap: 1rem; width: 100%; }
.vs-bullet-row { display: flex; align-items: center; gap: 0.9rem; font-size: 2.4rem; }
.vs-bullet-dot { width: 0.42em; height: 0.42em; border-radius: 999px; flex: 0 0 auto; }
.vs-code { padding: 0 8%; }
.vs-code-box { width: 100%; padding: 1.6rem 2rem; border-radius: 14px;
  background: rgba(12,16,26,0.94); border: 1.5px solid rgba(255,255,255,0.09);
  font-family: ui-monospace, monospace; font-size: 1.7rem; }
.vs-code-row { display: flex; gap: 1.2rem; line-height: 1.55; }
.vs-code-num { color: rgba(255,255,255,0.34); white-space: pre; }
.vs-code-text { color: #E2E8F0; white-space: pre; }
.vs-quote-mark { font-family: Georgia, serif; font-weight: 800; font-size: 7rem; line-height: 0.6; }
.vs-quote-text { margin-top: 1.6rem; font-weight: 600; font-size: 3rem; text-align: center; max-width: 74%; }
.vs-quote-by { margin-top: 1.2rem; font-size: 1.5rem; color: rgba(255,255,255,0.6); }
.vs-text { align-items: center; justify-content: center; text-align: center; width: 100%; height: 100%;
  display: flex; font-family: system-ui, sans-serif; }
.vs-caption { position: absolute; left: 50%; transform: translateX(-50%);
  max-width: 86%; padding: 0.6em 1em; border-radius: 12px; background: rgba(0,0,0,0.62);
  color: #fff; font-weight: 600; text-align: center; font-family: system-ui, sans-serif; }
.vs-media { width: 100%; height: 100%; object-fit: contain; display: block; }
.vs-missing { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  border: 4px dashed #F59E0B; color: #F59E0B; font: 600 32px system-ui, sans-serif; text-align: center; }
.vs-comp-box { position: relative; width: 100%; height: 100%; overflow: hidden; }
.vs-comp { position: absolute; left: 0; top: 0; border: 0; background: transparent; transform-origin: 0 0;
  pointer-events: none; }
.vs-vignette { position: absolute; inset: 0; pointer-events: none; }
.vs-stage.vs-alpha { background: transparent; }
`;

export interface HtmlSceneStageOptions {
  readonly doc: VideoDoc;
  readonly timeline: ResolvedTimeline;
  readonly media: MediaProvider;
  readonly scenes?: HtmlSceneRegistry;
  /** 무대를 붙일 부모. 없으면 화면 밖에 둔다(렌더 전용). */
  readonly container?: HTMLElement;
  /**
   * §5.13 (T-3) — composition 아이템의 문서 주소를 만드는 쪽. 프로젝트·패키지 앱 여부(vibproxy)를 아는 것은 호출부라
   * 무대는 묻기만 한다. 없거나 `null` 이면 그 아이템 자리에 "그릴 수 없다" 표식을 둔다(조용히 빈 칸 ❌).
   *
   * ⚠ 컴포지션은 **보이는 자리**에 세워야 한다 — 화면 밖(`left:-99999px`)의 교차 출처 프레임은 브라우저가 그리기를
   * 멈춰 `ready` 가 늦는다. 그래서 컴포지션을 그리는 무대에는 `container` 를 준다.
   */
  readonly compositionSrc?: (op: DrawOp, asset: VideoAsset | undefined) => string | null;
  /** 렌더처럼 한 장도 틀리면 안 되는 자리 — 컴포지션이 시각을 못 맞추면 `seek` 가 그 이유로 거절된다. */
  readonly strict?: boolean;
  /** §5.13 (W) 38-3 — 투명 배경 렌더: 무대가 바탕을 칠하지 않는다(그린 것 밖은 알파 0). */
  readonly transparent?: boolean;
  /** 컴포지션이 알려 온 오류·막힌 주소(표시용). */
  readonly onCompositionEvent?: (itemId: string, event: CompositionFrameEvent) => void;
}

interface Slot {
  wrapper: HTMLElement;
  inner: HTMLElement;
  kind: string;
  sceneId?: string | undefined;
  /** composition 슬롯 — 문서 주소(값 제외)가 바뀌면(코드·스타일이 바뀌면) 프레임을 새로 연다. */
  src?: string | undefined;
  frame?: CompositionFrame | undefined;
  /** §5.13 (V) 37-5 — 이 프레임에 마지막으로 보낸 값(props) — 바뀌면 데이터 메시지로 맞춘다. */
  propsKey?: string | undefined;
  /** §5.13 (W) 38-5 — 비네트 덧칠(필요할 때만 만든다). 필터는 `inner` 에 건다 — 비네트까지 필터를 타지 않게. */
  vignette?: HTMLElement | undefined;
}

/**
 * 그리기 목록을 DOM 으로 세우는 무대.
 *
 * `seek(t)` 가 끝나면 그 시각의 화면이 DOM 에 완성돼 있어야 한다 — 백엔드는 그 뒤에
 * 곧바로 캔버스로 옮기므로, 아직 안 온 이미지가 있으면 그 프레임에서 빠진다. 그래서
 * 소재를 기다린 다음 resolve 한다.
 */
export class HtmlSceneStage implements DomStage {
  readonly element: HTMLElement;
  private readonly slots = new Map<string, Slot>();
  private readonly scenes: HtmlSceneRegistry;
  /** §5.13 (T-7) — 미리보기는 문서가 바뀔 때마다 무대를 새로 세우지 않는다(컴포지션 프레임을 다시 열지 않게). */
  private doc: VideoDoc;
  private timeline: ResolvedTimeline;
  /** §5.13 (V) 37-6 — 마지막으로 맞춘 시각(고르기·살피기가 그 시각의 그림을 묻는다). */
  private lastT = 0;

  constructor(private readonly opts: HtmlSceneStageOptions) {
    this.scenes = { ...BUILTIN_HTML_SCENES, ...(opts.scenes ?? {}) };
    this.doc = opts.doc;
    this.timeline = opts.timeline;

    const root = document.createElement('div');
    root.className = opts.transparent === true ? 'vs-stage vs-alpha' : 'vs-stage';
    root.style.width = `${opts.doc.size.width}px`;
    root.style.height = `${opts.doc.size.height}px`;

    if (!document.getElementById('vs-stage-style')) {
      const style = document.createElement('style');
      style.id = 'vs-stage-style';
      style.textContent = HTML_STAGE_CSS;
      document.head.appendChild(style);
    }

    if (opts.container) {
      opts.container.appendChild(root);
    } else {
      // 화면에 보이지는 않되 레이아웃은 살아 있어야 한다(`display:none` 이면 크기가 0이 된다).
      root.style.position = 'fixed';
      root.style.left = '-99999px';
      root.style.top = '0';
      document.body.appendChild(root);
    }
    this.element = root;
  }

  /**
   * 문서만 갈아 끼운다 — 슬롯은 다음 `seek` 가 맞춘다. 같은 아이템·같은 종류·같은 문서 주소면 노드(컴포지션 프레임
   * 포함)를 그대로 쓴다. 판형이 바뀌었으면 무대 크기도 따라간다.
   */
  setDoc(doc: VideoDoc, timeline: ResolvedTimeline): void {
    this.doc = doc;
    this.timeline = timeline;
    this.element.style.width = `${doc.size.width}px`;
    this.element.style.height = `${doc.size.height}px`;
  }

  async seek(t: number): Promise<void> {
    const { doc, timeline } = this;
    this.lastT = t;
    const ops = buildDrawList(doc, timeline, t);
    const alive = new Set(ops.map((o) => o.itemId));

    // 사라진 것 정리.
    for (const [id, slot] of this.slots) {
      if (!alive.has(id)) {
        this.dropSlot(slot);
        this.slots.delete(id);
      }
    }

    const pending: Promise<void>[] = [];

    for (const op of ops) {
      const slot = this.ensureSlot(op);
      const { transform } = op;
      const w = slot.wrapper;
      w.style.left = `${transform.x}px`;
      w.style.top = `${transform.y}px`;
      w.style.width = `${transform.width}px`;
      w.style.height = `${transform.height}px`;
      w.style.opacity = String(transform.opacity * fadeFactor(op));
      w.style.zIndex = String(op.z);
      w.style.transform =
        transform.rotation === 0 && transform.scale === 1
          ? ''
          : `rotate(${transform.rotation}deg) scale(${transform.scale})`;
      // §5.13 (V) 37-8 — 전환이 잘라 보이게 한 사각형(문서 픽셀) → 상자 기준 안쪽 여백.
      if (op.clip) {
        const top = Math.max(0, op.clip.y - transform.y);
        const left = Math.max(0, op.clip.x - transform.x);
        const right = Math.max(0, transform.x + transform.width - (op.clip.x + op.clip.width));
        const bottom = Math.max(0, transform.y + transform.height - (op.clip.y + op.clip.height));
        w.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
      } else if (w.style.clipPath !== '') {
        w.style.clipPath = '';
      }
      // §5.13 (W) 38-5 — 이펙트: 필터는 안쪽에, 비네트는 그 위 덧칠(같은 값을 canvas2d 도 쓴다).
      const filter = op.filter ?? '';
      if (slot.inner.style.filter !== filter) slot.inner.style.filter = filter;
      this.applyVignette(slot, op.vignette ?? 0);

      pending.push(this.updateSlot(slot, op));
    }

    await Promise.all(pending);
    // 폰트가 아직이면 글자 폭이 달라져 다음 프레임과 어긋난다.
    if (typeof document.fonts?.ready?.then === 'function') await document.fonts.ready;
  }

  private dropSlot(slot: Slot): void {
    slot.frame?.dispose();
    slot.wrapper.remove();
  }

  /** §5.13 (W) 38-5 — 비네트 덧칠을 세우거나 걷는다(세기가 0 이면 노드도 없다). */
  private applyVignette(slot: Slot, amount: number): void {
    if (amount <= 0) {
      if (slot.vignette) { slot.vignette.remove(); slot.vignette = undefined; }
      return;
    }
    if (!slot.vignette) {
      slot.vignette = div('vs-vignette');
      slot.wrapper.appendChild(slot.vignette);
    }
    const bg = vignetteCss(amount);
    if (slot.vignette.style.background !== bg) slot.vignette.style.background = bg;
  }

  /** composition 아이템의 문서 주소(코드·props 가 바뀌면 달라진다). 만들 수 없으면 null. */
  private compositionSrcOf(op: DrawOp): string | null {
    if (op.kind !== 'composition') return null;
    const assetId = op.resolved.item.assetId;
    const asset = assetId === undefined ? undefined : this.doc.assets[assetId];
    return this.opts.compositionSrc?.(op, asset) ?? null;
  }

  private ensureSlot(op: DrawOp): Slot {
    const existing = this.slots.get(op.itemId);
    const sceneId = op.resolved.item.sceneId;
    const src = op.kind === 'composition' ? this.compositionSrcOf(op) ?? undefined : undefined;
    if (existing && existing.kind === op.kind && existing.sceneId === sceneId && existing.src === src) return existing;
    if (existing) this.dropSlot(existing);

    const wrapper = div('vs-item');
    let frame: CompositionFrame | undefined;
    let inner: HTMLElement;
    if (op.kind === 'composition' && src !== undefined) {
      const assetId = op.resolved.item.assetId;
      const asset = assetId === undefined ? undefined : this.doc.assets[assetId];
      const itemId = op.itemId;
      // §5.13 (V) 37-15 — 반응형 컴포지션은 선언 크기 대신 상자 크기로 짠다(판형 파생).
      const responsive = asset?.responsive === true;
      frame = new CompositionFrame({
        src: withPropsOverride(src, op.resolved.item.props),
        width: responsive ? op.transform.width : asset?.width ?? this.doc.size.width,
        height: responsive ? op.transform.height : asset?.height ?? this.doc.size.height,
        label: op.resolved.item.label ?? itemId,
        onEvent: (event) => this.opts.onCompositionEvent?.(itemId, event),
      });
      inner = frame.element;
    } else {
      inner = this.createInner(op);
    }
    wrapper.appendChild(inner);
    this.element.appendChild(wrapper);

    const slot: Slot = { wrapper, inner, kind: op.kind, sceneId, src, frame, propsKey: frame ? stableJson(op.resolved.item.props) : undefined };
    this.slots.set(op.itemId, slot);
    return slot;
  }

  private createInner(op: DrawOp): HTMLElement {
    switch (op.kind) {
      case 'composition': {
        // 주소를 만들 수 없는 자리(창 없는 환경 등) — 조용히 빈 칸으로 두지 않는다.
        const missing = div('vs-missing');
        missing.textContent = `컴포지션을 그릴 수 없습니다: ${op.resolved.item.label ?? op.itemId}`;
        return missing;
      }
      case 'scene': {
        const scene = op.resolved.item.sceneId === undefined ? undefined : this.scenes[op.resolved.item.sceneId];
        if (!scene) {
          const missing = div('vs-missing');
          missing.textContent = `등록되지 않은 씬: ${op.resolved.item.sceneId ?? '(없음)'}`;
          return missing;
        }
        return scene.create(this.doc);
      }
      case 'text':
        return div('vs-text');
      case 'caption':
        return div('vs-caption');
      case 'shape':
        return div('vs-shape');
      case 'image':
      case 'footage': {
        // 영상·이미지 모두 캔버스에 blit 한다 — `<video>` 를 프레임마다 seek 시키지 않는다.
        const canvas = document.createElement('canvas');
        canvas.className = 'vs-media';
        return canvas;
      }
      default:
        return div('vs-item-empty');
    }
  }

  private async updateSlot(slot: Slot, op: DrawOp): Promise<void> {
    switch (op.kind) {
      case 'composition': {
        const frame = slot.frame;
        if (!frame) return;
        frame.layout(op.transform.width, op.transform.height);
        // §5.13 (V) 37-5 — 값만 바뀌었으면 프레임을 다시 열지 않고 데이터로 맞춘다. 묶인 곳이 없으면 새 값을 실어 다시 연다.
        const props = op.resolved.item.props ?? {};
        const key = stableJson(props);
        if (slot.propsKey !== key) {
          slot.propsKey = key;
          const live = await frame.applyProps(props);
          if (!live && slot.src) frame.reload(withPropsOverride(slot.src, props));
        }
        try {
          // 컴포지션 안 시각 = 아이템 시작 뒤 흐른 시간 + 트림(drawList 가 이미 계산했다).
          await frame.seek(op.sourceTime);
        } catch (err) {
          if (this.opts.strict === true) throw err;
          this.opts.onCompositionEvent?.(op.itemId, { kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      case 'scene': {
        const scene = op.resolved.item.sceneId === undefined ? undefined : this.scenes[op.resolved.item.sceneId];
        scene?.update(slot.inner, op, this.doc);
        return;
      }
      case 'text': {
        const el = slot.inner;
        el.textContent = str(op, 'text', '');
        el.style.fontSize = `${numProp(op, 'fontSize', 64)}px`;
        el.style.fontWeight = str(op, 'fontWeight', '700');
        el.style.color = str(op, 'color', '#FFFFFF');
        el.style.fontFamily = str(op, 'fontFamily', 'system-ui, sans-serif');
        el.style.justifyContent =
          str(op, 'align', 'center') === 'left' ? 'flex-start' : str(op, 'align', 'center') === 'right' ? 'flex-end' : 'center';
        return;
      }
      case 'caption': {
        const el = slot.inner;
        if (wantsWordHighlight(op.resolved.item.props)) {
          // §5.13 (V) 37-12 — 단어 강조: 낱말마다 조각을 세우고 지금 낱말만 강조색(캔버스 백엔드와 같은 함수).
          const t = op.resolved.start + op.localTime;
          const accent = str(op, 'highlightColor', '#FACC15');
          const spans: HTMLElement[] = [];
          op.cues.forEach((cue, ci) => {
            if (ci > 0) spans.push(document.createElement('br'));
            captionWordSpans(cue, t).words.forEach((w, wi) => {
              const span = document.createElement('span');
              span.textContent = wi > 0 ? ` ${w.text}` : w.text;
              if (w.active) span.style.color = accent;
              spans.push(span);
            });
          });
          el.replaceChildren(...spans);
        } else {
          el.textContent = op.cues.map((c) => c.text).join(' ');
        }
        el.style.display = op.cues.length === 0 ? 'none' : 'block';
        el.style.fontSize = `${numProp(op, 'fontSize', 48)}px`;
        el.style.bottom = `${numProp(op, 'bottom', 96)}px`;
        el.style.color = str(op, 'color', '#FFFFFF');
        return;
      }
      case 'shape': {
        const el = slot.inner;
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.background = str(op, 'fill', '#3B82F6');
        el.style.borderRadius = str(op, 'shape', 'rect') === 'ellipse' ? '50%' : `${numProp(op, 'radius', 0)}px`;
        const strokeWidth = numProp(op, 'strokeWidth', 0);
        el.style.border = strokeWidth > 0 ? `${strokeWidth}px solid ${str(op, 'stroke', '#FFFFFF')}` : '';
        return;
      }
      case 'image':
      case 'footage': {
        const canvas = slot.inner as HTMLCanvasElement;
        const assetId = op.resolved.item.assetId;
        if (assetId === undefined) return;
        const src =
          op.kind === 'image'
            ? await this.opts.media.getImage(assetId)
            : await this.opts.media.getFrame(assetId, op.sourceTime);
        if (!src) return;
        const anySrc = src as { width?: number; height?: number; videoWidth?: number; videoHeight?: number };
        const w = anySrc.videoWidth ?? anySrc.width ?? 0;
        const h = anySrc.videoHeight ?? anySrc.height ?? 0;
        if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(src, 0, 0);
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * §5.13 (V) 37-6 — 마지막으로 맞춘 시각의 그림에서 문서 픽셀 (x, y) 아래 맨 위의 것. 컴포지션이면 샌드박스에 읽기 전용으로
   * 그 자리 요소를 묻는다(답이 없으면 아이템 단위).
   */
  async pickAt(x: number, y: number): Promise<StagePick | null> {
    const hit = hitTest(this.doc, this.timeline, this.lastT, x, y);
    if (!hit) return null;
    const slot = this.slots.get(hit.op.itemId);
    if (hit.op.kind === 'composition' && slot?.frame) {
      const box = hit.op.transform;
      const element = await slot.frame.pick(x - box.x, y - box.y);
      if (element) {
        return { op: hit.op, element, rect: { x: box.x + element.rect.x, y: box.y + element.rect.y, width: element.rect.width, height: element.rect.height } };
      }
    }
    return { op: hit.op, rect: hit.rect };
  }

  /** §5.13 (V) 37-9 — 마지막으로 맞춘 시각에 컴포지션들 안에서 보이는 글자 상자(문서 픽셀). */
  async inspectTexts(): Promise<StageText[]> {
    const ops = buildDrawList(this.doc, this.timeline, this.lastT).filter((op) => op.kind === 'composition');
    const out: StageText[] = [];
    for (const op of ops) {
      const frame = this.slots.get(op.itemId)?.frame;
      if (!frame) continue;
      for (const text of await frame.inspect()) {
        out.push({ ...text, itemId: op.itemId, rect: { x: op.transform.x + text.rect.x, y: op.transform.y + text.rect.y, width: text.rect.width, height: text.rect.height } });
      }
    }
    return out;
  }

  dispose(): void {
    for (const slot of this.slots.values()) this.dropSlot(slot);
    this.slots.clear();
    this.element.remove();
  }
}
