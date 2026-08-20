import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from '@xyflow/react';
import { BUBBLE_STYLES } from '@vibisual/shared';
import type { LabRunStatus, LabVariant } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * §5.18 / §7.17 — 에이전트 랩 표지 버블.
 *
 * 스펙·플레이 버블과 같은 "사용자가 만든 독립 캔버스 요소"다. 캔버스에서는 **표지만** 보여 준다
 * (제목·변형 수·끝난 개수·가장 싼 성공 변형). 과제를 쓰고 변형을 짜고 비교 표를 읽는 것은
 * 더블클릭으로 열리는 랩 패널의 몫이다 — 캔버스는 지도이지 편집기가 아니다.
 */

export interface LabNodeData extends Record<string, unknown> {
  labRunId: string;
  projectName: string;
  width: number;
  height: number;
  title: string;
  variants: LabVariant[];
  status: LabRunStatus;
  promotedVariantId?: string | undefined;
  preservePinned?: boolean | undefined;
}

interface MenuPos {
  x: number;
  y: number;
}

const STYLE = BUBBLE_STYLES.lab;

function LabGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M10 2v6.5L4.8 17.4A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 1.7-3.1L14 8.5V2" />
      <path d="M9 2h6" />
      <path d="M7.5 14h9" />
    </svg>
  );
}

function TrophyGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
    </svg>
  );
}

