/**
 * §5.11 — 자율성 등급(Autonomy Level): 제안만 / 승인 후 실행 / 자율 실행 후 보고 중 어느 칸인가.
 * 등급은 `permissionMode` 만 정한다. 무응답 정책·턴 상한·격리는 같은 등급 안의 세부로 보여준다 — 등급을 흔들면 왜 그 등급인지 추적이 안 된다.
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

/** 배지는 눈여겨볼 상태일 때만 붙인다 — 늘 붙으면 카드를 다 켠 화면이 배지 띠가 되어 신호로 읽히지 않는다. */
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

/** 호스트는 이 등급만으로 정렬·접힘을 정한다 — 안 주면 `neutral` 로 떨어져 문제를 보고할 때도 접힌다. */
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
