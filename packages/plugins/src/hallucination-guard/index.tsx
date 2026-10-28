/** §5.11 — 환각 방어(Hallucination): 최선 방어는 실행(타입체크·린트·테스트) — 이 에이전트가 실행으로 검증할 수단을 쥐었는지 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const canRun = (ctx: PluginBubbleContext): boolean => effectiveTools(ctx.agentConfig).has('Bash');
const canRead = (ctx: PluginBubbleContext): boolean => ['Read', 'Grep', 'Glob'].some((t) => effectiveTools(ctx.agentConfig).has(t));

const inspector = defineInspector({
  id: 'hallucination-guard', i18nKey: 'hallucinationGuard', name: 'Hallucination Guard', category: 'observability',
  status: (ctx) => {
    if (canRun(ctx) && canRead(ctx)) return { key: 'verifiable', tone: 'good' };
    if (canRead(ctx)) return { key: 'readOnly', tone: 'neutral' };
    return { key: 'blind', tone: 'warn' };
  },
  checks: [
    {
      key: 'execute',
      value: (ctx) => ctx.t(`panel.plugins.hallucinationGuard.${canRun(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (canRun(ctx) ? 'good' : 'warn'),
    },
    {
      key: 'read',
      value: (ctx) => ctx.t(`panel.plugins.hallucinationGuard.${canRead(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (canRead(ctx) ? 'good' : 'warn'),
    },
  ],
  noteKey: () => '.note',
});

export const hallucinationGuardManifest = inspector.manifest;
export const hallucinationGuardClient = inspector.client;