/** 비용 표시 — 값이 없으면 `—`(0 으로 채우지 않는다, §5.18). */
function formatCost(usd: number | undefined): string {
  if (usd === undefined) return '—';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export const LabNode = memo(function LabNode({
  data,
  selected,
}: NodeProps & { data: LabNodeData }): React.JSX.Element {
  const { t } = useTranslation();
  const selectLabRun = useGraphStore((s) => s.selectLabRun);
  const selectedLabRunId = useGraphStore((s) => s.selectedLabRunId);
  const openLabPanel = useGraphStore((s) => s.openLabPanel);
  const updateLabRun = useGraphStore((s) => s.updateLabRun);
  const patchLocal = useGraphStore((s) => s.patchLabRunLocal);
  const addLabVariant = useGraphStore((s) => s.addLabVariant);
  const startLabRun = useGraphStore((s) => s.startLabRun);
  const deleteLabRun = useGraphStore((s) => s.deleteLabRun);

  const [menu, setMenu] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const isSelected = selected === true || selectedLabRunId === data.labRunId;
  const isPinned = data.preservePinned === true;

  // 바깥 press 로 닫기(공통 규약 — capture 단계에서 React Flow 선점 전에 처리).
  useOutsidePressDismiss({
    enabled: menu !== null,
    onDismiss: () => setMenu(null),
    refs: [menuRef],
  });

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menu]);

  /** 서버가 준 값의 단순 집계뿐 — 판정 로직은 서버가 전부 들고 있다(§3.1 View 전용). */
  const counts = useMemo(() => {
    const total = data.variants.length;
    let finished = 0;
    let running = 0;
    let success = 0;
    let best: LabVariant | undefined;
    for (const v of data.variants) {
      const r = v.result;
      if (!r) continue;
      if (r.status === 'running') running += 1;
      else finished += 1;
      if (r.status !== 'success') continue;
      success += 1;
      if (r.costUsd === undefined) continue;
      if (best?.result?.costUsd === undefined || r.costUsd < best.result.costUsd) best = v;
    }
    return { total, finished, running, success, best };
  }, [data.variants]);

  const handleSelect = useCallback((e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest?.('button')) return;
    selectLabRun(data.labRunId);
  }, [selectLabRun, data.labRunId]);

  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    selectLabRun(data.labRunId);
    setMenu({ x: e.clientX, y: e.clientY });
  }, [selectLabRun, data.labRunId]);

  const handleOpen = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    selectLabRun(data.labRunId);
    openLabPanel(data.labRunId);
  }, [openLabPanel, selectLabRun, data.labRunId]);

  const rename = useCallback((): void => {
    setMenu(null);
    const next = window.prompt(t('canvas.lab.renamePrompt', { defaultValue: '랩 제목' }), data.title);
    if (next === null) return;
    const title = next.trim();
    patchLocal(data.labRunId, { title });
    void updateLabRun(data.labRunId, { title });
  }, [t, data.title, data.labRunId, patchLocal, updateLabRun]);

  const addVariant = useCallback((): void => {
    setMenu(null);
    void addLabVariant(data.labRunId);
  }, [addLabVariant, data.labRunId]);

  const start = useCallback((): void => {
    setMenu(null);
    if (counts.total === 0) return;
    setBusy(true);
    void startLabRun(data.labRunId).finally(() => setBusy(false));
  }, [counts.total, startLabRun, data.labRunId]);

  const togglePin = useCallback((): void => {
    setMenu(null);
    const next = !isPinned;
    patchLocal(data.labRunId, { preservePinned: next });
    void updateLabRun(data.labRunId, { preservePinned: next });
  }, [isPinned, data.labRunId, patchLocal, updateLabRun]);

  const remove = useCallback((): void => {
    setMenu(null);
    void deleteLabRun(data.labRunId);
  }, [deleteLabRun, data.labRunId]);

  const menuItem = (
    onClick: () => void,
    text: string,
    opts: { danger?: boolean; disabled?: boolean; title?: string } = {},
  ): React.JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      disabled={opts.disabled === true}
      title={opts.title}
      className={`w-full px-3 py-2 text-left text-sm transition-colors ${
        opts.disabled === true
          ? 'cursor-not-allowed text-gray-500'
          : `hover:bg-gray-800 ${opts.danger === true ? 'text-rose-300' : 'text-gray-200'}`
      }`}
    >
      {text}
    </button>
  );

  const menuPortal = menu
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[60] min-w-52 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menuItem(() => {
            setMenu(null);
            openLabPanel(data.labRunId);
          }, t('canvas.lab.openPanel', { defaultValue: '랩 열기' }))}
          {menuItem(rename, t('canvas.lab.rename', { defaultValue: '이름 바꾸기' }))}
          {menuItem(addVariant, t('canvas.lab.addVariant', { defaultValue: '변형 추가' }))}
          {menuItem(start, t('canvas.lab.startAll', { defaultValue: '전부 실행' }), {
            disabled: counts.total === 0,
            ...(counts.total === 0
              ? { title: t('canvas.lab.startNoneHint', { defaultValue: '실행할 변형이 없습니다' }) }
              : {}),
          })}
          {menuItem(togglePin, isPinned
            ? t('canvas.lab.unpin', { defaultValue: '고정 해제' })
            : t('canvas.lab.pin', { defaultValue: '고정' }))}
          <div className="mx-2 my-1 border-t border-gray-700" />
          {menuItem(remove, t('canvas.lab.delete', { defaultValue: '삭제' }), {
            danger: true,
            disabled: isPinned,
            ...(isPinned
              ? { title: t('canvas.lab.deletePinnedHint', { defaultValue: '고정된 랩입니다. 먼저 고정을 해제하세요.' }) }
              : {}),
          })}
        </div>,
        document.body,
      )
    : null;

  const title = data.title.trim() || t('canvas.lab.untitled', { defaultValue: '제목 없는 랩' });
  const isRunning = data.status === 'running';

  return (
    <>
      <div
        onPointerDownCapture={handleSelect}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleOpen}
        title={title}
        className="bubble-press relative flex cursor-pointer select-none flex-col overflow-hidden rounded-2xl px-3 py-2.5 text-white"
        style={{
          width: data.width,
          height: data.height,
          border: '2px solid',
          borderColor: isSelected ? '#FFFFFF' : `${STYLE.glow}99`,
          background: `linear-gradient(160deg, ${STYLE.color}E6, ${STYLE.color}99)`,
          boxShadow: isSelected ? `0 0 0 3px ${STYLE.glow}80` : `0 6px 22px ${STYLE.color}40`,
        }}
      >
        <div className="flex items-center gap-1.5 text-white/90">
          <LabGlyph />
          <span className="text-[12px] font-semibold uppercase tracking-wide text-white/70">
            {t('canvas.lab.title', { defaultValue: '랩' })}
          </span>
          <span className="ml-auto rounded bg-black/25 px-1.5 py-0.5 text-[12px] text-white/70">
            {isRunning
              ? t('canvas.lab.badgeRunning', { defaultValue: '실행 중' })
              : data.status === 'done'
                ? t('canvas.lab.badgeDone', { defaultValue: '완료' })
                : t('canvas.lab.badgeDraft', { defaultValue: '대기' })}
          </span>
        </div>

        <div className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-tight">{title}</div>

        <div className="mt-auto flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[12px] text-white/80">
            <span>{t('canvas.lab.variants', { defaultValue: '변형' })}</span>
            <span className="font-semibold">{counts.finished}/{counts.total}</span>
            {counts.running > 0 ? (
              <span className="ml-auto text-white/60">
                {t('canvas.lab.runningN', { count: counts.running, defaultValue: '도는 중 {{count}}' })}
              </span>
            ) : null}
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-black/30">
            <div
              className="h-full rounded-full bg-orange-200"
              style={{ width: `${counts.total === 0 ? 0 : Math.round((counts.finished / counts.total) * 100)}%` }}
            />
          </div>
          {counts.best ? (
            <div className="flex items-center gap-1 text-[12px] font-semibold text-amber-100">
              <TrophyGlyph />
              <span className="truncate">
                {counts.best.label} · {formatCost(counts.best.result?.costUsd)}
              </span>
            </div>
          ) : busy || isRunning ? (
            <div className="text-[12px] text-white/70">{t('canvas.lab.starting', { defaultValue: '변형 실행 중…' })}</div>
          ) : counts.total > 0 ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); start(); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="rounded bg-black/25 px-2 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-black/40"
            >
              {t('canvas.lab.startAllN', { count: counts.total, defaultValue: '전부 실행 ({{count}})' })}
            </button>
          ) : (
            <div className="text-[12px] text-white/70">{t('canvas.lab.emptyHint', { defaultValue: '더블클릭해 과제와 변형을 짜세요' })}</div>
          )}
        </div>

        {isPinned ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute right-2 top-8 h-3.5 w-3.5 text-white/80"
          >
            <path d="M12 17v5" />
            <path d="M9 10.76V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3.76a2 2 0 0 0 .59 1.42L17 13.5V17H7v-3.5l1.41-1.32A2 2 0 0 0 9 10.76z" />
          </svg>
        ) : null}
      </div>
      {menuPortal}
    </>
  );
});
