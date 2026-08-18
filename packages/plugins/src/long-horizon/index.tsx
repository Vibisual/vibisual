/**
 * §5.11 v3.88 — 장기 지평 작업(Long-Horizon Task) 플러그인.
 *
 * 긴 작업의 실패는 대개 능력 부족이 아니라 맥락 소진·누적 오차에서 온다. 그래서 "지금 이 세션이
 * 얼마나 길어졌는가"를 먼저 보이게 한다 — 턴 수, 첫 지시 이후 경과, 마지막 할일 진행률.
 *
 * 이 플러그인은 `agentEvents` 를 요구한다(`needs`). 요청하지 않으면 호스트가 데이터를 채우지 않으므로
 * 꺼져 있는 동안에는 스토어를 읽는 비용조차 들지 않는다.
 */
import type { AgentEvent } from '@vibisual/shared';
import type { PluginClientModule, PluginBubbleContext, PluginManifest, PluginSeverity } from '../sdk/index.js';
import { PluginSection, PluginRow, PluginBadgePill, formatElapsed, type PluginTone } from '../sdk/index.js';

export const longHorizonManifest: PluginManifest = {
  id: 'long-horizon',
  name: 'Long-Horizon Task',
  version: '1.0.0',
  category: 'observability',
  descriptionKey: 'panel.plugins.longHorizon.desc',
  enabledByDefault: false,
  contributes: ['bubbleBadge', 'panelSection', 'agentPrompt'],
  clientOnly: false,
};

const K = 'panel.plugins.longHorizon';

/** 이 턴 수를 넘으면 "길어지고 있다"로 본다. 절대 기준이 아니라 눈에 띄게 하는 문턱. */
const TURN_WARN = 15;
const TURN_LONG = 40;

export interface LongHorizonStats {
  turns: number;
  elapsedMs: number;
  todoDone: number;
  todoTotal: number;
  level: 'short' | 'long' | 'verylong';
}

export function computeLongHorizon(events: readonly AgentEvent[] | undefined, now: number): LongHorizonStats {
  const list = events ?? [];
  const turns = list.length;
  const first = list[0]?.timestamp;
  const elapsedMs = first ? Math.max(0, now - first) : 0;

  // 마지막으로 기록된 할일 목록이 현재 진행률. 없으면 0/0.
  let todoDone = 0;
  let todoTotal = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const todos = list[i]?.todos;
    if (todos && todos.length > 0) {
      todoTotal = todos.length;
      todoDone = todos.filter((td) => td.status === 'completed').length;
      break;
    }
  }

  const level: LongHorizonStats['level'] = turns >= TURN_LONG ? 'verylong' : turns >= TURN_WARN ? 'long' : 'short';
  return { turns, elapsedMs, todoDone, todoTotal, level };
}

const TONE: Record<LongHorizonStats['level'], PluginTone> = { short: 'neutral', long: 'warn', verylong: 'bad' };

function isAgent(ctx: PluginBubbleContext): boolean {
  return ctx.bubbleType === 'agent';
}

/** 배지는 길어졌을 때만 — 평상시에도 뜨면 그냥 배경이 된다. */
function badgeMatch(ctx: PluginBubbleContext): boolean {
  if (!isAgent(ctx)) return false;
  return computeLongHorizon(ctx.data.agentEvents, ctx.now).level !== 'short';
}

function Badge({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const s = computeLongHorizon(ctx.data.agentEvents, ctx.now);
  return (
    <PluginBadgePill tone={TONE[s.level]} title={ctx.t(`${K}.badge`, { turns: s.turns, elapsed: formatElapsed(s.elapsedMs) })}>
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
      </svg>
      {s.turns}
    </PluginBadgePill>
  );
}

/**
 * 호스트는 카드 내용을 열어 보지 않고 이 등급만으로 정렬·접힘을 정한다. 등급을 안 주면 `neutral` 로 떨어져
 * **문제를 보고하는 순간에도 조용한 카드로 분류돼 접힘 대상이 된다.** 카드가 이미 계산해 둔 판정을 그대로 넘긴다.
 */
function severity(ctx: PluginBubbleContext): PluginSeverity {
  return TONE[computeLongHorizon(ctx.data.agentEvents, ctx.now).level];
}

function Section({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const { t } = ctx;
  const s = computeLongHorizon(ctx.data.agentEvents, ctx.now);
  return (
    <PluginSection
      title={t(`${K}.heading`)}
      status={t(`${K}.level.${s.level}`)}
      tone={TONE[s.level]}
      note={s.level === 'short' ? t(`${K}.shortNote`) : t(`${K}.longNote`)}
    >
      <PluginRow label={t(`${K}.row.turns`)} value={String(s.turns)} tone={TONE[s.level]} />
      <PluginRow label={t(`${K}.row.elapsed`)} value={s.elapsedMs > 0 ? formatElapsed(s.elapsedMs) : '—'} />
      <PluginRow
        label={t(`${K}.row.todos`)}
        value={s.todoTotal > 0 ? `${s.todoDone}/${s.todoTotal}` : '—'}
        tone={s.todoTotal > 0 && s.todoDone === s.todoTotal ? 'good' : 'neutral'}
      />
    </PluginSection>
  );
}

export const longHorizonClient: PluginClientModule = {
  manifest: longHorizonManifest,
  usage: {
    i18nKey: 'longHorizon',
    checkKeys: ['row.turns', 'row.elapsed', 'row.todos'],
    badgeIsConditional: true,
  },
  needs: ['agentEvents'],
  bubbleBadges: [{ key: 'lh', match: badgeMatch, render: (ctx) => <Badge ctx={ctx} /> }],
  panelSections: [{ key: 'lh', match: isAgent, severity, render: (ctx) => <Section ctx={ctx} /> }],
};
