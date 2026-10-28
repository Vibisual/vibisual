/**
 * §5.11 — 기억 도구(Memory Tool): 컨텍스트 밖 파일은 컴팩션 뒤에도 살아남는다. 표시 전용.
 * §5.10 절차 파일(`.vibisual/skills/<절차>/SKILL.md`)의 출처를 나눠 본다 — 사람이 꽂은 단계인가, 에이전트 명령을 훑어 나온 것인가, 원본 앵커가 달렸는가.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const fromStep = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).fromStep;
const anchored = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).anchored;
const fromCommand = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).fromCommand;

const inspector = defineInspector({
  id: 'memory-tool', i18nKey: 'memoryTool', name: 'Memory Tool', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (readAutoGoal(ctx).stored === 0) return { key: 'unused', tone: 'neutral' };
    return fromCommand(ctx) > 0 ? { key: 'active', tone: 'good' } : { key: 'pushed', tone: 'neutral' };
  },
  checks: [
    { key: 'spawn', value: (ctx) => String(fromStep(ctx)) },
    { key: 'file', value: (ctx) => String(anchored(ctx)) },
    { key: 'search', value: (ctx) => String(fromCommand(ctx)), tone: (ctx) => (fromCommand(ctx) > 0 ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const memoryToolManifest = inspector.manifest;
export const memoryToolClient = inspector.client;
