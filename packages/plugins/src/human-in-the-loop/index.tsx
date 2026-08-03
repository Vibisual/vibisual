/**
 * §5.11 v3.93 — 사람 개입 지점(Human in the Loop): 되돌릴 수 없는 동작 앞에 확인이 있는가.
 *
 * 전부에 승인을 걸면 사람이 내용을 안 보고 누르게 되어 승인 자체가 무의미해지고, 아무 데도 안 걸면
 * 사고가 난다. 그래서 판단 기준은 **가역성**이다 — 되돌릴 수 있으면 승인이 필요 없다. 표시 전용.
 */
import { defineInspector, ICONS } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

const K = 'panel.plugins.humanInTheLoop';

/** 되돌릴 수 없는 결과를 만들 수 있는 도구들. */
const IRREVERSIBLE = ['Write', 'Edit', 'NotebookEdit', 'Bash'];

function riskyTools(ctx: PluginBubbleContext): string[] {
  const tools = effectiveTools(ctx.agentConfig);
  return IRREVERSIBLE.filter((t) => tools.has(t));
}

const inspector = defineInspector({
  id: 'human-in-the-loop',
  i18nKey: 'humanInTheLoop',
  name: 'Human in the Loop',
  category: 'workflow',
  status: (ctx) => {
    const mode = ctx.agentConfig?.permissionMode;
    if (riskyTools(ctx).length === 0 || mode === 'plan') return { key: 'notNeeded', tone: 'good' };
    if (mode === 'bypassPermissions') return { key: 'absent', tone: 'bad' };
    return { key: 'present', tone: 'neutral' };
  },
  checks: [
    {
      key: 'irreversible',
      value: (ctx) => String(riskyTools(ctx).length),
      tone: (ctx) => (riskyTools(ctx).length > 0 ? 'warn' : 'good'),
      hint: (ctx) => riskyTools(ctx).join(' · ') || undefined,
    },
    {
      key: 'prompt',
      value: (ctx) => ctx.t(`${K}.${ctx.agentConfig?.permissionMode === 'bypassPermissions' ? 'no' : 'yes'}`),
      tone: (ctx) => (ctx.agentConfig?.permissionMode === 'bypassPermissions' ? 'bad' : 'good'),
    },
    {
      key: 'reversible',
      value: (ctx) => ctx.t(`${K}.${ctx.agentConfig?.isolation === 'worktree' ? 'yes' : 'no'}`),
      tone: (ctx) => (ctx.agentConfig?.isolation === 'worktree' ? 'good' : 'neutral'),
    },
  ],
  noteKey: () => '.note',
  badge: {
    match: (ctx) => ctx.agentConfig?.permissionMode === 'bypassPermissions' && riskyTools(ctx).length > 0,
    text: () => '',
    icon: ICONS.hand,
  },
});

export const humanInTheLoopManifest = inspector.manifest;
export const humanInTheLoopClient = inspector.client;
