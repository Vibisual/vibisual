import './transport/install-packaged-transport.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { DetachedShell, parseDetachedHash } from './components/Layout/DetachedShell.js';
import { OverlayShell, parseOverlayHash } from './components/Layout/OverlayShell.js';
import { OverlayMenuShell, parseOverlayMenuHash } from './components/Layout/OverlayMenuShell.js';
import { CommandCenterShell, parseCommandCenterHash } from './components/CommandCenter/CommandCenterShell.js';
import { parseAppHash } from './apps/appHash.js';
import { AppShellHost } from './apps/AppShellHost.js';
import { InspectorOverlay } from './components/Inspector/InspectorOverlay.js';
import { installRendererDiagnostics } from './utils/diagnostics.js';
// §5.5 — 읽기 설정 글꼴은 OS 설치에 기대지 않고 앱에 동봉해 싣는다(`scripts/fetch-reading-fonts.mjs`).
// index.css 보다 먼저 실어야 `--font-sans` 첫 후보(Pretendard)가 첫 페인트부터 잡힌다.
import './assets/fonts/fonts.css';
import './index.css';
import './i18n/index.js';

// §4 v1.98 — renderer 에러 캡처 설치(가능한 한 일찍 — 부팅 초기 에러도 잡도록).
installRendererDiagnostics();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

// SCENARIO.md §5.4 #14-1 (v2.29) — URL hash 가 `#detached=1&kind=...&tabKey=...` 면
// windowManager 가 새로 띄운 별창. 메인 App 대신 DetachedShell 렌더.
// §5.5 #17-6 (v2.73) — `#overlay=1&agentId=...&projectId=...` 면 버블 오버레이 위젯 창.
const detached = parseDetachedHash(window.location.hash);
const overlay = detached ? null : parseOverlayHash(window.location.hash);
// §5.5 #17-6 (G) v2.87 — `#overlaymenu=1&…` 면 버블 우클릭 메뉴 전용 팝업 창.
const overlayMenu = detached || overlay ? null : parseOverlayMenuHash(window.location.hash);
// §5.12 (A) v4.43 — `#command=1&projectId=…` 면 지휘통제실 창.
const commandCenter = detached || overlay || overlayMenu ? null : parseCommandCenterHash(window.location.hash);

// §5.13 (O) v4.48 — `#app=<id>&mode=<mode>&…` 면 내부 앱 창.
//
// **코어는 앱 이름도 화면 이름도 모른다.** 여기서는 판별만 하고, 어떤 화면을 그릴지는
// 앱 레지스트리가 들고 있는 로더가 정한다. 그래서 내부 앱이 몇 개로 늘어나도 부팅
// 분기는 이 하나 그대로이고, 앱 코드는 이 경로로 들어오기 전까지 로드되지 않는다.
const appWindow = detached || overlay || overlayMenu || commandCenter ? null : parseAppHash(window.location.hash);

// §5.5 #17-6 — 오버레이/메뉴 위젯 창은 BrowserWindow 가 transparent:true 라, body 의 bg-gray-950
// 불투명 배경을 투명으로 덮어 버블/메뉴만 떠 보이게 한다(index.css `.overlay-window` 규칙).
if (overlay || overlayMenu) document.documentElement.classList.add('overlay-window');

// §9 v3.71 확장 — "보이지 않는 것은 그리지 않는다" 를 **창 단위**까지 넓힌다.
//
// 종전 게이트(`vibisual-canvas-idle`)는 캔버스가 전면 오버레이에 덮인 경우만 봤다. 그래서 IDE·
// 패널의 상시 애니메이션(`animate-pulse`·`animate-spin` 등)은 창을 최소화하거나 다른 창에 완전히
// 가려도 계속 tick 하며 스타일 재계산·컴포지터 작업을 만들었다. 보이지 않는 동안은 잃을 화면이
// 없으므로 통째로 끊고, 창이 돌아오면 클래스가 사라져 즉시 원래 연출로 복귀한다(상태 없음).
//
// 창 종류를 가리지 않아야 하므로 shell 안이 아니라 **부팅 지점**에 둔다 — 별창·오버레이 창·
// 지휘통제실 창·내부 앱 창도 같은 규칙을 받는다(InspectorOverlay 를 여기 둔 것과 같은 이유).
{
  const cls = 'vibisual-window-hidden';
  const syncWindowVisibility = (): void => {
    document.documentElement.classList.toggle(cls, document.visibilityState === 'hidden');
  };
  syncWindowVisibility();
  document.addEventListener('visibilitychange', syncWindowVisibility);
}

// §5.4 #15 (v4.49) — Inspector(Alt 홀드 → 요소 하이라이트/클릭 복사)는 **어느 창에서든** 쓸 수 있어야 한다.
// 예전에는 App / DetachedShell 안에서만 마운트해, 지휘통제실 창·오버레이 창·내부 앱 창에서는 Alt 를 눌러도
// 아무 일도 일어나지 않았다. 창 종류를 가리지 않도록 **shell 바깥(부팅 지점)에서 한 번만** 마운트한다
// — 렌더 진입점이 이 파일 하나뿐이므로 여기 두면 모든 창(앞으로 늘어날 새 앱 창 포함)에 자동 적용된다.
// (shell 안쪽에 또 두면 useInspector 가 두 번 돌아 클립보드 복사가 중복된다 — App/DetachedShell 에서는 제거.)
createRoot(rootElement).render(
  <StrictMode>
    <InspectorOverlay />
    {detached ? (
      <DetachedShell kind={detached.kind} tabKey={detached.tabKey} />
    ) : overlay ? (
      <OverlayShell agentId={overlay.agentId} projectId={overlay.projectId} />
    ) : overlayMenu ? (
      <OverlayMenuShell initialOpacity={overlayMenu.opacity} />
    ) : commandCenter ? (
      <CommandCenterShell projectId={commandCenter.projectId} />
    ) : appWindow ? (
      <AppShellHost hash={appWindow} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
