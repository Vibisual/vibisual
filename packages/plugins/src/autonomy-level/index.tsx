/**
 * §5.11 v3.88 — 자율성 등급(Autonomy Level) 플러그인.
 *
 * "제안만 / 승인 후 실행 / 자율 실행 후 보고" 를 한눈에. 자율성을 전부 아니면 전무로 두는 것이
 * 가장 흔한 설계 실패라, 지금 이 에이전트가 어느 칸에 있는지 먼저 보이게 한다.
 *
 * 등급은 `permissionMode` 가 정하고, 무응답 정책·턴 상한·격리는 **같은 등급 안의 세부**로 보여준다
 * (등급을 흔들지 않는다 — 흔들면 왜 그 등급인지 추적이 안 된다).
 */
import type { AgentConfig } from '@vibisual/shared';
import type { PluginClientModule, PluginBubbleContext, PluginManifest, PluginSeverity } from '../sdk/index.js';
import { PluginSection, PluginRow, PluginBadgePill, type PluginTone } from '../sdk/index.js';

export const autonomyLevelManifest: PluginManifest = {
  id: 'autonomy-level',
  name: 'Autonomy Level',
  version: '1.0.0',
  category: 'workflow',
  descriptionKey: 'panel.plugins.autonomyLevel.desc',
  enabledByDefault: false,
  contributes: ['bubbleBadge', 'panelSection', 'agentPrompt'],
  clientOnly: false,
};

const K = 'panel.plugins.autonomyLevel';

export type AutonomyLevel = 'suggest' | 'approve' | 'autonomous';

export function judgeAutonomy(config: AgentConfig | undefined): {
  level: AutonomyLevel;
  /** 승인 팝업에 60초 무응답이면 자동 허용인가 — 자리를 비우면 사실상 자율에 가까워진다. */
  autoAllowOnTimeout: boolean;
  maxTurns: number | undefined;
  isolated: boolean;
} {
  const mode = config?.permissionMode;
  const level: AutonomyLevel =
    mode === 'plan' ? 'suggest' : mode === 'bypassPermissions' ? 'autonomous' : 'approve';
  return {
    level,
    autoAllowOnTimeout: (config?.permissionTimeoutPolicy ?? 'allow') === 'allow',
    maxTurns: config?.maxTurns,
    isolated: config?.isolation === 'worktree',
  };
}

const TONE: Record<AutonomyLevel, PluginTone> = { suggest: 'good', approve: 'neutral', autonomous: 'warn' };
const STEPS: AutonomyLevel[] = ['suggest', 'approve', 'autonomous'];

function judgeable(ctx: PluginBubbleContext): boolean {
  return ctx.bubbleType === 'agent' && ctx.agentConfig !== undefined;
}

/**
 * 배지는 버블 위에 직접 붙는다 — 판정과 무관하게 항상 붙으면 111종을 켠 화면은 배지 띠가 되고,
 * "배지가 떴다"가 더는 신호로 읽히지 않는다. 눈여겨볼 상태일 때만 붙인다.
 */
function badgeMatch(ctx: PluginBubbleContext): boolean {
  return judgeable(ctx) && judgeAutonomy(ctx.agentConfig).level === 'autonomous';
}

function Badge({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const v = judgeAutonomy(ctx.agentConfig);
  const idx = STEPS.indexOf(v.level);
  return (
    <PluginBadgePill tone={TONE[v.level]} title={ctx.t(`${K}.badge.${v.level}`)}>
      {STEPS.map((_, i) => (
        <span key={i} className="block w-[3px] rounded-sm bg-current" style={{ height: 4 + i * 3, opacity: i <= idx ? 1 : 0.25 }} />
      ))}
    </PluginBadgePill>
  );
}

/**
 * 호스트는 카드 내용을 열어 보지 않고 이 등급만으로 정렬·접힘을 정한다. 등급을 안 주면 `neutral` 로 떨어져
 * **문제를 보고하는 순간에도 조용한 카드로 분류돼 접힘 대상이 된다.** 카드가 이미 계산해 둔 판정을 그대로 넘긴다.
 */
function severity(ctx: PluginBubbleContext): PluginSeverity {
  return TONE[judgeAutonomy(ctx.agentConfig).level];
}

function Section({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const { t } = ctx;
  const v = judgeAutonomy(ctx.agentConfig);
  return (
    <PluginSection
      title={t(`${K}.heading`)}
      status={t(`${K}.level.${v.level}`)}
      tone={TONE[v.level]}
      note={t(`${K}.ladderNote`)}
    >
      <PluginRow label={t(`${K}.row.mode`)} value={ctx.agentConfig?.permissionMode ?? '—'} hint={t(`${K}.levelDesc.${v.level}`)} />
      <PluginRow
        label={t(`${K}.row.timeout`)}
        value={v.autoAllowOnTimeout ? t(`${K}.timeout.allow`) : t(`${K}.timeout.deny`)}
        tone={v.level === 'approve' && v.autoAllowOnTimeout ? 'warn' : 'neutral'}
        hint={v.level === 'approve' && v.autoAllowOnTimeout ? t(`${K}.timeoutHint`) : undefined}
      />
      <PluginRow label={t(`${K}.row.maxTurns`)} value={v.maxTurns && v.maxTurns > 0 ? String(v.maxTurns) : t(`${K}.unlimited`)} tone={v.maxTurns && v.maxTurns > 0 ? 'good' : 'neutral'} />
      <PluginRow label={t(`${K}.row.isolation`)} value={v.isolated ? t(`${K}.isolated`) : t(`${K}.notIsolated`)} tone={v.isolated ? 'good' : 'neutral'} />
    </PluginSection>
  );
}

export const autonomyLevelClient: PluginClientModule = {
  manifest: autonomyLevelManifest,
  usage: {
    i18nKey: 'autonomyLevel',
    checkKeys: ['row.mode', 'row.timeout', 'row.maxTurns', 'row.isolation'],
    badgeIsConditional: true,
  },
  bubbleBadges: [{ key: 'autonomy', match: badgeMatch, render: (ctx) => <Badge ctx={ctx} /> }],
  panelSections: [{ key: 'autonomy', match: judgeable, severity, render: (ctx) => <Section ctx={ctx} /> }],
};
