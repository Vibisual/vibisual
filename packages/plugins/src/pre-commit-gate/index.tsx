/** §5.11 — 커밋 전 관문(Pre-commit Gate): 되돌릴 수 없는 것(푸시된 비밀 등)은 사전에 막는다 — 우회 가능하면 관문이 아니다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const canCommit = (ctx: PluginBubbleContext): boolean => effectiveTools(ctx.agentConfig).has('Bash');

const inspector = defineInspector({
  id: 'pre-commit-gate', i18nKey: 'preCommitGate', name: 'Pre-commit Gate', category: 'workflow',
  status: (ctx) => (canCommit(ctx) ? { key: 'gated', tone: 'neutral' } : { key: 'cannot', tone: 'good' }),
  checks: [
    {
      key: 'canCommit',
      value: (ctx) => ctx.t(`panel.plugins.preCommitGate.${canCommit(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (canCommit(ctx) ? 'neutral' : 'good'),
    },
    { key: 'gate', value: (ctx) => ctx.t('panel.plugins.preCommitGate.repoHook'), tone: () => 'good' },
  ],
  noteKey: () => '.note',
});

export const preCommitGateManifest = inspector.manifest;
export const preCommitGateClient = inspector.client;
