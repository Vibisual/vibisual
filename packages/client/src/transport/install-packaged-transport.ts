// Packaged-mode transport adapter — SCENARIO.md §3.7 (v1.93).
//
// When this module is imported in packaged Electron (window.api is exposed by
// preload), it monkey-patches the global `fetch` and `WebSocket` constructors
// so that EVERY existing fetch('/api/…') / new WebSocket('/ws') call site in
// the client (31 sites across 14 files) is transparently rerouted to IPC.
//
// In dev mode and standalone web the patch is a no-op — window.api is absent
// and the Vite proxy keeps doing its job.
//
// Rationale: "renderer fetch/WS → window.api 일괄 교체" (Stage 4) at a single
// chokepoint instead of editing every call site. UI source stays untouched.

import type { UpdateState } from '@vibisual/shared';

interface FetchInitWire {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  /**
   * `body` 가 base64 로 인코딩된 바이너리(FormData/Blob/ArrayBuffer)임을 표시.
   * IPC 와이어는 텍스트만 실어 나르므로 multipart 업로드(이미지 paste)는 이 경로를 탄다.
   */
  bodyEncoding?: 'base64';
}
interface FetchResponseWire {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** `body` 가 base64 인코딩 바이너리임을 표시 — 비텍스트 응답(이미지 등) 무손실 수신. */
  bodyEncoding?: 'base64';
}
// SCENARIO.md §5.4 #14-1 (v2.29) — 별창 detach/redock surface.
export type DetachKindWire = 'project' | 'iframe';
export interface DetachedTabInfoWire {
  windowId: number;
  tabKey: string;
  kind: DetachKindWire;
}
export interface DetachPayloadWire {
  kind: DetachKindWire;
  tabKey: string;
  cursor?: { x: number; y: number };
}
export interface RectWire { x: number; y: number; width: number; height: number }
export interface PointWire { x: number; y: number }

export interface PackagedWindowApi {
  detach(payload: DetachPayloadWire): Promise<{ windowId: number; reused: boolean }>;
  closeDetached(tabKey: string): Promise<boolean>;
  closeSelf(): Promise<boolean>;
  listDetached(): Promise<DetachedTabInfoWire[]>;
  hasTab(tabKey: string): Promise<boolean>;
  cursorScreen(): Promise<PointWire>;
  mainBounds(): Promise<RectWire | null>;
  redockDrag(tabKey: string, hovering: boolean): Promise<void>;
  redockCommit(tabKey: string): Promise<boolean>;
  onDetachedList(cb: (list: DetachedTabInfoWire[]) => void): () => void;
  onRedockHover(cb: (payload: { tabKey: string; hovering: boolean }) => void): () => void;
  onRedockCommit(cb: (payload: { tabKey: string; kind: DetachKindWire | null }) => void): () => void;
  // §5.4 #14-1 v2.30 — 별창 mini-ghost 드래그.
  startDetachDrag(): Promise<boolean>;
  endDetachDrag(commit: boolean): Promise<boolean>;
  onDragState(cb: (payload: { dragging: boolean; hovering: boolean }) => void): () => void;
}

// §4 v2.44 자동 업데이트 surface. UpdateState 는 shared 계약.
export interface PackagedUpdateApi {
  check(): Promise<UpdateState>;
  install(): Promise<boolean>;
  getState(): Promise<UpdateState>;
  onStatus(cb: (state: UpdateState) => void): () => void;
}

export interface PackagedApi {
  serverInfo(): Promise<{ port: number; running: boolean }>;
  request(path: string, init?: FetchInitWire): Promise<FetchResponseWire>;
  send(message: unknown): Promise<void>;
  connect(): Promise<void>;
  onMessage(cb: (payload: unknown) => void): () => void;
  window: PackagedWindowApi;
  update: PackagedUpdateApi;
}

declare global {
  // Augmented locally so the client tsconfig need not include preload's d.ts.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    api?: PackagedApi;
  }
}

function getApi(): PackagedApi | null {
  if (typeof window === 'undefined') return null;
  return window.api ?? null;
}

// ─── fetch patch ────────────────────────────────────────────────────────────
// Route URL-path requests (`/api/*`, `/health`, `/iframe-proxy/*`) through IPC.
// Absolute URLs (http://, https://, ws://, data:, blob:) pass through to the
// native fetch — they target external services, not the embedded server.

