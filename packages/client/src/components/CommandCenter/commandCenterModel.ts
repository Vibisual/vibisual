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
import { isReadOnlyHookAgent, hasSessionWork } from '@vibisual/shared';
import type { SessionRunInputs } from '@vibisual/shared';
import { NODE_STATUS_AS_SUB_STATUS } from '../../utils/sessionStatus.js';

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

/** 레인의 급한 순 순위(0 이 가장 급하다). 배열 인덱스가 곧 순위라 표와 코드가 어긋날 수 없다. */
export function laneRank(lane: CommandCenterLane): number {
  const idx = COMMAND_CENTER_LANES.indexOf(lane);
  return idx < 0 ? COMMAND_CENTER_LANES.length : idx;
}

/**
 * 상세 패널(§5.12 (H))이 펼쳐 보여 줄 **근거 원문**. 전부 이미 창 안에 와 있는 스냅샷 값의
 * 참조라 서버 왕복이 없다 — 새 REST 를 만들지 않는다는 §5.12 (G) 를 그대로 지킨다.
 *
 * 스트림(assistant 텍스트)은 여기 들어오지 않는다. 카드(질문/검수/신고)와 큐 텍스트뿐이다.
 */
export interface CommandCenterDetailData {
  question: AgentQuestions | null;
  review: AgentReview | null;
  report: AgentReport | null;
  permission: PermissionRequest | null;
  /** 이 세션에 쌓인 대기 명령 텍스트(오래된 순). */
  queuedTexts: string[];
  /** 근거 카드가 하나도 없는 세션에 남는 최소한의 맥락. */
  lastCommand: string | undefined;
  lastResult: string | undefined;
}

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
  /**
   * §5.12 (I) — 이 레인에 들어온 시각. `stabilizeLanes` 가 채운다(0 = 아직 모름).
   * ④ 작업 중 레인의 정렬 키 — 도구를 몇 번 쓰든 변하지 않아야 카드가 자리를 지킨다.
   */
  laneSince: number;
  /**
   * §5.12 (I) — 세션이 만들어진 시각(`SubAgent.createdAt`). 메인 탭은 스냅샷에 생성 시각이
   * 없어 0(= 그 에이전트의 세션들 중 가장 위). 최종 동점을 푸는 고정값이다.
   */
  startedAt: number;
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
  /**
   * §5.5 #17-29 — 훅으로 태어난 버블의 세션이면 true. 카드는 그대로 보여 주되(관측은 막지 않는다)
   * **명령 보내기 손잡이**를 지운다. 서버도 같은 술어로 403 을 돌려주므로 화면과 어긋나지 않는다.
   */
  readOnly: boolean;
  /** ① 레인 질문 카드의 제안 응답 프롬프트(카드에서 칩으로 노출). */
  questionPrompts: string[];
  /** 상세 패널이 쓰는 근거 원문(§5.12 (H)). */
  detail: CommandCenterDetailData;
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
  /**
   * §5.12 (B) v4.55 — 끝난 프롬프트 이력. 대기 **개수**에는 들어가지 않지만, 카드가 아직 스트림
   * 맨 끝인지(= 살아 있는지) 재는 자다. 큐만 보면 "답이 이미 갔다"는 사실이 스냅샷에서 사라진다.
   */
  completedCommands: Record<string, QueuedCommand[]>;
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
 *
 * ①②③ 의 근거 카드는 **아직 스트림 맨 끝인 것**만 쓴다(v4.55) — 뒤에 프롬프트가 온 카드는 사용자가
 * 이미 답하고 지나간 것이라 대기가 아니다(`isLiveCard`).
 */
