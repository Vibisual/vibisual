import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ko from './i18n/locales/ko.json';
import './index.css';
import { useGraphStore } from './stores/graphStore.js';
import { OptionsWindow } from './components/Options/OptionsWindow.js';
import { UsagePill } from './components/Layout/UsagePill.js';
i18n.use(initReactI18next).init({ lng: 'ko', resources: { ko: { translation: ko } }, interpolation: { escapeValue: false } });
const defaults = { updatedAt: Date.now(), engineChoice: { kind: 'codex', chosenAt: 1 }, agentConfig: { provider: { kind: 'codex-cli', modelId: 'test-model' } }, engineConfigs: { claude: { model: 'sonnet' }, codex: { provider: { kind: 'codex-cli', modelId: 'test-model' } } } };
useGraphStore.setState({ userDefaults: defaults, activeProject: '/review', projects: { '/review': { name: 'Review', path: '/review' } }, codexAuth: { loggedIn: true, account: 'review@example.test', checkedAt: 1 }, claudeAuth: { loggedIn: true, email: 'review@example.test', checkedAt: 1 }, codexSetup: { phase: 'ready' }, claudeSetup: { phase: 'ready' }, codexModels: { models: [{ slug: 'test-model', displayName: 'Test model', reasoningLevels: ['low', 'medium', 'high'] }] } } as any);
window.fetch = async (url, init) => {
  const state = useGraphStore.getState(); const path = String(url);
  let body: any = {};
  if (path.includes('codex-usage')) body = { windows: [{ id: 'codex:primary', label: 'Codex', usedPercent: 23, windowDurationMins: 300, resetsAt: Date.now() + 7200000 }], fetchedAt: Date.now() };
  else if (path.includes('user-defaults') && init?.method === 'PUT') { const patch = JSON.parse(String(init.body)); body = { ok: true, userDefaults: { ...state.userDefaults, ...patch, updatedAt: Date.now() } }; }
  else if (path.includes('codex-auth')) body = state.codexAuth;
  else if (path.includes('/auth/')) body = state.claudeAuth;
  else if (path.includes('codex-setup')) body = state.codexSetup;
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
function Review() { const [open, setOpen] = useState(true); return <><div className="p-6 flex gap-4"><button onClick={() => setOpen(true)}>설정 열기</button><UsagePill /></div><OptionsWindow open={open} onClose={() => setOpen(false)} initialCategory="account" /></>; }
createRoot(document.getElementById('root')!).render(<Review />);
