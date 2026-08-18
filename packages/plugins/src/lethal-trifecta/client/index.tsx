/**
 * §5.11 v3.88 — lethal-trifecta 의 클라이언트 기여 묶음.
 *
 * 배지·섹션 모두 **우리가 오케스트레이션한 에이전트**(agentConfig 가 있는 버블)에만 붙는다.
 * 훅으로 등록된 외부 Claude Code 세션은 우리가 설정을 소유하지 않으므로 판정 대상이 아니다
 * (판정할 근거가 없는데 배지를 다는 것은 잘못된 안심을 준다).
 */
import type { PluginClientModule, PluginBubbleContext, PluginSeverity } from '../../sdk/index.js';
import { lethalTrifectaManifest } from '../manifest.js';
import { judgeTrifecta } from '../../sdk/index.js';
import { TrifectaBadge } from './TrifectaBadge.js';
import { TrifectaSection } from './TrifectaSection.js';

function isJudgeableAgent(ctx: PluginBubbleContext): boolean {
  return ctx.bubbleType === 'agent' && ctx.agentConfig !== undefined;
}

/**
 * 호스트는 카드를 열어 보지 않고 이 등급만으로 정렬·접힘을 정한다. 등급을 안 주면 `neutral` 로 떨어지고,
 * 그러면 **세 다리가 다 열린 상태조차 조용한 카드로 분류돼 접힘 대상이 된다** — 보라고 만든 카드가 숨는다.
 */
function severity(ctx: PluginBubbleContext): PluginSeverity {
  const level = judgeTrifecta(ctx.agentConfig).level;
  return level === 'critical' ? 'bad' : level === 'caution' ? 'warn' : 'good';
}

export const lethalTrifectaClient: PluginClientModule = {
  manifest: lethalTrifectaManifest,
  // 손으로 쓴 카드는 골격이 채워 주지 않으므로 여기서 직접 선언한다 — 빠지면 Plugins 창의
  // "켜면 뭘 보게 되는가"에서 **행 목록만 통째로 사라진다**(창은 그려지므로 아무도 눈치채지 못한다).
  usage: { i18nKey: 'lethalTrifecta', checkKeys: ['leg.data', 'leg.untrusted', 'leg.egress'], badgeIsConditional: true },
  bubbleBadges: [
    {
      key: 'trifecta',
      // 기본 설정만으로도 '주의'가 나온다 — 그 수준에 배지를 달면 모든 버블에 붙어 구분이 사라진다.
      // 캔버스 경보는 **세 다리가 전부 열린** 최상위에만. 나머지 등급은 카드를 열면 그대로 보인다.
      match: (ctx) => isJudgeableAgent(ctx) && judgeTrifecta(ctx.agentConfig).level === 'critical',
      render: (ctx) => <TrifectaBadge ctx={ctx} />,
    },
  ],
  panelSections: [
    {
      key: 'trifecta',
      match: isJudgeableAgent,
      severity,
      render: (ctx) => <TrifectaSection ctx={ctx} />,
    },
  ],
};
