import './transport/install-packaged-transport.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { AppErrorBoundary } from './components/Layout/AppErrorBoundary.js';
import { DetachedShell, parseDetachedHash } from './components/Layout/DetachedShell.js';
import { ShortcutsHost } from './components/Shortcuts/ShortcutsHost.js';
import { OverlayShell, parseOverlayHash } from './components/Layout/OverlayShell.js';
import { OverlayMenuShell, parseOverlayMenuHash } from './components/Layout/OverlayMenuShell.js';
import { CommandCenterShell, parseCommandCenterHash } from './components/CommandCenter/CommandCenterShell.js';
import { parseAppHash } from './apps/appHash.js';
import { DetachedAppWindow } from './apps/DetachedAppWindow.js';
import { InspectorOverlay } from './components/Inspector/InspectorOverlay.js';
import { GlobalTextFieldContextMenu } from './components/Layout/GlobalTextFieldContextMenu.js';
import { ExternalOpenNotice } from './components/Layout/ExternalOpenNotice.js';
import { AppDialogHost } from './components/Layout/AppDialogHost.js';
import { installAppDialogKeyboardGuard } from './utils/appDialog.js';
import { installRendererDiagnostics } from './utils/diagnostics.js';
import { installPersistFlushBridge } from './utils/persistFlush.js';
import { installTitlebarPressCatch } from './utils/titlebarPress.js';
import { installInputCompositionGuard } from './utils/inputComposition.js';
import { bootAppTheme } from './theme/appThemeEngine.js';
import { AppThemeHost } from './components/Theme/AppThemeHost.js';
// §5.5 — 읽기 설정 글꼴은 OS 설치에 기대지 않고 앱에 동봉해 싣는다(`scripts/fetch-reading-fonts.mjs`).
// index.css 보다 먼저 실어야 `--font-sans` 첫 후보(Pretendard)가 첫 페인트부터 잡힌다.
import './assets/fonts/fonts.css';
import './index.css';
import './i18n/index.js';

// §4 — 가능한 한 일찍 설치한다 — 부팅 초기 에러도 잡도록.
installRendererDiagnostics();

// §4 앱 테마 — **첫 칠 전에** 지난번 테마로 먼저 칠한다. 스냅샷(고른 테마 id)은 창이 뜬 뒤에 오므로,
// 이 줄이 없으면 라이트 테마를 쓰는 사람도 매번 어두운 화면이 한 번 번쩍인 뒤 바뀐다. 창 종류를
// 가리지 않으므로 부팅 지점에 둔다. 권위는 서버 저장값이고, 이 캐시는 아래 AppThemeHost 가 늘 갱신한다.
bootAppTheme();
installInputCompositionGuard(window);
installAppDialogKeyboardGuard(window);

// §3.2.1 — 종료 직전 main 의 "지금 초안을 밀어라"를 받는다(앱 종료는 `app.exit(0)` 이라 `pagehide`/`beforeunload` 가 안 뜬다).
// 모든 창 종류에 입력칸이 있어 shell 안이 아니라 부팅 지점에 둔다.
installPersistFlushBridge();

// §3.7 — 드래그 영역 신고 전(앱을 막 켰을 때 등) 페이지까지 온 제목줄 누름을 덮개와 같은 길로 창 이동에 쓴다.
// 영역을 코드로 흔들어 다시 신고시키지 마라 — 누름이 버려진다(`titlebarPress.ts`). `.app-drag` 를 쓰는 창이 여럿이라 부팅 지점에 둔다.
installTitlebarPressCatch();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

// §5.4 #14-1 — `#detached=1&kind=...&tabKey=...` 면 별창(DetachedShell).
// §5.5 #17-6 — `#overlay=1&agentId=...&projectId=...` 면 버블 오버레이 위젯 창.
const detached = parseDetachedHash(window.location.hash);
const overlay = detached ? null : parseOverlayHash(window.location.hash);
// §5.5 #17-6 (G) — `#overlaymenu=1&…` 면 버블 우클릭 메뉴 전용 팝업 창.
const overlayMenu = detached || overlay ? null : parseOverlayMenuHash(window.location.hash);
// §5.12 (A) — `#command=1&projectId=…` 면 지휘통제실 창.
const commandCenter = detached || overlay || overlayMenu ? null : parseCommandCenterHash(window.location.hash);

