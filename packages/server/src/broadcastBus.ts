import type { WSMessage } from '@vibisual/shared';
import { logger } from './logger.js';

export type BroadcastSink = (message: WSMessage) => void;

let currentSink: BroadcastSink | null = null;

/** 전송 계층(standalone=ws / desktop=Electron IPC)이 자신을 sink로 등록한다. */
export function setBroadcastSink(sink: BroadcastSink | null): void {
  currentSink = sink;
}

/** 서버 코어의 푸시 단일 창구. sink 미설정 시 조용히 드롭(부팅 초기 윈도우). */
export function broadcast(message: WSMessage): void {
  if (!currentSink) {
    logger.warn('broadcast called before a sink was registered — dropping message');
    return;
  }
  currentSink(message);
}
