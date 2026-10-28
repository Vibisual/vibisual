/**
 * §5.11 — 워크트리 격리(Worktree Isolation): 동시에 도는 에이전트가 서로를 밟지 않는가. 표시 전용.
 * 브랜치만으로는 동시 체크아웃이 안 되고, 같은 디렉터리에서 둘이 고치면 서로의 변경을 덮어쓴다. 의존성 설치는 트리마다 필요하다.
 */
import { defineInspector, ICONS } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const isolated = (ctx: PluginBubbleContext): boolean => ctx.agentConfig?.isolation === 'worktree';

const inspector = defineInspector({
  id: 'worktree-isolation', i18nKey: 'worktreeIsolation', name: 'Worktree Isolation', category: 'workflow',
  status: (ctx) => (isolated(ctx) ? { key: 'isolated', tone: 'good' } : { key: 'shared', tone: 'neutral' }),
  checks: [
    { key: 'mode', value: (ctx) => ctx.agentConfig?.isolation ?? 'none', tone: (ctx) => (isolated(ctx) ? 'good' : 'neutral') },
    {
      key: 'merge',
      value: (ctx) => ctx.t(`panel.plugins.worktreeIsolation.${isolated(ctx) ? 'pending' : 'notNeeded'}`),
      tone: (ctx) => (isolated(ctx) ? 'warn' : 'neutral'),
    },
  ],
  noteKey: (ctx) => (isolated(ctx) ? '.noteIsolated' : '.note'),
  badge: { match: isolated, text: () => '', icon: ICONS.shield },
});

export const worktreeIsolationManifest = inspector.manifest;
export const worktreeIsolationClient = inspector.client;
