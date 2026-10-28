/**
 * main → renderer 스냅샷 팬아웃의 판정부(electron 무의존, 순수 — 실기 없이 검증하려고 떼어 뒀다).
 * `webContents.send` 는 메인 스레드에서 동기 구조화 클론을 해 400KB 급 `graph_snapshot` 순회가 입력을 밀어낸다 — `JSON.stringify` → `TextEncoder` → ArrayBuffer 로 1회 인코딩해 창마다 `postMessage`(바이트 클론은 memcpy). preload 가 `TextDecoder` 로 되돌려 렌더러 계약은 그대로다.
 * 규약: ① 인코딩은 창 수와 무관하게 1회 ② 버퍼 N벌은 첫 전송 전에 다 뜬다(detach 함정 — 지금 Electron 은 복사하지만 전송로가 바뀌어도 옳도록 지우지 마라)
 * ③ 인코딩 실패·전송 예외·구버전 preload 면 조용히 종전 경로로 — 폴백을 지우지 마라(IPC 가 어긋나면 앱이 죽어 보인다).
 */

/** main → renderer 바이트 푸시 채널. payload = UTF-8 로 인코딩한 JSON 바이트. */
export const WS_BUFFER_CHANNEL = 'vibisual:ws:buf';

/**
 * preload → main 능력 신고 채널(preload 로드 때 한 번). 신고 없이는 바이트를 보내지 않는다 — `postMessage` 는 리스너가 없어도
 * 던지지 않고 버려져, 구버전 preload 창은 영영 스냅샷을 못 받는다. 감지할 수 없는 실패라 "안다고 말한 창에만" 보낸다.
 */
export const WS_BUFFER_READY_CHANNEL = 'vibisual:ws:buf-ready';

/** 종전 경로 채널. 폴백이자, ipc.ts 의 초기 ack·스냅샷 단발 푸시가 그대로 쓰는 길. */
export const WS_OBJECT_CHANNEL = 'vibisual:ws';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** 1회 인코딩 결과. `json` 은 모바일·메신저 팬아웃이 재직렬화 없이 재사용한다. */
export interface EncodedWire {
  /** 직렬화된 JSON 문자열 — 폴백 전송과 LAN/메신저 팬아웃이 함께 쓴다. */
  readonly json: string;
  /** 그 문자열의 UTF-8 바이트. 여기서 버퍼를 떠 창들에 나눠 준다. */
  readonly bytes: Uint8Array;
}

/**
 * 메시지 하나를 **한 번만** 직렬화 + UTF-8 인코딩한다(규약 1).
 * JSON 으로 표현할 수 없는 값(`undefined`·순환 참조)이면 던진다 — 호출자가 폴백으로 넘어간다.
 */
export function encodeWire(msg: unknown): EncodedWire {
  const json = JSON.stringify(msg);
  // JSON.stringify(undefined) 는 예외가 아니라 undefined 를 돌려준다 — 바이트에 실을 수 없다.
  if (typeof json !== 'string') {
    throw new TypeError('snapshotWire: message is not JSON-serializable');
  }
  return { json, bytes: TEXT_ENCODER.encode(json) };
}

/**
 * 받는 쪽(preload)이 바이트를 종전과 같은 문자열로 되돌린다.
 * 문자열이 그대로 오면 그대로 돌려준다 — 폴백 payload 가 이 길로 흘러도 살아야 하기 때문(규약 3).
 */
export function decodeWire(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload instanceof ArrayBuffer) return TEXT_DECODER.decode(new Uint8Array(payload));
  if (ArrayBuffer.isView(payload)) {
    return TEXT_DECODER.decode(
      new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
    );
  }
  throw new TypeError(`snapshotWire: unsupported wire payload (${typeof payload})`);
}

/**
 * `Uint8Array` 를 **딱 그 바이트만 담은** ArrayBuffer 로 만든다.
 * 이미 딱 맞으면 복사 없이 그대로 쓴다 — 이 경로가 "1회 인코딩, 첫 창은 0회 복사"의 핵심이다.
 */
function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer as ArrayBuffer;
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

/**
 * 창 `count` 개에 나눠 줄 버퍼를 전송 전에 전부 떠 둔다(규약 2 — detach 함정).
 * 첫 벌은 인코딩한 버퍼 그대로, 두 번째부터만 `slice(0)`(memcpy) 로 복제한다(싸지만 공짜는 아니다).
 */
