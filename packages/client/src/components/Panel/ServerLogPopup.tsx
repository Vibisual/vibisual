/**
 * §7.7 서버 코어 로그 팝업(iframe dev server 로그 §7.11 과 별개). 연결됐을 때만 `subscribe_server_log`, unmount 에 해제.
 * 클라 버퍼 상한 `SERVER_LOG_CLIENT_BUFFER_MAX`. 카테고리 필터·"최근 200줄만"·인접 유사 줄 `×N` 묶기는 렌더만 바꾼다(버퍼 불변).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerLogEntry, ServerLogLevel, ServerLogCategory, WSMessage } from '@vibisual/shared';
import { SERVER_LOG_CLIENT_BUFFER_MAX, SERVER_LOG_RECENT_VIEW_LIMIT } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { serverLogEvents } from '../../bubble-map/api/serverLogEvents.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface ServerLogPopupProps {
  connectionStatus: ConnectionStatus;
  onClose: () => void;
}

/** 카테고리 필터 칩 순서 — 심각도 높은 순. */
const CATEGORY_ORDER: ServerLogCategory[] = ['error', 'warn', 'hook', 'event'];

/** §7.7 — 간격이 이 시간창(ms)을 넘으면 유사해도 묶지 않는다("동시 발생"만). */
const COALESCE_WINDOW_MS = 4000;

/** 라인 본문 색 — level 기준(debug 는 흐리게). */
function levelClasses(level: ServerLogLevel): string {
  if (level === 'error') return 'text-rose-300';
  if (level === 'warn') return 'text-amber-300';
  if (level === 'debug') return 'text-gray-500';
  return 'text-sky-300';
}

/** 필터 칩 색 — 토글 컨트롤이라 채운 배지(§7.7). */
function categoryChipClasses(category: ServerLogCategory): string {
  if (category === 'error') return 'bg-rose-500/20 text-rose-300';
  if (category === 'warn') return 'bg-amber-500/20 text-amber-300';
  if (category === 'hook') return 'bg-violet-500/20 text-violet-300';
  return 'bg-sky-500/15 text-sky-300'; // event
}

/** 줄 카테고리 마크 색 — 글자색 + 흐린 점선 밑줄(§7.7). */
function categoryMarkClasses(category: ServerLogCategory): string {
  if (category === 'error') return 'text-rose-300 border-rose-400/40';
  if (category === 'warn') return 'text-amber-300 border-amber-400/40';
  if (category === 'hook') return 'text-violet-300 border-violet-400/40';
  return 'text-sky-300 border-sky-400/40'; // event
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** 메시지를 토큰 배열로 — 숫자런은 `#` 으로 정규화(seq/카운트 차이를 무시). */
function tokenize(message: string): string[] {
  return message.replace(/\d+/g, '#').split(/\s+/);
}

/** 두 토큰 배열의 불일치 토큰 수. 길이가 다르면 Infinity. */
function tokenDiff(a: string[], b: string[]): number {
  if (a.length !== b.length) return Infinity;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff += 1;
  }
  return diff;
}

/** coalescing 으로 묶인 인접 라인 그룹. lines 는 1개 이상. */
interface LogGroup {
  /** 그룹 첫 라인의 seq — React key + 펼침 상태 키. */
  key: number;
  category: ServerLogCategory;
  lines: ServerLogEntry[];
}

/** §7.7 — 같은 category · 숫자 정규화 후 토큰 1개 이하 차이 · 시간창 안이면 한 그룹(렌더 단계). */
function coalesce(entries: ServerLogEntry[]): LogGroup[] {
  const groups: LogGroup[] = [];
  let headTokens: string[] = [];
  let prevTs = 0;
  for (const entry of entries) {
    const tokens = tokenize(entry.message);
    const last = groups[groups.length - 1];
    const fits = last !== undefined
      && last.category === entry.category
      && entry.ts - prevTs <= COALESCE_WINDOW_MS
      && tokenDiff(tokens, headTokens) <= 1;
    if (fits && last) {
      last.lines.push(entry);
    } else {
      groups.push({ key: entry.seq, category: entry.category, lines: [entry] });
      headTokens = tokens;
    }
    prevTs = entry.ts;
  }
  return groups;
}

/** 고정폭 슬롯이라 모든 행의 메시지 시작 열이 같다(§7.7). */
function CategoryMark({ category }: { category: ServerLogCategory }): React.JSX.Element {
  return (
    <span className="w-9 shrink-0">
      <span className={`border-b border-dotted pb-px text-[12px] uppercase ${categoryMarkClasses(category)}`}>
        {category}
      </span>
    </span>
  );
}

