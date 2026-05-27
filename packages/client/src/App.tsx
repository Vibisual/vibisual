import { useEffect } from 'react';
import { Header } from './components/Layout/Header.js';
import { BubbleMap } from './components/BubbleMap/BubbleMap.js';
import { CanvasBreadcrumb } from './components/BubbleMap/CanvasBreadcrumb.js';
import { IframeView } from './components/Layout/IframeView.js';
import { DetailPanel } from './components/Panel/DetailPanel.js';
import { DebugPanel } from './components/Panel/DebugPanel.js';
import { InspectorOverlay } from './components/Inspector/InspectorOverlay.js';
import { WorktreeDeleteDialog } from './components/Panel/WorktreeDeleteDialog.js';
import { StubProjectPlaceholder } from './components/Layout/StubProjectPlaceholder.js';
import { PermissionPromptStack } from './components/PermissionPrompt/PermissionPromptStack.js';
import { ClaudeVersionGate } from './components/Panel/ClaudeVersionGate.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useGraphStore, selectIDEOverlay } from './stores/graphStore.js';
import { WS_PATH } from '@vibisual/shared';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;

export function App(): React.JSX.Element {
  const { status } = useWebSocket(WS_URL);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectedTaskEdgeId = useGraphStore((s) => s.selectedTaskEdgeId);
  const selectedCommentBoxId = useGraphStore((s) => s.selectedCommentBoxId);
  const agentPhase = useGraphStore((s) => s.agentPhase);
  const debugMode = useGraphStore((s) => s.debugMode);
  const activeIframeId = useGraphStore((s) => s.activeIframeId);
  const iframeTabs = useGraphStore((s) => s.iframeTabs);

  const activeProject = useGraphStore((s) => s.activeProject);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  const hydratingProjects = useGraphStore((s) => s.hydratingProjects);

  const activeIframeTab = activeIframeId
    ? iframeTabs.find((t) => t.id === activeIframeId)
    : undefined;

  const activeIsStub = activeProject !== null && !!stubProjects[activeProject];

  // §5.5 #17-1 — 활성 탭의 IDE 가 우측 도킹이면 그 폭만큼 메인 캔버스를 축소(오버랩 X, 나란히).
  // IframeView 가 떠있으면 BubbleMap 이 언마운트되어 IDE 도 안 보이므로 축소 불필요.
  const ideDocked = useGraphStore((s) => selectIDEOverlay(s).dockedRight);
  const ideDockWidth = useGraphStore((s) => selectIDEOverlay(s).dockWidth);
  const shrinkForDock = ideDocked && !activeIframeTab;

  // 전역 `fixed inset-0` 모달(AgentConfigPopup 등)도 도크 영역을 침범하지 않도록 body 에 신호 + CSS 변수.
  useEffect(() => {
    if (shrinkForDock) {
      document.body.dataset.ideDock = 'right';
      document.body.style.setProperty('--ide-dock-width', `${ideDockWidth}px`);
    } else {
      delete document.body.dataset.ideDock;
      document.body.style.removeProperty('--ide-dock-width');
    }
  }, [shrinkForDock, ideDockWidth]);

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-950">
      <Header connectionStatus={status} agentPhase={agentPhase} />
      <div className="relative flex flex-1 overflow-hidden">
        {debugMode && (
          <DebugPanel onClose={() => useGraphStore.getState().toggleDebug()} />
        )}
        <main
          className="relative flex-1"
          style={shrinkForDock ? { marginRight: ideDockWidth } : undefined}
        >
          {activeIframeTab ? (
            <IframeView url={activeIframeTab.url} tabId={activeIframeTab.id} />
          ) : activeIsStub ? (
            <StubProjectPlaceholder
              projectName={activeProject}
              hydrating={!!hydratingProjects[activeProject]}
              onLoad={() => useGraphStore.getState().hydrateProject(activeProject)}
            />
          ) : (
            <>
              <BubbleMap />
              <CanvasBreadcrumb />
            </>
          )}
        </main>
        {(selectedNodeId !== null || selectedTaskEdgeId !== null || selectedCommentBoxId !== null) && !activeIframeTab && (
          <DetailPanel
            onClose={() => {
              const s = useGraphStore.getState();
              s.selectNode(null);
              s.selectTaskEdge(null);
              s.selectCommentBox(null);
            }}
          />
        )}
      </div>
      <InspectorOverlay />
      <WorktreeDeleteDialog />
      <PermissionPromptStack />
      <ClaudeVersionGate />
    </div>
  );
}