function shouldRouteThroughIpc(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/api') || url === '/health' || url.startsWith('/iframe-proxy')) {
    return true;
  }
  return false;
}

interface EncodedBody {
  body: string;
  bodyEncoding?: 'base64';
  /** 바이너리 본문에서 추출한 Content-Type — multipart 면 boundary 를 포함한다. */
  contentType?: string;
}

// 큰 이미지(최대 10MB)에서 String.fromCharCode 스프레드가 호출 스택을 넘기지 않도록 청크 변환.
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000; // 32KB
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// fetch 본문을 IPC 와이어(텍스트 전용)에 실을 수 있게 인코딩한다.
//   - string / URLSearchParams → 그대로 텍스트.
//   - FormData / Blob / ArrayBuffer(View) / ReadableStream → Response 로 정규 직렬화해
//     바이트와 Content-Type(FormData 면 multipart boundary 포함)을 얻어 base64 로 싣는다.
// 이 경로가 없으면 FormData 가 JSON.stringify 로 "{}" 가 되어 이미지 paste 업로드가 깨진다.
async function encodeBody(body: BodyInit | null | undefined): Promise<EncodedBody | null> {
  if (body == null) return null;
  if (typeof body === 'string') return { body };
  if (body instanceof URLSearchParams) return { body: body.toString() };
  const res = new Response(body as BodyInit);
  const buf = await res.arrayBuffer();
  const encoded: EncodedBody = { body: arrayBufferToBase64(buf), bodyEncoding: 'base64' };
  const ct = res.headers.get('content-type');
  if (ct) encoded.contentType = ct;
  return encoded;
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  if (h instanceof Headers) h.forEach((v, k) => { out[k] = v; });
  else if (Array.isArray(h)) for (const [k, v] of h) out[k] = v;
  else Object.assign(out, h);
  return out;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function wireToResponse(wire: FetchResponseWire): Response {
  // 204/304/1xx 는 본문을 가질 수 없다 — Response 생성자가 throw 하므로 null 본문으로.
  const nullBody =
    wire.status === 204 || wire.status === 304 || (wire.status >= 100 && wire.status < 200);
  const body: BodyInit | null = nullBody
    ? null
    : wire.bodyEncoding === 'base64'
      ? base64ToBytes(wire.body)
      : wire.body;
  return new Response(body, {
    status: wire.status,
    statusText: wire.statusText,
    headers: wire.headers,
  });
}

function installFetchPatch(api: PackagedApi): void {
  const native = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : input.url;
    if (!shouldRouteThroughIpc(url)) return native(input, init);

    const wireInit: FetchInitWire = {
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
    };
    const headers = headersToRecord(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (headers) wireInit.headers = headers;
    const encoded = await encodeBody(init?.body ?? null);
    if (encoded) {
      wireInit.body = encoded.body;
      if (encoded.bodyEncoding) wireInit.bodyEncoding = encoded.bodyEncoding;
      // 바이너리 본문(특히 multipart)의 Content-Type 은 boundary 를 담으므로 인코딩 시점
      // 값으로 덮어쓴다. FormData 호출부는 Content-Type 을 직접 지정하면 안 되므로 충돌 없음.
      if (encoded.contentType) {
        wireInit.headers = { ...(wireInit.headers ?? {}), 'content-type': encoded.contentType };
      }
    }

    const wire = await api.request(url, wireInit);
    return wireToResponse(wire);
  }) as typeof window.fetch;
}

// ─── WebSocket patch ────────────────────────────────────────────────────────
// Replace ws://…/ws and /ws constructions with a fake that bridges to IPC.
// Other URLs (external ws) fall through to the native WebSocket.

const NATIVE_WS = window.WebSocket;

interface WSEventListenerEntry {
  type: string;
  listener: EventListenerOrEventListenerObject;
}

