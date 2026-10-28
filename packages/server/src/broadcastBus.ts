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

// §9 — graph_snapshot 무거운 키맵 슬라이스 증분화: 바뀐 키만 보내고 클라이언트가 이전 값 위에 얹어 같은 전체 맵을 복원한다.
// 실측: 스냅샷 3.2MB 중 2.5MB(78%)가 `fileEdits`·`bashHistory`, 매 브로드캐스트(16~250ms) stringify 18ms + parse 10ms.
// · 새 클라이언트는 `buildConnectionMessages()` 로 전체 스냅샷을 먼저 받는다. 기준점이 그보다 과거여도 안전하다(받는 것은 늘 필요한 것의 상위집합).
// · 값 비교는 참조 비교다(ProjectGraph 가 안 바뀐 배열 참조를 유지). 참조만 바뀌면 한 번 더 보낼 뿐 틀린 값은 가지 않는다.

/**
 * 직전 브로드캐스트에서 보낸 키맵(참조 비교용 기준점). 슬라이스 목록은 `DELTA_SLICE_KEYS` 한 벌.
 * 슬라이스는 `ProjectGraph` 가 안 바뀐 배열 사본을 재사용해야 효과가 있다 — 매번 새로 복사하면 전부 "바뀜"으로 잡힌다(2026-09-02 실측: 참조 유지 941KB 중 782KB).
 */
const lastSentSlices = new Map<DeltaSliceKey, Record<string, unknown> | null>();

// §9 슬라이스 스코프 — 기준점(`lastSentSlices`)은 모듈 전역 하나다. 그래서 세 스코프 축(프로젝트·폴더·슬라이스)은 창별이 아니라 창 선언의 합집합이어야 한다.
// 창마다 다른 슬라이스를 보내면 기준점이 어긋나 증분이 틀린 값을 복원한다 — 창별로 가르려면 기준점부터 창마다 둬야 한다.
// 스코프로 빠진 슬라이스는 필드째 사라져 `next === undefined` 가지를 탄다: 기준점만 비우고, 다시 실리면 전량 한 번 뒤 증분(`sliceScopeSubscription.test.ts` 가 고정).

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
    // 슬라이스가 아예 없다 — ① optional 필드가 비었거나 ② §9 슬라이스 스코프가 지웠다. 델타 없이 기준점만 비운다.
    // `{}` 로 바꿔 보내지 마라 — 안 쓰는 기능에 매번 새 빈 객체가 가서 §9 ③(`?? {}` 는 고정 참조)이 깨진다. 다시 생기면 전량 한 번 뒤 증분.
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
