/**
 * §5.5 #17-28 v4.96 — **컨텍스트 주입원 통제** 사이드바 뷰.
 *
 * 활동바의 종전 `결과`(훅 이벤트 목록) 자리를 잇는다. 여기가 답하는 것은 하나다 —
 * *"지금 프롬프트를 넣으면 앞에 무엇이 얼마나 붙어 나가는가, 그리고 그중 무엇을 뺄 수 있는가."*
 *
 * 규율:
 *  · 목록은 **열 때마다 서버에서 다시 잰다**(캐시 ❌ — 캐시된 표는 옛날 답을 준다).
 *  · 토글은 **여기가 최종**이다. 프로젝트 층과 세션 층 중 어디에 걸지는 위 스위치가 정한다.
 *  · 못 끄는 줄은 잠긴 채로 이유를 말한다 — 끌 수 있는 척하지 않는다.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContextInventory, ContextSourceItem } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';
import { InfoTooltip } from '../Layout/InfoTooltip.js';
import {
  CONTEXT_CATEGORY_LABEL_KEY,
  formatTokens,
  groupByCategory,
  matchesQuery,
  sortItems,
  sumTokens,
  type ContextSortKey,
} from './contextInventoryView.js';
import { useContextAbout } from './useContextAbout.js';
import { IDEContextSourceDialog } from './IDEContextSourceDialog.js';

const SORT_KEYS: { key: ContextSortKey; labelKey: string }[] = [
  { key: 'category', labelKey: 'ide.context.sort.category' },
  { key: 'tokens', labelKey: 'ide.context.sort.tokens' },
  { key: 'updated', labelKey: 'ide.context.sort.updated' },
  { key: 'name', labelKey: 'ide.context.sort.name' },
];

/** 통제 성격 배지 색 — 끌 수 있는 것(초록/파랑)과 못 끄는 것(회색)이 한눈에 갈리게. */
const CONTROL_STYLE: Record<string, string> = {
  session: 'bg-emerald-500/15 text-emerald-300/90',
  spawn: 'bg-sky-500/15 text-sky-300/90',
  external: 'bg-amber-500/15 text-amber-300/90',
  none: 'bg-gray-600/25 text-gray-400',
};

function formatDay(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-CA'); // YYYY-MM-DD — 정렬 감각과 같은 표기.
}

