/**
 * §7.7 v1.99 Vibisual 서버 코어 로그 이벤트 버스.
 * useWebSocket 이 서버 push(server_log_init / server_log_append)를 받아 emit →
 * ServerLogPopup 이 subscribe.
 *
 * 스토어를 거치지 않는 이유: 로그는 팝업이 열려 있는 동안만 관심있는 transient 데이터.
 * graphStore 를 오염시키면 리렌더 비용이 늘고 다른 컴포넌트에 의미 없는 구독이 생긴다.
 * (§7.11 iframeLogEvents 와 동일 설계.)
 */
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
