/**
 * §5.13 (T-2)(T-3) — 컴포지션 한 장의 **샌드박스 프레임**과 시각 맞춤 대화.
 *
 * 무대(`HtmlSceneStage`)가 composition 아이템마다 하나씩 세운다. 하는 일은 셋이다.
 *
 * 1. **가둔다** — `<iframe sandbox="allow-scripts">`. `allow-same-origin` 이 없어 출처가 불투명해지므로 부모 문서·
 *    `window.api`(preload)·저장소·쿠키에 닿지 못한다. `allow`(권한 정책)는 비워 카메라·마이크·클립보드·전체 화면이 없다.
 * 2. **시각을 준다** — `{__vibi:'seek', t, seq}` 를 보내고 그 `seq` 의 `ready` 를 기다린다. 컴포지션 안의 런타임 심
 *    (`composition/runtime.ts`)이 맞춰 그리고 다 그려진 뒤에만 답한다. 상한을 넘기면 **어느 시각에서 멈췄는지** 말한다.
 * 3. **되감는다** — 프레임 콜백에 기대는 컴포지션(`forward`)은 뒤로 갈 수 없으므로, 지난 시각을 요구받으면 프레임을
 *    새로 열어 0초부터 다시 흘린다(그만큼 느리다 — 렌더는 앞으로만 가므로 대가가 없다).
 *
 * 메시지는 **그 iframe 의 `contentWindow` 에서 온 것만** 받고 모양이 다르면 버린다. 메시지로 무엇을 실행하는 일은 없다.
 *
 * §5.13 (V) — 읽기 전용 쌍과 데이터: `pick`(그 자리 요소 → `picked`) · `inspect`(보이는 글자 상자 → `inspected`) ·
 * `props`(값 갈아 끼우기 → `props-applied{live}`). 묶인 곳이 없으면(`live:false`) 무대가 새 값을 실어 프레임을 다시 연다.
 * 컴포지션이 알린 신호 표지(`cue`)는 `onEvent` 로 올린다.
 */

import { COMPOSITION_LOAD_TIMEOUT_MS, COMPOSITION_SEEK_TIMEOUT_MS } from '../constants.js';
import type { CompositionSeekMode } from '../types.js';

export interface CompositionFrameOptions {
  /** 컴포지션 문서 주소(내주는 쪽이 심을 넣어 준다). */
  readonly src: string;
  /** 컴포지션이 그리도록 짠 크기(선언 → 없으면 문서 판형). 프레임은 이 크기로 그린 뒤 상자에 맞춰 줄인다. */
  readonly width: number;
  readonly height: number;
  /** 사람이 읽는 이름(오류 문구용 — 아이템 라벨·id). */
  readonly label: string;
  readonly loadTimeoutMs?: number;
  readonly seekTimeoutMs?: number;
  /** 런타임이 알려 온 오류·막힌 주소(표시용). */
  readonly onEvent?: (event: CompositionFrameEvent) => void;
}

export type CompositionFrameEvent =
  /** `t` = 런타임이 알려 온, 오류가 난 가상 시각(초 — 없으면 모른다). */
  | { readonly kind: 'error'; readonly message: string; readonly t?: number }
  | { readonly kind: 'blocked'; readonly url: string; readonly directive: string }
  | { readonly kind: 'cue'; readonly name: string; readonly t: number };

/** 사각형(그 좌표계의 px). */
export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** §5.13 (V) 37-6 — 컴포지션이 읽어 알려 준 요소(사각형은 **상자** 좌표 — 무대가 다시 문서 좌표로 옮긴다). */
export interface PickedElement {
  readonly path: string;
  readonly tag: string;
  readonly text: string;
  /** 가장 가까운 `[data-vibi-prop]` 의 이름 — 그 글자는 값 손잡이와 같은 경로로 고친다. */
  readonly prop: string | null;
  readonly rect: FrameRect;
}

/** §5.13 (V) 37-9 — 보이는 글자 상자 하나(사각형은 상자 좌표). */
export interface InspectedText {
  readonly path: string;
  readonly text: string;
  readonly color: string;
  readonly fontSize: number;
  readonly rect: FrameRect;
}

/** 읽기 전용 쌍의 대기 상한(ms) — 답이 없으면 비어 있는 답으로 물러난다(가리키기는 아이템 단위로). */
const ASK_TIMEOUT_MS = 1500;

