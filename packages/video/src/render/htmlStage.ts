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
import { MODEL_RENDERER_UNAVAILABLE, fadeFactor, pickMediaElement } from './canvas2d.js';
import type { DomStage } from './htmlInCanvas.js';
import type { ResolvedTimeline } from '../types.js';
import { CompositionFrame, type CompositionFrameEvent, type CompositionPlay, type FrameRect, type InspectedText, type PickedElement } from './compositionFrame.js';
import { hitTest } from './hitTest.js';
import { scenePropText } from './sceneParts.js';
import { captionWordSpans, wantsWordHighlight } from './captionWords.js';
import { vignetteCss } from './effects.js';
import { STAGE_WARM_PRIME_OPACITY, parkedToRelease, upcomingCompositions, warmSlotState, type StageWarmOptions } from './stageWarm.js';
import { upcomingFootage } from './footagePlan.js';
import { planDurationMs, planKeyframes, planOpacity, planStage, type StagePlan, type StagePlanItem } from './stagePlan.js';
import { FOOTAGE_STREAM_DRIFT_S, FOOTAGE_STREAM_PREROLL_S, STAGE_PLAN_HORIZON_S, STAGE_PLAN_REFRESH_S } from '../constants.js';

/**
 * §5.13 (Z) 41-2·41-3 — 재생 기준: 이 문서의 시각 `perfMs`(`performance.now()` — 문서 타임라인과 같은 축)에 재생 머리가 `t`(초).
 * 속도는 1 이다. 스튜디오는 재생 시계(소리가 주인 — 40-9)와 이 직선이 반 프레임 넘게 어긋날 때만 새 기준을 준다.
 */
export interface StagePlayClock {
  readonly t: number;
  readonly perfMs: number;
}

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

/** 이 요소가 그리는 글자가 묶인 문서 값의 자리 — §5.13 (V) 37-6 가리키기·Alt 인스펙터가 이 표식으로 안쪽을 고른다. */
const SCENE_PROP_ATTR = 'data-vibi-prop';

/** 값에 묶인 글자 요소(컴포지션의 `[data-vibi-prop]` 과 같은 뜻 — 캔버스 씬의 `sceneParts.ts` 와 같은 자리 이름). */
function bound<T extends HTMLElement>(el: T, prop: string): T {
  el.setAttribute(SCENE_PROP_ATTR, prop);
  return el;
}

