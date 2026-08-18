/**
 * §5.11 v3.95 — 컨텍스트 오염(Context Pollution): 지난 하위 작업의 찌꺼기가 남아 있는가.
 *
 * 부패가 **길이**의 문제라면 오염은 **혼입**의 문제다. 실패한 시도의 로그, 버려진 접근, 장황한 도구 출력이
 * 주범이고, 특히 틀린 중간 결론이 남으면 모델이 그것을 계속 사실로 취급한다. 서브에이전트를 쓰는 진짜 이유가
 * 성능이 아니라 여기에 있다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const sessions = (ctx: PluginBubbleContext): number => (ctx.data.subAgents ?? []).length;
const turns = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).length;

/** 한 세션에서 턴이 많이 쌓일수록 혼입 위험이 커진다. 세션을 나눠 쓰면 그만큼 낮다. */
const perSession = (ctx: PluginBubbleContext): number => (sessions(ctx) > 0 ? turns(ctx) / sessions(ctx) : turns(ctx));

const inspector = defineInspector({
  id: 'context-pollution', i18nKey: 'contextPollution', name: 'Context Pollution', category: 'observability',
  needs: ['subAgents', 'agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (turns(ctx) === 0) return { key: 'clean', tone: 'good' };
    if (perSession(ctx) >= 20) return { key: 'mixed', tone: 'warn' };
    return { key: 'ok', tone: 'good' };
  },
  checks: [
    { key: 'sessions', value: (ctx) => String(sessions(ctx)) },
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    { key: 'perSession', value: (ctx) => (turns(ctx) > 0 ? perSession(ctx).toFixed(1) : '—'), tone: (ctx) => (perSession(ctx) >= 20 ? 'warn' : 'neutral') },
  ],
  noteKey: (ctx) => (perSession(ctx) >= 20 ? '.noteMixed' : '.note'),
});

export const contextPollutionManifest = inspector.manifest;
export const contextPollutionClient = inspector.client;
