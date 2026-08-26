import { useEffect, useCallback } from 'react';
import { useDetachedSync } from './hooks/useDetachedSync.js';
import { useOverlaySync } from './hooks/useOverlaySync.js';
import { useOverlayReveal } from './hooks/useOverlayReveal.js';
import { useCommandCenterReveal } from './hooks/useCommandCenterReveal.js';
import { useMobileBackAsEscape } from './hooks/useMobileBackAsEscape.js';
import { useLowPowerMode } from './hooks/useIsMobile.js';
import { Header } from './components/Layout/Header.js';
import { BubbleMap } from './components/BubbleMap/BubbleMap.js';
import { CanvasBreadcrumb } from './components/BubbleMap/CanvasBreadcrumb.js';
import { TrashToolbar } from './components/BubbleMap/TrashToolbar.js';
import { IframeView } from './components/Layout/IframeView.js';
import { DetailPanel } from './components/Panel/DetailPanel.js';
import { BrainLibraryOverlay } from './components/Panel/BrainLibraryOverlay.js';
import { DebugPanel } from './components/Panel/DebugPanel.js';
import { WorktreeDeleteDialog } from './components/Panel/WorktreeDeleteDialog.js';
import { MediaConvertDialog } from './components/IDE/MediaConvertDialog.js';
import { TrashPurgeDialog } from './components/Panel/TrashPurgeDialog.js';
import { LocalModelWindow } from './components/LocalModel/LocalModelWindow.js';
import { StubProjectPlaceholder } from './components/Layout/StubProjectPlaceholder.js';
import { PermissionPromptStack } from './components/PermissionPrompt/PermissionPromptStack.js';
import { ClaudeVersionGate } from './components/Panel/ClaudeVersionGate.js';
import { LoginWindow } from './components/Auth/LoginWindow.js';
import { ClaudeSetupGate, ClaudeSetupBanner } from './components/Auth/ClaudeSetupGate.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useGraphStore } from './stores/graphStore.js';
import { useIDEDockLayout } from './components/IDE/useIDEDockLayout.js';
import { WS_PATH } from '@vibisual/shared';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;

