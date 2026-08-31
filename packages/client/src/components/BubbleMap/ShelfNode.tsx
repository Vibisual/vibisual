import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from '@xyflow/react';
import { BUBBLE_STYLES, SHELF_EXPORT_VERSION, SHELF_MAX_ITEMS } from '@vibisual/shared';
import type { ShelfItem } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { isInteractiveTarget, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { ShelfGlyph, ShelfItemGlyph } from './shelfIcons.js';
import { exportShelfFile, pickShelfFile } from './shelfTransfer.js';

/**
 * §5.20 / §7.18 — 스크립트 선반 버블.
 *
 * 랩·스펙과 달리 **표지가 아니라 선반 그 자체**를 캔버스에 그린다 — 항목 줄이 그대로 보이고
 * 줄을 누르면 그 자리에서 실행된다(패널 경유 ❌ — 클릭 한 번이 이 도구의 존재 이유다).
 * 항목을 짜고 고치는 것은 더블클릭으로 열리는 선반 패널의 몫이다.
 */

export interface ShelfNodeData extends Record<string, unknown> {
  shelfBubbleId: string;
  projectName: string;
  width: number;
  height: number;
  title: string;
  items: ShelfItem[];
  preservePinned?: boolean | undefined;
}

interface MenuPos {
  x: number;
  y: number;
}

const STYLE = BUBBLE_STYLES.shelf;

/** 마지막 결과 점 — 성공 emerald / 실패 rose / 도는 중 pulse / 안 눌러 봤으면 흐린 회색. */
function RunDot({ item }: { item: ShelfItem }): React.JSX.Element {
  const status = item.lastRun?.status;
  const cls = status === 'success'
    ? 'bg-emerald-400'
    : status === 'failed'
      ? 'bg-rose-400'
      : status === 'running'
        ? 'bg-white animate-pulse'
        : 'bg-white/25';
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} />;
}