interface Pending {
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

type RuntimeMessage =
  | { readonly __vibi: 'loaded'; readonly mode?: unknown }
  | { readonly __vibi: 'ready'; readonly seq?: unknown; readonly mode?: unknown }
  | { readonly __vibi: 'error'; readonly message?: unknown; readonly t?: unknown }
  | { readonly __vibi: 'blocked'; readonly url?: unknown; readonly directive?: unknown }
  | { readonly __vibi: 'picked' | 'inspected' | 'props-applied' | 'scanned'; readonly seq?: unknown; readonly [key: string]: unknown }
  | { readonly __vibi: 'cue'; readonly name?: unknown; readonly t?: unknown };

const RUNTIME_TAGS = new Set(['loaded', 'ready', 'error', 'blocked', 'picked', 'inspected', 'props-applied', 'scanned', 'cue']);

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object') return false;
  const tag = (value as { __vibi?: unknown }).__vibi;
  return typeof tag === 'string' && RUNTIME_TAGS.has(tag);
}

function asRect(raw: unknown): FrameRect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (k: string): number => (typeof r[k] === 'number' && Number.isFinite(r[k] as number) ? (r[k] as number) : Number.NaN);
  const rect = { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
  return Object.values(rect).every((v) => Number.isFinite(v)) ? rect : null;
}

function asText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.slice(0, max) : '';
}

export class CompositionFrame {
  /** 무대가 아이템 상자 안에 붙이는 바깥 상자. 안의 iframe 은 되감을 때 갈아 끼운다. */
  readonly element: HTMLDivElement;
  private iframe: HTMLIFrameElement;
  private loaded!: Promise<void>;
  private settleLoaded: ((err?: Error) => void) | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  /** 읽기 전용 쌍·값 반영의 답을 기다리는 것들(`seq` 열쇠 — seek 와 같은 수를 쓴다). */
  private readonly asks = new Map<number, { readonly resolve: (data: Record<string, unknown> | null) => void; readonly timer: ReturnType<typeof setTimeout> }>();
  /** 지금 프레임이 연 주소(값을 실어 다시 열면 바뀐다). */
  private src: string;
  /** 설계 크기 → 상자 맞춤(contain) 배율과 여백 — 좌표를 오갈 때 쓴다. */
  private fit = { scale: 1, left: 0, top: 0 };
  private mode: CompositionSeekMode = 'random';
  /** 마지막으로 맞춘 시각(초) — 뒤로 가는지 가른다. 새 프레임이면 -1. */
  private lastT = -1;
  /**
   * 이 iframe 이 받은 `load` 수. 주소를 붙인 뒤에 DOM 에 넣으므로 정상이면 한 번뿐이다 — 두 번째부터는 컴포지션이 자기
   * 프레임에 다른 문서를 띄운 흔적이다(T-3 겹 방어 — main 의 프레임 이동 금지가 먼저 막는다). 메시지 도착 순서에
   * 기대지 않으려고 수로 센다(프레임이 다른 프로세스면 `loaded` 메시지와 `load` 사건의 순서가 보장되지 않는다).
   */
  private loadEvents = 0;
  private navigatedAway = false;
  private disposed = false;
  private box = { width: 0, height: 0 };
  private readonly onMessage = (e: MessageEvent): void => this.handleMessage(e);

  constructor(private readonly opts: CompositionFrameOptions) {
    this.src = opts.src;
    const box = document.createElement('div');
    box.className = 'vs-comp-box';
    this.element = box;
    this.iframe = this.createIframe();
    window.addEventListener('message', this.onMessage);
  }

  get seekMode(): CompositionSeekMode {
    return this.mode;
  }

  /** 상자 크기가 바뀌면 프레임을 다시 맞춘다(선언 크기 → 상자에 contain). */
  layout(width: number, height: number): void {
    if (this.box.width === width && this.box.height === height) return;
    this.box = { width, height };
    this.applyLayout();
  }

  private applyLayout(): void {
    const w = Math.max(1, this.opts.width);
    const h = Math.max(1, this.opts.height);
    const bw = Math.max(1, this.box.width);
    const bh = Math.max(1, this.box.height);
    const scale = Math.min(bw / w, bh / h);
    const left = (bw - w * scale) / 2;
    const top = (bh - h * scale) / 2;
    this.fit = { scale, left, top };
    this.iframe.style.width = `${w}px`;
    this.iframe.style.height = `${h}px`;
    this.iframe.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  }

  private createIframe(): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.className = 'vs-comp';
    // allow-same-origin 이 없어야 출처가 불투명해진다(T-3). 팝업·폼·최상위 이동·다운로드는 목록에 없어 막힌다.
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('allow', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    this.loadEvents = 0;
    this.armLoaded();
    iframe.addEventListener('load', () => {
      this.loadEvents += 1;
      if (this.loadEvents > 1 && !this.disposed && this.iframe === iframe) {
        this.navigatedAway = true;
        iframe.style.visibility = 'hidden';
        this.opts.onEvent?.({ kind: 'error', message: `${this.opts.label}: the composition navigated away from its document.` });
      }
    });
    // 주소를 먼저 붙이고 DOM 에 넣는다 — 주소 없이 넣으면 빈 문서(about:blank)의 load 가 먼저 와 위의 수가 어긋난다.
    iframe.src = this.src;
    this.iframe = iframe;
    this.applyLayout();
    this.element.replaceChildren(iframe);
    return iframe;
  }

