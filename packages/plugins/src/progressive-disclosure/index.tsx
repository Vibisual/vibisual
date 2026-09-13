/**
 * §5.11 v3.95 — 점진적 공개(Progressive Disclosure): 다 밀어넣는가, 목차를 주는가.
 *
 * 전부 미리 넣지 않고 필요해지는 순간 가져오게 하는 방식이 컨텍스트 부패를 막으면서 지식 총량은 줄이지 않는
 * 가장 실효적인 절충이다. 문서를 통째로 붙여넣는 대신 **"어떤 작업이면 어느 파일을 읽어라" 색인**을 주는 것이
 * 같은 문법이다.
 *
 * §5.10 의 절차 주입이 정확히 그 색인 형태다 — 프롬프트에 실리는 것은 이름과 한 줄 설명,
 * 그리고 파일 경로뿐이고 본문은 에이전트가 필요할 때 연다. 여기서는 훑은 행동 대비 **순 재발**이
 * 얼마나 되는지를 본다: 재발이 저장고보다 많으면 같은 일을 계속 다시 하고 있다는 뜻이다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const observed = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).observed;
const repeats = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).repeats;

const inspector = defineInspector({
  id: 'progressive-disclosure', i18nKey: 'progressiveDisclosure', name: 'Progressive Disclosure', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (observed(ctx) === 0) return { key: 'none', tone: 'neutral' };
    return repeats(ctx) > readAutoGoal(ctx).stored ? { key: 'repeating', tone: 'warn' } : { key: 'lean', tone: 'good' };
  },
  checks: [
    { key: 'events', value: (ctx) => String(observed(ctx)) },
    { key: 'repeats', value: (ctx) => String(repeats(ctx)), tone: (ctx) => (repeats(ctx) > readAutoGoal(ctx).stored ? 'warn' : 'neutral') },
    { key: 'cards', value: (ctx) => String(readAutoGoal(ctx).carried) },
  ],
  noteKey: () => '.note',
});

export const progressiveDisclosureManifest = inspector.manifest;
export const progressiveDisclosureClient = inspector.client;
