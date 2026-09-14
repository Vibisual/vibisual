import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { CodexToolPermissions } from './CodexToolPermissions.js';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('only offers ask for tools whose execution is intercepted', () => {
  const html = renderToStaticMarkup(createElement(CodexToolPermissions, { value: {}, onChange: () => {} }));
  expect(html.match(/<select /g)).toHaveLength(8);
  expect(html.match(/value="ask"/g)).toHaveLength(4);
  const web = html.match(/<select aria-label="Web search"[^]*?<\/select>/)?.[0];
  expect(web).toBeTruthy();
  expect(web).not.toContain('value="ask"');
});

it('renders saved ask and deny choices and disables native children while restrictions are active', () => {
  const html = renderToStaticMarkup(createElement(CodexToolPermissions, { value: { edit: 'ask', shell: 'deny' }, onChange: () => {} }));
  expect(html).toContain('value="ask" selected=""');
  expect(html).toMatch(/aria-label="spawn_agent" disabled=""/);
  expect(html).toContain('panel.agentConfig.codex.toolChildren');
});
