import type {
  AgentConfig,
  AgentQuestions,
  AgentReport,
  AgentReview,
  BubbleData,
  PermissionRequest,
  QueuedCommand,
  RunningSubagentTask,
  SubAgent,
} from '@vibisual/shared';

// SCENARIO.md §5.12 (v4.43) — 지휘통제실의 레인 파생 + 검색. **순수 함수만** 둔다.
//
// 원칙: 새 서버 상태를 만들지 않는다. 여기 있는 모든 값은 이미 graph_snapshot 으로 창에 와 있는
// 것의 파생이다(§5.12 (B)). 그래서 이 모듈은 store 를 import 하지 않고 필요한 조각만 인자로 받는다
// — 컴포넌트 없이 단위 테스트할 수 있게 하기 위함(floatingWindowGeom 선례).

/** 급한 순 5레인. 배열 순서가 곧 우선순위다(앞이 이긴다). */
export const COMMAND_CENTER_LANES = [
  'needs-answer',
  'needs-review',
  'needs-action',
  'working',
  'done',
] as const;

export type CommandCenterLane = (typeof COMMAND_CENTER_LANES)[number];

/** 한 항목 = 한 세션(IDE 탭). 에이전트 1개 = 메인 세션 1 + subAgents N. */
export interface CommandCenterItem {
  /** 렌더 key + 검색 대상 식별자. `<agentId>::<subAgentId ?? 'main'>`. */
  key: string;
  agentId: string;
  agentLabel: string;
  agentColor: string;
  /** null 이면 메인 세션 탭. */
  subAgentId: string | null;
  sessionLabel: string;
  lane: CommandCenterLane;
  /** 이 레인에 들어온 근거 한 줄(카드 미리보기). */
  laneReason: string;
  /** 레인 ①②③ 이면 그 근거가 생긴 시각 — "얼마나 기다렸나" 표시용. */
  waitingSince: number | null;
  /** 세션 상태 원본값. done 레인의 completed/idle 구분에 쓴다. */
  status: 'active' | 'idle' | 'completed' | 'error' | 'awaiting_permission' | 'disappearing';
  lastTool: string | undefined;
  lastActivityAt: number;
  contextUsed: number | undefined;
  contextMax: number | undefined;
  queuedCount: number;
  runningTaskCount: number;
  /** completed 인데 사용자가 아직 확인하지 않음 — done 레인에서 강조. */
  unacknowledged: boolean;
  /** ① 레인 질문 카드의 제안 응답 프롬프트(카드에서 칩으로 노출). */
  questionPrompts: string[];
  /** 검색 대상 전체를 소문자로 합친 것. */
  searchText: string;
}

export interface CommandCenterInput {
  projectId: string;
  agents: BubbleData[];
  agentProjects: Record<string, string>;
  agentConfigs: Record<string, AgentConfig>;
  subAgents: Record<string, SubAgent[]>;
  queuedCommands: Record<string, QueuedCommand[]>;
  runningSubagentTasks: Record<string, RunningSubagentTask[]>;
  agentQuestions: Record<string, AgentQuestions[]>;
  agentReviews: Record<string, AgentReview[]>;
  agentReports: Record<string, AgentReport[]>;
  pendingPermissions: Record<string, PermissionRequest>;
  acknowledgedSubAgents: Record<string, true>;
}

const DEFAULT_AGENT_COLOR = '#60a5fa';

function sessionKey(agentId: string, subAgentId: string | null): string {
  return `${agentId}::${subAgentId ?? 'main'}`;
}

/** 카드류(질문/검수/신고)는 `subAgentId` 가 없으면 메인 탭 소속이다(§4 v2.52 규약). */
function cardKey(agentId: string, subAgentId: string | undefined): string {
  return sessionKey(agentId, subAgentId ?? null);
}

function latestBy<T extends { createdAt: number }>(list: T[] | undefined): T | null {
  if (!list || list.length === 0) return null;
  let best = list[0] as T;
  for (const item of list) if (item.createdAt > best.createdAt) best = item;
  return best;
}

