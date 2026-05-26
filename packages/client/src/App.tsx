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
import { useGraphStore } from './stores/graphStore.js';
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

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-950">
      <Header connectionStatus={status} agentPhase={agentPhase} />
      <div className="relative flex flex-1 overflow-hidden">
        {debugMode && (
          <DebugPanel onClose={() => useGraphStore.getState().toggleDebug()} />
        )}
        <main className="relative flex-1">
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
