import { memo, useCallback, useMemo, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { SESSION_STATUS_DOT, sessionRunStateOf, serializeBusySubIds, parseBusySubIds } from '../../utils/sessionStatus.js';
import { IDEMainArea } from './IDEMainArea.js';
import { IDESplitCellContext, type IDESplitCellValue } from './splitCellContext.js';
import {
  SESSION_DRAG_MIME, SPLIT_CELL_DRAG_MIME, encodeSessionDrag, sessionIdMime, sessionOwnerMime,
  splitDropLabelKey,
} from './splitDrop.js';
import { IDE_SPLIT, type SplitCell } from './splitLayout.js';
import { previewBoxStyle, useSplitDrop, type SplitDropState } from './useSplitDrop.js';
import { useIDEPaneActions } from './idePane.js';

/**
 * §5.5 #17-34 — 칸 하나. 머리띠(무엇을 보고 있는가 + 옮기는 손잡이 + 닫기) 위에 본문 한 벌.
 *
 * 본문은 종전 `IDEMainArea` **그대로**다 — 분할을 위해 새 대화 화면을 만들지 않는다. 칸은 자기 세션을
 * 컨텍스트로 깔아 주고(`splitCellContext`), 본문은 그걸 읽어 그 세션을 그린다.
 */

const EMPTY_SUBS: SubAgent[] = [];

/**
 * 손을 떼면 앉을 자리를 그리는 파란 박스 — #17-1 도킹 미리보기와 같은 시각 언어.
 * 막힌 자리는 호박색 + **왜 막혔는지**. 칸과 "아직 안 나뉜 창"이 이 하나를 함께 쓴다(문구가 갈리면
 * 같은 상황에서 화면마다 다른 말을 하게 된다).
 */
export function SplitDropPreview({ state }: { state: SplitDropState }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!state.side || !state.box) return null;
  const tone = state.blocked
    ? 'border-amber-400/70 bg-amber-400/10 text-amber-100'
    : 'border-blue-400/70 bg-blue-400/15 text-blue-50';
  return (
    <div
      className={`pointer-events-none absolute z-40 flex items-center justify-center rounded border-2 ${tone}`}
      style={previewBoxStyle(state.box)}
    >
      <span className="rounded bg-gray-950/70 px-2 py-1 text-xs font-semibold">
        {t(splitDropLabelKey(state.side, state.blocked), { count: IDE_SPLIT.maxCells })}
      </span>
    </div>
  );
}

interface IDESplitCellViewProps {
  slotKey: string;
  cell: SplitCell;
  agentId: string;
  isCustom: boolean;
  focused: boolean;
  /** 이 창이 지금 몇 칸인가 — [분할 해제] 노출 판정. */
  cellTotal: number;
}

export const IDESplitCellView = memo(function IDESplitCellView({
  slotKey,
  cell,
  agentId,
  isCustom,
  focused,
  cellTotal,
}: IDESplitCellViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const { state: dropState, handlers } = useSplitDrop(slotKey, cell.id, agentId, cell.sessionId);
  const focusCell = useGraphStore((s) => s.focusIDESplitCell);
  const closeCell = useGraphStore((s) => s.closeIDESplitCell);
  const resetSplit = useGraphStore((s) => s.resetIDESplit);
  const { setSession } = useIDEPaneActions();
  const subAgents = useGraphStore((s) => s.subAgents[agentId] ?? EMPTY_SUBS);
  const subAgentLabels = useGraphStore((s) => s.subAgentLabels);
  const acknowledged = useGraphStore((s) => s.acknowledgedSubAgents);
  // 도트 색은 탭바와 **같은 표**를 쓴다(사본 ❌ — 같은 세션이 자리마다 다른 색이면 안 된다).
  const busySubKey = useGraphStore((s) => serializeBusySubIds(s.runningSubagentTasks[agentId]));
  const busySubIds = useMemo(() => parseBusySubIds(busySubKey), [busySubKey]);

  const sub = cell.sessionId === null ? null : subAgents.find((s) => s.id === cell.sessionId) ?? null;
  const label = cell.sessionId === null
    ? t('ide.tabbar.agentTabLabel')
    : subAgentLabels[cell.sessionId] ?? sub?.label ?? cell.sessionId;
  const dot = sub
    ? SESSION_STATUS_DOT[sessionRunStateOf(sub, !!acknowledged[sub.id], busySubIds.has(sub.id))]
    : 'bg-gray-400';

  // 칸 안 아무 데나 누르면 그 칸이 초점을 갖고, 탭바·사이드바·상태바가 그 세션을 따라본다.
  const handleFocus = useCallback(() => {
    if (focused) return;
    focusCell(slotKey, cell.id);
    setSession(cell.sessionId);
  }, [focused, focusCell, setSession, slotKey, cell.id, cell.sessionId]);

  const handleDragStart = useCallback((e: DragEvent<HTMLElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    // Firefox 는 짐이 하나도 없으면 드래그를 시작하지 않는다 — text/plain 을 함께 싣는다.
    e.dataTransfer.setData('text/plain', encodeSessionDrag(cell.sessionId));
    e.dataTransfer.setData(SESSION_DRAG_MIME, encodeSessionDrag(cell.sessionId));
    // 출처 칸을 함께 실어 "복제"가 아니라 "옮기기"로 읽히게 한다.
    e.dataTransfer.setData(SPLIT_CELL_DRAG_MIME, cell.id);
    // 누구의 세션인지도 **종류로** 싣는다 — 옆 창은 이걸 보고 dragover 단계에서 이미 거절한다.
    e.dataTransfer.setData(sessionOwnerMime(agentId), '1');
    // 어느 세션인지도 종류로 — 이미 그것을 보여 주는 칸은 파란 박스를 띄우지 않는다.
    e.dataTransfer.setData(sessionIdMime(cell.sessionId), '1');
  }, [cell.sessionId, cell.id, agentId]);

  const value = useMemo<IDESplitCellValue>(
    () => ({ cellId: cell.id, sessionId: cell.sessionId, focused }),
    [cell.id, cell.sessionId, focused],
  );

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      onMouseDownCapture={handleFocus}
      onDragEnter={handlers.onDragEnter}
      onDragOver={handlers.onDragOver}
      onDragLeave={handlers.onDragLeave}
      onDrop={handlers.onDrop}
    >
      <div
        draggable
        onDragStart={handleDragStart}
        title={`${label} — ${t('ide.split.dragHint')}`}
        className={`flex h-7 flex-shrink-0 cursor-grab select-none items-center gap-1.5 border-b px-2 text-xs transition-colors active:cursor-grabbing ${
          focused
            ? 'border-b-blue-400 bg-gray-800 text-gray-100'
            : 'border-b-gray-700 bg-gray-900/60 text-gray-400 hover:text-gray-300'
        }`}
      >
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {focused && cellTotal >= 2 && (
          <button
            type="button"
            onClick={() => { resetSplit(slotKey); }}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-600/50 hover:text-gray-200"
            aria-label={t('ide.split.reset')}
            title={t('ide.split.reset')}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 9l6 6" />
              <path d="M15 9l-6 6" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => { closeCell(slotKey, cell.id); }}
          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-600/50 hover:text-gray-200"
          aria-label={t('ide.split.closeCell')}
          title={t('ide.split.closeCell')}
        >
          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <IDESplitCellContext.Provider value={value}>
          <IDEMainArea agentId={agentId} isCustom={isCustom} />
        </IDESplitCellContext.Provider>
      </div>
      <SplitDropPreview state={dropState} />
    </div>
  );
});
