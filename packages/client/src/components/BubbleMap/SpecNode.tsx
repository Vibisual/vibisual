import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from '@xyflow/react';
import { BUBBLE_STYLES } from '@vibisual/shared';
import type { SpecItem } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * §5.15 — 스펙 표지 버블.
 *
 * 캡처·앱·플레이 버블과 같은 "사용자가 만든 독립 캔버스 요소"다. 캔버스에서는 **표지만** 보여
 * 준다(제목·수용 기준 진행·낡은 카드 수). 본문을 읽고 고치는 것은 더블클릭으로 열리는
 * 스펙 보드 패널의 몫이다 — 캔버스는 지도이지 편집기가 아니다.
 */

export interface SpecNodeData extends Record<string, unknown> {
  specDocId: string;
  projectName: string;
  width: number;
  height: number;
  title: string;
  items: SpecItem[];
  bodyRevision: number;
  preservePinned?: boolean | undefined;
}

interface MenuPos {
  x: number;
  y: number;
}

const STYLE = BUBBLE_STYLES.spec;

function SpecGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="m8.5 13.5 1.5 1.5 3-3" />
      <path d="M8.5 18h7" />
    </svg>
  );
}

function StaleGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

export const SpecNode = memo(function SpecNode({
  data,
  selected,
}: NodeProps & { data: SpecNodeData }): React.JSX.Element {
  const { t } = useTranslation();
  const selectSpecDoc = useGraphStore((s) => s.selectSpecDoc);
  const selectedSpecDocId = useGraphStore((s) => s.selectedSpecDocId);
  const openSpecBoard = useGraphStore((s) => s.openSpecBoard);
  const updateSpecDoc = useGraphStore((s) => s.updateSpecDoc);
  const patchLocal = useGraphStore((s) => s.patchSpecDocLocal);
  const addSpecItem = useGraphStore((s) => s.addSpecItem);
  const generateSpecTasks = useGraphStore((s) => s.generateSpecTasks);
  const deleteSpecDoc = useGraphStore((s) => s.deleteSpecDoc);

  const [menu, setMenu] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const isSelected = selected === true || selectedSpecDocId === data.specDocId;
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

  const counts = useMemo(() => {
    const total = data.items.length;
    let done = 0;
    let carded = 0;
    let stale = 0;
    for (const it of data.items) {
      if (it.done === true) done += 1;
      if (it.taskAgentId) {
        carded += 1;
        // 서버가 준 두 숫자의 비교뿐 — 판정 로직은 서버 값이 전부다(§3.1 View 전용).
        if ((it.generatedRevision ?? 0) < data.bodyRevision) stale += 1;
      }
    }
    return { total, done, carded, stale, pending: total - carded };
  }, [data.items, data.bodyRevision]);

  /**
   * 선택 — 플레이·앱 버블과 같은 규칙, 같은 함정.
   * 드래그 래퍼의 `d3-drag` 가 mousedown 에서 전파를 끊으므로 캡처 단계로 받는다.
   */
  const handleSelect = useCallback((e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest?.('button')) return;
    selectSpecDoc(data.specDocId);
  }, [selectSpecDoc, data.specDocId]);

  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    selectSpecDoc(data.specDocId);
    setMenu({ x: e.clientX, y: e.clientY });
  }, [selectSpecDoc, data.specDocId]);

  const handleOpen = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    selectSpecDoc(data.specDocId);
    openSpecBoard(data.specDocId);
  }, [openSpecBoard, selectSpecDoc, data.specDocId]);

  const rename = useCallback((): void => {
    setMenu(null);
    const next = window.prompt(t('canvas.spec.renamePrompt', { defaultValue: '스펙 제목' }), data.title);
    if (next === null) return;
    const title = next.trim();
    patchLocal(data.specDocId, { title });
    void updateSpecDoc(data.specDocId, { title });
  }, [t, data.title, data.specDocId, patchLocal, updateSpecDoc]);

  const addItem = useCallback((): void => {
    setMenu(null);
    const next = window.prompt(t('canvas.spec.addItemPrompt', { defaultValue: '수용 기준 한 줄' }), '');
    if (next === null) return;
    const text = next.trim();
    if (!text) return;
    void addSpecItem(data.specDocId, text);
  }, [t, data.specDocId, addSpecItem]);

  const generate = useCallback((): void => {
    setMenu(null);
    if (counts.pending === 0) return;
    setBusy(true);
    void generateSpecTasks(data.specDocId).finally(() => setBusy(false));
  }, [counts.pending, generateSpecTasks, data.specDocId]);

  const togglePin = useCallback((): void => {
    setMenu(null);
    const next = !isPinned;
    patchLocal(data.specDocId, { preservePinned: next });
    void updateSpecDoc(data.specDocId, { preservePinned: next });
  }, [isPinned, data.specDocId, patchLocal, updateSpecDoc]);

  const remove = useCallback((): void => {
    setMenu(null);
    void deleteSpecDoc(data.specDocId);
  }, [deleteSpecDoc, data.specDocId]);

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
            openSpecBoard(data.specDocId);
          }, t('canvas.spec.openBoard', { defaultValue: '스펙 보드 열기' }))}
          {menuItem(rename, t('canvas.spec.rename', { defaultValue: '이름 바꾸기' }))}
          {menuItem(addItem, t('canvas.spec.addItem', { defaultValue: '수용 기준 추가' }))}
          {menuItem(generate, t('canvas.spec.generateTasks', { defaultValue: '작업 카드 만들기' }), {
            disabled: counts.pending === 0,
            ...(counts.pending === 0
              ? { title: t('canvas.spec.generateNoneHint', { defaultValue: '카드가 없는 수용 기준이 없습니다' }) }
              : {}),
          })}
          {menuItem(togglePin, isPinned
            ? t('canvas.spec.unpin', { defaultValue: '고정 해제' })
            : t('canvas.spec.pin', { defaultValue: '고정' }))}
          <div className="mx-2 my-1 border-t border-gray-700" />
          {menuItem(remove, t('canvas.spec.delete', { defaultValue: '삭제' }), {
            danger: true,
            disabled: isPinned,
            ...(isPinned
              ? { title: t('canvas.spec.deletePinnedHint', { defaultValue: '고정된 스펙입니다. 먼저 고정을 해제하세요.' }) }
              : {}),
          })}
        </div>,
        document.body,
      )
    : null;

  const title = data.title.trim() || t('canvas.spec.untitled', { defaultValue: '제목 없는 스펙' });

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
          <SpecGlyph />
          <span className="text-[12px] font-semibold uppercase tracking-wide text-white/70">
            {t('canvas.spec.title', { defaultValue: '스펙' })}
          </span>
          <span className="ml-auto rounded bg-black/25 px-1.5 py-0.5 text-[12px] text-white/70">
            r{data.bodyRevision}
          </span>
        </div>

        <div className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-tight">{title}</div>

        <div className="mt-auto flex flex-col gap-1">
          {/* 수용 기준 진행 — 사람이 손으로 체크한 것만 센다(카드 생성과 별개 축). */}
          <div className="flex items-center gap-1.5 text-[12px] text-white/80">
            <span>{t('canvas.spec.criteria', { defaultValue: '수용 기준' })}</span>
            <span className="font-semibold">{counts.done}/{counts.total}</span>
            <span className="ml-auto text-white/60">
              {t('canvas.spec.cards', { defaultValue: '카드' })} {counts.carded}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-black/30">
            <div
              className="h-full rounded-full bg-teal-200"
              style={{ width: `${counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100)}%` }}
            />
          </div>
          {counts.stale > 0 ? (
            <div className="flex items-center gap-1 text-[12px] font-semibold text-amber-200">
              <StaleGlyph />
              <span>{t('canvas.spec.staleCount', { count: counts.stale, defaultValue: '스펙 변경됨 {{count}}' })}</span>
            </div>
          ) : busy ? (
            <div className="text-[12px] text-white/70">{t('canvas.spec.generating', { defaultValue: '작업 카드 만드는 중…' })}</div>
          ) : counts.pending > 0 ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); generate(); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="rounded bg-black/25 px-2 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-black/40"
            >
              {t('canvas.spec.generateTasksN', { count: counts.pending, defaultValue: '작업 카드 만들기 ({{count}})' })}
            </button>
          ) : null}
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
