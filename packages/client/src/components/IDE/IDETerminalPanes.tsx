import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CMD_PANE_MAX,
  CMD_PANE_RATIO_MAX,
  CMD_PANE_RATIO_MIN,
  closeCmdPane,
  cmdPaneTermId,
  collectCmdPaneIds,
  sanitizeCmdPaneTree,
  splitCmdPane,
  type CmdPaneNode,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { getTerminalTransport } from '../../transport/terminalTransport.js';
import { IDETerminalView } from './IDETerminalView.js';

// §4 (CMD 터미널 업그레이드 ⑤) — 세션 탭 **안**의 pane 분할 컨테이너.
//
// herdr 이 tmux 에서 가져온 것 중 우리에게 없던 것이 pane 이다. 종전 CMD 탭은 탭 1개 = PTY 1개라
// "빌드 돌려 두고 옆에서 로그 보기"를 하려면 탭을 오가야 했다.
//
// 새 실행 레일을 만들지 않는다 — `termId` 에 `#<paneId>` 한 토큰이 붙으면 desktop 의 PTY 는
// 그냥 하나 더 뜬다. 그래서 이 파일이 하는 일은 **레이아웃과 트리 편집뿐**이고, 터미널 자체는
// 기존 `IDETerminalView` 를 pane 마다 반복 렌더한다.
//
// 트리는 그 세션 탭의 표시 상태라 서버(`PUT /api/cmd-pane-tree`)가 들고 체크포인트에 실린다.
// 화면은 서버 값을 그대로 보되, 사용자가 방금 만진 결과는 **낙관 오버라이드**로 먼저 보여 준다
// (드래그 리사이즈는 프레임마다 일어나므로 매번 서버를 왕복할 수 없다).

interface IDETerminalPanesProps {
  agentId: string;
  sessionId: string | null;
}

/**
 * 낙관 오버라이드. **바깥 `null` = 오버라이드 없음(서버 값을 본다)**, 안쪽 `tree: null` =
 * "분할 없음(단일 pane)" 이다.
 *
 * 두 의미를 하나의 `null` 로 합치면 **마지막 pane 을 닫는 순간 서버의 옛 분할 트리가 되살아나**
 * 화면이 되돌아간다. 감싸는 객체 한 겹이 그 구분을 만든다.
 */
type PaneOverride = { tree: CmdPaneNode | null } | null;

/** 트리에 없는 새 pane id 발급 — 숫자 문자열을 1씩 올려 빈 자리를 찾는다. */
function nextPaneId(tree: CmdPaneNode | null): string {
  const used = new Set(collectCmdPaneIds(tree));
  for (let i = 1; i < CMD_PANE_MAX + 2; i += 1) {
    const id = String(i);
    if (!used.has(id)) return id;
  }
  return String(Date.now() % 100000);
}

export function IDETerminalPanes({ agentId, sessionId }: IDETerminalPanesProps): React.JSX.Element {
  // 서버가 들고 있는 트리(스냅샷). 세션 탭이 없는 메인 탭은 항상 단일 pane 이다.
  const serverTree = useGraphStore((s) => {
    if (!sessionId) return null;
    const subs = s.subAgents[agentId];
    return subs?.find((x) => x.id === sessionId)?.paneTree ?? null;
  });

  const [override, setOverride] = useState<PaneOverride>(null);
  const [zoomPane, setZoomPane] = useState<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const tree = override ? override.tree : serverTree;
  const paneIds = useMemo(() => collectCmdPaneIds(tree), [tree]);
  const paneCount = paneIds.length;

  // 서버가 새 트리를 흘려 주면 낙관 오버라이드를 놓아준다(서버가 SSOT — §3.1).
  //   드래그 중에는 서버로 보내지 않으므로 `serverTree` 가 바뀌지 않아 오버라이드가 뺏기지 않는다.
  useEffect(() => { setOverride(null); }, [serverTree]);

  // zoom 대상이 사라졌으면(그 pane 을 닫았으면) 확대를 푼다.
  useEffect(() => {
    if (zoomPane && !paneIds.includes(zoomPane)) setZoomPane(null);
  }, [zoomPane, paneIds]);

  const pushTree = useCallback((next: CmdPaneNode | null, immediate: boolean) => {
    if (!sessionId) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    const send = (): void => {
      void fetch('/api/cmd-pane-tree', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subAgentId: sessionId, tree: next ? sanitizeCmdPaneTree(next) : null }),
      }).catch(() => { /* 표시 상태 — 실패해도 화면은 오버라이드로 동작 */ });
    };
    if (immediate) send();
    else pushTimer.current = setTimeout(send, 250);
  }, [sessionId]);

  useEffect(() => () => { if (pushTimer.current) clearTimeout(pushTimer.current); }, []);

  const handleSplit = useCallback((targetPaneId: string, dir: 'row' | 'column') => {
    if (paneCount >= CMD_PANE_MAX) return;
    const next = splitCmdPane(tree, targetPaneId, nextPaneId(tree), dir);
    setOverride({ tree: next });
    pushTree(next, true);
  }, [tree, paneCount, pushTree]);

  const handleClosePane = useCallback((targetPaneId: string) => {
    const next = closeCmdPane(tree, targetPaneId);
    setOverride({ tree: next });
    pushTree(next, true);
    // 닫은 pane 의 PTY 도 함께 회수한다 — 남겨 두면 화면에 없는 셸이 계속 돈다.
    //   (탭 전환·IDE 닫기는 화면에서 사라질 뿐 살아 있어야 하지만, pane 닫기는 **명시 종료**다.)
    const transport = getTerminalTransport();
    if (transport && sessionId) {
      void transport.kill(cmdPaneTermId(`term:${agentId}:${sessionId}`, targetPaneId));
    }
  }, [tree, pushTree, agentId, sessionId]);

  const handleToggleZoom = useCallback((targetPaneId: string) => {
    setZoomPane((cur) => (cur === targetPaneId ? null : targetPaneId));
  }, []);

  const handleResize = useCallback((firstLeafId: string, ratio: number) => {
    setOverride((cur) => {
      const base = cur ? cur.tree : serverTree;
      if (!base) return cur; // 분할이 없으면 옮길 경계선도 없다.
      return { tree: applyRatio(base, firstLeafId, ratio) };
    });
  }, [serverTree]);

  const handleResizeEnd = useCallback(() => {
    setOverride((cur) => { if (cur) pushTree(cur.tree, true); return cur; });
  }, [pushTree]);

  const renderLeaf = useCallback((id: string) => (
    <IDETerminalView
      key={`pane:${id}`}
      agentId={agentId}
      sessionId={sessionId}
      paneId={id}
      onSplit={sessionId ? handleSplit : undefined}
      onClosePane={sessionId ? handleClosePane : undefined}
      onToggleZoom={sessionId ? handleToggleZoom : undefined}
      zoomed={zoomPane === id}
      paneCount={paneCount}
    />
  ), [agentId, sessionId, handleSplit, handleClosePane, handleToggleZoom, zoomPane, paneCount]);

  // zoom — 한 pane 만 그린다. 다른 pane 의 xterm 은 언마운트되지만 **PTY 는 살아 있다**
  // (§4 v2.63: unmount 는 kill 이 아니다) → 확대를 풀면 reattach + replay 로 그대로 돌아온다.
  const node: CmdPaneNode = zoomPane && paneCount > 1
    ? { type: 'leaf', id: zoomPane }
    : (tree ?? { type: 'leaf', id: '0' });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PaneNode
        node={node}
        renderLeaf={renderLeaf}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
      />
    </div>
  );
}