export function buildCommandCenterItems(input: CommandCenterInput): CommandCenterItem[] {
  const {
    projectId,
    agents,
    agentProjects,
    agentConfigs,
    subAgents,
    queuedCommands,
    completedCommands,
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
  /** 그중 **지금 나가 있는**(executing) 것만. 레인 판정이 IDE 와 같은 함수를 쓰기 위해 따로 센다. */
  const executingByKey = new Map<string, number>();
  const queuedTextsByKey = new Map<string, string[]>();
  const runningByKey = new Map<string, number>();
  const promptFloorByKey = new Map<string, number>();

  // 프롬프트 바닥을 **먼저** 깐다 — 카드 수집이 이 값으로 지나간 카드를 걸러 내기 때문이다.
  for (const agentId of agentIds) {
    let agentFloor = 0;
    for (const list of [queuedCommands[agentId], completedCommands[agentId]]) {
      for (const cmd of list ?? []) {
        if (cmd.timestamp > agentFloor) agentFloor = cmd.timestamp;
        const k = sessionKey(agentId, cmd.subAgentId);
        if (cmd.timestamp > (promptFloorByKey.get(k) ?? 0)) promptFloorByKey.set(k, cmd.timestamp);
      }
    }
    // 메인 탭은 IDE 메인 타임라인과 같은 자를 쓴다 — 그 에이전트 **전 세션**의 프롬프트.
    if (agentFloor > 0) promptFloorByKey.set(sessionKey(agentId, null), agentFloor);
  }

  /**
   * 그 카드가 아직 세션 스트림의 **맨 끝**인가(§5.12 (B) v4.55).
   *
   * IDE 가 카드를 놓는 규칙(`turnEndSortTs`)과 같은 자다 — 카드 뒤에 프롬프트가 하나라도 있으면
   * 그 카드는 다음 턴 앞으로 밀려 **중간**으로 올라간다. 그런 카드는 사용자가 이미 답한 것이므로
   * "지금 나를 기다리는 것"에서 빠져야 한다.
   */
  const isLiveCard = (key: string, createdAt: number): boolean =>
    createdAt >= (promptFloorByKey.get(key) ?? 0);

  for (const agentId of agentIds) {
    for (const q of agentQuestions[agentId] ?? []) {
      if (q.items.length === 0) continue;
      const k = cardKey(agentId, q.subAgentId);
      if (!isLiveCard(k, q.createdAt)) continue;
      const prev = questionByKey.get(k);
      if (!prev || q.createdAt > prev.createdAt) questionByKey.set(k, q);
    }
    for (const r of agentReviews[agentId] ?? []) {
      if (r.changes.length === 0) continue;
      const k = cardKey(agentId, r.subAgentId);
      if (!isLiveCard(k, r.createdAt)) continue;
      const prev = reviewByKey.get(k);
      if (!prev || r.createdAt > prev.createdAt) reviewByKey.set(k, r);
    }
    for (const r of agentReports[agentId] ?? []) {
      if (!r.userActions || r.userActions.length === 0) continue;
      const k = cardKey(agentId, r.subAgentId);
      if (!isLiveCard(k, r.createdAt)) continue;
      const prev = reportByKey.get(k);
      if (!prev || r.createdAt > prev.createdAt) reportByKey.set(k, r);
    }
    for (const cmd of queuedCommands[agentId] ?? []) {
      if (cmd.status !== 'queued' && cmd.status !== 'executing') continue;
      const k = sessionKey(agentId, cmd.subAgentId);
      queuedByKey.set(k, (queuedByKey.get(k) ?? 0) + 1);
      // "잔량"(카드에 뜨는 수)과 "지금 나가 있는가"는 다른 질문이다 — 후자만 따로 센다.
      if (cmd.status === 'executing') executingByKey.set(k, (executingByKey.get(k) ?? 0) + 1);
      const texts = queuedTextsByKey.get(k) ?? [];
      texts.push(cmd.text);
      queuedTextsByKey.set(k, texts);
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
      /** 세션 생성 시각 — 정렬의 최종 동점을 푸는 고정값(§5.12 (I)). */
      startedAt: number;
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
        startedAt: 0, // 버블에는 생성 시각이 없다 — 메인 탭을 그 에이전트의 맨 위에 둔다.
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
        startedAt: sub.createdAt,
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
      // §5.12 (B) ④ 의 판정 근거 4종(버블/세션 status · 백그라운드 Task · 큐 잔량)을 IDE 와
      //   **같은 함수**(`hasSessionWork`)에 넘긴다. 식을 두 벌로 두면 또 갈라진다.
      const runInputs: SessionRunInputs = {
        // 메인 탭(버블)과 sub 탭(세션)이 한 목록에 섞이므로 세션 축으로 먼저 정규화한다.
        subStatus: NODE_STATUS_AS_SUB_STATUS[s.status],
        hasExecutingCommand: (executingByKey.get(key) ?? 0) > 0,
        hasQueuedCommand: queuedCount > 0,
        runningTaskCount,
        acknowledged: s.acked,
      };

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
      } else if (hasSessionWork(runInputs)) {
        lane = 'working';
        // §5.12 (I) — 도구 이름은 메타 줄에 칩으로 이미 있다. 본문까지 도구마다 바뀌면
        // 글자가 깜빡이므로 **명령 → 마지막 결과** 를 먼저 쓰고 도구는 마지막 수단이다.
        laneReason = firstLine(s.lastCommand || s.lastResult || s.lastTool);
      } else {
        lane = 'done';
        laneReason = firstLine(s.lastResult || s.lastCommand);
      }

      const unacknowledged = lane === 'done' && s.status === 'completed' && !s.acked;
      const queuedTexts = queuedTextsByKey.get(key) ?? [];

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
        ...queuedTexts,
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
        laneSince: 0, // stabilizeLanes 가 채운다(창이 기억하는 값이라 여기선 알 수 없다).
        startedAt: s.startedAt,
        status: s.status,
        lastTool: s.lastTool,
        lastActivityAt: s.lastActivityAt,
        contextUsed: s.contextUsed,
        contextMax: s.contextMax,
        queuedCount,
        runningTaskCount,
        unacknowledged,
        readOnly: isReadOnlyHookAgent(agent),
        questionPrompts,
        detail: {
          question,
          review,
          report,
          permission,
          queuedTexts,
          lastCommand: s.lastCommand,
          lastResult: s.lastResult,
        },
        searchText: searchParts.join('   ').toLowerCase(),
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

/**
 * 레인 → 그 레인을 고르는 **정본 토큰**. §5.12 (H) 분류 막대가 이 토큰을 검색 문자열에
 * 넣고 빼는 방식으로 동작한다 — 알약과 검색창이 같은 하나의 질의를 공유하게 하려는 것이다
 * (알약 전용 상태를 따로 두면 "검색창엔 needs:review 인데 알약은 전체"가 되어 어긋난다).
 */
export const LANE_QUERY_TOKEN: Record<CommandCenterLane, string> = {
  'needs-answer': 'needs:answer',
  'needs-review': 'needs:review',
  'needs-action': 'needs:action',
  working: 'is:working',
  done: 'is:done',
};

/**
 * 검색 문자열에서 그 레인 토큰을 켜고 끈다(§5.12 (H) 분류 막대).
 * 이미 켜져 있으면 빼고(=전체로 복귀), 아니면 **다른 레인 토큰을 모두 걷어내고** 그것만 켠다
 * — 알약은 라디오처럼 동작해야 "지금 한 종류만 본다"가 눈에 보인다.
 */
export function toggleLaneToken(raw: string, lane: CommandCenterLane | null): string {
  const kept: string[] = [];
  let had = false;
  for (const rawToken of raw.split(/\s+/)) {
    const token = rawToken.trim();
    if (!token) continue;
    const lower = token.toLowerCase();
    const isLaneToken = !!LANE_TOKENS[lower] || lower === 'is:idle' || lower === 'is:completed';
    if (isLaneToken) {
      if (lane && lower === LANE_QUERY_TOKEN[lane]) had = true;
      continue; // 레인 토큰은 전부 걷어낸 뒤 아래에서 다시 넣는다.
    }
    kept.push(token);
  }
  if (lane && !had) kept.unshift(LANE_QUERY_TOKEN[lane]);
  return kept.join(' ');
}

/** 지금 질의가 고르고 있는 레인(정확히 하나일 때만). 분류 막대의 활성 알약 표시용. */
export function activeLaneOf(query: CommandCenterQuery): CommandCenterLane | null {
  if (query.lanes.size !== 1) return null;
  if (query.idleOnly || query.unackOnly) return null;
  return [...query.lanes][0] ?? null;
}

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

/** 정렬 선택지. 배열 순서가 곧 선택기에 보이는 순서다. */
export const COMMAND_CENTER_SORTS = ['priority', 'recent', 'waiting', 'context'] as const;

export type CommandCenterSort = (typeof COMMAND_CENTER_SORTS)[number];

/**
 * §5.12 (I) — `recent` 가 **초 단위 차이로** 카드를 뒤바꾸지 않도록 활동 시각을 이 폭으로 뭉갠다.
 * 같은 칸 안에서는 우선순위 순서(=고정값)로 떨어지므로 동시에 도는 세션끼리 자리를 맞바꾸지 않는다.
 */
const RECENT_BUCKET_MS = 60_000;

/**
 * §5.12 (I) 우선순위 비교 — **작업이 도는 동안 변하지 않는 값만** 쓴다.
 *
 * 레인 순위 → (①②③ 대기 시작 시각 / ④ 작업 진입 시각 / ⑤ 미확인 먼저·마지막 활동)
 * → 세션 생성 시각 → 세션 키. 마지막이 키라 **동점이 남지 않는다** — 같은 입력이면 언제나 같은 순서다.
 */
function comparePriority(a: CommandCenterItem, b: CommandCenterItem): number {
  const byLane = laneRank(a.lane) - laneRank(b.lane);
  if (byLane !== 0) return byLane;

  if (a.lane === 'working') {
    // 먼저 시작한 작업이 위. 도구를 아무리 써도 이 값은 그대로다.
    if (a.laneSince !== b.laneSince) return a.laneSince - b.laneSince;
  } else if (a.lane === 'done') {
    if (a.unacknowledged !== b.unacknowledged) return a.unacknowledged ? -1 : 1;
    if (a.lastActivityAt !== b.lastActivityAt) return b.lastActivityAt - a.lastActivityAt;
  } else {
    // ①②③ — 카드가 생긴 시각. 오래 기다린 것(작은 timestamp)이 위로.
    const aw = a.waitingSince ?? Number.POSITIVE_INFINITY;
    const bw = b.waitingSince ?? Number.POSITIVE_INFINITY;
    if (aw !== bw) return aw - bw;
  }

  if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * 정렬 — `priority`(우선순위 고정, 기본) / `recent`(마지막 활동 최신순) / `waiting`(대기가 긴 순) /
 * `context`(컨텍스트 잔량 적은 순). 원본 배열을 건드리지 않는다.
 *
 * 어느 기준을 골라도 **동점은 우선순위 순서로 떨어진다**(§5.12 (I)) — 동점을 남겨 두면 그 두 장이
 * 스냅샷마다 자리를 맞바꾸는데, 그것이 "엎치락뒤치락"의 실제 원인이었다.
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
      return comparePriority(a, b);
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
      return comparePriority(a, b);
    });
    return copy;
  }
  if (sort === 'recent') {
    copy.sort((a, b) => {
      const ab = Math.floor(a.lastActivityAt / RECENT_BUCKET_MS);
      const bb = Math.floor(b.lastActivityAt / RECENT_BUCKET_MS);
      if (ab !== bb) return bb - ab; // 최근 1분 칸이 위로
      return comparePriority(a, b);
    });
    return copy;
  }
  copy.sort(comparePriority);
  return copy;
}

