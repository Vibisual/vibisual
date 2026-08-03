/**
 * §5.11 v3.97 — 환각 방어(Hallucination): 코드 도메인의 최선 방어는 실행이다.
 *
 * 에이전트에서는 존재하지 않는 API·파일·함수를 지어내는 형태가 가장 흔하다. 타입체크·린트·테스트가
 * 지어낸 API 를 즉시 잡아내므로, "모델에게 확인하게 하는" 것보다 훨씬 확실하다. 여기서는 이 에이전트가
 * **실행으로 검증할 수단을 쥐고 있는지**를 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

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
