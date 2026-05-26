/**
 * §7.11 v1.44 Iframe 서버 로그 이벤트 버스.
 * useWebSocket이 서버 push(iframe_log_init / iframe_log_append)를 받아 emit →
 * IframeServerLogsPopup이 subscribe.
 *
 * 스토어를 거치지 않는 이유: 로그는 팝업이 열려 있는 동안만 관심있는 transient 데이터.
 * graphStore 를 오염시키면 리렌더 비용이 늘고 다른 컴포넌트에 의미 없는 구독이 생긴다.
 */
import type { IframeLogLine } from '@vibisual/shared';

export type IframeLogEventKind = 'init' | 'append';

export interface IframeLogEvent {
  port: number;
  /** §7.11 v2.5 — 스트림 식별자의 셸. 팝업이 (port, shellId) 로 이벤트를 필터한다. */
  shellId?: string;
  kind: IframeLogEventKind;
  lines: IframeLogLine[];
  /** init 이벤트에서 tail 불가 사유 (있을 때만) */
  unavailable?: 'no-output-file' | 'no-server-entry' | 'file-not-found';
}

type Listener = (ev: IframeLogEvent) => void;

const listeners = new Set<Listener>();

export const iframeLogEvents = {
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  emit(ev: IframeLogEvent): void {
    for (const l of listeners) {
      try { l(ev); } catch { /* ignore */ }
    }
  },
};
