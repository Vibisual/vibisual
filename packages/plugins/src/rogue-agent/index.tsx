/**
 * §5.11 v3.88 — 통제 이탈·유휴 에이전트(Rogue Agent) 플러그인.
 *
 * 실제 사고의 상당수는 악의가 아니라 "그게 아직 돌고 있는 줄 몰랐다"에서 온다. 만드는 비용이 0 에
 * 가까워질수록 아무도 목록을 모르는 상태가 기본값이 되므로, **마지막 활동 이후 얼마나 지났는지**를
 * 버블에 직접 붙인다.
 *
 * 표시 전용이다 — 여기서 정지시키지 않는다. 자동 정지는 사용자가 만든 것을 조용히 끄는 일이라
 * 별도 결정이 필요하고, 이 플러그인은 "보이게 하는 것"까지만 맡는다.
 */
import type { SubAgent } from '@vibisual/shared';
import type { PluginClientModule, PluginBubbleContext, PluginManifest, PluginSeverity } from '../types.js';
import { PluginSection, PluginRow, PluginBadgePill, formatElapsed, type PluginTone } from '../ui/kit.js';

export const rogueAgentManifest: PluginManifest = {
  id: 'rogue-agent',
  name: 'Idle & Rogue Agents',
  version: '1.0.0',
  category: 'security',
  descriptionKey: 'panel.plugins.rogueAgent.desc',
  enabledByDefault: false,
  contributes: ['bubbleBadge', 'panelSection'],
  clientOnly: true,
};

const K = 'panel.plugins.rogueAgent';

const IDLE_WARN_MS = 30 * 60_000;
const IDLE_STALE_MS = 6 * 60 * 60_000;

export interface RogueVerdict {
  idleMs: number;
  liveSessions: number;
  totalSessions: number;
  level: 'active' | 'idle' | 'forgotten';
}

const LIVE: ReadonlySet<string> = new Set(['running', 'busy', 'active', 'working']);

export function judgeRogue(subAgents: readonly SubAgent[] | undefined, now: number): RogueVerdict {
  const list = subAgents ?? [];
  const lastActivity = list.reduce((max, s) => Math.max(max, s.lastActivityAt ?? 0), 0);
  const idleMs = lastActivity > 0 ? Math.max(0, now - lastActivity) : 0;
  const liveSessions = list.filter((s) => LIVE.has(String(s.status))).length;

  // "잊힌" 판정은 세션이 살아 있는데 오래 조용한 경우로 좁힌다 — 그냥 끝난 에이전트는 유휴가 정상이다.
  const level: RogueVerdict['level'] =
    liveSessions > 0 && idleMs >= IDLE_STALE_MS ? 'forgotten'
      : liveSessions > 0 && idleMs >= IDLE_WARN_MS ? 'idle'
        : 'active';

  return { idleMs, liveSessions, totalSessions: list.length, level };
}

const TONE: Record<RogueVerdict['level'], PluginTone> = { active: 'good', idle: 'warn', forgotten: 'bad' };

function isAgent(ctx: PluginBubbleContext): boolean {
  return ctx.bubbleType === 'agent';
}

function badgeMatch(ctx: PluginBubbleContext): boolean {
  return isAgent(ctx) && judgeRogue(ctx.data.subAgents, ctx.now).level !== 'active';
}

function Badge({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const v = judgeRogue(ctx.data.subAgents, ctx.now);
  return (
    <PluginBadgePill tone={TONE[v.level]} title={ctx.t(`${K}.badge.${v.level}`, { elapsed: formatElapsed(v.idleMs) })}>
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a9 9 0 1 1-6.4 2.6" /><path d="M5 3v3.5h3.5" /><path d="M12 8v4.5l3 1.5" />
      </svg>
      {formatElapsed(v.idleMs)}
    </PluginBadgePill>
  );
}

/**
 * 호스트는 카드 내용을 열어 보지 않고 이 등급만으로 정렬·접힘을 정한다. 등급을 안 주면 `neutral` 로 떨어져
 * **문제를 보고하는 순간에도 조용한 카드로 분류돼 접힘 대상이 된다.** 카드가 이미 계산해 둔 판정을 그대로 넘긴다.
 */
function severity(ctx: PluginBubbleContext): PluginSeverity {
  return TONE[judgeRogue(ctx.data.subAgents, ctx.now).level];
}

function Section({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const { t } = ctx;
  const v = judgeRogue(ctx.data.subAgents, ctx.now);
  return (
    <PluginSection
      title={t(`${K}.heading`)}
      status={t(`${K}.level.${v.level}`)}
      tone={TONE[v.level]}
      note={v.level === 'active' ? t(`${K}.activeNote`) : t(`${K}.idleNote`)}
    >
      <PluginRow label={t(`${K}.row.idle`)} value={v.idleMs > 0 ? formatElapsed(v.idleMs) : '—'} tone={TONE[v.level]} />
      <PluginRow label={t(`${K}.row.live`)} value={String(v.liveSessions)} tone={v.liveSessions > 0 ? 'neutral' : 'good'} />
      <PluginRow label={t(`${K}.row.total`)} value={String(v.totalSessions)} />
    </PluginSection>
  );
}

export const rogueAgentClient: PluginClientModule = {
  manifest: rogueAgentManifest,
  usage: {
    i18nKey: 'rogueAgent',
    checkKeys: ['row.idle', 'row.live', 'row.total'],
    badgeIsConditional: true,
  },
  needs: ['subAgents'],
  bubbleBadges: [{ key: 'rogue', match: badgeMatch, render: (ctx) => <Badge ctx={ctx} /> }],
  panelSections: [{ key: 'rogue', match: isAgent, severity, render: (ctx) => <Section ctx={ctx} /> }],
};
