import './transport/install-packaged-transport.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { DetachedShell, parseDetachedHash } from './components/Layout/DetachedShell.js';
import { OverlayShell, parseOverlayHash } from './components/Layout/OverlayShell.js';
import { installRendererDiagnostics } from './utils/diagnostics.js';
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

// §5.5 #17-6 — 오버레이 위젯 창은 BrowserWindow 가 transparent:true 라, body 의 bg-gray-950
// 불투명 배경을 투명으로 덮어 버블만 떠 보이게 한다(index.css `.overlay-window` 규칙).
if (overlay) document.documentElement.classList.add('overlay-window');

createRoot(rootElement).render(
  <StrictMode>
    {detached ? (
      <DetachedShell kind={detached.kind} tabKey={detached.tabKey} />
    ) : overlay ? (
      <OverlayShell agentId={overlay.agentId} projectId={overlay.projectId} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
