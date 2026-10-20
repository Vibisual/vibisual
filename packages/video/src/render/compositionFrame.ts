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
 * §5.13 (Z) 41-1 — **직통 채널**: 런타임이 `loaded{ port:true }` 로 받을 수 있다고 알리면 `MessageChannel` 의 한쪽 포트를 그
 * 프레임에 건네고, 그 뒤 모든 요청·답은 포트로 오간다. 다른 프로세스 프레임 사이의 `window.postMessage` 는 브라우저 프로세스
 * UI 스레드(앱 본체 — 서버가 함께 돈다)를 거쳐 건너가서, 거기가 멈출 때마다 미리보기가 멎었다(41 실측). 포트를 모르는 옛
 * 런타임은 종전 길 그대로다.
 *
 * §5.13 (Z) 41-2 — **스스로 재생**: `play()` 는 프레임마다 시각을 보내는 대신 기준식(에포크 `anchor` 에 `base`) 하나를 보낸다 —
 * 컴포지션이 제 rAF 로 제 시각을 계산한다. `pause()` 는 멈춘 시각을 받아 온다(다음 정확한 seek 가 그 자리에서 판단하게).
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
  /** §5.13 (Z) 41-5 — 이 프레임(새로 열 때마다)이 첫 그림을 냈을 때 한 번(정확한 seek 의 답 또는 스스로 재생의 첫 장). */
  readonly onPainted?: () => void;
}

/**
 * §5.13 (Z) 41-2 — 스스로 재생의 기준식. 에포크 시각 `anchor`(ms — `performance.timeOrigin + performance.now()`)에 이
 * 컴포지션의 시각은 `base`(초)이고 속도 1 로 간다. `min`~`until`(초, `until` 은 들어가지 않는다) 밖으로 나가지 않으며, 시각은
 * 문서 프레임 격자에 놓인다(`grid` = 아이템 시작 − 트림 — 무대가 프레임마다 청했을 바로 그 프레임들).
 */
export interface CompositionPlay {
  readonly base: number;
  readonly anchor: number;
  readonly min: number;
  readonly until: number | null;
  readonly grid: number;
  readonly fps: number;
}

/** 이 문맥의 에포크 시각(ms). 다른 프로세스의 컴포지션과 같은 축이다(41 실측 — 한 프레임 안). */
export function epochNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number') return performance.timeOrigin + performance.now();
  return Date.now();
}

/** 기준식이 에포크 `now` 에 가리키는 시각(초 — `min`~`until` 안). */
export function playTimeAt(play: CompositionPlay, now: number): number {
  const t = play.base + (now - play.anchor) / 1000;
  const upper = play.until === null ? Number.POSITIVE_INFINITY : play.until;
  return Math.min(upper, Math.max(play.min, t));
}