class IpcWebSocket extends EventTarget implements WebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  binaryType: BinaryType = 'blob';
  readonly bufferedAmount = 0;
  readonly extensions = '';
  readonly protocol = '';
  readyState: number = 0;
  readonly url: string;

  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;

  private unsub: (() => void) | null = null;
  private listenerEntries: WSEventListenerEntry[] = [];

  constructor(url: string, private readonly api: PackagedApi) {
    super();
    this.url = url;
    // Subscribe to IPC stream first so we don't miss the initial snapshot.
    this.unsub = api.onMessage((payload) => this._deliver(payload));
    // Resolve to OPEN on the next microtask (mirrors browser timing for async connect).
    queueMicrotask(() => {
      if (this.readyState !== this.CONNECTING) return;
      this.readyState = this.OPEN;
      const ev = new Event('open');
      this.onopen?.call(this as unknown as WebSocket, ev);
      this.dispatchEvent(ev);
      // §3.7 — in-process 서버엔 ws 'connection' 이벤트가 없으므로 연결을 명시적으로 알린다.
      // main 이 connection_ack + 현재 graph_snapshot 을 이 renderer 로 푸시한다. OPEN 직후라
      // 그 응답 메시지가 _deliver 의 readyState 가드를 통과한다.
      void this.api.connect();
    });
  }

  private _deliver(payload: unknown): void {
    if (this.readyState !== this.OPEN) return;
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const ev = new MessageEvent('message', { data });
    this.onmessage?.call(this as unknown as WebSocket, ev);
    this.dispatchEvent(ev);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== this.OPEN) {
      throw new DOMException('WebSocket is not OPEN', 'InvalidStateError');
    }
    let text: string;
    if (typeof data === 'string') text = data;
    else if (data instanceof Blob) {
      void data.text().then((t) => this.api.send(safeParse(t) ?? t));
      return;
    } else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (ArrayBuffer.isView(data)) text = new TextDecoder().decode(data as ArrayBufferView);
    else text = String(data);
    void this.api.send(safeParse(text) ?? text);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSING;
    this.unsub?.(); this.unsub = null;
    this.readyState = this.CLOSED;
    const ev = new CloseEvent('close', { wasClean: true, code: code ?? 1000, reason: reason ?? '' });
    this.onclose?.call(this as unknown as WebSocket, ev);
    this.dispatchEvent(ev);
  }

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void {
    super.addEventListener(type, listener, options);
    this.listenerEntries.push({ type, listener });
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean): void {
    super.removeEventListener(type, listener, options);
    this.listenerEntries = this.listenerEntries.filter((e) => !(e.type === type && e.listener === listener));
  }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function shouldBridgeWs(url: string): boolean {
  // 임베디드 server WS 만 IPC 로 브리지. 커버:
  //   - path-relative   '/ws'
  //   - localhost        ws[s]://localhost|127.0.0.1:<port>/ws
  //   - host-less        'ws:///ws'  ← packaged renderer 는 file:// 로딩이라
  //                       window.location.host 가 '' → App.tsx 가 'ws:///ws' 를 만든다.
  // 실제 외부 host 를 가진 ws[s] URL 은 네이티브 WebSocket 으로 통과.
  //
  // 주의: new URL('ws:///ws') 는 host 를 'ws' 로 오파싱한다(빈 authority 를 첫 path
  // 세그먼트로 흡수 → href 'ws://ws/'). 그래서 URL API 를 쓰지 않고 정규식으로
  // authority 를 직접 떼어내 host 를 판정한다.
  if (url !== '/ws' && !url.endsWith('/ws')) return false;
  if (url.startsWith('/')) return true;
  const m = /^wss?:\/\/([^/?#]*)/i.exec(url);
  if (!m) return false;
  const hostname = (m[1] ?? '').split('@').pop()!.split(':')[0]!.toLowerCase();
  return hostname === '' || hostname === 'localhost' || hostname === '127.0.0.1';
}

function installWebSocketPatch(api: PackagedApi): void {
  const Bridged: unknown = new Proxy(NATIVE_WS, {
    construct(target, args: [string, (string | string[])?]) {
      const url = String(args[0] ?? '');
      if (shouldBridgeWs(url)) return new IpcWebSocket(url, api) as unknown as WebSocket;
      // Pass-through for any other (external) WebSocket use.
      return Reflect.construct(target, args);
    },
  });
  (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = Bridged as typeof WebSocket;
}

// ─── boot ───────────────────────────────────────────────────────────────────

let installed = false;

export function installPackagedTransport(): boolean {
  if (installed) return true;
  const api = getApi();
  if (!api) return false; // dev / web — leave globals alone
  installFetchPatch(api);
  installWebSocketPatch(api);
  installed = true;
  return true;
}

// Side-effect: run on import so a single line in main.tsx is enough.
installPackagedTransport();
