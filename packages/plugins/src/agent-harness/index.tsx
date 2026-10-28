/** §5.11 — 에이전트 하네스(Agent Harness): 이 에이전트를 감싼 것들(모델·도구·권한·격리·스킬·규칙)을 한 장으로 보여준다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const parts = (ctx: PluginBubbleContext): number =>
  [
    effectiveTools(ctx.agentConfig).size > 0,
    Boolean(ctx.agentConfig?.permissionMode),
    (ctx.agentConfig?.skills ?? []).length > 0,
    (ctx.agentConfig?.rules ?? '').trim().length > 0,
    ctx.agentConfig?.isolation === 'worktree',
  ].filter(Boolean).length;

const inspector = defineInspector({
  id: 'agent-harness', i18nKey: 'agentHarness', name: 'Agent Harness', category: 'observability',
  status: (ctx) => (parts(ctx) >= 4 ? { key: 'rich', tone: 'good' } : parts(ctx) >= 2 ? { key: 'basic', tone: 'neutral' } : { key: 'bare', tone: 'warn' }),
  checks: [
    { key: 'model', value: (ctx) => ctx.agentConfig?.model ?? '—' },
    { key: 'tools', value: (ctx) => String(effectiveTools(ctx.agentConfig).size) },
    { key: 'permission', value: (ctx) => ctx.agentConfig?.permissionMode ?? '—' },
    { key: 'skills', value: (ctx) => String((ctx.agentConfig?.skills ?? []).length) },
    { key: 'isolation', value: (ctx) => ctx.agentConfig?.isolation ?? 'none' },
  ],
  noteKey: () => '.note',
});

export const agentHarnessManifest = inspector.manifest;
export const agentHarnessClient = inspector.client;