// §5.13 (O) — `#app=<id>&mode=<mode>&…` 면 내부 앱 창. 코어는 앱·화면 이름을 모른다 — 판별만 하고 그릴 화면은 앱 레지스트리의 로더가 정한다.
const appWindow = detached || overlay || overlayMenu || commandCenter ? null : parseAppHash(window.location.hash);

// §5.5 #17-6 — 오버레이/메뉴 위젯 창은 BrowserWindow 가 transparent:true 라, body 의 bg-gray-950
// 불투명 배경을 투명으로 덮어 버블/메뉴만 떠 보이게 한다(index.css `.overlay-window` 규칙).
if (overlay || overlayMenu) document.documentElement.classList.add('overlay-window');

// §9 — 창이 최소화·완전히 가려진 동안 상시 애니메이션(`animate-pulse`·`animate-spin` 등)을 끊는다(`vibisual-canvas-idle` 은 캔버스가 덮인 경우만 본다).
// 돌아오면 클래스만 빠진다(상태 없음). 모든 창 종류가 받도록 부팅 지점에 둔다.
{
  const cls = 'vibisual-window-hidden';
  const syncWindowVisibility = (): void => {
    document.documentElement.classList.toggle(cls, document.visibilityState === 'hidden');
  };
  syncWindowVisibility();
  document.addEventListener('visibilitychange', syncWindowVisibility);
}

// §5.4 #15 — Inspector(Alt 홀드)는 어느 창에서든 써야 하므로 부팅 지점에서 한 번만 마운트한다.
// shell 안에 또 두면 useInspector 가 두 번 돌아 클립보드 복사가 중복된다.
createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      {/* §4 앱 테마 — 고른 테마를 이 창의 `<html>` 에 싣는다. 별창·오버레이·지휘통제실·내부 앱 창도
          같은 테마를 칠해야 하므로 InspectorOverlay 와 같은 이유로 **부팅 지점에서 한 번만** 마운트한다. */}
      <AppThemeHost />
      <AppDialogHost />
      <InspectorOverlay />
      {/* 입력칸 우클릭 메뉴 — Electron 에는 브라우저 기본 메뉴가 없다. 모든 창의 입력칸이 받도록 부팅 지점에서 한 번만 마운트한다. */}
      <GlobalTextFieldContextMenu />
      {/* §3.7 — 바깥 브라우저 열기가 실패했을 때의 안내(폴백 ❌). 링크는 어느 창에서든 눌리고
          (로그인 창·IDE 별창·내부 앱 창 …) 리눅스에서는 shell.openExternal 이 실패해도 resolve 해
          renderer 가 스스로는 알 수 없다 — main 이 알려 준다. 위 둘과 같은 이유로 부팅 지점에 둔다. */}
      <ExternalOpenNotice />
      {/* §6 — 단축키 판(`Ctrl+/`)과 "이건 키로도 됩니다" 알림. 위 셋과 같은 이유로 부팅 지점에 둔다
          — 어느 창에서든 물어볼 수 있어야 하고, shell 안에 두면 별창에서는 답이 없다. */}
      <ShortcutsHost />
      {detached ? (
        <DetachedShell kind={detached.kind} tabKey={detached.tabKey} />
      ) : overlay ? (
        <OverlayShell agentId={overlay.agentId} projectId={overlay.projectId} initiallyExpanded={overlay.initiallyExpanded} />
      ) : overlayMenu ? (
        <OverlayMenuShell initialOpacity={overlayMenu.opacity} />
      ) : commandCenter ? (
        <CommandCenterShell projectId={commandCenter.projectId} />
      ) : appWindow ? (
        <DetachedAppWindow initial={appWindow} />
      ) : (
        <App />
      )}
    </AppErrorBoundary>
  </StrictMode>,
);
