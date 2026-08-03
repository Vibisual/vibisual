/** §5.11 v3.88 — 최소 권한 플러그인 (배지 + 패널 섹션). 표시 전용. */
import type { PluginClientModule, PluginBubbleContext, PluginManifest, PluginSeverity } from '../types.js';
import { PluginSection, PluginRow, PluginBadgePill, type PluginTone } from '../ui/kit.js';
import { judgeLeastPrivilege } from './leastPrivilege.js';

export const leastPrivilegeManifest: PluginManifest = {
  id: 'least-privilege',
  name: 'Least Privilege',
  version: '1.0.0',
  category: 'security',
  descriptionKey: 'panel.plugins.leastPrivilege.desc',
  enabledByDefault: false,
  contributes: ['bubbleBadge', 'panelSection'],
  clientOnly: true,
};

const K = 'panel.plugins.leastPrivilege';
const TONE: Record<string, PluginTone> = { tight: 'good', broad: 'warn', wide: 'bad' };

function judgeable(ctx: PluginBubbleContext): boolean {
  return ctx.bubbleType === 'agent' && ctx.agentConfig !== undefined;
}

/**
 * 배지는 버블 위에 직접 붙는다 — 판정과 무관하게 항상 붙으면 111종을 켠 화면은 배지 띠가 되고,
 * "배지가 떴다"가 더는 신호로 읽히지 않는다. 눈여겨볼 상태일 때만 붙인다.
 */
function badgeMatch(ctx: PluginBubbleContext): boolean {
  return judgeable(ctx) && judgeLeastPrivilege(ctx.agentConfig).level !== 'tight';
}

function Badge({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const v = judgeLeastPrivilege(ctx.agentConfig);
  return (
    <PluginBadgePill tone={TONE[v.level] ?? 'neutral'} title={ctx.t(`${K}.badge.${v.level}`, { count: v.powerCount })}>
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0" />
      </svg>
      {v.powerCount}
    </PluginBadgePill>
  );
}

/**
 * 호스트는 카드 내용을 열어 보지 않고 이 등급만으로 정렬·접힘을 정한다. 등급을 안 주면 `neutral` 로 떨어져
 * **문제를 보고하는 순간에도 조용한 카드로 분류돼 접힘 대상이 된다.** 카드가 이미 계산해 둔 판정을 그대로 넘긴다.
 */
function severity(ctx: PluginBubbleContext): PluginSeverity {
  return TONE[judgeLeastPrivilege(ctx.agentConfig).level] ?? 'neutral';
}

function Section({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const { t } = ctx;
  const v = judgeLeastPrivilege(ctx.agentConfig);
  const list = (items: string[]): string => (items.length > 0 ? items.join(' · ') : t(`${K}.none`));

  return (
    <PluginSection
      title={t(`${K}.heading`)}
      status={t(`${K}.level.${v.level}`)}
      tone={TONE[v.level] ?? 'neutral'}
      note={v.locked.length > 0 ? t(`${K}.lockedNote`, { tools: v.locked.join(', ') }) : t(`${K}.displayOnly`)}
    >
      <PluginRow label={t(`${K}.class.mutating`)} value={String(v.byClass.mutating.length)} tone={v.byClass.mutating.length > 0 ? 'warn' : 'good'} hint={list(v.byClass.mutating)} />
      <PluginRow label={t(`${K}.class.reach`)} value={String(v.byClass.reach.length)} tone={v.byClass.reach.length > 0 ? 'warn' : 'good'} hint={list(v.byClass.reach)} />
      <PluginRow label={t(`${K}.class.read`)} value={String(v.byClass.read.length)} hint={list(v.byClass.read)} />
      <PluginRow label={t(`${K}.denied`)} value={String(v.denied.length)} tone={v.denied.length > 0 ? 'good' : 'neutral'} hint={list(v.denied)} />
    </PluginSection>
  );
}

export const leastPrivilegeClient: PluginClientModule = {
  manifest: leastPrivilegeManifest,
  usage: {
    i18nKey: 'leastPrivilege',
    checkKeys: ['class.mutating', 'class.reach', 'class.read', 'denied'],
    badgeIsConditional: true,
  },
  bubbleBadges: [{ key: 'lp', match: badgeMatch, render: (ctx) => <Badge ctx={ctx} /> }],
  panelSections: [{ key: 'lp', match: judgeable, severity, render: (ctx) => <Section ctx={ctx} /> }],
};
