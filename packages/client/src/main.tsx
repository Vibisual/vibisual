import './transport/install-packaged-transport.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { DetachedShell, parseDetachedHash } from './components/Layout/DetachedShell.js';
import { installRendererDiagnostics } from './utils/diagnostics.js';
import './index.css';
import './i18n/index.js';

// §4 v1.98 — renderer 에러 캡처 설치(가능한 한 일찍 — 부팅 초기 에러도 잡도록).
installRendererDiagnostics();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

// SCENARIO.md §5.4 #14-1 (v2.29) — URL hash 가 `#detached=1&kind=...&tabKey=...` 면
// windowManager 가 새로 띄운 별창. 메인 App 대신 DetachedShell 렌더.
const detached = parseDetachedHash(window.location.hash);

createRoot(rootElement).render(
  <StrictMode>
    {detached ? <DetachedShell kind={detached.kind} tabKey={detached.tabKey} /> : <App />}
  </StrictMode>,
);
