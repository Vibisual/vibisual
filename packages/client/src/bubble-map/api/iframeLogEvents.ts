/** §7.11 — Iframe 서버 로그 이벤트 버스(useWebSocket emit → IframeServerLogsPopup subscribe). 팝업이 열린 동안만 쓰는 일시 데이터라 graphStore 를 거치지 않는다. */
import type { IframeLogLine } from '@vibisual/shared';

export type IframeLogEventKind = 'init' | 'append';

export interface IframeLogEvent {
  port: number;
  /** §7.11 — 스트림의 셸. 팝업이 (port, shellId) 로 필터한다. */
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
