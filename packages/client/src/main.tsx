import './transport/install-packaged-transport.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installRendererDiagnostics } from './utils/diagnostics.js';
import './index.css';
import './i18n/index.js';

// §4 v1.98 — renderer 에러 캡처 설치(가능한 한 일찍 — 부팅 초기 에러도 잡도록).
installRendererDiagnostics();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