/** 같은 기준식인가(같은 시계 위의 같은 직선 — 기준점만 옮겨 적은 것도 같다고 본다, 1ms 안). */
export function samePlay(a: CompositionPlay, b: CompositionPlay): boolean {
  if (a.min !== b.min || a.until !== b.until || a.grid !== b.grid || a.fps !== b.fps) return false;
  // 같은 직선이면 b 의 기준점에서 a 가 가리키는 시각이 b.base 와 같다.
  const aAtB = a.base + (b.anchor - a.anchor) / 1000;
  return Math.abs(aAtB - b.base) < 0.001;
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
  readonly objectId?: string;
  readonly adapter?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly path: string;
  readonly tag: string;
  readonly text: string;
  /** 가장 가까운 `[data-vibi-prop]` 의 이름 — 그 글자는 값 손잡이와 같은 경로로 고친다. */
  readonly prop: string | null;
  readonly rect: FrameRect;
  /** §5.13 (V) 37-6 — 그 글자의 크기(문서 픽셀). 알면 제자리 고치기 칸이 같은 크기로 선다(기본 씬이 싣는다). */
  readonly fontSize?: number;
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
  | { readonly __vibi: 'loaded'; readonly mode?: unknown; readonly port?: unknown }
  | { readonly __vibi: 'ready'; readonly seq?: unknown; readonly mode?: unknown }
  | { readonly __vibi: 'played'; readonly t?: unknown; readonly mode?: unknown }
  | { readonly __vibi: 'error'; readonly message?: unknown; readonly t?: unknown }
  | { readonly __vibi: 'blocked'; readonly url?: unknown; readonly directive?: unknown }
  | { readonly __vibi: 'picked' | 'inspected' | 'props-applied' | 'scanned' | 'paused'; readonly seq?: unknown; readonly [key: string]: unknown }
  | { readonly __vibi: 'cue'; readonly name?: unknown; readonly t?: unknown };

const RUNTIME_TAGS = new Set(['loaded', 'ready', 'played', 'error', 'blocked', 'picked', 'inspected', 'props-applied', 'scanned', 'paused', 'cue']);

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
  private frameDirty = false;
  /**
   * 이 iframe 이 받은 `load` 수. 주소를 붙인 뒤에 DOM 에 넣으므로 정상이면 한 번뿐이다 — 두 번째부터는 컴포지션이 자기
   * 프레임에 다른 문서를 띄운 흔적이다(T-3 겹 방어 — main 의 프레임 이동 금지가 먼저 막는다). 메시지 도착 순서에
   * 기대지 않으려고 수로 센다(프레임이 다른 프로세스면 `loaded` 메시지와 `load` 사건의 순서가 보장되지 않는다).
   */
  private loadEvents = 0;
  private navigatedAway = false;
  private disposed = false;
  /** Warming and foreground activation may overlap; only one seek may own an iframe at a time. */
  private seekChain: Promise<void> = Promise.resolve();
  private generation = 0;
  private box = { width: 0, height: 0 };
  private readonly onMessage = (e: MessageEvent): void => this.handleMessage(e);
  /** §5.13 (Z) 41-1 — 직통 채널(이 iframe 에 건넨 포트의 우리 쪽). 새로 열면(되감기·다시 열기) 버리고 새로 건넨다. */
  private port: MessagePort | null = null;
  /** §5.13 (Z) 41-2 — 지금 스스로 재생 중이면 그 기준식(아니면 null). */
  private playMap: CompositionPlay | null = null;
  /** §5.13 (Z) 41-5 — 이 iframe 이 첫 그림을 냈는가(새로 열면 다시 false). */
  private paintedFlag = false;

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

  /** §5.13 (Z) 41-5 — 첫 그림을 냈는가(정확한 seek 의 답 또는 스스로 재생의 첫 장). 새로 열면 다시 false. */
  get painted(): boolean {
    return this.paintedFlag;
  }

  /** §5.13 (Z) 41-2 — 스스로 재생 중인가. */
  get playing(): boolean {
    return this.playMap !== null;
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
      if (this.disposed || this.iframe !== iframe) return;
      this.loadEvents += 1;
      if (this.loadEvents > 1) {
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
    this.handleData(e.data);
  }

  /**
   * §5.13 (Z) 41-1 — 포트를 건넨다(런타임이 받을 수 있다고 알렸을 때만). 건넨 뒤의 답은 포트로 오고, 그 포트는 이 iframe 의 것일
   * 때만 듣는다(되감기로 새로 열면 옛 포트는 닫는다).
   */
  private openPort(): void {
    if (this.port || typeof MessageChannel !== 'function') return;
    const target = this.iframe.contentWindow;
    if (!target) return;
    const channel = new MessageChannel();
    const port = channel.port1;
    port.onmessage = (ev: MessageEvent): void => {
      if (!this.disposed && this.port === port) this.handleData(ev.data);
    };
    try {
      target.postMessage({ __vibi: 'port' }, '*', [channel.port2]);
    } catch {
      port.close();
      return;
    }
    this.port = port;
  }

  private closePort(): void {
    if (!this.port) return;
    try { this.port.close(); } catch { /* already closed */ }
    this.port = null;
  }

  /** 포트가 있으면 포트로, 없으면 종전 창 메시지로(옛 런타임). 보낼 곳이 없으면 false. */
  private send(message: Record<string, unknown>): boolean {
    if (this.port) {
      this.port.postMessage(message);
      return true;
    }
    const target = this.iframe.contentWindow;
    if (!target) return false;
    target.postMessage(message, '*');
    return true;
  }

  private markPainted(): void {
    if (this.paintedFlag) return;
    this.paintedFlag = true;
    this.opts.onPainted?.();
  }

  private handleData(data: unknown): void {
    if (!isRuntimeMessage(data)) return;
    switch (data.__vibi) {
      case 'loaded':
        if (data.mode === 'forward') this.mode = 'forward';
        if (data.port === true) this.openPort();
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
        this.markPainted();
        return;
      }
      case 'played':
        if (data.mode === 'forward') this.mode = 'forward';
        this.markPainted();
        return;
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
      case 'scanned':
      case 'paused': {
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
    this.settleLoaded?.(new Error(`${this.opts.label}: restarted.`));
    for (const [seq, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(seq);
      p.reject(new Error(`${this.opts.label}: restarted.`));
    }
    for (const a of this.asks.values()) {
      clearTimeout(a.timer);
      a.resolve(null);
    }
    this.asks.clear();
    this.lastT = -1;
    this.mode = 'random';
    this.navigatedAway = false;
    // §5.13 (Z) 41-1·41-2·41-5 — 새 문서에는 새 포트를 건네고(옛 포트는 닫는다), 스스로 재생·첫 그림도 처음부터.
    this.closePort();
    this.playMap = null;
    this.paintedFlag = false;
    this.createIframe();
  }

  /**
   * 컴포지션 안 시각 `t`(초 — 아이템 시작 + 트림 기준)의 모습으로 맞춘다. 다 그려진 뒤에 끝난다.
   * 상한을 넘기거나 문서가 뜨지 않으면 **거절**한다 — 무대가 엄격 모드(렌더)면 그 프레임을 찍지 않고 이유를 낸다.
   */
  seek(t: number, options?: { readonly preview?: boolean }): Promise<void> {
    const generation = this.generation;
    const run = this.seekChain.then(() => this.seekFrame(t, options?.preview === true, generation));
    this.seekChain = run.catch(() => undefined);
    return run;
  }

  private async seekFrame(t: number, preview: boolean, generation: number): Promise<void> {
    if (this.disposed || generation !== this.generation) return;
    await this.loaded;
    if (this.disposed || generation !== this.generation) return;
    // §5.13 (Z) 41-2 — 스스로 재생 중이면 먼저 세우고 그 자리(멈춘 시각)를 받아 아래 판단에 쓴다.
    if (this.playMap) await this.stopSelfPlay();
    if (this.disposed || generation !== this.generation) return;
    if (this.navigatedAway || (this.mode === 'forward' && this.lastT >= 0 && t < this.lastT - 1e-6)) {
      this.restart();
      await this.loaded;
    }
    if (this.disposed || generation !== this.generation) return;
    // A warmed boundary or a repeated preview request needs no new virtual tick or paint barrier.
    if (preview && !this.frameDirty && this.lastT === t) return;
    const target = this.iframe.contentWindow;
    if (!target) throw new Error(`${this.opts.label}: the composition frame is gone.`);
    const seq = (this.seq += 1);
    const ms = this.opts.seekTimeoutMs ?? COMPOSITION_SEEK_TIMEOUT_MS;
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`${this.opts.label}: the composition did not finish the frame at ${t.toFixed(2)}s within ${Math.round(ms / 1000)}s.`));
      }, ms);
      this.pending.set(seq, { resolve, reject, timer });
    });
    // 불투명 출처라 대상 출처를 지정할 수 없다 — 받는 쪽(심)이 `e.source === parent` 로 가린다(포트면 건넨 쪽만 닿는다).
    this.send({ __vibi: 'seek', t, seq, ...(preview ? { preview: true } : {}) });
    await done;
    if (!this.disposed && generation === this.generation) { this.lastT = t; this.frameDirty = false; }
  }

  /**
   * §5.13 (Z) 41-2 — 스스로 재생을 건다(같은 기준식이면 다시 보내지 않는다). 앞 seek 가 끝난 뒤에 보낸다(한 번에 하나가
   * 프레임을 쥔다). 앞으로만 가는 컴포지션이 지금보다 한 프레임 넘게 앞(과거)에서 시작해야 하면 새로 연다.
   */
  play(play: CompositionPlay): Promise<void> {
    const generation = this.generation;
    const run = this.seekChain.then(() => this.playFrame(play, generation));
    this.seekChain = run.catch(() => undefined);
    return run;
  }

  private async playFrame(play: CompositionPlay, generation: number): Promise<void> {
    if (this.disposed || generation !== this.generation) return;
    await this.loaded;
    if (this.disposed || generation !== this.generation) return;
    const prev = this.playMap;
    if (prev && samePlay(prev, play)) return;
    const now = epochNowMs();
    const from = playTimeAt(play, now);
    const at = prev ? playTimeAt(prev, now) : this.lastT;
    if (this.navigatedAway || (this.mode === 'forward' && at >= 0 && from < at - 1 / Math.max(1, play.fps))) {
      this.restart();
      await this.loaded;
      if (this.disposed || generation !== this.generation) return;
    }
    if (!this.send({ __vibi: 'play', base: play.base, anchor: play.anchor, min: play.min, until: play.until, grid: play.grid, fps: play.fps })) return;
    this.playMap = play;
    // 다음 정확한 seek 는 같은 시각이어도 다시 그린다(스스로 재생이 그림을 옮겼다).
    this.frameDirty = true;
  }

  /** §5.13 (Z) 41-2 — 스스로 재생을 세운다(앞 seek 다음 차례). 세운 시각을 돌려준다(재생 중이 아니었으면 마지막 시각). */
  pause(): Promise<number> {
    const generation = this.generation;
    const run = this.seekChain.then(async () => {
      if (this.disposed || generation !== this.generation) return this.lastT;
      if (this.playMap) await this.stopSelfPlay();
      return this.lastT;
    });
    this.seekChain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 세우고 멈춘 시각을 받는다. 답이 없으면 어디서 멈췄는지 모른다 — 앞으로만 가는 컴포지션은 다음 seek 에서 새로 연다. */
  private async stopSelfPlay(): Promise<void> {
    this.playMap = null;
    this.frameDirty = true;
    const data = await this.ask({ __vibi: 'pause' });
    const t = data?.['t'];
    this.lastT = typeof t === 'number' && Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  }

  /** 묻고 그 `seq` 의 답을 기다린다(상한을 넘기면 null). */
  private ask(message: Record<string, unknown>, timeoutMs = ASK_TIMEOUT_MS): Promise<Record<string, unknown> | null> {
    if (this.disposed || (!this.port && !this.iframe.contentWindow)) return Promise.resolve(null);
    const seq = (this.seq += 1);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.asks.delete(seq); resolve(null); }, timeoutMs);
      this.asks.set(seq, { resolve, timer });
      if (!this.send({ ...message, seq })) { clearTimeout(timer); this.asks.delete(seq); resolve(null); }
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
    const objectId = asText(data['objectId'], 200);
    const adapter = asText(data['adapter'], 40);
    const rawProperties = data['properties'];
    let properties: Record<string, unknown> | undefined;
    try {
      if (rawProperties && typeof rawProperties === 'object' && !Array.isArray(rawProperties) && JSON.stringify(rawProperties).length <= 8000) properties = rawProperties as Record<string, unknown>;
    } catch { /* A custom picker must return JSON; ignore cyclic/unsupported properties. */ }
    return { path, tag: asText(data['tag'], 40), text: asText(data['text'], 200), prop: typeof data['prop'] === 'string' ? data['prop'] : null, rect: this.toBox(rect),
      ...(objectId ? { objectId } : {}), ...(adapter ? { adapter } : {}), ...(properties ? { properties } : {}) };
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
    // Props can change the drawing even when the requested time remains unchanged.
    this.frameDirty = true;
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
    this.generation += 1;
    this.src = src;
    this.restart();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
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
    this.closePort();
    this.playMap = null;
    // Drop the browsing context even if an old in-flight operation still retains this frame object.
    this.element.replaceChildren();
    this.element.remove();
  }
}