export function App(): React.JSX.Element {
  const { status } = useWebSocket(WS_URL);
  // SCENARIO.md §5.4 #14-1 (v2.29) — desktop main 의 detached BrowserWindow 목록을 store 와 sync.
  useDetachedSync();
  // SCENARIO.md §5.5 #17-6 (v2.73) — 오버레이 위젯 창 목록 + 전역 토글 상태를 store 와 sync.
  useOverlaySync();
  // SCENARIO.md §5.5 #17-6 (G) v2.82 — 오버레이 버블 우클릭 "본체로 점프" 신호 수신(메인 윈도우 한정).
  useOverlayReveal();
  // SCENARIO.md §5.12 (D) v4.43 — 지휘통제실 카드 [이동] 신호 수신(메인 윈도우 한정).
  useCommandCenterReveal();
  // §4 v3.16 — 모바일 웹 브라우저의 back 버튼을 ESC(오버레이·팝업 닫기)처럼 동작시켜 앱 이탈 방지.
  useMobileBackAsEscape();
  // §4 v3.39 — 모바일/터치·'동작 줄이기'면 저전력 클래스를 root 에 걸어 상시 GPU 부하(애니메이션
  // 엣지·pulse/ping·backdrop-blur)를 index.css 에서 끈다(폰 발열 억제). 데스크톱엔 미적용.
  const lowPower = useLowPowerMode();
  useEffect(() => {
    const cls = 'vibisual-low-power';
    document.documentElement.classList.toggle(cls, lowPower);
    return () => document.documentElement.classList.remove(cls);
  }, [lowPower]);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectedTaskEdgeId = useGraphStore((s) => s.selectedTaskEdgeId);
  const selectedCommentBoxId = useGraphStore((s) => s.selectedCommentBoxId);
  const selectedCaptureBubbleId = useGraphStore((s) => s.selectedCaptureBubbleId);
  // §5.13 (M) v4.68 — 앱 버블도 선택하면 우측 옵션 패널이 뜬다(캡처 버블과 같은 자리).
  const selectedAppBubbleId = useGraphStore((s) => s.selectedAppBubbleId);
  const selectedBrainCardId = useGraphStore((s) => s.selectedBrainCardId);
  // §5.10 v3.49 — 기억 피드 오버레이가 열려 있으면 카드 상세는 오버레이 우측 pane 이 담당(App DetailPanel 은 억제).
  const brainFeedOpen = useGraphStore((s) => s.brainFeed !== null);
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

  // §5.5 #17-1 — 활성 탭의 IDE 창들이 붙어 있는 **네 변**만큼 메인 캔버스를 축소(오버랩 X, 나란히).
  // IframeView 가 떠있으면 BubbleMap 이 언마운트되어 IDE 도 안 보이므로 축소 불필요.
  // 자리를 비우는 판정은 도킹 비트가 아니라 **그 IDE 가 실제로 그려지는가**로 — 창들의 자리를 내는
  //   `useIDEDockLayout` 을 창 자신도 함께 읽는다(같은 산식).
  //   슬롯의 에이전트가 스냅샷에서 사라지면 AgentIDEOverlay 는 null 을 반환하는데, 종전 판정은 그때도
  //   도크 폭만큼 캔버스를 잘라 "IDE 없는 빈 칸"이 화면을 가렸다(북마크 숫자키 점프 뒤 사용자 보고).
  const { insets: dockInsets } = useIDEDockLayout();
  const shrinkForDock = !activeIframeTab
    && (dockInsets.left > 0 || dockInsets.right > 0 || dockInsets.top > 0 || dockInsets.bottom > 0);

  // 도크 폭은 여기 `main` 의 marginRight 로만 반영한다 — 전역 `fixed inset-0` 모달/팝업까지 도크를
  //   피해 줄이던 body 신호(data-ide-dock·--ide-dock-width)는 폐기했다. 전면 오버레이는 도킹 여부와
  //   무관하게 창 전체를 덮어야 한다(사유는 index.css §5.5 #17-1 주석).

  // DebugPanel onClose 를 안정 참조로 — 매 렌더 새 함수가 prop 으로 들어가 memo 를 깨지 않도록.
  const closeDebug = useCallback(() => useGraphStore.getState().toggleDebug(), []);

  return (
    // §4 v3.16 — h-dvh: 모바일 브라우저의 동적 URL 바가 하단(입력창·상태바)을 가리지 않게
    // dynamic viewport height 사용. 데스크톱(Electron)에선 100vh 와 동일.
    <div className="flex h-dvh w-screen flex-col bg-gray-950">
      {/* §4 (첫 실행 설치 온보딩) — 게이트를 [나중에]로 닫았을 때 남는 배너. 헤더보다 위에 둬야
          "에이전트를 아직 못 돌린다"는 사실이 화면 맨 처음에 읽힌다. */}
      <ClaudeSetupBanner />
      <Header connectionStatus={status} agentPhase={agentPhase} />
      <div className="relative flex flex-1 overflow-hidden">
        {/* DebugPanel — 평소엔 숨김, `~`/` 키로 debugMode 토글 시에만 마운트(꺼지면 비용 0).
            켜져 있을 때의 잦은 리렌더는 DebugPanel 내부 React.memo + 안정 onClose 로 완화. */}
        {debugMode && <DebugPanel onClose={closeDebug} />}
        <main
          className="relative flex-1"
          style={shrinkForDock ? {
            marginLeft: dockInsets.left,
            marginRight: dockInsets.right,
            marginTop: dockInsets.top,
            marginBottom: dockInsets.bottom,
          } : undefined}
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
              {/* §5.10 v4.84 — 휴지통 내부에서만 뜨는 [모두 삭제] 툴바(경로 표시 바로 아래). */}
              <TrashToolbar />
            </>
          )}
        </main>
        {(selectedNodeId !== null || selectedTaskEdgeId !== null || selectedCommentBoxId !== null || selectedCaptureBubbleId !== null || selectedAppBubbleId !== null || (selectedBrainCardId !== null && !brainFeedOpen)) && !activeIframeTab && (
          <DetailPanel
            onClose={() => {
              const s = useGraphStore.getState();
              s.selectNode(null);
              s.selectTaskEdge(null);
              s.selectCommentBox(null);
              s.selectCaptureBubble(null);
              s.selectAppBubble(null);
              s.selectBrainCard(null);
            }}
          />
        )}
      </div>
      <BrainLibraryOverlay />
      {/* §5.10 (H) — 첫 실행 두뇌 안내 배너는 폐기됐다(사용자 결정 2026-08-26). 켜는 자리는 설정 창 `Project Brain` 탭과 캔버스 우클릭. */}
      {/* InspectorOverlay 는 main.tsx 에서 전역 1회 마운트 — 여기서 또 그리면 복사가 두 번 일어난다. */}
      <WorktreeDeleteDialog />
      {/* §5.10 v4.84 — 휴지통 영구 삭제 확인. 트리거(툴바·Delete 키)와 같은 창의 스토어를 보므로
          캔버스가 있는 셸(App·DetachedShell)에 각각 마운트한다. */}
      <TrashPurgeDialog />
      {/* §5.13 (R-8) — 못 읽는 영상·소리를 눌렀을 때 뜨는 변환 팝업(캐시가 있으면 뜨지 않는다). */}
      <MediaConvertDialog />
      {/* §5.19 — All Model 창(엔진 설치 + 모델 고르기). 캔버스 우클릭이 여는 유일한 진입이다. */}
      <LocalModelWindow />
      <PermissionPromptStack />
      <ClaudeVersionGate />
      {/* §4 (첫 실행 설치 온보딩) — 설치 게이트. 로그인보다 **앞** 단계라 z-index 도 위다
          (CLI 가 없으면 로그인 자체가 불가능하다). 로그인과 같은 이유로 메인 창에만 마운트. */}
      <ClaudeSetupGate />
      {/* §4 v4.82 — 로그인 게이트. main.tsx(공통 부팅 지점)가 아니라 여기 — 별창마다 같은 모달이
          겹쳐 뜨면 안 되고, 로그인은 메인 창에서 한 번만 물으면 되는 일이다. */}
      <LoginWindow />
    </div>
  );
}
