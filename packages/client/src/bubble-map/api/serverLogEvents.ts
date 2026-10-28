/** §7.7 — 서버 코어 로그 이벤트 버스(useWebSocket emit → ServerLogPopup subscribe). 스토어를 거치지 않는 이유는 §7.11 iframeLogEvents 와 같다. */
import type { ServerLogEntry } from '@vibisual/shared';

export type ServerLogEventKind = 'init' | 'append';

export interface ServerLogEvent {
  kind: ServerLogEventKind;
  lines: ServerLogEntry[];
}

type Listener = (ev: ServerLogEvent) => void;

const listeners = new Set<Listener>();

export const serverLogEvents = {
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  emit(ev: ServerLogEvent): void {
    for (const l of listeners) {
      try { l(ev); } catch { /* ignore */ }
    }
  },
};
