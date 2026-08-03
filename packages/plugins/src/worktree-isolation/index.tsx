/**
 * §5.11 v3.97 — 워크트리 격리(Worktree Isolation): 동시에 도는 에이전트가 서로를 밟지 않는가.
 *
 * 여러 에이전트가 동시에 도는 순간 필수 인프라가 된다 — 브랜치만으로는 동시 체크아웃이 안 되고, 같은
 * 디렉터리에서 둘이 파일을 고치면 서로의 변경을 덮어쓴다. 함정도 많다 — 의존성 설치가 트리마다 필요하고,
 * **격리보다 통합 설계가 더 어렵다.** 표시 전용.
 */
import { defineInspector, ICONS } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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