/** split 노드를 **그 첫 자식의 첫 leaf id** 로 식별해 비율만 갈아 끼운다(leaf id 는 트리 안에서 유일). */
function applyRatio(node: CmdPaneNode, firstLeafId: string, ratio: number): CmdPaneNode {
  if (node.type === 'leaf') return node;
  const clamped = Math.max(CMD_PANE_RATIO_MIN, Math.min(CMD_PANE_RATIO_MAX, ratio));
  const head = collectCmdPaneIds(node.children[0])[0];
  const children: [CmdPaneNode, CmdPaneNode] = [
    applyRatio(node.children[0], firstLeafId, ratio),
    applyRatio(node.children[1], firstLeafId, ratio),
  ];
  return head === firstLeafId ? { ...node, ratio: clamped, children } : { ...node, children };
}

interface PaneNodeProps {
  node: CmdPaneNode;
  renderLeaf: (id: string) => React.JSX.Element;
  onResize: (firstLeafId: string, ratio: number) => void;
  onResizeEnd: () => void;
}

function PaneNode({ node, renderLeaf, onResize, onResizeEnd }: PaneNodeProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  if (node.type === 'leaf') {
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{renderLeaf(node.id)}</div>;
  }

  const isRow = node.dir === 'row';
  const firstLeafId = collectCmdPaneIds(node.children[0])[0] ?? '0';

  // 경계선 드래그 — pointer capture 로 커서가 xterm 위로 들어가도 이벤트를 놓치지 않는다.
  //   capture 는 **경계선 엘리먼트 자신**에 건다(e.target 은 캡처 중 바뀔 수 있다).
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const ratio = isRow
      ? (e.clientX - rect.left) / Math.max(1, rect.width)
      : (e.clientY - rect.top) / Math.max(1, rect.height);
    onResize(firstLeafId, ratio);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onResizeEnd();
  };

  return (
    <div ref={hostRef} className={`flex min-h-0 min-w-0 flex-1 ${isRow ? 'flex-row' : 'flex-col'}`}>
      <div className="flex min-h-0 min-w-0 flex-col" style={{ flex: `${node.ratio} 1 0%` }}>
        <PaneNode node={node.children[0]} renderLeaf={renderLeaf} onResize={onResize} onResizeEnd={onResizeEnd} />
      </div>
      <div
        role="separator"
        aria-orientation={isRow ? 'vertical' : 'horizontal'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // §4 (CMD) — 종전에는 이 자리가 회색 실선이었다. 이제 pane 마다 자기 테두리가 있어
        //   실선을 그대로 두면 경계에 선이 두 겹으로 겹친다 → 평소엔 비우고 **잡을 때만** 보인다.
        className={`shrink-0 bg-transparent transition-colors hover:bg-teal-500/50 ${
          isRow ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'
        }`}
      />
      <div className="flex min-h-0 min-w-0 flex-col" style={{ flex: `${1 - node.ratio} 1 0%` }}>
        <PaneNode node={node.children[1]} renderLeaf={renderLeaf} onResize={onResize} onResizeEnd={onResizeEnd} />
      </div>
    </div>
  );
}