/** 기본 HTML 씬 — 캔버스 씬과 같은 이름·같은 props 를 받아 결과가 어긋나지 않게 한다. */
export const BUILTIN_HTML_SCENES: HtmlSceneRegistry = {
  title: {
    create: () => {
      const root = div('vs-scene vs-title');
      root.appendChild(bound(div('vs-title-main'), 'title'));
      root.appendChild(bound(div('vs-title-sub'), 'subtitle'));
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
      box.appendChild(bound(div('vs-lower-name'), 'name'));
      box.appendChild(bound(div('vs-lower-role'), 'role'));
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
      root.appendChild(bound(div('vs-bullets-heading'), 'heading'));
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
        const row = bound(div('vs-bullet-row'), `items[${holder.children.length}]`);
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
        const row = bound(div('vs-code-row'), `lines[${box.children.length}]`);
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
      root.appendChild(bound(div('vs-quote-text'), 'text'));
      root.appendChild(bound(div('vs-quote-by'), 'by'));
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
  /** Live DOM preview may acknowledge updates before paint; captures always keep the paint barrier. */
  readonly preview?: boolean;
  /** §5.13 (W) 38-3 — 투명 배경 렌더: 무대가 바탕을 칠하지 않는다(그린 것 밖은 알파 0). */
  readonly transparent?: boolean;
  /** 컴포지션이 알려 온 오류·막힌 주소(표시용). */
  readonly onCompositionEvent?: (itemId: string, event: CompositionFrameEvent) => void;
  /**
   * §5.13 (X) 39-5 — 미리보기 전용 **데우기**(`stageWarm.ts`). 곧 시작할 컴포지션은 미리 열어 첫 시각에 맞춰 두고, 막 지나간 것은
   * 잠시 보관한다(둘 다 보이지 않게). 렌더 무대(`strict`)에는 주지 않는다 — 찍히는 그림에 아무 영향이 없어야 한다.
   */
  readonly warm?: StageWarmOptions;
  /**
   * §5.13 (Z) 41-5 ② — 재생 중 지금 보여야 할 컴포지션이 아직 첫 그림을 못 냈는가(바뀔 때만 부른다). 그동안 화면이 가벼운 판
   * (그 장면의 대표 프레임)을 깔았다가 첫 그림이 서면 걷는다. 재생이 아니면 늘 false.
   */
  readonly onCold?: (cold: boolean) => void;
  /** §5.13 (Z) 41-6 — 합성기 예약을 새로 짤 때마다(계측용). */
  readonly onPlan?: () => void;
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
  /** §5.13 (X) 39-5 — 보이지 않게 보관(또는 미리 열어 둔) 시각(ms). 지금 그리는 슬롯이면 없다. */
  parkedAt?: number | undefined;
  /** §5.13 (Y) 40-8 ① — 미리 연 슬롯의 시작 시각(초). 지나간 보관분이면 null(다시 올 시각을 모른다). */
  warmStart?: number | null | undefined;
  /** §5.13 (Y) 40-8 ① — 숨긴 채 첫 그림을 그렸는가(그 전에는 쉬게 하지 않는다 — 한 번도 안 그린 프레임은 쉬지 않는다). */
  warmPainted?: boolean | undefined;
  /**
   * §5.13 (Z) 41-5 ① — 코드가 바뀌어 새로 여는 프레임. 첫 그림을 낼 때까지 옛 프레임(`frame`)이 그대로 보이고(재생 중이면 그대로
   * 재생하며), 첫 그림이 서면 바꿔 낀다 — 로딩 동안 빈 칸이 보이지 않게.
   */
  incoming?: { readonly frame: CompositionFrame; readonly src: string; readonly propsKey: string } | undefined;
  /** §5.13 (Z) 41-4 — 재생 중 실사를 흘려 트는 `<video>`(주소를 받으면 만든다). `asking` 이면 주소를 묻는 중, `none` 이면 못 쓴다. */
  video?: HTMLVideoElement | undefined;
  videoState?: 'asking' | 'ready' | 'none' | undefined;
  /** §5.13 (Z) 41-3 — 지금 합성기 예약이 걸린 상자인가(그동안 화면 스레드는 자리·불투명도·변형을 쓰지 않는다). */
  planned?: boolean | undefined;
  /** §5.13 (Z) 41-3 — 그 예약의 애니메이션과 그것을 짠 예약(예약이 바뀌면 새로 건다). */
  anim?: Animation | undefined;
  animPlan?: StagePlan | undefined;
  /** §5.13 (Z) 41-2 — 재생 중 데이터로 보내는 중인 값(같은 값을 거듭 보내지 않게). */
  propsApplying?: string | undefined;
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
  private disposed = false;
  private revision = 0;
  private warmTimer: ReturnType<typeof setTimeout> | null = null;
  /** §5.13 (Y) 40-8 ⑤ — 실측 프레임 시간으로 조절한 데우기(없으면 처음 받은 값). */
  private warmOverride: StageWarmOptions | undefined;
  /** §5.13 (Z) 41-2·41-3 — 재생 기준(재생 중이 아니면 null). 렌더 무대(엄격)는 늘 null 이다. */
  private playClock: StagePlayClock | null = null;
  /** §5.13 (Z) 41-3 — 지금 걸린 합성기 예약과 상자별 애니메이션. */
  private plan: StagePlan | null = null;
  private planDirty = true;
  /** 다시 짠 예약으로 바꿔 낀 옛 애니메이션 — 새것을 다 건 뒤에 걷는다. */
  private readonly staleAnims: Animation[] = [];
  /** §5.13 (Z) 41-3 — 재생이 끝났다: 다음 정확한 seek 가 그 자리 배치를 쓴 **뒤에** 예약을 걷는다(한 프레임도 옛 값이 안 보이게). */
  private pendingUnplan = false;
  /** §5.13 (Z) 41-5 ② — 마지막으로 알린 '첫 그림을 못 낸 컴포지션이 보여야 하는가'. */
  private coldState = false;

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
  /** §5.13 (Y) 40-8 ⑤ — 데우기 수를 바꾼다(긴 프레임이 이어지면 줄이고, 조용해지면 되돌린다). 렌더 무대(엄격)에는 뜻이 없다. */
  setWarm(warm: StageWarmOptions | undefined): void {
    this.warmOverride = warm;
  }

  /**
   * §5.13 (Z) 41-2·41-3 — 재생을 시작하거나 기준을 옮긴다. 재생 중 `seek(t)` 는 배치만 하고 바로 끝난다 — 컴포지션은 이 기준으로
   * 스스로 재생하고(프레임마다 시각을 보내지 않는다), 컷·전환·페이드는 합성기에 예약한다. 렌더 무대(엄격)에는 뜻이 없다.
   */
  play(clock: StagePlayClock): void {
    if (this.disposed || this.opts.strict === true) return;
    this.playClock = clock;
    this.planDirty = true;
  }

  /**
   * §5.13 (Z) 41-2 — 재생을 끝낸다. 컴포지션·실사는 그 자리에 서고(실사는 정확한 장이 그려질 때까지 보이던 장 그대로), 다음 `seek`
   * 가 종전처럼 정확한 한 장을 맞춘 뒤 합성기 예약을 걷는다.
   */
  stopPlay(): void {
    if (!this.playClock) return;
    this.playClock = null;
    this.planDirty = true;
    this.pendingUnplan = true;
    for (const slot of this.slots.values()) {
      slot.video?.pause();
      if (slot.frame?.playing) void slot.frame.pause().catch(() => undefined);
      if (slot.incoming?.frame.playing) void slot.incoming.frame.pause().catch(() => undefined);
    }
    this.setCold(false);
  }

  /** §5.13 (Z) 41-2 — 재생 중인가(스스로 재생·합성기 예약이 걸려 있는가). */
  get playing(): boolean {
    return this.playClock !== null;
  }

  setDoc(doc: VideoDoc, timeline: ResolvedTimeline): void {
    if (this.disposed) return;
    this.cancelWarm();
    this.revision += 1;
    this.doc = doc;
    this.timeline = timeline;
    this.planDirty = true;
    this.element.style.width = `${doc.size.width}px`;
    this.element.style.height = `${doc.size.height}px`;
  }

  async seek(t: number): Promise<void> {
    if (this.disposed) return;
    this.cancelWarm();
    const revision = ++this.revision;
    const { doc, timeline } = this;
    this.lastT = t;
    // §5.13 (Z) 41-2·41-3 — 재생 중이면 배치만 하고 바로 끝난다(컴포지션은 스스로 재생, 컷은 합성기 예약 — 기다릴 것이 없다).
    if (this.playClock && this.opts.strict !== true) {
      this.seekPlaying(t, revision);
      return;
    }
    const ops = buildDrawList(doc, timeline, t);
    const alive = new Set(ops.map((o) => o.itemId));
    const warm = this.opts.strict === true ? undefined : this.warmOverride ?? this.opts.warm;
    const now = Date.now();
    // 데우는 무대도 문서에서 **지워진** 아이템은 보관하지 않는다(다시 올 일이 없다).
    const known = warm ? new Set(timeline.items.map((r) => r.id)) : null;

    // 사라진 것 정리 — 데우는 무대는 컴포지션을 바로 버리지 않고 보이지 않게 보관한다(39-5).
    for (const [id, slot] of this.slots) {
      if (alive.has(id)) continue;
      if (warm && slot.frame && known?.has(id)) {
        // 막 지나간 것 — 보이던 슬롯이라 이미 그려졌다(바로 쉰다).
        if (slot.parkedAt === undefined) { slot.warmStart = null; slot.warmPainted = true; }
        this.park(slot, now);
        continue;
      }
      this.dropSlot(slot);
      this.slots.delete(id);
    }

    const pending: Promise<void>[] = [];

    for (const op of ops) {
      const slot = this.ensureSlot(op);
      if (slot.parkedAt !== undefined) {
        slot.parkedAt = undefined;
        slot.warmStart = undefined;
        slot.wrapper.style.pointerEvents = '';
        slot.wrapper.style.contentVisibility = '';
      }
      this.placeSlot(slot, op);
      pending.push(this.updateSlot(slot, op, revision));
    }

    // §5.13 (Y) 40-8 ① — 숨긴 슬롯마다 쉼·깨움을 맞춘다(컷 두 프레임 전에 깨워 그 프레임을 그려 둔다).
    if (warm) {
      for (const slot of this.slots.values()) if (slot.parkedAt !== undefined) this.applyWarmState(slot, t);
    }
    // §5.13 (Z) 41-3 — 재생이 막 끝났으면 이 자리의 배치를 다 쓴 지금(같은 작업 안 — 그 사이 프레임이 없다) 예약을 걷는다.
    if (this.pendingUnplan) this.unplan();
    await Promise.all(pending);
    // 폰트가 아직이면 글자 폭이 달라져 다음 프레임과 어긋난다.
    if (typeof document.fonts?.ready?.then === 'function') await document.fonts.ready;
    // Let the caller present this frame first. Loading future documents must not hold up its ready signal.
    if (warm && !this.disposed && revision === this.revision) {
      this.warmTimer = setTimeout(() => {
        this.warmTimer = null;
        if (!this.disposed && revision === this.revision) this.warmUp(t, alive, Date.now(), warm);
      }, 0);
    }
  }

  private cancelWarm(): void {
    if (this.warmTimer !== null) clearTimeout(this.warmTimer);
    this.warmTimer = null;
  }

  // ─── §5.13 (Z) 흘려 트는 재생 ───

  /**
   * §5.13 (Z) 41-2~41-5 — 재생 중 한 프레임. **기다리지 않는다**(배치만 하고 끝난다):
   * ① 합성기 예약(앞 `STAGE_PLAN_HORIZON_S`)을 `STAGE_PLAN_REFRESH_S` 마다·문서나 기준이 바뀌면 다시 짠다
   * ② 지금 보이는 상자와 예약 구간에 곧 보일 상자를 세워 둔다 — 컴포지션은 스스로 재생을 걸고(곧 보일 것은 시작 시각까지 첫 장),
   *    실사는 `<video>` 로 흘려 튼다(시작 전에 미리 굴려 둔다)
   * ③ 예약 밖으로 나간 것은 종전처럼 보관(컴포지션)하거나 버린다
   * ④ 보여야 할 컴포지션이 아직 첫 그림을 못 냈으면 알린다(화면이 가벼운 판을 깐다)
   * ⑤ 예약 밖의 미래(데우기 거리)는 종전 데우기가 맡는다.
   */
  private seekPlaying(t: number, revision: number): void {
    const { doc, timeline } = this;
    const fps = doc.fps > 0 ? doc.fps : 30;
    const warm = this.warmOverride ?? this.opts.warm;
    const now = Date.now();
    const plan = this.planFor(t, fps);
    const ops = buildDrawList(doc, timeline, t);
    const opsById = new Map(ops.map((o) => [o.itemId, o]));
    const known = new Set(timeline.items.map((r) => r.id));
    const index = Math.round((t - plan.from) * plan.fps);

    // ③ 지금 보이지 않는 것 — 예약이 제때 숨기거나(예약이 걸린 상자) 곧 보일 것은 둔다. 나머지는 컴포지션이면 보관(데우기와 같은
    //   규칙), 아니면 버린다(예약이 안 걸린 채 끝난 상자가 다음 예약까지 남아 보이지 않게).
    for (const [id, slot] of this.slots) {
      if (opsById.has(id)) continue;
      const planned = plan.items.get(id);
      if (planned && (slot.planned === true || planned.lastIndex >= index)) continue;
      if (warm && slot.frame && known.has(id)) {
        if (slot.parkedAt === undefined) { slot.warmStart = null; slot.warmPainted = true; }
        this.unplanSlot(slot);
        this.holdSlot(slot);
        this.park(slot, now);
        continue;
      }
      this.dropSlot(slot);
      this.slots.delete(id);
    }

    // ② 지금 보이는 것.
    for (const op of ops) {
      const slot = this.ensureSlot(op);
      this.wakeSlot(slot);
      const item = plan.items.get(op.itemId);
      this.placePlaying(slot, op, item, plan);
      this.updatePlaying(slot, op, revision);
    }

    // ② 예약 구간 안에서 곧 보일 것 — 합성기가 제때 드러낸다(컴포지션은 거의 안 보이게 깨워 두고 첫 장에 세워 둔다).
    for (const item of plan.items.values()) {
      if (opsById.has(item.id) || item.lastIndex < index) continue;
      const canPlan = item.plannable && this.canAnimate();
      if (item.kind !== 'composition' && !canPlan) continue; // 예약 못 하는 것은 보일 때 세운다(먼저 세우면 먼저 보인다).
      const slot = this.ensureSlot(item.first);
      this.wakeSlot(slot);
      this.placePlaying(slot, item.first, item, plan);
      if (!slot.planned && slot.frame) slot.wrapper.style.opacity = String(STAGE_WARM_PRIME_OPACITY);
      this.armUpcoming(slot, item.first, t, revision);
    }

    // 한 번에 바꿔 낀 예약 — 새 애니메이션을 다 건 뒤에 옛것을 걷는다(같은 시각의 같은 값이라 튀지 않는다).
    for (const old of this.staleAnims.splice(0)) old.cancel();

    // ④ 보여야 할 컴포지션이 첫 그림을 못 냈는가.
    let cold = false;
    for (const op of ops) {
      if (op.kind !== 'composition') continue;
      const frame = this.slots.get(op.itemId)?.frame;
      if (frame && !frame.painted && planOpacity(op) > STAGE_WARM_PRIME_OPACITY * 2) { cold = true; break; }
    }
    this.setCold(cold);

    // ⑤ 예약 밖의 미래는 종전 데우기가 맡는다(이번 프레임을 막지 않게 다음 차례에).
    if (warm && !this.disposed) {
      const handled = new Set<string>([...opsById.keys(), ...plan.items.keys()]);
      this.warmTimer = setTimeout(() => {
        this.warmTimer = null;
        if (!this.disposed && revision === this.revision && this.playClock) this.warmUp(t, handled, Date.now(), warm);
      }, 0);
    }
  }

  /** 지금 시각의 예약(없거나 낡았으면 다시 짠다 — 짠 뒤 상자마다 새 애니메이션이 걸리고 옛것은 그 뒤에 걷힌다). */
  private planFor(t: number, fps: number): StagePlan {
    const current = this.plan;
    if (current && !this.planDirty && t >= current.from - 1e-6 && t < current.from + STAGE_PLAN_REFRESH_S) return current;
    const next = planStage(this.doc, this.timeline, t, STAGE_PLAN_HORIZON_S, fps);
    this.plan = next;
    this.planDirty = false;
    this.opts.onPlan?.();
    return next;
  }

  /** 이 환경이 Web Animations 를 걸 수 있는가(창 없는 시험·옛 엔진이면 화면 스레드가 맞춘다). */
  private canAnimate(): boolean {
    return typeof this.element.animate === 'function';
  }

  /** 보관(쉼)에서 깨운다 — 예약 구간 안의 것은 쉬지 않는다(쉬는 프레임은 그리지 않아 컷 순간에 늦는다). */
  private wakeSlot(slot: Slot): void {
    if (slot.parkedAt === undefined) return;
    slot.parkedAt = undefined;
    slot.warmStart = undefined;
    slot.wrapper.style.pointerEvents = '';
    slot.wrapper.style.contentVisibility = '';
  }

  /**
   * 재생 중 상자 배치. 예약할 수 있는 상자는 예약의 기준 자리·크기만 쓰고(자리 이동·회전·배율·불투명도는 합성기 애니메이션이
   * 쥔다), 그 밖은 종전처럼 프레임마다 화면 스레드가 쓴다.
   */
  private placePlaying(slot: Slot, op: DrawOp, item: StagePlanItem | undefined, plan: StagePlan): void {
    if (!item || !item.plannable || !this.canAnimate()) {
      if (slot.planned) this.unplanSlot(slot);
      this.placeSlot(slot, op);
      return;
    }
    const w = slot.wrapper;
    const set = (key: 'left' | 'top' | 'width' | 'height', value: string): void => { if (w.style[key] !== value) w.style[key] = value; };
    set('left', `${item.base.x}px`);
    set('top', `${item.base.y}px`);
    set('width', `${item.base.width}px`);
    set('height', `${item.base.height}px`);
    w.style.zIndex = String(op.z);
    if (w.style.clipPath !== '') w.style.clipPath = '';
    this.applyEffects(slot, op);
    if (slot.animPlan !== plan) this.animateSlot(slot, item, plan);
  }

  /** 예약 항목 하나를 상자에 건다(재생 기준에 맞춘 시작 시각으로). 같은 상자의 옛 애니메이션은 새것을 건 뒤에 걷는다. */
  private animateSlot(slot: Slot, item: StagePlanItem, plan: StagePlan): void {
    const clock = this.playClock;
    if (!clock) return;
    const keyframes = planKeyframes(item, { primeBefore: item.kind === 'composition' });
    let anim: Animation;
    try {
      anim = slot.wrapper.animate(keyframes as unknown as Keyframe[], { duration: planDurationMs(plan), fill: 'both', easing: 'linear' });
      // 문서 타임라인 = 이 문서의 performance.now() 축 — 예약의 첫 프레임이 재생 머리에 오는 순간에 시작한다.
      anim.startTime = clock.perfMs + (plan.from - clock.t) * 1000;
    } catch {
      this.unplanSlot(slot);
      return;
    }
    if (slot.anim) this.staleAnims.push(slot.anim);
    slot.anim = anim;
    slot.animPlan = plan;
    slot.planned = true;
  }

  /** 상자의 예약을 걷는다(화면 스레드가 다시 쓴다). */
  private unplanSlot(slot: Slot): void {
    slot.anim?.cancel();
    slot.anim = undefined;
    slot.animPlan = undefined;
    slot.planned = false;
  }

  /** 재생이 끝난 뒤 — 모든 예약을 걷는다(정확한 seek 가 그 자리 배치를 쓴 뒤에 부른다). */
  private unplan(): void {
    for (const slot of this.slots.values()) this.unplanSlot(slot);
    for (const old of this.staleAnims.splice(0)) old.cancel();
    this.plan = null;
    this.planDirty = true;
    this.pendingUnplan = false;
  }

  /** 재생 중 상자 안을 맞춘다 — 컴포지션은 스스로 재생, 실사는 `<video>`, 나머지는 종전 갱신(기다리지 않는다). */
  private updatePlaying(slot: Slot, op: DrawOp, revision: number): void {
    switch (op.kind) {
      case 'composition': {
        const frame = slot.frame;
        if (!frame) return;
        frame.layout(op.transform.width, op.transform.height);
        this.syncProps(slot, op);
        const play = this.compositionPlay(op);
        if (play) {
          void frame.play(play).catch(() => undefined);
          if (slot.incoming) {
            slot.incoming.frame.layout(op.transform.width, op.transform.height);
            void slot.incoming.frame.play(play).catch(() => undefined);
          }
        }
        return;
      }
      case 'footage':
        if (this.streamFootage(slot, op)) return;
        void this.updateSlot(slot, op, revision).catch(() => undefined);
        return;
      default:
        void this.updateSlot(slot, op, revision).catch(() => undefined);
    }
  }

  /** 곧 보일 상자의 안을 미리 세워 둔다 — 컴포지션은 스스로 재생을 걸어 첫 장에 머물게, 실사는 미리 굴린다. */
  private armUpcoming(slot: Slot, first: DrawOp, t: number, revision: number): void {
    switch (first.kind) {
      case 'composition': {
        const frame = slot.frame;
        if (!frame) return;
        frame.layout(first.transform.width, first.transform.height);
        const play = this.compositionPlay(first);
        if (play) {
          void frame.play(play).catch(() => undefined);
          if (slot.incoming) void slot.incoming.frame.play(play).catch(() => undefined);
        }
        return;
      }
      case 'footage':
        this.prerollFootage(slot, first, t);
        return;
      default:
        void this.updateSlot(slot, first, revision).catch(() => undefined);
    }
  }

  /** 재생 중 값(props)이 바뀌었으면 데이터로 맞춘다(기다리지 않는다 — 묶인 곳이 없으면 새 값을 실어 다시 연다). */
  private syncProps(slot: Slot, op: DrawOp): void {
    const frame = slot.frame;
    if (!frame) return;
    const props = op.resolved.item.props ?? {};
    const key = stableJson(props);
    if (slot.propsKey === key || slot.propsApplying === key) return;
    slot.propsApplying = key;
    void frame.applyProps(props).then((live) => {
      if (slot.propsApplying === key) slot.propsApplying = undefined;
      if (this.disposed || this.slots.get(op.itemId) !== slot || slot.frame !== frame) return;
      slot.propsKey = key;
      if (!live && slot.src) frame.reload(withPropsOverride(slot.src, props));
    }, () => { if (slot.propsApplying === key) slot.propsApplying = undefined; });
  }

  /** 아이템의 스스로 재생 기준식(재생 기준 → 에포크 축). 재생 중이 아니면 null. */
  private compositionPlay(op: DrawOp): CompositionPlay | null {
    const clock = this.playClock;
    if (!clock) return null;
    const r = op.resolved;
    const trim = r.item.trimStart ?? 0;
    const origin = typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number' ? performance.timeOrigin : 0;
    return {
      base: trim + (clock.t - r.start),
      anchor: origin + clock.perfMs,
      min: trim,
      until: trim + (r.end - r.start),
      grid: r.start - trim,
      fps: this.doc.fps > 0 ? this.doc.fps : 30,
    };
  }

  /** 상자의 스스로 재생·실사 재생을 세운다(보관할 때). */
  private holdSlot(slot: Slot): void {
    slot.video?.pause();
    if (slot.frame?.playing) void slot.frame.pause().catch(() => undefined);
    if (slot.incoming?.frame.playing) void slot.incoming.frame.pause().catch(() => undefined);
  }

  private setCold(cold: boolean): void {
    if (cold === this.coldState) return;
    this.coldState = cold;
    this.opts.onCold?.(cold);
  }

  // ─── §5.13 (Z) 41-4 실사는 흘려 튼다 ───

  /**
   * 재생 중 보이는 실사 — `<video>` 가 있으면 그것을 시계에 맞춰 굴린다(멈춰 있으면 그 자리로 옮겨 틀고, 굴러가는 중에는
   * `FOOTAGE_STREAM_DRIFT_S` 넘게 어긋날 때만 맞춘다). `<video>` 를 못 쓰면(주소를 묻는 중·못 받음) false — 종전 캔버스 길.
   */
  private streamFootage(slot: Slot, op: DrawOp): boolean {
    const video = this.footageVideo(slot, op);
    if (!video) return false;
    const want = op.sourceTime;
    if (video.paused || video.ended) {
      if (Math.abs(video.currentTime - want) > 1 / Math.max(1, this.doc.fps)) video.currentTime = want;
      void video.play().catch(() => undefined);
    } else if (Math.abs(video.currentTime - want) > FOOTAGE_STREAM_DRIFT_S) {
      video.currentTime = want;
    }
    return true;
  }

  /**
   * 곧 시작할 실사 — 시작 `FOOTAGE_STREAM_PREROLL_S` 전부터 그만큼 앞에서 굴려 두어(트림이 그보다 짧으면 첫 장에 세워 두었다가)
   * 시작 순간에 키프레임부터 푸는 대기가 보이지 않게 한다. 그보다 이르면 첫 장에만 세워 둔다.
   */
  private prerollFootage(slot: Slot, first: DrawOp, t: number): void {
    const video = this.footageVideo(slot, first);
    if (!video) return;
    const trim = first.resolved.item.trimStart ?? 0;
    const lead = first.resolved.start - t;
    const want = trim - lead;
    if (lead <= FOOTAGE_STREAM_PREROLL_S && want >= 0) {
      if (video.paused || video.ended) {
        if (Math.abs(video.currentTime - want) > 0.05) video.currentTime = want;
        void video.play().catch(() => undefined);
      } else if (Math.abs(video.currentTime - want) > FOOTAGE_STREAM_DRIFT_S) {
        video.currentTime = want;
      }
      return;
    }
    if (video.paused && !video.seeking && Math.abs(video.currentTime - trim) > 0.05) video.currentTime = trim;
  }

  /** 상자의 `<video>`(없으면 공급자에게 흘려 보내는 주소를 묻고 다음 프레임부터 쓴다). 못 쓰면 null. */
  private footageVideo(slot: Slot, op: DrawOp): HTMLVideoElement | null {
    if (slot.video) return slot.video;
    if (slot.videoState === 'asking' || slot.videoState === 'none') return null;
    const assetId = op.resolved.item.assetId;
    const media = this.opts.media;
    if (assetId === undefined || typeof media.streamUrl !== 'function' || typeof document === 'undefined') {
      slot.videoState = 'none';
      return null;
    }
    slot.videoState = 'asking';
    void media.streamUrl(assetId).then((url) => {
      if (this.disposed || this.slots.get(op.itemId) !== slot) return;
      if (!url) { slot.videoState = 'none'; return; }
      slot.video = this.createVideo(slot, url);
      slot.videoState = 'ready';
    }, () => { slot.videoState = 'none'; });
    return null;
  }

  /** 소리 없는 `<video>` 를 캔버스 위에 겹친다 — 그 자리의 장이 서기 전(`playing`·`seeked` 전)에는 투명해 캔버스가 보인다. */
  private createVideo(slot: Slot, url: string): HTMLVideoElement {
    const video = document.createElement('video');
    video.className = 'vs-media';
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.disableRemotePlayback = true;
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('disablepictureinpicture', '');
    const s = video.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    s.opacity = '0';
    s.pointerEvents = 'none';
    const show = (): void => { if (slot.video === video && this.playClock) video.style.opacity = '1'; };
    video.addEventListener('playing', show);
    video.addEventListener('seeked', show);
    video.src = url;
    slot.wrapper.insertBefore(video, slot.vignette ?? null);
    return video;
  }

  /** `<video>` 를 놓는다(디코더·버퍼까지 — 주소를 떼고 다시 읽혀 비운다). */
  private releaseVideo(slot: Slot): void {
    const video = slot.video;
    slot.video = undefined;
    slot.videoState = undefined;
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    try { video.load(); } catch { /* already released */ }
    video.remove();
  }

  // ─── §5.13 (Z) 41-5 ① 코드가 바뀐 컴포지션은 뒤에서 연다 ───

  /** 새 주소의 프레임을 옛 프레임 위에 거의 안 보이게 연다 — 첫 그림을 내면 `promoteIncoming` 이 바꿔 낀다. */
  private openIncoming(slot: Slot, op: DrawOp, src: string): { readonly frame: CompositionFrame; readonly src: string; readonly propsKey: string } {
    const assetId = op.resolved.item.assetId;
    const asset = assetId === undefined ? undefined : this.doc.assets[assetId];
    const responsive = asset?.responsive === true;
    const itemId = op.itemId;
    let frame: CompositionFrame | null = null;
    frame = new CompositionFrame({
      src: withPropsOverride(src, op.resolved.item.props),
      width: responsive ? op.transform.width : asset?.width ?? this.doc.size.width,
      height: responsive ? op.transform.height : asset?.height ?? this.doc.size.height,
      label: op.resolved.item.label ?? itemId,
      onEvent: (event) => this.opts.onCompositionEvent?.(itemId, event),
      onPainted: () => { if (frame) this.promoteIncoming(slot, frame); },
    });
    const s = frame.element.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    s.opacity = String(STAGE_WARM_PRIME_OPACITY);
    slot.wrapper.insertBefore(frame.element, slot.inner.nextSibling);
    frame.layout(op.transform.width, op.transform.height);
    return { frame, src, propsKey: stableJson(op.resolved.item.props) };
  }

  /** 새 프레임이 첫 그림을 냈다 — 옛 프레임을 걷고 그 자리를 넘긴다. */
  private promoteIncoming(slot: Slot, frame: CompositionFrame): void {
    const incoming = slot.incoming;
    if (this.disposed || !incoming || incoming.frame !== frame) return;
    const old = slot.frame;
    slot.incoming = undefined;
    slot.frame = frame;
    slot.inner = frame.element;
    slot.src = incoming.src;
    slot.propsKey = incoming.propsKey;
    const s = frame.element.style;
    s.position = '';
    s.left = '';
    s.top = '';
    s.opacity = '';
    old?.dispose();
  }

  private isCurrent(slot: Slot, op: DrawOp, revision: number): boolean {
    // §5.13 (Z) 41-2 — 재생 중에는 seek 가 기다리지 않아 판(revision)이 박자마다 오른다. 그때는 상자가 그대로인지만 본다(한 박자보다
    //   오래 걸린 그림 — 캔버스 길의 실사·그림 — 이 늘 버려지지 않게).
    return !this.disposed && (revision === this.revision || this.playClock !== null) && this.slots.get(op.itemId) === slot;
  }

  /** 슬롯 상자를 그 시각의 자리·크기·투명도·잘림·이펙트로 맞춘다. */
  private placeSlot(slot: Slot, op: DrawOp): void {
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
    this.applyEffects(slot, op);
  }

  /**
   * §5.13 (W) 38-5 — 이펙트: 필터는 안쪽(그림)에, 비네트는 그 위 덧칠(같은 값을 canvas2d 도 쓴다). §5.13 (Z) — 그림이 둘일 때
   * (흘려 트는 `<video>` · 뒤에서 여는 새 프레임)도 같은 필터를 입는다.
   */
  private applyEffects(slot: Slot, op: DrawOp): void {
    const filter = op.filter ?? '';
    for (const el of [slot.inner, slot.video, slot.incoming?.frame.element]) {
      if (el && el.style.filter !== filter) el.style.filter = filter;
    }
    this.applyVignette(slot, op.vignette ?? 0);
  }

  /**
   * §5.13 (X) 39-5 — 보이지 않게 둔다(자리는 무대 안 그대로). `display:none`·`visibility:hidden`·화면 밖으로 치우지 않는다 — 그러면
   * 브라우저가 교차 출처 프레임의 그리기를 늦춰 데운 보람이 없다(무대 머리말 ⚠ 와 같은 이유). 투명도만 0 이다.
   */
  private park(slot: Slot, now: number): void {
    if (slot.parkedAt === undefined) slot.parkedAt = now;
    slot.wrapper.style.pointerEvents = 'none';
    this.applyWarmState(slot, this.lastT);
  }

  /**
   * §5.13 (Y) 40-8 ① — 숨긴 슬롯의 쉼(`content-visibility:hidden` + 투명도 0)·깨움(투명도 0.01). 판단은 `warmSlotState`(순수).
   * 종전 투명도 0 만으로는 같은 프로세스 프레임이 쉬지 않았고, 다른 프로세스 프레임은 다시 보일 때 첫 그림이 늦었다(실측 — 40).
   */
  private applyWarmState(slot: Slot, t: number): void {
    const state = warmSlotState({ start: slot.warmStart ?? null, t, fps: this.doc.fps, painted: slot.warmPainted === true });
    const style = slot.wrapper.style;
    if (state === 'rest') {
      if (style.contentVisibility !== 'hidden') style.contentVisibility = 'hidden';
      if (style.opacity !== '0') style.opacity = '0';
    } else {
      if (style.contentVisibility !== '') style.contentVisibility = '';
      const prime = String(STAGE_WARM_PRIME_OPACITY);
      if (style.opacity !== prime) style.opacity = prime;
    }
  }

  /** §5.13 (X) 39-5 — 곧 시작할 컴포지션을 미리 열어 첫 시각에 맞추고(기다리지 않는다), 상한을 넘은 보관분을 버린다. */
  private warmUp(t: number, alive: ReadonlySet<string>, now: number, warm: StageWarmOptions): void {
    const upcoming = upcomingCompositions(this.timeline, t, alive, warm);
    const keep = new Set(upcoming.map((u) => u.id));
    for (const u of upcoming) {
      if (this.slots.has(u.id)) continue;
      // Warm the exact boundary: even a 1ms lead makes forward-only compositions restart on activation.
      const op = buildDrawList(this.doc, this.timeline, u.start).find((o) => o.itemId === u.id);
      if (!op || op.kind !== 'composition') continue;
      const slot = this.ensureSlot(op);
      this.placeSlot(slot, op);
      // §5.13 (Y) 40-8 ① — 처음엔 깨운 채(거의 안 보이게) 첫 시각을 그리고, 그린 뒤에야 쉰다.
      slot.warmStart = u.start;
      slot.warmPainted = false;
      this.park(slot, now);
      const frame = slot.frame;
      if (!frame) continue;
      frame.layout(op.transform.width, op.transform.height);
      // 미리보기는 엄격하지 않다 — 미리 맞추다 실패하면 그 아이템이 살아날 때 다시 맞춘다(그때의 오류는 그때 알린다).
      void frame.seek(op.sourceTime, { preview: this.opts.preview === true }).then(() => this.afterPaint(() => {
        if (this.disposed || this.slots.get(u.id) !== slot || slot.parkedAt === undefined) return;
        slot.warmPainted = true;
        this.applyWarmState(slot, this.lastT);
      }), () => undefined);
    }
    // §5.13 (Y) 40-3 ④ — 곧 시작할 실사 아이템의 읽개도 첫 프레임에 세워 둔다(공급자가 기다리지 않고 한다).
    //   §5.13 (Z) 41-4 — 재생 중 실사를 `<video>` 로 흘려 트는 공급자면 그쪽이 미리 굴린다(읽개를 따로 풀지 않는다).
    if (!(this.playClock && typeof this.opts.media.streamUrl === 'function')) this.opts.media.warmFootage?.(upcomingFootage(this.timeline, t, alive));
    const parked: { id: string; parkedAt: number }[] = [];
    for (const [id, slot] of this.slots) if (slot.parkedAt !== undefined) parked.push({ id, parkedAt: slot.parkedAt });
    for (const id of parkedToRelease(parked, now, keep, warm)) {
      const slot = this.slots.get(id);
      if (!slot) continue;
      this.dropSlot(slot);
      this.slots.delete(id);
    }
  }

  /** 이 문서에서 두 번 그려진 뒤에(그 사이 샌드박스 프레임이 제 그림을 낼 틈) 부른다. 창이 없으면 바로. */
  private afterPaint(fn: () => void): void {
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    if (!raf) { fn(); return; }
    raf(() => raf(() => fn()));
  }

  private dropSlot(slot: Slot): void {
    slot.frame?.dispose();
    // §5.13 (Z) — 뒤에서 열던 새 프레임 · 흘려 틀던 `<video>` · 합성기 예약도 함께 놓는다.
    slot.incoming?.frame.dispose();
    slot.incoming = undefined;
    this.releaseVideo(slot);
    this.unplanSlot(slot);
    // Detached canvases can remain reachable until a decode settles; release their pixel buffers now.
    if (slot.kind === 'image' || slot.kind === 'footage' || slot.kind === 'model') {
      const canvas = slot.inner as HTMLCanvasElement;
      canvas.width = 0;
      canvas.height = 0;
    }
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
    if (existing && existing.kind === op.kind && existing.sceneId === sceneId && existing.src === src) {
      // 코드가 도로 그 판으로 돌아왔다 — 뒤에서 열던 새 프레임은 필요 없다.
      if (existing.incoming) { existing.incoming.frame.dispose(); existing.incoming = undefined; }
      return existing;
    }
    // §5.13 (Z) 41-5 ① — 미리보기에서 코드만 바뀐 컴포지션은 옛 그림을 그대로 두고 새 프레임을 뒤에서 연다(첫 그림이 서면 바꿔 낀다 —
    //   로딩 동안 빈 칸이 보이지 않게). 렌더(엄격)는 종전대로 바로 바꾼다. 옛 프레임이 아직 그림을 못 냈으면 둘 이유가 없다.
    if (existing && existing.frame && existing.frame.painted && existing.kind === 'composition' && op.kind === 'composition'
      && existing.sceneId === sceneId && src !== undefined && this.opts.preview === true && this.opts.strict !== true) {
      if (existing.incoming?.src !== src) {
        existing.incoming?.frame.dispose();
        existing.incoming = this.openIncoming(existing, op, src);
      }
      return existing;
    }
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
      case 'model':
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

  private async updateSlot(slot: Slot, op: DrawOp, revision: number): Promise<void> {
    switch (op.kind) {
      case 'composition': {
        const frame = slot.frame;
        if (!frame) return;
        frame.layout(op.transform.width, op.transform.height);
        // §5.13 (V) 37-5 — 값만 바뀌었으면 프레임을 다시 열지 않고 데이터로 맞춘다. 묶인 곳이 없으면 새 값을 실어 다시 연다.
        const props = op.resolved.item.props ?? {};
        const key = stableJson(props);
        try {
          if (slot.propsKey !== key) {
            const live = await frame.applyProps(props);
            if (!this.isCurrent(slot, op, revision)) return;
            slot.propsKey = key;
            if (!live && slot.src) frame.reload(withPropsOverride(slot.src, props));
          }
          // §5.13 (Z) 41-5 ① — 뒤에서 여는 새 프레임도 같은 시각으로 맞춘다(기다리지 않는다 — 첫 그림이 서면 바꿔 낀다).
          const incoming = slot.incoming;
          if (incoming) {
            incoming.frame.layout(op.transform.width, op.transform.height);
            void incoming.frame.seek(op.sourceTime, { preview: true }).catch(() => undefined);
          }
          // 컴포지션 안 시각 = 아이템 시작 뒤 흐른 시간 + 트림(drawList 가 이미 계산했다).
          await frame.seek(op.sourceTime, { preview: this.opts.preview === true && this.opts.strict !== true });
        } catch (err) {
          if (!this.isCurrent(slot, op, revision)) return;
          if (this.opts.strict === true) throw err;
          this.opts.onCompositionEvent?.(op.itemId, { kind: 'error', message: err instanceof Error ? err.message : String(err) });
          // A failed preview frame is not ready. Let the playback gate keep time/audio stopped and retry.
          if (this.opts.preview === true) throw err;
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
      case 'model':
      case 'footage': {
        const canvas = slot.inner as HTMLCanvasElement;
        const assetId = op.resolved.item.assetId;
        if (assetId === undefined) return;
        const src =
          op.kind === 'model'
            ? await this.opts.media.getModelFrame?.(op)
            : op.kind === 'image'
            ? (await this.opts.media.getItemFrame?.(op)) ?? await this.opts.media.getImage(assetId)
            : await this.opts.media.getFrame(assetId, op.sourceTime, { itemId: op.itemId, boxWidth: op.transform.width });
        if (!this.isCurrent(slot, op, revision)) return;
        if (!src) { if (op.kind === 'model') throw new Error(MODEL_RENDERER_UNAVAILABLE); return; }
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
        // §5.13 (Z) 41-4 — 정확한 장이 캔버스에 섰으니 재생 때 흘려 틀던 `<video>` 를 걷는다(그 전까지는 보이던 장 그대로였다).
        if (slot.video && !this.playClock) {
          slot.video.pause();
          slot.video.style.opacity = '0';
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
    // Models and editable images answer through the provider's adapter — the same call the canvas preview makes.
    const element = await pickMediaElement(this.opts.media, hit.op, x, y);
    if (element) return { op: hit.op, element, rect: element.rect };
    if (hit.op.kind === 'composition' && slot?.frame) {
      const box = hit.op.transform;
      const element = await slot.frame.pick(x - box.x, y - box.y);
      if (element) {
        return { op: hit.op, element, rect: { x: box.x + element.rect.x, y: box.y + element.rect.y, width: element.rect.width, height: element.rect.height } };
      }
    }
    if (hit.op.kind === 'scene' && slot) {
      const element = this.scenePartAt(hit.op, slot, x, y);
      if (element) return { op: hit.op, element, rect: element.rect };
    }
    return { op: hit.op, rect: hit.rect };
  }

  /**
   * §5.13 (V) 37-6 — 기본 HTML 씬 안에서 문서 픽셀 (x, y) 아래 글자 요소(`[data-vibi-prop]`). 무대는 CSS 로 배치하므로
   * 캔버스 계산(`sceneParts.ts`)이 아니라 **실제 상자**로 잰다 — 무대 상자 대 문서 크기의 비로 옮기므로 무대를 줄여 보여도 맞다.
   * 아직 나오지 않은(투명한) 줄은 고르지 않는다.
   */
  private scenePartAt(op: DrawOp, slot: Slot, x: number, y: number): PickedElement | null {
    const stage = this.element.getBoundingClientRect();
    if (stage.width <= 0 || stage.height <= 0) return null;
    const sx = this.doc.size.width / stage.width;
    const sy = this.doc.size.height / stage.height;
    const found = Array.from(slot.inner.querySelectorAll<HTMLElement>(`[${SCENE_PROP_ATTR}]`));
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const el = found[i];
      if (!el) continue;
      let alpha = 1;
      for (let cur: HTMLElement | null = el; cur && cur !== slot.wrapper; cur = cur.parentElement) {
        const o = cur.style.opacity === '' ? 1 : Number(cur.style.opacity);
        if (Number.isFinite(o)) alpha *= o;
        if (cur.style.display === 'none') alpha = 0;
      }
      if (alpha <= 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const rect = { x: (r.left - stage.left) * sx, y: (r.top - stage.top) * sy, width: r.width * sx, height: r.height * sy };
      if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) continue;
      const prop = el.getAttribute(SCENE_PROP_ATTR) ?? '';
      const px = parseFloat(el.ownerDocument.defaultView?.getComputedStyle(el).fontSize ?? '');
      return {
        path: `props.${prop}`, tag: 'scene', text: scenePropText(op, prop) ?? (el.textContent ?? '').trim(), prop, rect,
        ...(Number.isFinite(px) && px > 0 ? { fontSize: px } : {}),
      };
    }
    return null;
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
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    this.cancelWarm();
    for (const slot of this.slots.values()) this.dropSlot(slot);
    this.slots.clear();
    for (const old of this.staleAnims.splice(0)) old.cancel();
    this.playClock = null;
    this.plan = null;
    this.element.remove();
  }
}
