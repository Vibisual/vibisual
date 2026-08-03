import type {
  WSMessage, GraphSnapshot, GraphSnapshotWire, GraphSnapshotDeltas,
} from '@vibisual/shared';
import { diffKeyedSlice } from '@vibisual/shared';
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

/** 직전 브로드캐스트에서 보낸 키맵(참조 비교용 기준점). */
const lastSentSlices: {
  fileEdits: GraphSnapshot['fileEdits'] | null;
  bashHistory: GraphSnapshot['bashHistory'] | null;
} = { fileEdits: null, bashHistory: null };

/**
 * graph_snapshot 메시지를 전선 형태로 변환한다(원본 스냅샷 객체는 건드리지 않는다 —
 * ProjectGraph 가 그 객체를 캐시해 재사용하므로 변형은 금물).
 */
function encodeSnapshotMessage(message: WSMessage): WSMessage {
  const snap = message.payload as GraphSnapshot | undefined;
  if (!snap || typeof snap !== 'object') return message;

  const deltas: GraphSnapshotDeltas = {};
  const wire: GraphSnapshotWire = { ...snap };

  const nextFileEdits = snap.fileEdits ?? {};
  const fileEditsDelta = diffKeyedSlice(lastSentSlices.fileEdits, nextFileEdits);
  if (fileEditsDelta) {
    deltas.fileEdits = fileEditsDelta;
    delete wire.fileEdits;
  }
  lastSentSlices.fileEdits = nextFileEdits;

  const nextBash = snap.bashHistory ?? {};
  const bashDelta = diffKeyedSlice(lastSentSlices.bashHistory, nextBash);
  if (bashDelta) {
    deltas.bashHistory = bashDelta;
    delete wire.bashHistory;
  }
  lastSentSlices.bashHistory = nextBash;

  if (deltas.fileEdits === undefined && deltas.bashHistory === undefined) return message;
  wire.deltas = deltas;
  return { ...message, payload: wire };
}

/**
 * 새 클라이언트가 붙기 전/서버 상태가 통째로 갈릴 때 기준점을 지운다 —
 * 다음 브로드캐스트가 전체 스냅샷이 된다(안전 리셋).
 */
export function resetSnapshotDeltaBaseline(): void {
  lastSentSlices.fileEdits = null;
  lastSentSlices.bashHistory = null;
}

/** 서버 코어의 푸시 단일 창구. sink 미설정 시 조용히 드롭(부팅 초기 윈도우). */
export function broadcast(message: WSMessage): void {
  if (!currentSink) {
    logger.warn('broadcast called before a sink was registered — dropping message');
    return;
  }
  currentSink(message.type === 'graph_snapshot' ? encodeSnapshotMessage(message) : message);
}
