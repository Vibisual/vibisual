/**
 * §5.11 v3.95 — 기억 도구(Memory Tool): 에이전트가 스스로 기억을 찾아 쓰는가.
 *
 * 컨텍스트 밖 파일에 메모를 쓰고 나중에 다시 읽어 오는 방식은 별도 인프라 없이 지속 기억을 얻는 가장 가벼운
 * 형태이고, **컴팩션으로 대화가 압축돼도 파일은 살아남는다**는 결정적 성질이 있다. 여기서는 주입이
 * 밀어넣기(스폰)로만 오는지, 에이전트가 **능동 검색**으로도 끌어오는지를 나눠 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

function byTrigger(ctx: PluginBubbleContext, trigger: 'spawn' | 'file' | 'search'): number {
  return (ctx.data.brainInjections ?? []).filter((e) => e.trigger === trigger).length;
}

const inspector = defineInspector({
  id: 'memory-tool', i18nKey: 'memoryTool', name: 'Memory Tool', category: 'observability',
  needs: ['brainInjections'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const total = (ctx.data.brainInjections ?? []).length;
    if (total === 0) return { key: 'unused', tone: 'neutral' };
    return byTrigger(ctx, 'search') > 0 ? { key: 'active', tone: 'good' } : { key: 'pushed', tone: 'neutral' };
  },
  checks: [
    { key: 'spawn', value: (ctx) => String(byTrigger(ctx, 'spawn')) },
    { key: 'file', value: (ctx) => String(byTrigger(ctx, 'file')) },
    { key: 'search', value: (ctx) => String(byTrigger(ctx, 'search')), tone: (ctx) => (byTrigger(ctx, 'search') > 0 ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const memoryToolManifest = inspector.manifest;
export const memoryToolClient = inspector.client;