export const ShelfNode = memo(function ShelfNode({
  data,
  selected,
}: NodeProps & { data: ShelfNodeData }): React.JSX.Element {
  const { t } = useTranslation();
  const selectShelfBubble = useGraphStore((s) => s.selectShelfBubble);
  const selectedShelfBubbleId = useGraphStore((s) => s.selectedShelfBubbleId);
  const openShelfPanel = useGraphStore((s) => s.openShelfPanel);
  const updateShelfBubble = useGraphStore((s) => s.updateShelfBubble);
  const patchLocal = useGraphStore((s) => s.patchShelfBubbleLocal);
  const runShelfItem = useGraphStore((s) => s.runShelfItem);
  const importShelfItems = useGraphStore((s) => s.importShelfItems);
  const deleteShelfBubble = useGraphStore((s) => s.deleteShelfBubble);

  const [menu, setMenu] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 선택 링은 `selectIntentId`(캔버스가 나눠 쓰는 "지금 고른 것 한 칸")도 함께 본다 —
  // 더블클릭 지연(`bubbleSelectGesture`) 동안 눈에 보이는 반응을 내는 것이 그 칸이다.
  const selectIntentId = useGraphStore((s) => s.selectIntentId);
  const isSelected = selected === true
    || selectedShelfBubbleId === data.shelfBubbleId
    || selectIntentId === data.shelfBubbleId;
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

  // 선택·더블클릭은 에이전트(IDE) 버블과 같은 상태기계 한 벌을 쓴다.
  // `ignore` 로 실행 줄(버튼)에서 시작한 누름을 걸러 낸다 — 줄 클릭은 선택이 아니라 실행이다.
  const gesture = useBubbleSelectGesture({
    doubleClickable: true,
    select: () => selectShelfBubble(data.shelfBubbleId),
    setIntent: (active) => {
      useGraphStore.getState().setSelectIntent(active ? data.shelfBubbleId : null);
    },
    ignore: (e) => isInteractiveTarget(e.target),
  });

  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    gesture.selectNow();
    setMenu({ x: e.clientX, y: e.clientY });
  }, [gesture]);

  // 더블클릭 = 선반 패널 열기. **선택은 하지 않는다**(패널은 id 를 직접 받는다).
  const handleOpen = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    gesture.cancelPendingSelect();
    openShelfPanel(data.shelfBubbleId);
  }, [gesture, openShelfPanel, data.shelfBubbleId]);

  /** 줄 클릭 = 즉시 실행. 도는 줄은 다시 쏘지 않는다(서버도 409 로 막지만 손끝에서 먼저 막는다). */
  const runItem = useCallback((item: ShelfItem): void => {
    if (item.lastRun?.status === 'running') return;
    void runShelfItem(data.shelfBubbleId, item.id);
  }, [runShelfItem, data.shelfBubbleId]);

  const rename = useCallback((): void => {
    setMenu(null);
    const next = window.prompt(t('canvas.shelf.renamePrompt', { defaultValue: '선반 이름' }), data.title);
    if (next === null) return;
    const title = next.trim();
    patchLocal(data.shelfBubbleId, { title });
    void updateShelfBubble(data.shelfBubbleId, { title });
  }, [t, data.title, data.shelfBubbleId, patchLocal, updateShelfBubble]);

  const exportShelf = useCallback((): void => {
    setMenu(null);
    exportShelfFile({ version: SHELF_EXPORT_VERSION, title: data.title, items: data.items });
  }, [data.title, data.items]);

  const importShelf = useCallback((): void => {
    setMenu(null);
    void pickShelfFile().then((payload) => {
      if (payload === null) return;
      void importShelfItems(data.shelfBubbleId, payload, false);
    });
  }, [importShelfItems, data.shelfBubbleId]);

  const togglePin = useCallback((): void => {
    setMenu(null);
    const next = !isPinned;
    patchLocal(data.shelfBubbleId, { preservePinned: next });
    void updateShelfBubble(data.shelfBubbleId, { preservePinned: next });
  }, [isPinned, data.shelfBubbleId, patchLocal, updateShelfBubble]);

  const remove = useCallback((): void => {
    setMenu(null);
    void deleteShelfBubble(data.shelfBubbleId);
  }, [deleteShelfBubble, data.shelfBubbleId]);

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
            openShelfPanel(data.shelfBubbleId);
          }, t('canvas.shelf.openPanel', { defaultValue: '선반 열기' }))}
          {menuItem(() => {
            setMenu(null);
            openShelfPanel(data.shelfBubbleId);
          }, t('canvas.shelf.addItem', { defaultValue: '항목 추가' }), {
            disabled: data.items.length >= SHELF_MAX_ITEMS,
            ...(data.items.length >= SHELF_MAX_ITEMS
              ? { title: t('canvas.shelf.itemLimit', { count: SHELF_MAX_ITEMS, defaultValue: '한 선반에 항목은 {{count}}개까지입니다' }) }
              : {}),
          })}
          {menuItem(rename, t('canvas.shelf.rename', { defaultValue: '이름 바꾸기' }))}
          <div className="mx-2 my-1 border-t border-gray-700" />
          {menuItem(exportShelf, t('canvas.shelf.export', { defaultValue: '내보내기 (JSON)' }), {
            disabled: data.items.length === 0,
            ...(data.items.length === 0
              ? { title: t('canvas.shelf.exportEmptyHint', { defaultValue: '내보낼 항목이 없습니다' }) }
              : {}),
          })}
          {menuItem(importShelf, t('canvas.shelf.import', { defaultValue: '가져오기 (JSON)' }))}
          <div className="mx-2 my-1 border-t border-gray-700" />
          {menuItem(togglePin, isPinned
            ? t('canvas.shelf.unpin', { defaultValue: '고정 해제' })
            : t('canvas.shelf.pin', { defaultValue: '고정' }))}
          {menuItem(remove, t('canvas.shelf.delete', { defaultValue: '삭제' }), {
            danger: true,
            disabled: isPinned,
            ...(isPinned
              ? { title: t('canvas.shelf.deletePinnedHint', { defaultValue: '고정된 선반입니다. 먼저 고정을 해제하세요.' }) }
              : {}),
          })}
        </div>,
        document.body,
      )
    : null;

  const title = data.title.trim() || t('canvas.shelf.untitled', { defaultValue: '이름 없는 선반' });

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
          <ShelfGlyph />
          <span className="text-[12px] font-semibold uppercase tracking-wide text-white/70">
            {t('canvas.shelf.title', { defaultValue: '선반' })}
          </span>
          <span className="ml-auto rounded bg-black/25 px-1.5 py-0.5 text-[12px] text-white/70">
            {t('canvas.shelf.countBadge', { count: data.items.length, defaultValue: '{{count}}개' })}
          </span>
        </div>

        <div className="mt-1 line-clamp-1 text-[13px] font-semibold leading-tight">{title}</div>

        {/* 줄 목록 — 여기가 선반의 본체다. 넘치면 안에서 스크롤한다(§7.18). */}
        <div className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5 nowheel">
          {data.items.length === 0 ? (
            <div className="text-[12px] leading-snug text-white/70">
              {t('canvas.shelf.emptyHint', { defaultValue: '더블클릭해 자주 쓰는 명령·프롬프트를 올리세요' })}
            </div>
          ) : (
            data.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={(e) => { e.stopPropagation(); runItem(item); }}
                onMouseDown={(e) => e.stopPropagation()}
                title={item.kind === 'command' ? (item.command ?? '') : (item.prompt ?? '')}
                disabled={item.lastRun?.status === 'running'}
                className="flex items-center gap-1.5 rounded bg-black/25 px-1.5 py-1 text-left transition-colors hover:bg-black/45 disabled:cursor-progress"
              >
                <span className="shrink-0" style={{ color: item.color }}>
                  <ShelfItemGlyph name={item.icon} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white">{item.label}</span>
                <RunDot item={item} />
              </button>
            ))
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
