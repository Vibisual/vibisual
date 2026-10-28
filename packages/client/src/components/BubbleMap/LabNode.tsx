import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from '@xyflow/react';
import { BUBBLE_STYLES } from '@vibisual/shared';
import type { LabRunStatus, LabVariant } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { promptDialog } from '../../utils/appDialog.js';
import { isInteractiveTarget, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { useCanvasNodeSelection } from './useCanvasNodeSelection.js';
import { openGroupMenuIfGrouped } from './BubbleContextMenu.js';
import { CanvasNodeMenu, CanvasNodeMenuItem, CanvasNodeMenuSeparator } from './CanvasNodeMenu.js';

/** §5.18 / §7.17 — 랩 표지 버블. 캔버스엔 표지만 — 과제·변형·비교 표는 더블클릭 랩 패널 몫(캔버스는 지도지 편집기가 아니다). */

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
  id,
  data,
  selected,
}: NodeProps & { data: LabNodeData }): React.JSX.Element {
  const { t } = useTranslation();
  const selectLabRun = useGraphStore((s) => s.selectLabRun);
  const openLabPanel = useGraphStore((s) => s.openLabPanel);
  const updateLabRun = useGraphStore((s) => s.updateLabRun);
  const patchLocal = useGraphStore((s) => s.patchLabRunLocal);
  const addLabVariant = useGraphStore((s) => s.addLabVariant);
  const startLabRun = useGraphStore((s) => s.startLabRun);
  const deleteLabRun = useGraphStore((s) => s.deleteLabRun);

  const [menu, setMenu] = useState<MenuPos | null>(null);
  // 바깥 press·아무 키로 닫기는 메뉴 껍데기(`CanvasNodeMenu`)가 든다 — 다섯 노드가 같은 규약 한 벌.
  const closeMenu = useCallback((): void => setMenu(null), []);
  const [busy, setBusy] = useState(false);

  // 선택 링은 `selectIntentId`(캔버스가 나눠 쓰는 "지금 고른 것 한 칸")도 함께 본다 —
  // 더블클릭 지연(`bubbleSelectGesture`) 동안 눈에 보이는 반응을 내는 것이 그 칸이다.
  // 둘 다 판정 결과만 구독한다(§9) — id 를 받으면 다른 버블을 고를 때마다 이 버블도 다시 그려진다.
  const chosenHere = useGraphStore((s) => s.selectedLabRunId === data.labRunId || s.selectIntentId === data.labRunId);
  const isSelected = selected === true || chosenHere;
  const isPinned = data.preservePinned === true;

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

  // 선택·더블클릭은 에이전트(IDE) 버블과 같은 상태기계 한 벌을 쓴다 — 더블클릭으로 랩을 열 때
  // 1타의 선택(우측 패널)이 함께 발동하지 않는다.
  // §6 — 고른 묶음은 다른 버블과 같은 칸이다(보통 클릭 = 이 노드 하나로, Ctrl/Cmd 클릭 = 넣고 빼기).
  const canvasSelection = useCanvasNodeSelection(id, data.labRunId);
  const gesture = useBubbleSelectGesture({
    doubleClickable: true,
    select: () => {
      canvasSelection.replace();
      selectLabRun(data.labRunId);
    },
    toggle: canvasSelection.toggle,
    setIntent: (active) => {
      useGraphStore.getState().setSelectIntent(active ? data.labRunId : null);
    },
    ignore: (e) => isInteractiveTarget(e.target),
  });

  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    // §6 — 여럿을 고른 묶음 안이면 묶음 메뉴다(고르기를 그 하나로 바꾸지 않는다).
    if (selected === true && openGroupMenuIfGrouped(id, e.clientX, e.clientY)) return;
    gesture.selectNow();
    setMenu({ x: e.clientX, y: e.clientY });
  }, [gesture, id, selected]);

  // 더블클릭 = 랩 패널 열기. **선택은 하지 않는다** — 패널은 id 를 직접 받으므로 선택이 필요 없고,
  // 여는 동작이 선택까지 끌고 오면 에이전트 버블과 손버릇이 갈린다.
  const handleOpen = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    gesture.cancelPendingSelect();
    openLabPanel(data.labRunId);
  }, [gesture, openLabPanel, data.labRunId]);

  const rename = useCallback(async (): Promise<void> => {
    setMenu(null);
    const next = await promptDialog(t('canvas.lab.renamePrompt', { defaultValue: '랩 제목' }), data.title);
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
    <CanvasNodeMenuItem onClick={onClick} label={text} danger={opts.danger} disabled={opts.disabled} title={opts.title} />
  );

  // 화면 밖으로 넘치면 안쪽으로 밀고 길면 스크롤한다(폰 폭 — `CanvasNodeMenu`).
  const menuPortal = menu
    ? (
        <CanvasNodeMenu x={menu.x} y={menu.y} minWidthClass="min-w-52" onClose={closeMenu}>
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
          <CanvasNodeMenuSeparator />
          {menuItem(remove, t('canvas.lab.delete', { defaultValue: '삭제' }), {
            danger: true,
            disabled: isPinned,
            ...(isPinned
              ? { title: t('canvas.lab.deletePinnedHint', { defaultValue: '고정된 랩입니다. 먼저 고정을 해제하세요.' }) }
              : {}),
          })}
        </CanvasNodeMenu>
      )
    : null;

  const title = data.title.trim() || t('canvas.lab.untitled', { defaultValue: '제목 없는 랩' });
  const isRunning = data.status === 'running';

  return (
    <>
      <div
        {...gesture.handlers}
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
