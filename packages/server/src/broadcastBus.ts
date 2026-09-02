import type {
  WSMessage, GraphSnapshot, GraphSnapshotWire, GraphSnapshotDeltas, DeltaSliceKey,
} from '@vibisual/shared';
import { diffKeyedSlice, DELTA_SLICE_KEYS } from '@vibisual/shared';
import { logger } from './logger.js';

export type BroadcastSink = (message: WSMessage) => void;

let currentSink: BroadcastSink | null = null;

/** 전송 계층(standalone=ws / desktop=Electron IPC)이 자신을 sink로 등록한다. */
export function setBroadcastSink(sink: BroadcastSink | null): void {
  currentSink = sink;
}

// ─── §9 v3.89 — graph_snapshot 무거운 슬라이스 증분화 ─────────────────────────────
//
// `fileEdits`(파일별 diff 원문)·`bashHistory`(명령/출력 원문)는 작업할수록 무한히 쌓이는데,
// 종전엔 **안 바뀐 것까지 전부** 매 브로드캐스트(16~250ms)마다 직렬화 → 구조화 클론/파싱 됐다.
// 실측: 스냅샷 3.2MB 중 2.5MB(78%)가 이 둘, stringify 18ms + parse 10ms 를 상시 반복.
//
// 여기서 바뀐 키만 추려 보내고, 클라이언트가 이전 값 위에 얹어 **같은 전체 맵**을 복원한다.
// 표시 데이터·타이밍은 그대로이고 전선에 오르는 양만 줄어든다.
//
// 정합성:
//  · 새 클라이언트는 `buildConnectionMessages()` 로 **전체 스냅샷**을 먼저 받는다(증분 아님).
//  · 기준점(baseline)이 그보다 과거여도 안전하다 — 그 사이 바뀐 키는 다음 증분에 반드시 포함되므로
//    새 클라이언트가 받는 건 항상 "필요한 것 + 이미 아는 것(같은 값 덮어쓰기)" 의 상위집합이다.
//  · 값 비교는 **참조 비교**다(ProjectGraph 가 안 바뀐 배열의 참조를 유지한다). 내용이 같아도
//    참조가 바뀌면 그냥 한 번 더 보낼 뿐 — 틀린 값이 가는 방향의 오차는 생기지 않는다.

/**
 * 직전 브로드캐스트에서 보낸 키맵(참조 비교용 기준점). 슬라이스 목록은 `DELTA_SLICE_KEYS` 한 벌.
 *
 * 2026-09-02 — 종전에는 `fileEdits`·`bashHistory` 둘만 이 길을 탔다. 나머지 키맵 슬라이스는
 * **서버가 매 스냅샷마다 새로 복사**해 내보내고 있어서 여기 넣어 봐야 소용이 없었다(참조가 매번
 * 달라 전부 "바뀜"으로 잡힌다). `ProjectGraph` 가 안 바뀐 배열의 사본을 재사용하도록 고친 뒤,
 * 실측 참조 유지분이 941KB 중 **115KB → 782KB** 가 되어 이 목록을 넓힐 값이 생겼다.
 */
const lastSentSlices = new Map<DeltaSliceKey, Record<string, unknown> | null>();

// ─── §9 슬라이스 스코프와의 관계 — **왜 여기 기준점이 하나뿐인가** ─────────────────
//
// 위 `lastSentSlices` 는 **모듈 전역 Map 하나**다. 그것이 성립하는 전제는 "모든 창에 똑같은
// 페이로드 한 벌이 나간다"이고, 세 스코프 축(프로젝트·폴더·슬라이스)이 전부 **창별이 아니라
// 창 선언의 합집합**인 이유가 바로 이것이다. 창마다 다른 슬라이스를 보내는 순간 이 기준점이
// 어긋나 **증분이 틀린 값을 복원한다**(누구 기준의 "직전"인지가 정해지지 않는다).
// 창별로 가르고 싶으면 기준점을 창마다 두는 작업이 먼저다 — 훨씬 큰 작업이고 여기서 할 일이 아니다.
//
// 스코프로 빠진 슬라이스는 스냅샷에서 **필드째 사라지므로** 아래 `next === undefined` 가지를 탄다:
// 델타를 만들지 않고 기준점만 비운다 → 다시 실리기 시작하면 `diffKeyedSlice(null, …)` 가 `null` 을
// 돌려주어 **전량으로 한 번 가고 그 뒤부터 증분이 붙는다**(값 유실 없음). 이 왕복은
// `sliceScopeSubscription.test.ts` 가 고정한다.

/**
 * graph_snapshot 메시지를 전선 형태로 변환한다(원본 스냅샷 객체는 건드리지 않는다 —
 * ProjectGraph 가 그 객체를 캐시해 재사용하므로 변형은 금물).
 */
function encodeSnapshotMessage(message: WSMessage): WSMessage {
  const snap = message.payload as GraphSnapshot | undefined;
  if (!snap || typeof snap !== 'object') return message;

  const deltas: GraphSnapshotDeltas = {};
  const wire: GraphSnapshotWire = { ...snap };
  const snapRec = snap as unknown as Record<string, Record<string, unknown> | undefined>;
  const wireRec = wire as unknown as Record<string, unknown>;
  const deltaRec = deltas as unknown as Record<string, unknown>;
  let encoded = false;

  for (const key of DELTA_SLICE_KEYS) {
    const next = snapRec[key];
    // 이 스냅샷에 그 슬라이스가 **아예 없다**. 두 경우가 여기로 온다 — ① optional 필드가 비어
    // undefined(그 기능을 안 쓴다) ② §9 슬라이스 스코프가 범위 밖이라 지웠다. 둘 다 델타를 만들지
    // 않고 기준점만 비운다 — 없는 것을 `{}` 로 바꿔 보내면 "안 쓰는 기능"에 매번 새 빈 객체가 가서
    // §9 ③(`?? {}` 는 고정 참조)이 깨진다. 다음에 생기면 전량으로 한 번 가고 그때부터 증분이 붙는다.
    if (next === undefined) {
      lastSentSlices.set(key, null);
      continue;
    }
    const delta = diffKeyedSlice(lastSentSlices.get(key) ?? null, next);
    if (delta) {
      deltaRec[key] = delta;
      delete wireRec[key];
      encoded = true;
    }
    lastSentSlices.set(key, next);
  }

  if (!encoded) return message;
  wire.deltas = deltas;
  return { ...message, payload: wire };
}

/**
 * 새 클라이언트가 붙기 전/서버 상태가 통째로 갈릴 때 기준점을 지운다 —
 * 다음 브로드캐스트가 전체 스냅샷이 된다(안전 리셋).
 */
export function resetSnapshotDeltaBaseline(): void {
  lastSentSlices.clear();
}

/** 서버 코어의 푸시 단일 창구. sink 미설정 시 조용히 드롭(부팅 초기 윈도우). */
export function broadcast(message: WSMessage): void {
  if (!currentSink) {
    logger.warn('broadcast called before a sink was registered — dropping message');
    return;
  }
  currentSink(message.type === 'graph_snapshot' ? encodeSnapshotMessage(message) : message);
}