// ─── 레인 정착(§5.12 (I)) ───────────────────────────────────────────────────

/**
 * 덜 급한 레인으로 **내려갈 때만** 이만큼 붙잡는다(올라갈 땐 즉시).
 * 도구 사이의 짧은 공백에 ④↔⑤ 를 오가며 카드가 열을 뛰어다니는 것을 막기 위한 것이다.
 */
export const LANE_SETTLE_MS = 8_000;

export interface LaneMemoEntry {
  /** 화면에 실제로 보여 준 레인. */
  lane: CommandCenterLane;
  /** 그 레인에 들어온 시각. */
  since: number;
  /** 덜 급한 레인으로 내려가라는 판정이 **처음** 나온 시각(0 = 없음). */
  demotedAt: number;
}

/** 창이 살아 있는 동안만 유지되는 표시용 기억. 서버·체크포인트와 무관하다. */
export type LaneMemory = Map<string, LaneMemoEntry>;

/**
 * 레인 판정에 **정착 시간**을 입히고 `laneSince` 를 채운다(§5.12 (I)).
 *
 * - 더 급한 레인으로 바뀌면 **즉시** 옮긴다(내 답을 기다리는 것이 늦게 보이면 안 된다).
 * - 덜 급한 레인으로 바뀌면 `holdMs` 동안 이전 레인을 유지한다 — **표시만 늦출 뿐**
 *   판정(§5.12 (B))도 세션도 건드리지 않는다(자동 정리와 같은 성격).
 *
 * `memory` 는 호출자가 창 수명 동안 들고 있는 Map 이며 여기서 갱신된다(사라진 세션은 지운다).
 */
