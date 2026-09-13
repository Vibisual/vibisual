/**
 * §5.11 v3.95 — 기억 도구(Memory Tool): 에이전트가 스스로 남긴 것을 다시 쓰는가.
 *
 * 컨텍스트 밖 파일에 적어 두고 나중에 다시 읽어 오는 방식은 별도 인프라 없이 지속 기억을 얻는 가장
 * 가벼운 형태이고, **컴팩션으로 대화가 압축돼도 파일은 살아남는다**는 결정적 성질이 있다.
 *
 * §5.10 의 절차 파일(`.vibisual/skills/<절차>/SKILL.md`)이 정확히 그 형태다. 여기서는 그 파일이
 * 어디서 왔는지를 나눠 본다 — 사람이 꽂아 준 단계인가, 에이전트가 스스로 친 명령을 훑어 나온
 * 것인가, 그리고 원본으로 되짚을 앵커가 달렸는가. 표시 전용.
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
