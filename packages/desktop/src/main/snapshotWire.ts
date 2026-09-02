/**
 * snapshotWire.ts — main → renderer 스냅샷 팬아웃의 **판정부**(electron 무의존, 순수).
 *
 * **왜 필요한가.** `setBroadcastSink` 가 창마다 `webContents.send('vibisual:ws', msg)` 를 부르면,
 * Electron 은 **호출 시점에 메인 프로세스 스레드에서 동기 구조화 클론**을 수행한다. `graph_snapshot`
 * 은 400KB 급 깊은 객체라 그 깊은 순회가 그대로 메인 스레드 점유가 되고, 그동안 창 이동·클릭 같은
 * 입력이 밀린다. 종전 코드는 **창이 2개 이상일 때만** 1회 `JSON.stringify` 해 문자열로 팬아웃했다
 * (문자열 클론은 사실상 memcpy). 그러나 **사용자 대부분은 창이 하나**여서, 가장 흔한 경로가
 * 여전히 깊은 객체 클론을 타고 있었다.
 *
 * 그래서 이 모듈은 창 수와 무관하게 **한 번만 인코딩**한다:
 *   `JSON.stringify` → `TextEncoder` → 평평한 바이트(ArrayBuffer) → 창마다 `postMessage`.
 * 바이트 배열의 클론은 깊은 순회가 아니라 memcpy 라, 창이 몇 개든 비용이 선형이고 상수가 아주 작다.
 * 받는 쪽(preload)이 `TextDecoder` 로 문자열을 되돌려 **렌더러가 종전과 똑같은 모양**(문자열)을
 * 받게 하므로, `useWebSocket`·`install-packaged-transport` 는 이 변경을 전혀 모른다
 * (그 문자열 경로는 이미 "창 2개 이상"에서 돌던 길이다 — 새 계약이 아니다).
 *
 * **판정을 electron 에서 떼어 둔 이유.** 아래 세 가지는 실기 없이 검증할 수 있어야 한다 —
 * `chat/policy.ts`·`rendererFlushPlan.ts` 가 따로 나와 있는 것과 같은 이유다.
 *
 * **정확성 규약**
 *  1. **인코딩은 창 수와 무관하게 1회다.** 창마다 `JSON.stringify` 를 다시 하면 개악이다.
 *  2. **버퍼는 나눠 주기 전에 미리 뜬다(detach 함정).** Transferable 은 원래 *소유권 이전* 이라
 *     한 번 넘긴 버퍼는 보낸 쪽에서 detach(byteLength 0)된다. 그래서 창이 N개면 버퍼도 N벌이
 *     필요하고, 그 N벌은 **첫 전송 이전에** 전부 떠 있어야 한다. 보내면서 그때그때 뜨면 두 번째
 *     창부터 빈 데이터를 받는다. (오늘의 Electron 은 `postMessage` 의 transfer 목록에
 *     `MessagePortMain` 만 받으므로 ArrayBuffer 는 실제로는 *복사*되어 detach 가 일어나지 않는다.
 *     그래도 이 규약을 지키는 이유는, 나중에 진짜 transfer 로 바뀌거나 다른 전송로로 갈아타도
 *     **여기 판정은 그대로 옳기** 때문이다. 이 미리 뜨기를 "지금은 필요 없어 보인다"고 지우지 마라.)
 *  3. **바이트 경로는 성능 경로일 뿐 정확성 경로가 아니다.** 인코딩이 실패하거나(순환 참조 등),
 *     전송이 던지거나, 받는 쪽이 이 채널을 모르는 구버전 preload 면 **조용히 종전 경로로 되돌아간다.**
 *     이 앱은 자동 업데이트로 배포되는 무료 제품이고, IPC 가 한 번 어긋나면 사용자에겐 앱이 통째로
 *     죽은 것으로 보인다. **폴백을 지우지 마라 — 이게 그 사고를 막는 유일한 길이다.**
 */

/** main → renderer 바이트 푸시 채널. payload = UTF-8 로 인코딩한 JSON 바이트. */
export const WS_BUFFER_CHANNEL = 'vibisual:ws:buf';

/**
 * preload → main 능력 신고 채널. preload 가 로드되면서 한 번 보낸다.
 *
 * **신고 없이는 바이트를 보내지 않는다.** `postMessage` 는 받는 쪽에 리스너가 없어도 던지지 않고
 * 조용히 버려지므로, 구버전 preload 가 남은 창에 낙관적으로 바이트를 쏘면 그 창은 영영 스냅샷을
 * 못 받는다(= 화면이 죽은 것으로 보인다). 그 실패는 감지할 수 없기 때문에, 감지 가능한 반대편
 * — "안다고 말한 창에만 보낸다" — 로 뒤집어 놓았다.
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
 * 창 `count` 개에 나눠 줄 버퍼를 **전송 전에 전부** 떠 둔다(규약 2 — detach 함정).
 *
 * 첫 벌은 인코딩이 방금 지은 버퍼를 그대로 쓰고, 두 번째부터만 `slice(0)`(= memcpy) 로 복제한다.
 * 복제는 깊은 구조화 클론보다 훨씬 싸지만 공짜는 아니므로, 첫 벌까지 복사하지는 않는다.
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