export function stabilizeLanes(
  items: CommandCenterItem[],
  memory: LaneMemory,
  now: number,
  holdMs: number = LANE_SETTLE_MS,
): CommandCenterItem[] {
  const seen = new Set<string>();
  const out = items.map((item) => {
    seen.add(item.key);
    const prev = memory.get(item.key);

    if (!prev) {
      memory.set(item.key, { lane: item.lane, since: now, demotedAt: 0 });
      return { ...item, laneSince: now };
    }
    if (item.lane === prev.lane) {
      prev.demotedAt = 0; // 되돌아왔다 — 내려가던 시계를 접는다.
      return { ...item, laneSince: prev.since };
    }
    if (laneRank(item.lane) < laneRank(prev.lane)) {
      memory.set(item.key, { lane: item.lane, since: now, demotedAt: 0 });
      return { ...item, laneSince: now };
    }
    if (prev.demotedAt === 0) prev.demotedAt = now;
    if (now - prev.demotedAt < holdMs) {
      return { ...item, lane: prev.lane, laneSince: prev.since };
    }
    memory.set(item.key, { lane: item.lane, since: now, demotedAt: 0 });
    return { ...item, laneSince: now };
  });

  for (const key of memory.keys()) if (!seen.has(key)) memory.delete(key);
  return out;
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

/** 분류 막대(§5.12 (H))가 알약에 띄울 레인별 개수. 검색 **전** 목록으로 세야 "전체 중 몇"이 된다. */
export function laneCounts(items: CommandCenterItem[]): Record<CommandCenterLane, number> {
  const out = { 'needs-answer': 0, 'needs-review': 0, 'needs-action': 0, working: 0, done: 0 };
  for (const item of items) out[item.lane] += 1;
  return out;
}

/**
 * 화면에 보이는 순서(레인 우선순위 → 각 레인 안 정렬)대로 평탄화 — 키보드 ↑↓ 이동이
 * 눈에 보이는 순서와 어긋나지 않게 하려면 이동도 이 목록을 따라야 한다(§5.12 (H)).
 */
export function flattenLanes(lanes: Record<CommandCenterLane, CommandCenterItem[]>): CommandCenterItem[] {
  const out: CommandCenterItem[] = [];
  for (const lane of COMMAND_CENTER_LANES) out.push(...lanes[lane]);
  return out;
}

/** 대기 시간 긴급도 — 30분↑ amber, 2시간↑ red(§5.12 (H)). 대기 중이 아니면 null. */
export function waitingLevel(
  waitingSince: number | null,
  now: number,
): { minutes: number; level: 'fresh' | 'warn' | 'critical' } | null {
  if (waitingSince === null) return null;
  const minutes = Math.max(0, Math.floor((now - waitingSince) / 60_000));
  if (minutes >= 120) return { minutes, level: 'critical' };
  if (minutes >= 30) return { minutes, level: 'warn' };
  return { minutes, level: 'fresh' };
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