export function sliceWireBuffers(bytes: Uint8Array, count: number): ArrayBuffer[] {
  if (count <= 0) return [];
  const first = exactBuffer(bytes);
  const out: ArrayBuffer[] = [first];
  for (let i = 1; i < count; i += 1) out.push(first.slice(0));
  return out;
}

/** 팬아웃 대상 창 하나. `post`/`send` 가 던지면 그 창은 이미 죽은 것으로 본다. */
export interface WireTarget {
  /** `webContents.id` — 어느 창이 어느 길을 탔는지 가르는 열쇠(로그·집계용). */
  readonly id: number;
  /**
   * 이 창의 preload 가 바이트 채널을 안다고 **신고했는가**.
   * false 면 바이트를 아예 만들어 주지 않고 종전 경로로 보낸다(규약 3).
   */
  readonly canPost: boolean;
  /** 무복사 경로 — `webContents.postMessage(WS_BUFFER_CHANNEL, buffer)`. */
  post(buffer: ArrayBuffer): void;
  /** 종전 경로 — `webContents.send(WS_OBJECT_CHANNEL, payload)`. */
  send(payload: unknown): void;
}

export interface FanoutOutcome {
  /**
   * 이번 팬아웃에서 만든 JSON 문자열. 창이 0개거나 인코딩이 실패하면 null.
   * 모바일 LAN 팬아웃이 이 값을 재사용해 **스냅샷 재직렬화를 피한다**.
   */
  readonly json: string | null;
  /** 바이트 경로로 나간 창 수. */
  readonly posted: number;
  /** 종전 경로로 나간 창 수(구버전 preload · 바이트 전송 실패 · 인코딩 실패). */
  readonly sent: number;
  /** 두 경로 모두 던져 포기한 창 수(대개 방금 닫힌 창). */
  readonly dropped: number;
  /** 인코딩 자체가 실패했는가(순환 참조 등) — 그때는 전량이 종전 경로로 간다. */
  readonly encodeFailed: boolean;
}

/**
 * 메시지 하나를 창들에 팬아웃한다. 인코딩은 1회(규약 1), 버퍼는 전송 전에 전부 확보(규약 2),
 * 어느 단계가 실패해도 종전 경로로 되돌아간다(규약 3).
 *
 * @param encode 인코더 주입 — 테스트가 "창이 N개여도 1회만 불렸다"를 스파이로 고정하기 위함.
 */
export function fanoutWire(
  msg: unknown,
  targets: readonly WireTarget[],
  encode: (msg: unknown) => EncodedWire = encodeWire,
): FanoutOutcome {
  if (targets.length === 0) {
    return { json: null, posted: 0, sent: 0, dropped: 0, encodeFailed: false };
  }

  let encoded: EncodedWire | null = null;
  let encodeFailed = false;
  try {
    encoded = encode(msg);
  } catch {
    // 순환 참조·비직렬화 값. 종전 `webContents.send` 는 구조화 클론이라 이런 값도 실어 보낼 수
    // 있으므로, 여기서 죽지 않고 원본 객체 그대로 종전 경로로 흘린다(규약 3).
    encodeFailed = true;
  }

  let posted = 0;
  let sent = 0;
  let dropped = 0;

  const fallback = (target: WireTarget): void => {
    // 폴백 payload 는 이미 만들어 둔 문자열을 재사용한다 — 재직렬화 금지(규약 1).
    // 인코딩 자체가 실패한 경우에만 원본 객체를 그대로 보낸다.
    const payload: unknown = encoded ? encoded.json : msg;
    try {
      target.send(payload);
      sent += 1;
    } catch {
      dropped += 1;
    }
  };

  if (!encoded) {
    for (const target of targets) fallback(target);
    return { json: null, posted, sent, dropped, encodeFailed };
  }

  // 바이트를 받을 창만 센 다음, 그 수만큼 버퍼를 **미리** 뜬다(규약 2).
  const postable = targets.filter((t) => t.canPost);
  const buffers = sliceWireBuffers(encoded.bytes, postable.length);

  let bufferIndex = 0;
  for (const target of targets) {
    if (!target.canPost) {
      fallback(target);
      continue;
    }
    const buffer = buffers[bufferIndex];
    bufferIndex += 1;
    if (!buffer) {
      // 도달 불가(버퍼 수 = canPost 창 수). 그래도 조용히 종전 경로로 — 규약 3.
      fallback(target);
      continue;
    }
    try {
      target.post(buffer);
      posted += 1;
    } catch {
      fallback(target);
    }
  }

  return { json: encoded.json, posted, sent, dropped, encodeFailed };
}
