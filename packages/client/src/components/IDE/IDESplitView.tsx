import { Fragment, memo, useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { IDEMainArea } from './IDEMainArea.js';
import { IDESplitCellView, SplitDropPreview } from './IDESplitCell.js';
import { useIDESlotKey } from './ideSlot.js';
import { useIDEPaneValue } from './idePane.js';
import { splitterDeltaRatio } from './splitDrop.js';
import {
  IDE_SPLIT, cellCount, cellIdForSession, evenSplitSizes, listCells, moveSplitter, normalizeSizes,
  setBranchSizes, type SplitBranch, type SplitNode,
} from './splitLayout.js';
import { useSplitDrop } from './useSplitDrop.js';

/**
 * §5.5 #17-34 — IDE 창 **안**의 화면 분할.
 *
 * 분할이 없으면(`ideSplits` 에 항목이 없으면) 종전과 똑같이 `IDEMainArea` 한 벌만 그린다 —
 * 이 기능을 안 쓰는 사용자의 화면은 픽셀 단위로 같다. 세션 탭을 끌어다 본문 가장자리에 떨구는
 * 순간 그 자리가 갈라지고, 그때부터 칸마다 `IDEMainArea` 가 자기 세션을 그린다.
 */

interface IDESplitViewProps {
  agentId: string;
  isCustom: boolean;
}

/** 아직 안 나뉜 창 — 본문 전체가 하나의 드롭 자리다(첫 분할이 여기서 시작된다). */
function IDESplitRoot({
  slotKey, agentId, sessionId, children,
}: {
  slotKey: string;
  agentId: string;
  sessionId: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const { state, handlers } = useSplitDrop(slotKey, null, agentId, sessionId);
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragEnter={handlers.onDragEnter}
      onDragOver={handlers.onDragOver}
      onDragLeave={handlers.onDragLeave}
      onDrop={handlers.onDrop}
    >
      {children}
      <SplitDropPreview state={state} />
    </div>
  );
}

interface SplitTreeProps {
  slotKey: string;
  node: SplitNode;
  agentId: string;
  isCustom: boolean;
  focusedCellId: string | null;
  cellTotal: number;
}

function SplitTree(props: SplitTreeProps): React.JSX.Element {
  const { node, slotKey, agentId, isCustom, focusedCellId, cellTotal } = props;
  if (node.kind === 'cell') {
    return (
      <IDESplitCellView
        slotKey={slotKey}
        cell={node}
        agentId={agentId}
        isCustom={isCustom}
        focused={focusedCellId === node.id}
        cellTotal={cellTotal}
      />
    );
  }
  return (
    <SplitBranchView
      branch={node}
      slotKey={slotKey}
      agentId={agentId}
      isCustom={isCustom}
      focusedCellId={focusedCellId}
      cellTotal={cellTotal}
    />
  );
}

interface SplitBranchViewProps extends Omit<SplitTreeProps, 'node'> {
  branch: SplitBranch;
}

function SplitBranchView({
  branch, slotKey, agentId, isCustom, focusedCellId, cellTotal,
}: SplitBranchViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setLayout = useGraphStore((s) => s.setIDESplitLayout);
  // 드래그 중에 이 가지가 사라지면(옆 칸을 닫는 등) window 리스너가 남지 않게 걷어 둔다.
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { stopRef.current?.(); }, []);

  const startResize = useCallback((e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    const el = containerRef.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const total = branch.axis === 'row' ? rect.width : rect.height;
    const origin = branch.axis === 'row' ? e.clientX : e.clientY;
    // 시작 시점의 트리를 붙잡고 **처음부터의 이동량**으로 계산한다 — 프레임마다 증분을 더하면
    // 최소 비율에 부딪힌 뒤 손을 되돌려도 그만큼 늦게 반응하는(끈적이는) 손맛이 된다.
    const startLayout = useGraphStore.getState().ideSplits[slotKey]?.layout ?? null;
    if (!startLayout) return;
    // 끄는 동안 손끝을 붙잡아 둔다 — 칸 위를 지날 때마다 커서가 본문 것으로 바뀌고 지나간 자리의
    //   글자가 선택되면 "지금 크기를 조절하는 중"이라는 감각이 끊긴다.
    const { body } = document;
    const prevCursor = body.style.cursor;
    const prevSelect = body.style.userSelect;
    body.style.cursor = branch.axis === 'row' ? 'col-resize' : 'row-resize';
    body.style.userSelect = 'none';
    const onMove = (ev: PointerEvent): void => {
      const moved = (branch.axis === 'row' ? ev.clientX : ev.clientY) - origin;
      setLayout(slotKey, moveSplitter(startLayout, branch.id, index, splitterDeltaRatio(total, moved)));
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      body.style.cursor = prevCursor;
      body.style.userSelect = prevSelect;
      stopRef.current = null;
    };
    stopRef.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, [branch.axis, branch.id, slotKey, setLayout]);

  // 손잡이 더블클릭 = 이 가지의 칸들을 고르게. 한쪽으로 밀어붙인 뒤 되돌리는 가장 흔한 손동작이라
  //   따로 버튼을 만들지 않고 손잡이 자신이 받는다(VS Code·탐색기 창 나누기와 같은 관례).
  const equalize = useCallback(() => {
    const layout = useGraphStore.getState().ideSplits[slotKey]?.layout ?? null;
    if (!layout) return;
    setLayout(slotKey, setBranchSizes(layout, branch.id, evenSplitSizes(branch.children.length)));
  }, [slotKey, branch.id, branch.children.length, setLayout]);

  const sizes = useMemo(
    () => normalizeSizes(branch.sizes, branch.children.length),
    [branch.sizes, branch.children.length],
  );
  const row = branch.axis === 'row';

  return (
    <div
      ref={containerRef}
      className={`flex min-h-0 min-w-0 flex-1 ${row ? 'flex-row' : 'flex-col'}`}
    >
      {branch.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            // 보이는 띠는 4px 그대로, **잡히는 띠**는 양옆으로 넓힌다(안쪽 절대배치 자식이 포인터를
            //   받는다). 부모의 `:hover` 는 자식 위에서도 켜지므로 넓힌 만큼 파란 강조도 함께 뜬다.
            <div
              className="relative flex-shrink-0 flex-grow-0 bg-gray-800 transition-colors hover:bg-blue-500/70"
              style={{ flexBasis: `${String(IDE_SPLIT.splitterPx)}px` }}
            >
              <div
                role="separator"
                aria-orientation={row ? 'vertical' : 'horizontal'}
                title={t('ide.split.resizeHint')}
                onPointerDown={(e) => { startResize(e, i - 1); }}
                onDoubleClick={equalize}
                className={`absolute z-10 ${row ? 'inset-y-0 cursor-col-resize' : 'inset-x-0 cursor-row-resize'}`}
                style={row
                  ? { left: -IDE_SPLIT.splitterHitPadPx, right: -IDE_SPLIT.splitterHitPadPx }
                  : { top: -IDE_SPLIT.splitterHitPadPx, bottom: -IDE_SPLIT.splitterHitPadPx }}
              />
            </div>
          )}
          <div
            className="flex min-h-0 min-w-0 flex-col"
            style={{ flexBasis: `${String((sizes[i] ?? 0) * 100)}%`, flexGrow: 0, flexShrink: 1 }}
          >
            <SplitTree
              slotKey={slotKey}
              node={child}
              agentId={agentId}
              isCustom={isCustom}
              focusedCellId={focusedCellId}
              cellTotal={cellTotal}
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

export const IDESplitView = memo(function IDESplitView({
  agentId,
  isCustom,
}: IDESplitViewProps): React.JSX.Element {
  const slotKey = useIDESlotKey();
  const split = useGraphStore((s) => s.ideSplits[slotKey] ?? null);
  // 창이 다른 버블로 갈아 끼워졌으면 남아 있는 분할은 남의 것이다 — 못 본 척한다(자가 치유).
  const active = split && split.agentId === agentId ? split : null;
  // 세션 목록은 스냅샷마다 새 배열이라 그대로 의존하면 effect 가 매번 돈다 — id 문자열로 잰다.
  const subIdsKey = useGraphStore((s) => (s.subAgents[agentId] ?? []).map((x) => x.id).join('|'));
  const sync = useGraphStore((s) => s.syncIDESplitCells);
  const windowSession = useIDEPaneValue((o) => o.activeSessionId);
  const dropOnCellAction = useGraphStore((s) => s.dropSessionOnIDECell);

  // 닫힌·사라진 세션을 문 칸 걷어내기. 바뀐 게 없으면 스토어가 그대로 돌려보내 되풀이가 없다.
  useEffect(() => {
    if (!active) return;
    sync(slotKey, subIdsKey ? subIdsKey.split('|') : []);
  }, [active, slotKey, subIdsKey, sync]);

  // 밖에서 창의 세션이 바뀌었는데(탭 `+` 로 새 세션·북마크 점프·지휘통제실 [이동]) 그 세션을 띄운
  //   칸이 하나도 없으면 **탭바 강조와 화면이 서로 다른 말을** 한다. 초점 칸이 그 세션을 받아 안는다.
  //   진입점마다 따로 손보지 않고 여기 한 곳에서 맞추는 이유 = 부르는 곳이 계속 늘기 때문이다.
  useEffect(() => {
    if (!active) return;
    if (cellIdForSession(active.layout, windowSession)) return;
    const target = active.focusedCellId ?? listCells(active.layout)[0]?.id ?? null;
    if (target) dropOnCellAction(slotKey, target, 'center', windowSession);
  }, [active, windowSession, slotKey, dropOnCellAction]);

  if (!active) {
    return (
      <IDESplitRoot slotKey={slotKey} agentId={agentId} sessionId={windowSession}>
        <IDEMainArea agentId={agentId} isCustom={isCustom} />
      </IDESplitRoot>
    );
  }

  const total = cellCount(active.layout);
  const focused = active.focusedCellId ?? listCells(active.layout)[0]?.id ?? null;
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <SplitTree
        slotKey={slotKey}
        node={active.layout}
        agentId={agentId}
        isCustom={isCustom}
        focusedCellId={focused}
        cellTotal={total}
      />
    </div>
  );
});