/** 한 줄 — 제목·토큰·통제 배지·토글 + (있으면) 펼쳐지는 내역. */
const SourceRow = memo(function SourceRow({
  item,
  onToggle,
  onOpenDetail,
  busy,
}: {
  item: ContextSourceItem;
  onToggle: (item: ContextSourceItem, next: boolean) => void;
  /** §5.5 #17-28 ⑦ — 제목을 누르면 이 줄이 무엇인지 말해 주는 상세창이 뜬다. */
  onOpenDetail: (item: ContextSourceItem) => void;
  busy: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const about = useContextAbout();
  const [open, setOpen] = useState(false);
  const title = item.labelKey ? t(item.labelKey) : item.title;
  const lockable = item.control === 'session' || item.control === 'spawn';
  const children = item.children ?? [];

  return (
    <li className={`rounded px-1.5 py-1.5 transition-colors ${item.enabled ? 'hover:bg-gray-700/40' : 'bg-gray-800/40 hover:bg-gray-700/30'}`}>
      <div className="flex items-start gap-1.5">
        {/* 토글 — 못 끄는 줄은 잠긴 상태로 그린다(눌러도 아무 일이 없다는 것이 보이게). */}
        <button
          type="button"
          disabled={!lockable || busy}
          onClick={() => onToggle(item, !item.enabled)}
          title={lockable
            ? t(item.enabled ? 'ide.context.turnOff' : 'ide.context.turnOn')
            : t(item.hintKey ?? 'ide.context.locked')}
          aria-label={title}
          aria-pressed={item.enabled}
          className={`mt-px flex h-4 w-7 flex-shrink-0 items-center rounded-full px-0.5 transition-colors ${
            !lockable
              ? 'cursor-not-allowed bg-gray-700/60'
              : item.enabled
                ? 'bg-emerald-500/70 hover:bg-emerald-400/80'
                : 'bg-gray-600 hover:bg-gray-500'
          }`}
        >
          <span
            className={`h-3 w-3 rounded-full bg-white/90 transition-transform ${item.enabled ? 'translate-x-3' : 'translate-x-0'} ${
              !lockable ? 'opacity-40' : ''
            }`}
          />
        </button>

        <div className="min-w-0 flex-1">
          {/* 제목 = 손잡이. 마우스를 올리면 "이게 무엇인가" 한 줄이 뜨고, 누르면 상세창이 열린다(⑦). */}
          <div className="flex items-baseline gap-1">
            <InfoTooltip
              title={title}
              body={about(item, 'what')}
              footer={t('ide.context.rowHint')}
              className="min-w-0 flex-1"
            >
              <button
                type="button"
                onClick={() => onOpenDetail(item)}
                className="block w-full text-left"
              >
                <span className={`block truncate text-[12px] font-medium underline-offset-2 hover:underline ${item.enabled ? 'text-gray-200' : 'text-gray-500 line-through'}`}>
                  {title}
                </span>
              </button>
            </InfoTooltip>
            {item.detail && (
              <span className="flex-shrink-0 text-[12px] text-gray-500">{item.detail.length > 22 ? `${item.detail.slice(0, 22)}…` : item.detail}</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className={`tabular-nums text-[12px] font-semibold ${item.enabled ? 'text-violet-300/80' : 'text-gray-600'}`}>
              {item.estimated ? '~' : ''}{formatTokens(item.tokens)}
            </span>
            <span className={`rounded px-1 py-px text-[12px] ${CONTROL_STYLE[item.control] ?? CONTROL_STYLE['none']}`}>
              {t(`ide.context.control.${item.control}`)}
            </span>
            {item.overrideScope && (
              <span className="rounded bg-violet-500/20 px-1 py-px text-[12px] text-violet-300">
                {t(`ide.context.scope.${item.overrideScope}`)}
              </span>
            )}
            {item.updatedAt && (
              <span className="text-[12px] text-gray-600">{formatDay(item.updatedAt)}</span>
            )}
            {children.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="ml-auto flex items-center gap-0.5 text-[12px] text-gray-500 transition-colors hover:text-gray-300"
              >
                <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
                {children.length}
              </button>
            )}
          </div>
          {item.warnKey && !item.enabled && (
            <p className="mt-0.5 text-[12px] leading-snug text-amber-400/80">{t(item.warnKey)}</p>
          )}
          {open && children.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 border-l border-gray-700 pl-1.5">
              {children.map((c) => (
                <li key={`${c.path ?? c.title}`} className="flex items-baseline gap-1">
                  <span className="truncate text-[12px] text-gray-400" title={c.path ?? c.title}>{c.title}</span>
                  <span className="ml-auto flex-shrink-0 tabular-nums text-[12px] text-violet-300/60">{formatTokens(c.tokens)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
});

export function IDEContextView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  const [inventory, setInventory] = useState<ContextInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<ContextSortKey>('category');
  const [desc, setDesc] = useState(true);
  const [scope, setScope] = useState<'project' | 'session'>('project');
  const [busy, setBusy] = useState(false);
  /** §5.5 #17-28 ⑦ — 상세창은 **id 로** 연다. 목록을 다시 재면 항목 객체는 새것이 되므로 붙들면 낡는다. */
  const [detailId, setDetailId] = useState<string | null>(null);

  /** 열 때마다·세션이 바뀔 때마다 다시 잰다 — 이 창을 여는 순간이 곧 "지금" 을 묻는 순간이다. */
  const refresh = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const url = `/api/context-inventory/${encodeURIComponent(agentId)}${activeSessionId ? `?sub=${encodeURIComponent(activeSessionId)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      setInventory((await res.json()) as ContextInventory);
    } catch {
      setInventory(null);
    } finally {
      setLoading(false);
    }
  }, [agentId, activeSessionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // 세션 탭이 없으면 걸 곳이 없으므로 프로젝트 층으로 되돌린다(빈 세션 키로 저장되는 일 방지).
  useEffect(() => { if (!activeSessionId && scope === 'session') setScope('project'); }, [activeSessionId, scope]);

  const handleToggle = useCallback(async (item: ContextSourceItem, next: boolean) => {
    if (!agentId) return;
    setBusy(true);
    // 낙관 반영 — 누른 즉시 줄이 반응하고, 서버 응답 뒤 실측으로 덮어쓴다.
    setInventory((prev) => prev && ({
      ...prev,
      items: prev.items.map((i) => (i.id === item.id ? { ...i, enabled: next, overrideScope: scope } : i)),
    }));
    try {
      await fetch(`/api/context-overrides/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: item.id,
          // 기본값과 같아지면 오버라이드를 지운다(설정이 쌓이지 않게 — 되돌리기가 곧 삭제다).
          enabled: next === item.defaultEnabled ? null : next,
          scope: scope === 'session' && activeSessionId ? 'session' : 'project',
          ...(scope === 'session' && activeSessionId ? { subAgentId: activeSessionId } : {}),
        }),
      });
    } catch {
      /* 실패해도 아래 refresh 가 실측으로 되돌린다 */
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [agentId, scope, activeSessionId, refresh]);

  const handleReset = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const q = scope === 'session' && activeSessionId
        ? `?scope=session&sub=${encodeURIComponent(activeSessionId)}`
        : '?scope=project';
      await fetch(`/api/context-overrides/${encodeURIComponent(agentId)}${q}`, { method: 'DELETE' });
    } catch {
      /* 무시 — refresh 가 진실을 다시 가져온다 */
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [agentId, scope, activeSessionId, refresh]);

  const handleOpenDetail = useCallback((item: ContextSourceItem) => setDetailId(item.id), []);

  const titleOf = useCallback((i: ContextSourceItem) => (i.labelKey ? t(i.labelKey) : i.title), [t]);

  const visible = useMemo(() => {
    const items = (inventory?.items ?? []).filter((i) => matchesQuery(i, titleOf(i), query));
    return sortItems(items, sortKey, desc, titleOf);
  }, [inventory, query, sortKey, desc, titleOf]);

  const totals = useMemo(() => sumTokens(inventory?.items ?? []), [inventory]);
  const groups = useMemo(() => (sortKey === 'category' ? groupByCategory(visible) : null), [sortKey, visible]);
  // 목록이 새로 고쳐져도 열려 있던 상세창은 **그 줄의 최신 상태**를 계속 비춘다(토글 직후에도 어긋나지 않게).
  const detailItem = useMemo(
    () => (detailId ? (inventory?.items ?? []).find((i) => i.id === detailId) ?? null : null),
    [detailId, inventory],
  );

  return (
    <div className="flex min-h-0 flex-col gap-1 p-2">
      <div className="flex items-center gap-1 px-0.5">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.context.title')}</span>
        <button
          type="button"
          onClick={() => { void refresh(); }}
          title={t('ide.context.refresh')}
          aria-label={t('ide.context.refresh')}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
        >
          <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      {/* 합계 — "지금 이 프롬프트가 얼마짜리인가" 한 줄. */}
      <div className="flex items-baseline gap-1 rounded bg-gray-800/60 px-2 py-1">
        <span className="tabular-nums text-[13px] font-bold text-violet-300">~{formatTokens(totals.enabled)}</span>
        <span className="text-[12px] text-gray-500">/ ~{formatTokens(totals.total)}</span>
        <span className="ml-auto text-[12px] text-gray-500">{t('ide.context.tokensLabel')}</span>
      </div>

      {/* 어느 층에 걸까 — 프로젝트 전체 / 이 세션만. */}
      <div className="flex items-center gap-1">
        {(['project', 'session'] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={s === 'session' && !activeSessionId}
            onClick={() => setScope(s)}
            className={`flex-1 rounded px-1 py-1 text-[12px] font-semibold transition-colors ${
              scope === s
                ? 'bg-violet-500/25 text-violet-200'
                : 'bg-gray-800/60 text-gray-500 hover:text-gray-300 disabled:opacity-40 disabled:hover:text-gray-500'
            }`}
          >
            {t(`ide.context.scope.${s}`)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { void handleReset(); }}
          title={t('ide.context.reset')}
          aria-label={t('ide.context.reset')}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
          </svg>
        </button>
      </div>

      {/* 검색 */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('ide.context.searchPlaceholder')}
        className="w-full rounded border border-gray-700 bg-gray-900/80 px-1.5 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-violet-500/60 focus:outline-none"
      />

      {/* 정렬 축 — 누른 축을 다시 누르면 오름/내림이 뒤집힌다. */}
      <div className="flex flex-wrap items-center gap-0.5">
        {SORT_KEYS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              if (sortKey === s.key) setDesc((v) => !v);
              else { setSortKey(s.key); setDesc(true); }
            }}
            className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[12px] font-semibold transition-colors ${
              sortKey === s.key ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
            }`}
          >
            {t(s.labelKey)}
            {sortKey === s.key && (
              <svg className={`h-2.5 w-2.5 ${desc ? '' : 'rotate-180'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            )}
          </button>
        ))}
      </div>

      <ScrollFade maxHeight={520}>
        {groups
          ? groups.map((g) => (
            <div key={g.category} className="mb-1">
              <div className="px-1 pb-0.5 pt-1 text-[12px] font-bold uppercase tracking-wider text-gray-600">
                {t(CONTEXT_CATEGORY_LABEL_KEY[g.category] ?? g.category)}
              </div>
              <ul className="flex flex-col">
                {g.items.map((i) => <SourceRow key={i.id} item={i} onToggle={handleToggle} onOpenDetail={handleOpenDetail} busy={busy} />)}
              </ul>
            </div>
          ))
          : (
            <ul className="flex flex-col">
              {visible.map((i) => <SourceRow key={i.id} item={i} onToggle={handleToggle} onOpenDetail={handleOpenDetail} busy={busy} />)}
            </ul>
          )}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-[12px] text-gray-600">
            {loading ? t('ide.context.loading') : t('ide.context.empty')}
          </p>
        )}
      </ScrollFade>

      {detailItem && (
        <IDEContextSourceDialog
          agentId={agentId}
          subAgentId={activeSessionId ?? undefined}
          item={detailItem}
          onToggle={handleToggle}
          busy={busy}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
