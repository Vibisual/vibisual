/**
 * §7.11 v1.44 Iframe 서버 로그 팝업 — 포트 하나의 dev server stdout/stderr 라이브 tail.
 *
 * 라이프사이클:
 *  - mount: WS `subscribe_iframe_log { port }` → 서버가 `iframe_log_init` 으로 현재 버퍼 전송
 *  - 이후 새 라인은 `iframe_log_append` delta 로 도착(50ms 마이크로배치)
 *  - unmount: `unsubscribe_iframe_log { port }` → 서버가 tail 타이머 해제 + 버퍼 폐기
 *
 * 클라 측 ring buffer 는 IFRAME_LOG_CLIENT_BUFFER_MAX 상한 — 초과분은 앞에서 버려 메모리 고정.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  IframeLogLine,
  IframeLogSubscribePayload,
  IframeLogUnsubscribePayload,
  WSMessage,
} from '@vibisual/shared';
import { IFRAME_LOG_CLIENT_BUFFER_MAX } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { iframeLogEvents } from '../../bubble-map/api/iframeLogEvents.js';

interface IframeServerLogsPopupProps {
  port: number;
  /** §7.11 v2.5 — 스트림 식별자의 셸. 없으면(레거시 위성) port 단독 구독. */
  shellId?: string;
  url?: string;
  onClose: () => void;
}

type Unavailable = 'no-output-file' | 'no-server-entry' | 'file-not-found';

function levelClasses(level: IframeLogLine['level']): string {
  if (level === 'error') return 'text-rose-300';
  if (level === 'warn') return 'text-amber-300';
  if (level === 'info') return 'text-sky-300';
  return 'text-gray-300';
}

function formatTime(ts: number): string {
  // ts === 0 은 historic(팝업 open 이전 기록) sentinel — 실제 발생 시각 모름.
  // 가짜 "지금" 시각을 찍는 대신 dash 로 표기.
  if (!ts) return '  —  ';
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const IframeServerLogsPopup = memo(function IframeServerLogsPopup({
  port,
  shellId,
  url,
  onClose,
}: IframeServerLogsPopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const wsSend = useGraphStore((s) => s._wsSend);
  const [lines, setLines] = useState<IframeLogLine[]>([]);
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 구독 / 해제 + 이벤트 수신 — 식별자 (port, shellId)
  useEffect(() => {
    if (!wsSend) return;
    const subPayload: IframeLogSubscribePayload = shellId ? { port, shellId } : { port };
    const msg: WSMessage = {
      type: 'subscribe_iframe_log',
      timestamp: Date.now(),
      payload: subPayload,
    };
    wsSend(msg);

    const unsub = iframeLogEvents.subscribe((ev) => {
      // 다른 (port, shellId) 스트림의 이벤트는 무시 — 프로젝트 간 5173 충돌 방지
      if (ev.port !== port) return;
      if (ev.shellId !== shellId) return;
      if (ev.kind === 'init') {
        setUnavailable(ev.unavailable ?? null);
        setLines(ev.lines);
        setInitialized(true);
        return;
      }
      // append
      setLines((prev) => {
        const merged = prev.concat(ev.lines);
        const overflow = merged.length - IFRAME_LOG_CLIENT_BUFFER_MAX;
        return overflow > 0 ? merged.slice(overflow) : merged;
      });
    });

    return () => {
      unsub();
      const unsubPayload: IframeLogUnsubscribePayload = shellId ? { port, shellId } : { port };
      const unsubMsg: WSMessage = {
        type: 'unsubscribe_iframe_log',
        timestamp: Date.now(),
        payload: unsubPayload,
      };
      wsSend(unsubMsg);
    };
  }, [wsSend, port, shellId]);

  // ESC 닫기
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // auto-scroll — lines 가 늘어날 때 바닥 고정. 사용자가 위로 스크롤하면 꺼짐.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  }, [autoScroll]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return lines;
    const needle = filter.toLowerCase();
    return lines.filter((l) => l.text.toLowerCase().includes(needle));
  }, [lines, filter]);

  const errorCount = useMemo(
    () => lines.reduce((acc, l) => (l.level === 'error' ? acc + 1 : acc), 0),
    [lines],
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <svg className="h-4 w-4 shrink-0 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 6h16M4 10h16M4 14h10M4 18h10" />
            </svg>
            <span className="shrink-0 text-sm font-semibold text-gray-100">
              {t('panel.iframeServerLog.title')}
            </span>
            <span className="truncate font-mono text-xs text-sky-300">
              {url ?? `:${port}`}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded bg-gray-700/40 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">
              {t('panel.iframeServerLog.linesCount', { count: lines.length })}
            </span>
            {errorCount > 0 && (
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                {t('panel.iframeServerLog.errorsCount', { count: errorCount })}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              aria-label={t('panel.iframeServerLog.close')}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('panel.iframeServerLog.filterPlaceholder')}
            className="flex-1 rounded border border-gray-700 bg-gray-800/60 px-2 py-1 font-mono text-xs text-gray-200 placeholder-gray-500 focus:border-sky-500 focus:outline-none"
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-3 w-3 cursor-pointer accent-sky-500"
            />
            {t('panel.iframeServerLog.autoScroll')}
          </label>
          <button
            type="button"
            onClick={() => setLines([])}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 hover:text-gray-100"
            title={t('panel.iframeServerLog.clearLocal')}
          >
            {t('panel.iframeServerLog.clear')}
          </button>
        </div>

        {/* Body — virtualized light: 1000줄 상한 + 모노 라인 렌더(성능 OK) */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto bg-gray-950/70 px-3 py-2 font-mono text-[11px] leading-relaxed"
        >
          {!initialized && (
            <div className="flex items-center justify-center py-10 text-xs text-gray-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-700 border-t-sky-400" />
              <span className="ml-2">{t('panel.iframeServerLog.connecting')}</span>
            </div>
          )}

          {initialized && unavailable && (
            <div className="py-10 text-center text-xs text-gray-500">
              {t(`panel.iframeServerLog.unavailable.${unavailable}`, {
                defaultValue: t('panel.iframeServerLog.unavailable.generic'),
              })}
            </div>
          )}

          {initialized && !unavailable && filtered.length === 0 && (
            <div className="py-10 text-center text-xs text-gray-500">
              {filter
                ? t('panel.iframeServerLog.emptyFiltered')
                : t('panel.iframeServerLog.emptyWaiting')}
            </div>
          )}

          {filtered.map((l) => (
            <div
              key={l.seq}
              className={`flex items-start gap-2 whitespace-pre-wrap break-all ${levelClasses(l.level)}`}
            >
              <span className="shrink-0 text-[10px] text-gray-600">{formatTime(l.ts)}</span>
              <span className="flex-1">{l.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
