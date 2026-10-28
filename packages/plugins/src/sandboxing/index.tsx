/** §5.11 — 샌드박싱(Sandboxing): 격리는 git worktree(파일시스템)까지라 네트워크는 격리되지 않는다는 사실을 숨기지 않고 표시한다. 표시 전용. */
import { defineInspector, ICONS } from '../sdk/index.js';

const K = 'panel.plugins.sandboxing';

const inspector = defineInspector({
  id: 'sandboxing',
  i18nKey: 'sandboxing',
  name: 'Sandboxing',
  category: 'security',
  status: (ctx) =>
    ctx.agentConfig?.isolation === 'worktree'
      ? { key: 'isolated', tone: 'good' }
      : { key: 'shared', tone: 'warn' },
  checks: [
    {
      key: 'filesystem',
      value: (ctx) => ctx.t(`${K}.${ctx.agentConfig?.isolation === 'worktree' ? 'worktree' : 'sameTree'}`),
      tone: (ctx) => (ctx.agentConfig?.isolation === 'worktree' ? 'good' : 'warn'),
    },
    {
      key: 'network',
      value: (ctx) => ctx.t(`${K}.noNetworkIsolation`),
      tone: () => 'warn',
    },
    { key: 'execution', value: (ctx) => ctx.agentConfig?.executionMode ?? 'headless' },
  ],
  noteKey: () => '.note',
  badge: {
    match: (ctx) => ctx.agentConfig?.isolation === 'worktree',
    text: () => '',
    icon: ICONS.shield,
  },
});

export const sandboxingManifest = inspector.manifest;
export const sandboxingClient = inspector.client;