  private armLoaded(): void {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.settleLoaded = null;
    this.loaded = new Promise<void>((resolve, reject) => {
      this.settleLoaded = (err?: Error): void => {
        if (this.loadTimer) clearTimeout(this.loadTimer);
        this.loadTimer = null;
        this.settleLoaded = null;
        if (err) reject(err);
        else resolve();
      };
    });
    // 기다리는 쪽이 없을 때 거절되어도 처리되지 않은 거절로 남지 않게.
    this.loaded.catch(() => undefined);
    const ms = this.opts.loadTimeoutMs ?? COMPOSITION_LOAD_TIMEOUT_MS;
    this.loadTimer = setTimeout(() => {
      this.settleLoaded?.(new Error(`${this.opts.label}: the composition did not load within ${Math.round(ms / 1000)}s.`));
    }, ms);
  }

  private handleMessage(e: MessageEvent): void {
    if (this.disposed || e.source !== this.iframe.contentWindow) return;
    const data: unknown = e.data;
    if (!isRuntimeMessage(data)) return;
    switch (data.__vibi) {
      case 'loaded':
        if (data.mode === 'forward') this.mode = 'forward';
        this.settleLoaded?.();
        return;
      case 'ready': {
        if (data.mode === 'forward') this.mode = 'forward';
        const seq = typeof data.seq === 'number' ? data.seq : -1;
        const pending = this.pending.get(seq);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(seq);
          pending.resolve();
        }
        return;
      }
      case 'error': {
        const message = `${this.opts.label}: ${typeof data.message === 'string' ? data.message : 'error'}`;
        const t = typeof data.t === 'number' && Number.isFinite(data.t) ? data.t : undefined;
        this.opts.onEvent?.(t === undefined ? { kind: 'error', message } : { kind: 'error', message, t });
        return;
      }
      case 'blocked':
        this.opts.onEvent?.({
          kind: 'blocked',
          url: typeof data.url === 'string' ? data.url : '',
          directive: typeof data.directive === 'string' ? data.directive : '',
        });
        return;
      case 'cue': {
        const t = typeof data.t === 'number' && Number.isFinite(data.t) ? data.t : Number.NaN;
        const name = typeof data.name === 'string' ? data.name.slice(0, 80) : '';
        if (name !== '' && Number.isFinite(t)) this.opts.onEvent?.({ kind: 'cue', name, t });
        return;
      }
      case 'picked':
      case 'inspected':
      case 'props-applied':
      case 'scanned': {
        const seq = typeof data.seq === 'number' ? data.seq : -1;
        const ask = this.asks.get(seq);
        if (ask) {
          clearTimeout(ask.timer);
          this.asks.delete(seq);
          ask.resolve(data as Record<string, unknown>);
        }
        return;
      }
      default:
        return;
    }
  }

  /** 프레임을 새로 연다 — 처음부터 다시 흘린다(순방향 전용 컴포지션의 되감기). */
  private restart(): void {
    for (const [seq, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(seq);
      p.reject(new Error(`${this.opts.label}: restarted.`));
    }
    this.lastT = -1;
    this.navigatedAway = false;
    this.createIframe();
  }

  /**
   * 컴포지션 안 시각 `t`(초 — 아이템 시작 + 트림 기준)의 모습으로 맞춘다. 다 그려진 뒤에 끝난다.
   * 상한을 넘기거나 문서가 뜨지 않으면 **거절**한다 — 무대가 엄격 모드(렌더)면 그 프레임을 찍지 않고 이유를 낸다.
   */
  async seek(t: number): Promise<void> {
    if (this.disposed) return;
    if (this.navigatedAway || (this.mode === 'forward' && this.lastT >= 0 && t < this.lastT - 1e-6)) this.restart();
    await this.loaded;
    if (this.disposed) return;
    const seq = (this.seq += 1);
    const ms = this.opts.seekTimeoutMs ?? COMPOSITION_SEEK_TIMEOUT_MS;
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`${this.opts.label}: the composition did not finish the frame at ${t.toFixed(2)}s within ${Math.round(ms / 1000)}s.`));
      }, ms);
      this.pending.set(seq, { resolve, reject, timer });
    });
    const target = this.iframe.contentWindow;
    if (!target) throw new Error(`${this.opts.label}: the composition frame is gone.`);
    // 불투명 출처라 대상 출처를 지정할 수 없다 — 받는 쪽(심)이 `e.source === parent` 로 가린다.
    target.postMessage({ __vibi: 'seek', t, seq }, '*');
    await done;
    this.lastT = t;
  }

  /** 묻고 그 `seq` 의 답을 기다린다(상한을 넘기면 null). */
  private ask(message: Record<string, unknown>, timeoutMs = ASK_TIMEOUT_MS): Promise<Record<string, unknown> | null> {
    const target = this.iframe.contentWindow;
    if (this.disposed || !target) return Promise.resolve(null);
    const seq = (this.seq += 1);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.asks.delete(seq); resolve(null); }, timeoutMs);
      this.asks.set(seq, { resolve, timer });
      target.postMessage({ ...message, seq }, '*');
    });
  }

  /** 상자 좌표(px) → 컴포지션 설계 좌표. */
  private toDesign(x: number, y: number): { x: number; y: number } {
    const s = this.fit.scale > 0 ? this.fit.scale : 1;
    return { x: (x - this.fit.left) / s, y: (y - this.fit.top) / s };
  }

  /** 컴포지션 설계 좌표의 사각형 → 상자 좌표. */
  private toBox(r: FrameRect): FrameRect {
    const s = this.fit.scale;
    return { x: this.fit.left + r.x * s, y: this.fit.top + r.y * s, width: r.width * s, height: r.height * s };
  }

  /** §5.13 (V) 37-6 — 상자 좌표 (x, y) 아래 요소(읽기 전용). 답이 없거나 빈 자리면 null. */
  async pick(x: number, y: number): Promise<PickedElement | null> {
    try { await this.loaded; } catch { return null; }
    const design = this.toDesign(x, y);
    const data = await this.ask({ __vibi: 'pick', x: design.x, y: design.y });
    const rect = asRect(data?.['rect']);
    const path = asText(data?.['path'], 400);
    if (!data || !rect || path === '') return null;
    return { path, tag: asText(data['tag'], 40), text: asText(data['text'], 200), prop: typeof data['prop'] === 'string' ? data['prop'] : null, rect: this.toBox(rect) };
  }

  /** §5.13 (V) 37-9 — 지금 보이는 글자 상자들(읽기 전용). */
  async inspect(): Promise<InspectedText[]> {
    try { await this.loaded; } catch { return []; }
    const data = await this.ask({ __vibi: 'inspect' }, ASK_TIMEOUT_MS * 2);
    const raw = data?.['texts'];
    if (!Array.isArray(raw)) return [];
    const out: InspectedText[] = [];
    for (const entry of raw.slice(0, 80)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const rect = asRect(e['rect']);
      if (!rect) continue;
      out.push({ path: asText(e['path'], 400), text: asText(e['text'], 120), color: asText(e['color'], 60), fontSize: typeof e['fontSize'] === 'number' ? e['fontSize'] : 0, rect: this.toBox(rect) });
    }
    return out;
  }

  /**
   * §5.13 (V) 37-5 — 새 값(props)을 데이터로 보낸다. 컴포지션이 그 값을 바로 그렸으면(묶인 요소·`onProps`·`seek` 함수) true.
   * 답이 없으면 false — 무대가 새 값을 실어 다시 연다.
   */
  async applyProps(values: Readonly<Record<string, unknown>>): Promise<boolean> {
    try { await this.loaded; } catch { return false; }
    const data = await this.ask({ __vibi: 'props', values }, ASK_TIMEOUT_MS * 2);
    return data?.['live'] === true;
  }

  /**
   * §5.13 (T-8) — 0초부터 `to` 초까지 `step` 걸음으로 시계를 한 번 흘린다(찍지 않는다). 그 사이 표지·오류는 `onEvent` 로
   * 차례로 오고, 이 약속은 런타임의 `scanned` 가 오면 끝난다(같은 창에서 온 메시지는 순서가 지켜진다 — 그때는 표지가 다 와 있다).
   * 상한 안에 답이 없으면 false.
   */
  async scan(to: number, step: number, timeoutMs: number): Promise<boolean> {
    try { await this.loaded; } catch { return false; }
    const data = await this.ask({ __vibi: 'scan', to, step }, timeoutMs);
    if (data) this.lastT = to;
    return data !== null;
  }

  /** 다른 주소로 다시 연다(값을 실은 주소 등). 다음 seek 이 새 프레임을 맞춘다. */
  reload(src: string): void {
    if (this.disposed) return;
    this.src = src;
    this.restart();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('message', this.onMessage);
    if (this.loadTimer) clearTimeout(this.loadTimer);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(`${this.opts.label}: disposed.`));
    }
    this.pending.clear();
    for (const a of this.asks.values()) {
      clearTimeout(a.timer);
      a.resolve(null);
    }
    this.asks.clear();
    this.settleLoaded?.(new Error(`${this.opts.label}: disposed.`));
    this.element.remove();
  }
}