function firstLine(text: string | undefined, max = 160): string {
  if (!text) return '';
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/**
 * 스냅샷 조각 → 레인이 매겨진 항목 목록. 정렬은 하지 않는다(정렬은 sortItems 소관).
 *
 * 한 항목은 **한 레인에만** 속한다 — 위 표의 위쪽이 이긴다(일하는 중이어도 내 답을 기다리면
 * 답 대기다, §5.12 (B)).
 */
export function buildCommandCenterItems(input: CommandCenterInput): CommandCenterItem[] {
  const {
    projectId,
    agents,
    agentProjects,
    agentConfigs,
    subAgents,
    queuedCommands,
    runningSubagentTasks,
    agentQuestions,
    agentReviews,
    agentReports,
    pendingPermissions,
    acknowledgedSubAgents,
  } = input;

  const projectAgents = agents.filter(
    (a) => a.bubbleType === 'agent' && !a.trashed && agentProjects[a.id] === projectId,
  );
  if (projectAgents.length === 0) return [];
  const agentIds = new Set(projectAgents.map((a) => a.id));

  // ── 세션별 근거 수집 (한 번씩만 훑는다) ────────────────────────────────
  const questionByKey = new Map<string, AgentQuestions>();
  const reviewByKey = new Map<string, AgentReview>();
  const reportByKey = new Map<string, AgentReport>();
  const permissionByKey = new Map<string, PermissionRequest>();
  const queuedByKey = new Map<string, number>();
  const runningByKey = new Map<string, number>();

  for (const agentId of agentIds) {
    for (const q of agentQuestions[agentId] ?? []) {
      if (q.items.length === 0) continue;
      const k = cardKey(agentId, q.subAgentId);
      const prev = questionByKey.get(k);
      if (!prev || q.createdAt > prev.createdAt) questionByKey.set(k, q);
    }
    for (const r of agentReviews[agentId] ?? []) {
      if (r.changes.length === 0) continue;
      const k = cardKey(agentId, r.subAgentId);
      const prev = reviewByKey.get(k);
      if (!prev || r.createdAt > prev.createdAt) reviewByKey.set(k, r);
    }
    for (const r of agentReports[agentId] ?? []) {
      if (!r.userActions || r.userActions.length === 0) continue;
      const k = cardKey(agentId, r.subAgentId);
      const prev = reportByKey.get(k);
      if (!prev || r.createdAt > prev.createdAt) reportByKey.set(k, r);
    }
    for (const cmd of queuedCommands[agentId] ?? []) {
      if (cmd.status !== 'queued' && cmd.status !== 'executing') continue;
      const k = sessionKey(agentId, cmd.subAgentId);
      queuedByKey.set(k, (queuedByKey.get(k) ?? 0) + 1);
    }
    for (const task of runningSubagentTasks[agentId] ?? []) {
      const k = cardKey(agentId, task.subAgentId);
      runningByKey.set(k, (runningByKey.get(k) ?? 0) + 1);
    }
  }

  for (const req of Object.values(pendingPermissions)) {
    if (!agentIds.has(req.agentId)) continue;
    const k = cardKey(req.agentId, req.subAgentId);
    const prev = permissionByKey.get(k);
    if (!prev || req.createdAt > prev.createdAt) permissionByKey.set(k, req);
  }

  // ── 세션 단위로 항목 만들기 ─────────────────────────────────────────────
  const out: CommandCenterItem[] = [];

  for (const agent of projectAgents) {
    const agentColor = agentConfigs[agent.id]?.color ?? DEFAULT_AGENT_COLOR;
    const subs = subAgents[agent.id] ?? [];

    const sessions: Array<{
      subAgentId: string | null;
      sessionLabel: string;
      status: CommandCenterItem['status'];
      lastActivityAt: number;
      lastTool: string | undefined;
      lastCommand: string | undefined;
      lastResult: string | undefined;
      contextUsed: number | undefined;
      contextMax: number | undefined;
      acked: boolean;
    }> = [
      {
        subAgentId: null,
        sessionLabel: agent.label,
        status: agent.status,
        lastActivityAt: agent.lastActivity ?? 0,
        lastTool: agent.lastTool,
        lastCommand: undefined,
        lastResult: agent.summary,
        contextUsed: undefined,
        contextMax: undefined,
        acked: true,
      },
      ...subs.map((sub) => ({
        subAgentId: sub.id,
        sessionLabel: sub.label,
        status: sub.status,
        lastActivityAt: sub.lastActivityAt,
        lastTool: undefined,
        lastCommand: sub.lastCommand,
        lastResult: sub.lastResult,
        contextUsed: sub.contextUsed,
        contextMax: sub.contextMax,
        acked: !!acknowledgedSubAgents[sub.id],
      })),
    ];

    for (const s of sessions) {
      const key = sessionKey(agent.id, s.subAgentId);
      const question = questionByKey.get(key) ?? null;
      const permission = permissionByKey.get(key) ?? null;
      const review = reviewByKey.get(key) ?? null;
      const report = reportByKey.get(key) ?? null;
      const queuedCount = queuedByKey.get(key) ?? 0;
      const runningTaskCount = runningByKey.get(key) ?? 0;

      let lane: CommandCenterLane;
      let laneReason: string;
      let waitingSince: number | null = null;
      let questionPrompts: string[] = [];

      if (permission) {
        lane = 'needs-answer';
        laneReason = permission.toolName;
        waitingSince = permission.createdAt;
      } else if (question) {
        lane = 'needs-answer';
        const head = question.items[0];
        laneReason = firstLine(head?.header || head?.question);
        waitingSince = question.createdAt;
        questionPrompts = question.items.flatMap((i) => i.prompts).slice(0, 6);
      } else if (s.status === 'awaiting_permission') {
        lane = 'needs-answer';
        laneReason = firstLine(s.lastCommand);
        waitingSince = s.lastActivityAt || null;
      } else if (review) {
        lane = 'needs-review';
        laneReason = firstLine(review.instruction || review.changes[0]);
        waitingSince = review.createdAt;
      } else if (report) {
        lane = 'needs-action';
        laneReason = firstLine(report.userActions[0]);
        waitingSince = report.createdAt;
      } else if (s.status === 'active' || runningTaskCount > 0 || queuedCount > 0) {
        lane = 'working';
        laneReason = firstLine(s.lastCommand || s.lastTool);
      } else {
        lane = 'done';
        laneReason = firstLine(s.lastResult || s.lastCommand);
      }

      const unacknowledged = lane === 'done' && s.status === 'completed' && !s.acked;

      const searchParts = [
        agent.label,
        s.sessionLabel,
        s.lastTool ?? '',
        s.lastCommand ?? '',
        s.lastResult ?? '',
        laneReason,
        question ? question.items.map((i) => `${i.header ?? ''} ${i.question}`).join(' ') : '',
        review ? [review.instruction ?? '', ...review.changes, ...review.checkpoints].join(' ') : '',
        report ? [...report.userActions, ...report.did].join(' ') : '',
        permission ? permission.toolName : '',
        ...(queuedCommands[agent.id] ?? [])
          .filter((c) => sessionKey(agent.id, c.subAgentId) === key)
          .map((c) => c.text),
      ];

      out.push({
        key,
        agentId: agent.id,
        agentLabel: agent.label,
        agentColor,
        subAgentId: s.subAgentId,
        sessionLabel: s.sessionLabel,
        lane,
        laneReason,
        waitingSince,
        status: s.status,
        lastTool: s.lastTool,
        lastActivityAt: s.lastActivityAt,
        contextUsed: s.contextUsed,
        contextMax: s.contextMax,
        queuedCount,
        runningTaskCount,
        unacknowledged,
        questionPrompts,
        searchText: searchParts.join('   ').toLowerCase(),
      });
    }
  }

  return out;
}

// ─── 검색 (§5.12 (C)) ───────────────────────────────────────────────────────

export interface CommandCenterQuery {
  /** 자유 문자열(전부 소문자, AND). */
  terms: string[];
  /** `is:` / `needs:` 로 지정된 레인. 비어 있으면 전체. */
  lanes: Set<CommandCenterLane>;
  /** `is:idle` — done 레인 중 미확인이 아닌 것만. */
  idleOnly: boolean;
  /** `is:completed` — 확인 대기 중인 완료만. */
  unackOnly: boolean;
  /** `agent:<조각>` (AND). */
  agentFragments: string[];
  /** `tool:<조각>` (AND). */
  toolFragments: string[];
}

const LANE_TOKENS: Record<string, CommandCenterLane> = {
  'is:working': 'working',
  'is:done': 'done',
  'needs:answer': 'needs-answer',
  'needs:review': 'needs-review',
  'needs:action': 'needs-action',
};

export function parseCommandCenterQuery(raw: string): CommandCenterQuery {
  const query: CommandCenterQuery = {
    terms: [],
    lanes: new Set<CommandCenterLane>(),
    idleOnly: false,
    unackOnly: false,
    agentFragments: [],
    toolFragments: [],
  };
  for (const rawToken of raw.split(/\s+/)) {
    const token = rawToken.trim();
    if (!token) continue;
    const lower = token.toLowerCase();
    const lane = LANE_TOKENS[lower];
    if (lane) {
      query.lanes.add(lane);
      continue;
    }
    if (lower === 'is:idle') {
      query.lanes.add('done');
      query.idleOnly = true;
      continue;
    }
    if (lower === 'is:completed') {
      query.lanes.add('done');
      query.unackOnly = true;
      continue;
    }
    if (lower.startsWith('agent:') && lower.length > 6) {
      query.agentFragments.push(lower.slice(6));
      continue;
    }
    if (lower.startsWith('tool:') && lower.length > 5) {
      query.toolFragments.push(lower.slice(5));
      continue;
    }
    query.terms.push(lower);
  }
  return query;
}

export function isEmptyQuery(query: CommandCenterQuery): boolean {
  return (
    query.terms.length === 0 &&
    query.lanes.size === 0 &&
    query.agentFragments.length === 0 &&
    query.toolFragments.length === 0
  );
}

export function matchesQuery(item: CommandCenterItem, query: CommandCenterQuery): boolean {
  if (query.lanes.size > 0 && !query.lanes.has(item.lane)) return false;
  if (query.idleOnly && item.unacknowledged) return false;
  if (query.unackOnly && !item.unacknowledged) return false;
  for (const frag of query.agentFragments) {
    if (!item.agentLabel.toLowerCase().includes(frag)) return false;
  }
  for (const frag of query.toolFragments) {
    if (!(item.lastTool ?? '').toLowerCase().includes(frag)) return false;
  }
  for (const term of query.terms) {
    if (!item.searchText.includes(term)) return false;
  }
  return true;
}

export function filterCommandCenterItems(
  items: CommandCenterItem[],
  query: CommandCenterQuery,
): CommandCenterItem[] {
  if (isEmptyQuery(query)) return items;
  return items.filter((item) => matchesQuery(item, query));
}

// ─── 정리 (§5.12 (E)) ───────────────────────────────────────────────────────

export type CommandCenterSort = 'recent' | 'waiting' | 'context';

/**
 * 정렬 — `recent`(마지막 활동 최신순) / `waiting`(대기가 긴 순) / `context`(컨텍스트 잔량 적은 순).
 * 원본 배열을 건드리지 않는다.
 */
export function sortCommandCenterItems(
  items: CommandCenterItem[],
  sort: CommandCenterSort,
): CommandCenterItem[] {
  const copy = [...items];
  if (sort === 'waiting') {
    copy.sort((a, b) => {
      const aw = a.waitingSince ?? Number.POSITIVE_INFINITY;
      const bw = b.waitingSince ?? Number.POSITIVE_INFINITY;
      if (aw !== bw) return aw - bw; // 오래 기다린 것(작은 timestamp)이 위로
      return b.lastActivityAt - a.lastActivityAt;
    });
    return copy;
  }
  if (sort === 'context') {
    const remaining = (item: CommandCenterItem): number => {
      if (!item.contextMax || item.contextMax <= 0) return Number.POSITIVE_INFINITY;
      return item.contextMax - (item.contextUsed ?? 0);
    };
    copy.sort((a, b) => {
      const ar = remaining(a);
      const br = remaining(b);
      if (ar !== br) return ar - br; // 잔량이 적은 것이 위로
      return b.lastActivityAt - a.lastActivityAt;
    });
    return copy;
  }
  copy.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return copy;
}

/** 자동 정리 문턱 선택지(분). §5.12 (E). */
export const AUTO_TIDY_MINUTES = [10, 30, 60, 180] as const;

/**
 * 자동 정리 대상 판정 — **표시 접기 전용**. 세션을 종료하지 않는다(§5.12 (G)).
 * ⑤ done 레인의 유휴 세션 중 마지막 활동이 문턱보다 오래된 것만.
 */
export function isAutoTidyTarget(
  item: CommandCenterItem,
  now: number,
  thresholdMinutes: number,
): boolean {
  if (item.lane !== 'done') return false;
  if (item.unacknowledged) return false;
  if (!item.lastActivityAt) return true;
  return now - item.lastActivityAt > thresholdMinutes * 60_000;
}

/** 레인별로 나눠 담는다. 비어 있는 레인도 키는 존재한다(UI 가 접기 처리). */
export function groupByLane(
  items: CommandCenterItem[],
): Record<CommandCenterLane, CommandCenterItem[]> {
  const out = {
    'needs-answer': [] as CommandCenterItem[],
    'needs-review': [] as CommandCenterItem[],
    'needs-action': [] as CommandCenterItem[],
    working: [] as CommandCenterItem[],
    done: [] as CommandCenterItem[],
  };
  for (const item of items) out[item.lane].push(item);
  return out;
}

/**
 * 경과 시간을 단위 + 값으로 쪼갠다. 문자열 조립은 i18n 이 하도록 여기선 숫자만 낸다.
 * (컴포넌트가 `commandCenter.time.<unit>` 키로 번역)
 */
export function elapsedParts(ms: number): { unit: 'now' | 'min' | 'hour' | 'day'; value: number } {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60_000);
  if (minutes < 1) return { unit: 'now', value: 0 };
  if (minutes < 60) return { unit: 'min', value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hour', value: hours };
  return { unit: 'day', value: Math.floor(hours / 24) };
}

/** 컨텍스트 게이지 색 단계 — 80% amber, 92% red(§5.12 (B)). */
export function contextLevel(
  used: number | undefined,
  max: number | undefined,
): { ratio: number; level: 'ok' | 'warn' | 'critical' } | null {
  if (!max || max <= 0 || used === undefined) return null;
  const ratio = Math.max(0, Math.min(1, used / max));
  if (ratio >= 0.92) return { ratio, level: 'critical' };
  if (ratio >= 0.8) return { ratio, level: 'warn' };
  return { ratio, level: 'ok' };
}