/** 단일 로그 라인 행 — 그룹 1개짜리 + 펼친 그룹의 자식 라인 공용. */
function LogRow({ entry, child = false }: { entry: ServerLogEntry; child?: boolean }): React.JSX.Element {
  return (
    <div
      className={`flex items-start gap-2 whitespace-pre-wrap break-all ${child ? 'bg-gray-900/40' : ''} ${levelClasses(entry.level)}`}
    >
      <span className="shrink-0 text-[12px] text-gray-600">{formatTime(entry.ts)}</span>
      {/* chevron 자리 — 그룹 헤더의 chevron(w-3)과 같은 폭을 비워 메시지 열을 맞춘다. */}
      <span className="h-3 w-3 shrink-0" aria-hidden />
      <CategoryMark category={entry.category} />
      <span className="flex-1">{entry.message}</span>
    </div>
  );
}

export const ServerLogPopup = memo(function ServerLogPopup({
  connectionStatus,
  onClose,
}: ServerLogPopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const wsSend = useGraphStore((s) => s._wsSend);
  const [lines, setLines] = useState<ServerLogEntry[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  // §7.7 — 기본 ON: 라이브 로그는 최근 N줄로 충분.
  const [recentOnly, setRecentOnly] = useState(true);
  const [hiddenCategories, setHiddenCategories] = useState<Set<ServerLogCategory>>(new Set());
  // §7.7 — 펼쳐진 coalesce 그룹(그룹 첫 줄 seq).
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const connected = connectionStatus === 'connected';

  // 구독 / 해제 + 이벤트 수신 — 연결돼 있을 때만. 끊김↔연결 전이 시 재구독.
  useEffect(() => {
    if (!connected || !wsSend) return;

    const subMsg: WSMessage = {
      type: 'subscribe_server_log',
      timestamp: Date.now(),
      payload: {},
    };
    wsSend(subMsg);

    const unsub = serverLogEvents.subscribe((ev) => {
      if (ev.kind === 'init') {
        setLines(ev.lines.slice(-SERVER_LOG_CLIENT_BUFFER_MAX));
        setInitialized(true);
        return;
      }
      setLines((prev) => {
        const merged = prev.concat(ev.lines);
        const overflow = merged.length - SERVER_LOG_CLIENT_BUFFER_MAX;
        return overflow > 0 ? merged.slice(overflow) : merged;
      });
    });

    return () => {
      unsub();
      const unsubMsg: WSMessage = {
        type: 'unsubscribe_server_log',
        timestamp: Date.now(),
        payload: {},
      };
      wsSend(unsubMsg);
    };
  }, [connected, wsSend]);

  // ESC 닫기
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // 카테고리별 라인 수 — 필터 칩 배지용(필터 적용 전 전체 기준).
  const categoryCounts = useMemo(() => {
    const counts: Record<ServerLogCategory, number> = { error: 0, warn: 0, hook: 0, event: 0 };
    for (const l of lines) counts[l.category] += 1;
    return counts;
  }, [lines]);

  // 카테고리 숨김 + 부분문자열 필터.
  const filtered = useMemo(() => {
    let out = lines;
    if (hiddenCategories.size > 0) {
      out = out.filter((l) => !hiddenCategories.has(l.category));
    }
    const needle = filter.trim().toLowerCase();
    if (needle) {
      out = out.filter((l) => l.message.toLowerCase().includes(needle));
    }
    return out;
  }, [lines, filter, hiddenCategories]);

  // "최근 200줄만" 토글 — 렌더 대상만 자른다(로컬 ring buffer 자체는 불변).
  const visible = useMemo(
    () => (recentOnly && filtered.length > SERVER_LOG_RECENT_VIEW_LIMIT
      ? filtered.slice(-SERVER_LOG_RECENT_VIEW_LIMIT)
      : filtered),
    [filtered, recentOnly],
  );

  const groups = useMemo(() => coalesce(visible), [visible]);

  // auto-scroll — 보이는 줄이 늘어날 때 바닥 고정. 사용자가 위로 스크롤하면 꺼짐.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [groups, autoScroll]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  }, [autoScroll]);

  const toggleCategory = useCallback((category: ServerLogCategory) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((key: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        className="mx-4 flex max-h-[85dvh] w-full max-w-4xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — 좁으면 연결 상태 글자가 말줄임으로 물러난다(줄 수·오류 수·닫기는 남는다). */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <svg className="h-4 w-4 shrink-0 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 10h16M4 14h10M4 18h10" />
            </svg>
            <span className="shrink-0 text-sm font-semibold text-gray-100">
              {t('panel.serverLog.title')}
            </span>
            <span className={`min-w-0 truncate font-mono text-xs ${connected ? 'text-emerald-300' : 'text-gray-500'}`}>
              {t(`header.conn.${connectionStatus}`)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded bg-gray-700/40 px-1.5 py-0.5 font-mono text-[12px] text-gray-300">
              {t('panel.serverLog.linesCount', { count: lines.length })}
            </span>
            {categoryCounts.error > 0 && (
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[12px] text-rose-300">
                {t('panel.serverLog.errorsCount', { count: categoryCounts.error })}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:h-9 pointer-coarse:w-9"
              aria-label={t('panel.serverLog.close')}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar — row 1: filter + clear */}
        <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('panel.serverLog.filterPlaceholder')}
            className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800/60 px-2 py-1 font-mono text-xs text-gray-200 placeholder-gray-500 focus:border-sky-500 focus:outline-none pointer-coarse:py-1.5"
          />
          <button
            type="button"
            onClick={() => setLines([])}
            className="shrink-0 rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 hover:text-gray-100 pointer-coarse:min-h-8"
            title={t('panel.serverLog.clearLocal')}
          >
            {t('panel.serverLog.clear')}
          </button>
        </div>

        {/* Toolbar — row 2: category filter chips + view toggles(좁으면 토글 둘이 다음 줄로 내려간다) */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-4 py-2">
          <div className="flex flex-1 flex-wrap items-center gap-1">
            {CATEGORY_ORDER.map((category) => {
              const hidden = hiddenCategories.has(category);
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[12px] uppercase transition pointer-coarse:min-h-8 pointer-coarse:px-2 ${
                    hidden
                      ? 'bg-gray-800 text-gray-600 line-through'
                      : categoryChipClasses(category)
                  }`}
                >
                  {category} {categoryCounts[category]}
                </button>
              );
            })}
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={recentOnly}
              onChange={(e) => setRecentOnly(e.target.checked)}
              className="h-3 w-3 cursor-pointer accent-sky-500"
            />
            <span title={t('panel.serverLog.recentOnlyTitle')}>{t('panel.serverLog.recentOnly')}</span>
          </label>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-3 w-3 cursor-pointer accent-sky-500"
            />
            {t('panel.serverLog.autoScroll')}
          </label>
        </div>

        {/* Body */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto bg-gray-950/70 px-3 py-2 font-mono text-[12px] leading-relaxed"
        >
          {!connected && (
            <div className="py-10 text-center text-xs text-gray-500">
              {t('panel.serverLog.disconnected')}
            </div>
          )}

          {connected && !initialized && (
            <div className="flex items-center justify-center py-10 text-xs text-gray-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-700 border-t-sky-400" />
              <span className="ml-2">{t('panel.serverLog.connecting')}</span>
            </div>
          )}

          {connected && initialized && visible.length === 0 && (
            <div className="py-10 text-center text-xs text-gray-500">
              {filter || hiddenCategories.size > 0
                ? t('panel.serverLog.emptyFiltered')
                : t('panel.serverLog.emptyWaiting')}
            </div>
          )}

          {connected && groups.map((group) => {
            const head = group.lines[0];
            if (!head) return null;
            if (group.lines.length === 1) {
              return <LogRow key={head.seq} entry={head} />;
            }
            const expanded = expandedGroups.has(group.key);
            return (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className={`flex w-full items-start gap-2 whitespace-pre-wrap break-all text-left hover:bg-gray-900/60 ${levelClasses(head.level)}`}
                >
                  <span className="shrink-0 text-[12px] text-gray-600">{formatTime(head.ts)}</span>
                  <svg
                    className={`mt-px h-3 w-3 shrink-0 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                  <CategoryMark category={head.category} />
                  <span className="flex-1">{head.message}</span>
                  <span className="shrink-0 rounded bg-gray-700/60 px-1.5 text-[12px] font-semibold text-gray-200">
                    ×{group.lines.length}
                  </span>
                </button>
                {expanded && group.lines.map((l) => <LogRow key={l.seq} entry={l} child />)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
