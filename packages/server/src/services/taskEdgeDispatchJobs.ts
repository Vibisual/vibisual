/**
 * §5.3 #10-2 (위임 결과 복구) — 위임 엣지 dispatch 작업 장부.
 *
 * dispatch 는 결과를 **HTTP 대기 소켓 하나에만** 넘겼다. 긴 위임 도중 그 연결이 끊기면(`fetch failed`)
 * 자식은 끝까지 일하는데 결과를 다시 받을 길이 없었고, 부르는 쪽이 다시 부르면 같은 일이 새 서브에이전트로
 * 한 번 더 돌았다.
 *
 * 이 모듈이 쥐는 것:
 *  - cmdId 로 상태·결과를 **소켓과 따로** 보관한다 → 끊긴 뒤에도 조회로 회수한다.
 *  - 호출자가 준 요청 키(`requestKey`)가 같으면 **새로 띄우지 않고 기존 작업을 돌려준다** → 재시도가 중복 실행이 되지 않는다.
 *  - 대기는 여럿이 걸 수 있고, 하나를 풀어도(제한시간·연결 끊김) **작업은 그대로**다(`createDispatchWaiterHub`).
 *  - 누가 조회·취소할 수 있는가(`decideDispatchJobAccess`)와 큐를 떠난 명령을 어떤 끝 상태로 적는가(`dispatchOutcomeFromCommand`).
 *
 * 순수 모듈 — 큐·그래프·소켓을 모른다. 배선(등록·조회/취소 라우트·끝 상태 기록)은 index.ts 의 dispatch 핸들러와
 * 명령이 큐를 떠나는 자리들(완료 콜백·중지·좀비 봉합·큐 제거)이 맡는다.
 *
 * **메모리 장부다** — 앱(=서버) 재시작을 넘지 않는다. 보장하는 것은 앱이 살아 있는 동안의 통신 단절 회수까지다.
 */

import { createHash } from 'node:crypto';
import type { UsageLimitStop } from '@vibisual/shared';

export type DispatchJobStatus = 'queued' | 'executing' | 'completed' | 'error' | 'cancelled';

export type DispatchJobTerminalStatus = Extract<DispatchJobStatus, 'completed' | 'error' | 'cancelled'>;

export interface DispatchJob {
  cmdId: string;
  edgeId: string;
  sourceAgentId: string;
  targetAgentId: string;
  /** 같은 요청의 재시도를 알아보는 호출자 키. 없으면 중복 판정을 하지 않는다. */
  requestKey?: string;
  /** 지시문 지문 — 같은 키로 **다른** 지시가 오면 옛 결과를 주지 않고 거절하려고 둔다. 바깥에는 내보내지 않는다. */
  fingerprint?: string;
  status: DispatchJobStatus;
  result?: string;
  errorMessage?: string;
  /** 한도로 끊겼다(§5.5 #17-47) — 상태 유니온은 건드리지 않는 직교 플래그. */
  usageLimit?: UsageLimitStop;
  /** 취소를 요청받은 시각. 끝 상태는 실제 중지가 완료 경로를 지나야 적힌다(장부만 바꾸는 취소 ❌). */
  cancelRequestedAt?: number;
  /**
   * 위임 조회 — 소스가 이 위임과 함께 **대상 에이전트에게 조회를 넘긴 다른 작업**의 cmdId.
   * 이 작업이 끝나기 전까지만, 대상 에이전트만, 이 목록만 읽힌다(`decideDispatchJobAccess`). 취소는 넘기지 않는다.
   */
  statusGrants?: string[];
  /**
   * 반환 엣지가 있어 **요청자가 끝난 결과를 받아야 하는** 작업. 끝난 결과가 요청자에게 실려 나가기 전
   * (`deliveredAt` 없음)에는 요청한 세션의 턴이 완료로 끝나지 않는다(`listUndelivered`).
   */
  expectsResult?: boolean;
  /** 요청한 세션(서브에이전트). 받지 못한 결과를 **그 세션의 턴**에 묶는 키다. 모르면 묶지 않는다. */
  requesterSubAgentId?: string;
  /** 끝난 결과를 요청자에게 실어 보낸 시각. 진행 중 응답(대기 중·제한시간·조회 실패)은 적지 않는다. */
  deliveredAt?: number;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

/** 응답 본문에 싣는 모양 — 내부 지문·세션 묶음은 뺀다. */
export type DispatchJobView = Omit<DispatchJob, 'fingerprint' | 'requesterSubAgentId'>;

/** 받지 못한 결과를 고르는 조건. 둘 다 주면 둘 다 맞아야 한다. */
export interface UndeliveredDispatchJobFilter {
  sourceAgentId?: string;
  requesterSubAgentId?: string;
}

export interface RegisterDispatchJobInput {
  cmdId: string;
  edgeId: string;
  sourceAgentId: string;
  targetAgentId: string;
  requestKey?: string;
  fingerprint?: string;
  /** 등록 전에 `authorizeStatusGrants` 로 확인한 목록만 넘긴다. */
  statusGrants?: readonly string[];
  expectsResult?: boolean;
  requesterSubAgentId?: string;
}

export interface DispatchJobOutcome {
  status: DispatchJobTerminalStatus;
  result?: string;
  errorMessage?: string;
  usageLimit?: UsageLimitStop;
}

export interface DispatchJobRegistryOptions {
  /** 끝난 작업을 몇 건까지 남길지. 키 개수에 상한이 없으면 장부가 끝없이 자란다. */
  maxFinished?: number;
  /** 끝난 작업을 조회 가능하게 남기는 시간(ms). 지나면 같은 요청 키로 다시 부를 때 새로 실행된다. */
  finishedTtlMs?: number;
  now?: () => number;
}

/** 조회자. `fromLoopback` 은 §3.7 리스너가 덮어쓰는 유입 표식이다 — 클라가 흉내 내도 제약이 늘 뿐이다. */
export interface DispatchJobAccess {
  requesterAgentId?: string;
  fromLoopback?: boolean;
  /** 위임 조회는 `'read'` 에만 쓰인다. 생략하거나 `'cancel'` 이면 소유자 규칙만 본다. */
  purpose?: 'read' | 'cancel';
}

export type DispatchJobAccessDenial = 'requester-required' | 'forbidden';

export type DispatchJobLookup =
  | { ok: true; job: DispatchJob }
  | { ok: false; reason: 'not-found' | DispatchJobAccessDenial };

export const DISPATCH_JOB_MAX_FINISHED = 100;
export const DISPATCH_JOB_FINISHED_TTL_MS = 6 * 60 * 60 * 1000;
/** 요청 키 길이 상한 — 키 문자열이 그대로 장부의 색인이 되므로 끝없이 긴 값을 받지 않는다. */
export const DISPATCH_REQUEST_KEY_MAX = 200;
/** 한 위임에 조회를 넘길 수 있는 작업 수 — 목록이 곧 권한 범위라 끝없이 받지 않는다. */
export const DISPATCH_STATUS_GRANTS_MAX = 20;
/** 사용자 중지 봉합 표식 — close 핸들러·중지 라우트가 `cmd.result` 앞에 붙인다. */
export const DISPATCH_USER_STOPPED_PREFIX = '[Stopped by user]';

export function isTerminalDispatchJobStatus(status: DispatchJobStatus): status is DispatchJobTerminalStatus {
  return status === 'completed' || status === 'error' || status === 'cancelled';
}

/**
 * 누가 이 작업을 보고 끊을 수 있는가 — 한 벌. 이름을 밝혔으면 소스와 같아야 하고,
 * **loopback 으로 들어온 바깥 프로세스는 이름을 밝혀야 한다**(생략으로 우회 ❌). 앱 화면(IPC)은 사용자라 생략해도 된다.
 * 신뢰 경계는 토큰이고 이름은 자기 신고라, 이것은 위조 방지가 아니라 오조회 방지다.
 *
 * 소스가 아닌 이름은 **조회(`purpose: 'read'`)에 한해** 서버가 쥔 위임 관계(`isDelegatedReader`)로만 통과한다 —
 * 취소는 위임되지 않는다.
 */
export function decideDispatchJobAccess(
  sourceAgentId: string,
  access: DispatchJobAccess = {},
  isDelegatedReader: (agentId: string) => boolean = () => false,
): { ok: true } | { ok: false; reason: DispatchJobAccessDenial } {
  if (access.requesterAgentId === undefined) {
    return access.fromLoopback ? { ok: false, reason: 'requester-required' } : { ok: true };
  }
  if (access.requesterAgentId === sourceAgentId) return { ok: true };
  if (access.purpose === 'read' && isDelegatedReader(access.requesterAgentId)) return { ok: true };
  return { ok: false, reason: 'forbidden' };
}

/** 헤더·쿼리·본문에 흩어진 값들에서 비어 있지 않은 문자열을 중복 없이 모은다(배열 헤더도 푼다). */
function distinctStrings(candidates: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const values: readonly unknown[] = Array.isArray(candidate) ? candidate : [candidate];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen];
}

/** 요청자 id 를 하나로 모은다. 서로 다른 값이 둘 이상이면 누구인지 모르는 것이다. */
export function resolveDispatchRequester(
  ...candidates: unknown[]
): { ok: true; agentId?: string } | { ok: false; reason: 'conflicting-requester' } {
  const ids = distinctStrings(candidates);
  if (ids.length > 1) return { ok: false, reason: 'conflicting-requester' };
  const [agentId] = ids;
  return agentId === undefined ? { ok: true } : { ok: true, agentId };
}

export function parseDispatchRequestKey(
  ...candidates: unknown[]
): { ok: true; requestKey?: string } | { ok: false; reason: 'conflicting-request-key' | 'request-key-too-long' } {
  const keys = distinctStrings(candidates);
  if (keys.length > 1) return { ok: false, reason: 'conflicting-request-key' };
  const [requestKey] = keys;
  if (requestKey === undefined) return { ok: true };
  if (requestKey.length > DISPATCH_REQUEST_KEY_MAX) return { ok: false, reason: 'request-key-too-long' };
  return { ok: true, requestKey };
}

/**
 * 완료를 기다릴까. `false`·`0`·`no`·`off`(JSON `false`)면 기다리지 않는다. 없거나 모르는 값은 종전 동작(기다림)이다.
 * 앞선 후보(쿼리)가 뒤(본문)를 이긴다.
 */
export function parseDispatchWait(...candidates: unknown[]): boolean {
  for (const raw of candidates) {
    const value: unknown = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value !== 'string') continue;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
  }
  return true;
}

/**
 * 상태 조회 한 번이 붙들 수 있는 최대 시간(ms). 부르는 쪽 HTTP 클라이언트의 헤더 대기 한도(Node fetch 300초)보다
 * 넉넉히 짧게 둔다 — 더 오래 기다리려면 조회를 되풀이한다(§5.3 #10-2 ⑨).
 */
export const DISPATCH_STATUS_WAIT_MAX_MS = 120_000;

/** `?waitMs=` — 끝날 때까지 조회 응답을 붙들 시간. 없거나 모르는 값·0 이하는 0(종전 즉시 응답), 상한을 넘으면 상한. */
export function parseDispatchStatusWaitMs(raw: unknown): number {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(DISPATCH_STATUS_WAIT_MAX_MS, Math.floor(parsed));
}

/**
 * 위임 조회 목록을 읽는다 — 헤더·쿼리는 쉼표 구분 문자열, JSON 은 문자열 배열. 목록이 곧 권한 범위라
 * 두 곳이 **서로 다른 목록**을 주면 합치지 않고 거절한다(조용히 넓어지지 않게).
 */
export function parseDispatchStatusGrants(
  ...candidates: unknown[]
): { ok: true; cmdIds: string[] } | { ok: false; reason: 'conflicting-status-grants' | 'too-many-status-grants' | 'status-grant-too-long' | 'invalid-status-grants' } {
  let chosen: string[] | undefined;
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const parts: string[] = [];
    const values: readonly unknown[] = Array.isArray(candidate) ? candidate : [candidate];
    for (const value of values) {
      if (typeof value !== 'string') return { ok: false, reason: 'invalid-status-grants' };
      for (const piece of value.split(',')) {
        const trimmed = piece.trim();
        if (trimmed) parts.push(trimmed);
      }
    }
    const cmdIds = [...new Set(parts)];
    if (cmdIds.length === 0) continue;
    if (chosen === undefined) {
      chosen = cmdIds;
      continue;
    }
    const same = chosen.length === cmdIds.length && cmdIds.every((id) => chosen!.includes(id));
    if (!same) return { ok: false, reason: 'conflicting-status-grants' };
  }
  const cmdIds = chosen ?? [];
  if (cmdIds.length > DISPATCH_STATUS_GRANTS_MAX) return { ok: false, reason: 'too-many-status-grants' };
  if (cmdIds.some((id) => id.length > DISPATCH_REQUEST_KEY_MAX)) return { ok: false, reason: 'status-grant-too-long' };
  return { ok: true, cmdIds };
}

/**
 * 위임 조회를 받은 **클로드** 턴에 싣는 조회 안내. 자기 이름(`$VIBISUAL_PARENT_AGENT_ID` — 이 턴을 도는 에이전트)으로 부른다 —
 * 남의 id 를 쓰라고 하지 않는다. 코덱스 턴은 MCP `status` 도구 안내(`codexEdgeInstructions`)가 이 몫이다.
 */
export function dispatchStatusGrantInstructions(cmdIds: readonly string[]): string {
  if (!cmdIds.length) return '';
  return '\n\n# Delegated dispatch status (this task only)\n'
    + `While this task runs you may read these dispatch jobs: ${cmdIds.map((id) => `\`${id}\``).join(', ')}.\n`
    + '```bash\n'
    + 'curl -s -H "x-vibisual-hook-token: $VIBISUAL_TOKEN" "$VIBISUAL_BASE/api/task-edges/dispatch/<cmdId>?agentId=$VIBISUAL_PARENT_AGENT_ID&waitMs=60000"\n'
    + '```\n'
    + 'Always send your own agent id as above. Other jobs, cancelling, and reads after this task ends are refused (403).\n';
}

/**
 * 이 세션이 띄우고 **아직 끝난 결과를 받지 못한** 위임을 다음 **클로드** 턴에 싣는 안내. 턴 실패 사유와 같은 목록·같은 모양이라
 * 사유에 적힌 cmdId 로 그대로 이어 받는다. 코덱스 턴은 `codexEdgeInstructions` 의 `pendingResults` 가 이 몫이다.
 */
export function undeliveredDispatchResultInstructions(jobs: readonly Pick<DispatchJob, 'cmdId' | 'status'>[]): string {
  if (!jobs.length) return '';
  return '\n\n# Undelivered dispatch results\n'
    + `Dispatch jobs you started have not handed their finished result to you yet: ${formatUndeliveredDispatchJobs(jobs)}.\n`
    + '```bash\n'
    + 'curl -s -H "x-vibisual-hook-token: $VIBISUAL_TOKEN" "$VIBISUAL_BASE/api/task-edges/dispatch/<cmdId>?agentId=$VIBISUAL_PARENT_AGENT_ID&waitMs=60000"\n'
    + '```\n'
    + 'Repeat the lookup while a job is queued or executing. Do not dispatch the same work again. This turn cannot finish as completed until each result is received; if a lookup is refused or fails, tell the user with its cmdId.\n';
}

/** 지문. 위임 조회 목록이 있으면 함께 넣는다 — 같은 요청 키로 **다른 권한**을 달고 오면 옛 작업을 주지 않는다. 목록이 없으면 종전 지문과 같다. */
export function dispatchRequestFingerprint(instruction: string, statusGrants: readonly string[] = []): string {
  const hash = createHash('sha256').update(instruction, 'utf8');
  if (statusGrants.length) hash.update(`\0statusGrants:${JSON.stringify([...statusGrants].sort())}`, 'utf8');
  return hash.digest('hex');
}

/** 같은 요청 키에 다른 지시문이 왔는가. 어느 한쪽 지문이 없으면 가를 근거가 없으므로 충돌로 보지 않는다. */
export function isDispatchRequestKeyConflict(job: DispatchJob, fingerprint: string | undefined): boolean {
  return job.fingerprint !== undefined && fingerprint !== undefined && job.fingerprint !== fingerprint;
}

/**
 * 큐를 떠난 명령 하나를 어떤 끝 상태로 적는가. 끝나지 않은 명령이면 `undefined`.
 * 사용자 중지(`[Stopped by user]`)는 봉합이 `completed` 여도 **`cancelled`** 다 — 부르는 쪽이 중간 결과를 답으로 읽으면 안 된다.
 */
export function dispatchOutcomeFromCommand(
  cmd: { status: string; result?: string },
  usageLimit?: UsageLimitStop,
): DispatchJobOutcome | undefined {
  if (cmd.status !== 'completed' && cmd.status !== 'error') return undefined;
  const result = typeof cmd.result === 'string' ? cmd.result : undefined;
  if (result !== undefined && result.startsWith(DISPATCH_USER_STOPPED_PREFIX)) {
    return { status: 'cancelled', result, errorMessage: 'stopped by user' };
  }
  if (cmd.status === 'error') {
    return { status: 'error', ...(result !== undefined ? { result } : {}), errorMessage: result ?? 'subagent error' };
  }
  return { status: 'completed', ...(result !== undefined ? { result } : {}), ...(usageLimit ? { usageLimit } : {}) };
}

/** 위임한 일을 **끝까지 해냈는가** — 응답의 `ok`. 한도 정지는 실패가 아니지만 끝낸 것도 아니다. */
export function isDispatchJobSucceeded(job: Pick<DispatchJob, 'status' | 'usageLimit'>): boolean {
  return job.status === 'completed' && job.usageLimit === undefined;
}

export function toDispatchJobView(job: DispatchJob): DispatchJobView {
  const view: DispatchJob = { ...job };
  delete view.fingerprint;
  delete view.requesterSubAgentId;
  return view;
}

/**
 * 요청자가 아직 받지 못한 결과인가. 취소를 요청한 작업은 누구도 결과를 기다리지 않으므로 빠진다.
 * 끝났어도 실어 보내지 않았으면 받지 못한 것이다 — 끝남과 받음은 다른 사실이다.
 */
export function isDispatchResultUndelivered(job: Pick<DispatchJob, 'expectsResult' | 'deliveredAt' | 'cancelRequestedAt'>): boolean {
  return job.expectsResult === true && job.deliveredAt === undefined && job.cancelRequestedAt === undefined;
}

/**
 * 받지 못한 결과를 사람·모델이 함께 읽는 한 줄로 — `cmd-… (executing), cmd-… (completed)`.
 * 턴 실패 사유와 다음 턴 안내가 같은 모양을 써야 사유에 적힌 cmdId 로 그대로 이어 조회한다.
 */
export function formatUndeliveredDispatchJobs(jobs: readonly Pick<DispatchJob, 'cmdId' | 'status'>[]): string {
  return jobs.map((job) => `${job.cmdId} (${job.status})`).join(', ');
}

export interface DispatchJobRegistry {
  /** 새 작업을 적는다. 같은 (소스, 엣지, 요청 키) 작업이 남아 있으면 적지 않고 그것을 돌려준다(`reused: true`). */
  register(input: RegisterDispatchJobInput): { job: DispatchJob; reused: boolean };
  /** 등록 전에 재시도인지 확인한다 — 서브에이전트를 만들기 **전에** 불러야 빈 탭이 남지 않는다. */
  findByRequestKey(sourceAgentId: string, edgeId: string, requestKey: string): DispatchJob | undefined;
  markExecuting(cmdId: string): DispatchJob | undefined;
  /** 취소 요청을 적는다. 끝 상태는 적지 않는다 — 실제 중지가 완료 경로를 지나며 적는다. */
  markCancelRequested(cmdId: string): DispatchJob | undefined;
  /**
   * 끝난 상태를 적는다. **처음 적힌 끝 상태가 이긴다** — 취소 뒤에 도착한 자식의 종료는 덮어쓰지 않는다.
   * 한도 표식은 이 작업이 생긴 뒤에 선 것만 받는다(그 전 것은 이 작업의 사실이 아니다).
   */
  finish(cmdId: string, outcome: DispatchJobOutcome): DispatchJob | undefined;
  /**
   * 끝난 결과를 요청자에게 실어 보냈다고 적는다. **끝나지 않은 작업은 적지 않는다** — 대기 중·조회 실패 응답은
   * 결과를 건넨 것이 아니다. 처음 적힌 시각이 이긴다.
   */
  markDelivered(cmdId: string): DispatchJob | undefined;
  /** 요청자가 아직 받지 못한 결과들(`isDispatchResultUndelivered`) — 만든 순서대로. */
  listUndelivered(filter?: UndeliveredDispatchJobFilter): DispatchJob[];
  /** All results belonging to a requesting session, including already collected results. */
  listForRequester(subAgentId: string): DispatchJob[];
  /**
   * 같은 요청자(소스·엣지·세션)가 **같은 지시**로 이미 띄웠고 아직 결과를 받지 못한 작업. 요청 키가 달라도
   * 이것이 있으면 새로 띄우지 않고 그 작업을 이어 받는다 — 조회를 놓친 뒤의 다시 dispatch 가 중복 실행이 되지 않게.
   */
  findUndeliveredDuplicate(input: { sourceAgentId: string; edgeId: string; fingerprint: string; requesterSubAgentId?: string }): DispatchJob | undefined;
  /**
   * 조회. 문자열은 요청자 id 로 읽는다. 소유권 판정은 `decideDispatchJobAccess` 한 벌 —
   * loopback 유입은 이름이 없으면 작업이 있는지조차 답하지 않는다.
   */
  get(cmdId: string, access?: string | DispatchJobAccess): DispatchJobLookup;
  /**
   * 위임 조회를 넘기기 전 확인 — `grantorAgentId`(엣지 소스)가 목록의 작업을 **지금** 읽을 수 있는가(소유자이거나 살아 있는 위임을 쥐었는가).
   * 하나라도 없거나 못 읽으면 그 cmdId 와 함께 거절한다. 서브에이전트를 만들기 **전에** 부른다.
   */
  authorizeStatusGrants(grantorAgentId: string, cmdIds: readonly string[]): { ok: true } | { ok: false; reason: 'not-found' | 'forbidden'; cmdId: string };
  /** 이 위임 작업이 대상에게 넘긴 조회 목록(없으면 빈 배열). 끝난 위임이면 빈 배열이다 — 조회 창구를 싣지 않는다. */
  activeStatusGrantsFor(cmdId: string): string[];
  size(): number;
}

export function createDispatchJobRegistry(options: DispatchJobRegistryOptions = {}): DispatchJobRegistry {
  const maxFinished = Math.max(0, options.maxFinished ?? DISPATCH_JOB_MAX_FINISHED);
  const finishedTtlMs = Math.max(0, options.finishedTtlMs ?? DISPATCH_JOB_FINISHED_TTL_MS);
  const now = options.now ?? Date.now;
  const jobs = new Map<string, DispatchJob>();
  const byRequestKey = new Map<string, string>();

  const keyOf = (sourceAgentId: string, edgeId: string, requestKey: string): string =>
    JSON.stringify([sourceAgentId, edgeId, requestKey]);

  const drop = (job: DispatchJob): void => {
    jobs.delete(job.cmdId);
    if (job.requestKey === undefined) return;
    const key = keyOf(job.sourceAgentId, job.edgeId, job.requestKey);
    if (byRequestKey.get(key) === job.cmdId) byRequestKey.delete(key);
  };

  /** 끝난 작업만 치운다. 진행 중 작업은 명령이 큐를 떠나는 자리마다 끝 상태가 적히므로 여기서 걷지 않는다. */
  const prune = (): void => {
    const at = now();
    const finished: DispatchJob[] = [];
    for (const job of jobs.values()) {
      if (job.finishedAt === undefined) continue;
      if (at - job.finishedAt >= finishedTtlMs) drop(job);
      else finished.push(job);
    }
    if (finished.length <= maxFinished) return;
    // 넘친 몫은 **이미 받은 결과부터** 걷는다 — 받지 못한 결과가 먼저 사라지면 cmdId 로 이어 받을 길이 끊긴다.
    finished.sort((a, b) =>
      Number(isDispatchResultUndelivered(a)) - Number(isDispatchResultUndelivered(b))
      || (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    for (const job of finished.slice(0, finished.length - maxFinished)) drop(job);
  };

  const copy = (job: DispatchJob): DispatchJob => ({
    ...job,
    ...(job.usageLimit ? { usageLimit: { ...job.usageLimit } } : {}),
    ...(job.statusGrants ? { statusGrants: [...job.statusGrants] } : {}),
  });

  /**
   * `agentId` 가 이 작업을 읽을 수 있는가 — 소유자이거나, **진행 중인** 위임 작업의 대상으로서 그 목록에 이 작업이 있고
   * 그 위임을 넘긴 쪽이 **지금도** 읽을 수 있을 때(재위임 사슬). 위 위임이 끝나면 아래 권한도 함께 끊긴다.
   */
  const readableBy = (agentId: string, job: DispatchJob, seen: Set<string> = new Set()): boolean => {
    if (job.sourceAgentId === agentId) return true;
    for (const via of jobs.values()) {
      if (via.targetAgentId !== agentId || isTerminalDispatchJobStatus(via.status)) continue;
      if (!via.statusGrants?.includes(job.cmdId) || seen.has(via.cmdId)) continue;
      seen.add(via.cmdId);
      if (readableBy(via.sourceAgentId, job, seen)) return true;
    }
    return false;
  };

  const findByRequestKey = (sourceAgentId: string, edgeId: string, requestKey: string): DispatchJob | undefined => {
    prune();
    const cmdId = byRequestKey.get(keyOf(sourceAgentId, edgeId, requestKey));
    const job = cmdId === undefined ? undefined : jobs.get(cmdId);
    return job ? copy(job) : undefined;
  };

  return {
    register(input) {
      const requestKey = input.requestKey?.trim() ? input.requestKey.trim() : undefined;
      if (requestKey !== undefined) {
        const existing = findByRequestKey(input.sourceAgentId, input.edgeId, requestKey);
        if (existing) return { job: existing, reused: true };
      }
      const at = now();
      const job: DispatchJob = {
        cmdId: input.cmdId,
        edgeId: input.edgeId,
        sourceAgentId: input.sourceAgentId,
        targetAgentId: input.targetAgentId,
        ...(requestKey !== undefined ? { requestKey } : {}),
        ...(input.fingerprint !== undefined ? { fingerprint: input.fingerprint } : {}),
        ...(input.expectsResult ? { expectsResult: true } : {}),
        ...(input.requesterSubAgentId ? { requesterSubAgentId: input.requesterSubAgentId } : {}),
        ...(input.statusGrants?.length ? { statusGrants: [...new Set(input.statusGrants)] } : {}),
        status: 'queued',
        createdAt: at,
        updatedAt: at,
      };
      const previous = jobs.get(job.cmdId);
      if (previous) drop(previous);
      jobs.set(job.cmdId, job);
      if (requestKey !== undefined) byRequestKey.set(keyOf(job.sourceAgentId, job.edgeId, requestKey), job.cmdId);
      prune();
      return { job: copy(job), reused: false };
    },
    findByRequestKey,
    markExecuting(cmdId) {
      const job = jobs.get(cmdId);
      if (!job) return undefined;
      if (job.status === 'queued') {
        job.status = 'executing';
        job.updatedAt = now();
      }
      return copy(job);
    },
    markCancelRequested(cmdId) {
      const job = jobs.get(cmdId);
      if (!job) return undefined;
      if (!isTerminalDispatchJobStatus(job.status) && job.cancelRequestedAt === undefined) {
        const at = now();
        job.cancelRequestedAt = at;
        job.updatedAt = at;
      }
      return copy(job);
    },
    finish(cmdId, outcome) {
      const job = jobs.get(cmdId);
      if (!job) return undefined;
      if (!isTerminalDispatchJobStatus(job.status)) {
        const at = now();
        job.status = outcome.status;
        if (outcome.result !== undefined) job.result = outcome.result;
        if (outcome.errorMessage !== undefined) job.errorMessage = outcome.errorMessage;
        if (outcome.usageLimit && outcome.usageLimit.at >= job.createdAt) job.usageLimit = { ...outcome.usageLimit };
        job.updatedAt = at;
        job.finishedAt = at;
      }
      const snapshot = copy(job);
      prune();
      return snapshot;
    },
    markDelivered(cmdId) {
      const job = jobs.get(cmdId);
      if (!job) return undefined;
      if (isTerminalDispatchJobStatus(job.status) && job.deliveredAt === undefined) {
        const at = now();
        job.deliveredAt = at;
        job.updatedAt = at;
      }
      return copy(job);
    },
    listUndelivered(filter = {}) {
      prune();
      return [...jobs.values()]
        .filter((job) => isDispatchResultUndelivered(job)
          && (filter.sourceAgentId === undefined || job.sourceAgentId === filter.sourceAgentId)
          && (filter.requesterSubAgentId === undefined || job.requesterSubAgentId === filter.requesterSubAgentId))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(copy);
    },
    listForRequester(subAgentId) {
      prune();
      return [...jobs.values()].filter((job) => job.requesterSubAgentId === subAgentId).map(copy);
    },
    findUndeliveredDuplicate(input) {
      prune();
      let found: DispatchJob | undefined;
      for (const job of jobs.values()) {
        if (!isDispatchResultUndelivered(job)) continue;
        if (job.sourceAgentId !== input.sourceAgentId || job.edgeId !== input.edgeId) continue;
        if (job.fingerprint === undefined || job.fingerprint !== input.fingerprint) continue;
        // 다른 세션이 띄운 같은 지시는 그 세션의 몫이다 — 가로채면 원래 세션이 결과를 영영 못 받는다.
        if (job.requesterSubAgentId !== input.requesterSubAgentId) continue;
        if (!found || job.createdAt > found.createdAt) found = job;
      }
      return found ? copy(found) : undefined;
    },
    get(cmdId, access) {
      prune();
      const normalized: DispatchJobAccess = typeof access === 'string' ? { requesterAgentId: access } : (access ?? {});
      if (normalized.fromLoopback && normalized.requesterAgentId === undefined) {
        return { ok: false, reason: 'requester-required' };
      }
      const job = jobs.get(cmdId);
      if (!job) return { ok: false, reason: 'not-found' };
      const decision = decideDispatchJobAccess(job.sourceAgentId, normalized, (agentId) => readableBy(agentId, job));
      if (!decision.ok) return { ok: false, reason: decision.reason };
      return { ok: true, job: copy(job) };
    },
    authorizeStatusGrants(grantorAgentId, cmdIds) {
      prune();
      for (const cmdId of cmdIds) {
        const job = jobs.get(cmdId);
        if (!job) return { ok: false, reason: 'not-found', cmdId };
        if (!readableBy(grantorAgentId, job)) return { ok: false, reason: 'forbidden', cmdId };
      }
      return { ok: true };
    },
    activeStatusGrantsFor(cmdId) {
      const job = jobs.get(cmdId);
      if (!job || isTerminalDispatchJobStatus(job.status)) return [];
      return [...(job.statusGrants ?? [])];
    },
    size() {
      return jobs.size;
    },
  };
}

/** 한 작업을 기다리는 대기들. 소켓 하나가 곧 결과의 유일한 통로이던 것을 끊는 자리다. */
export interface DispatchWaiterHub<T> {
  /** 대기를 건다. 돌려받은 함수로 풀면(제한시간·연결 끊김) **작업은 그대로** 두고 이 대기만 걷힌다. */
  add(cmdId: string, deliver: (value: T) => void): () => void;
  /** 끝난 작업을 기다리던 모두에게 한 번씩 건네고 걷는다. 건넨 대기 수를 돌려준다. */
  settle(cmdId: string, value: T): number;
  count(cmdId?: string): number;
}

export function createDispatchWaiterHub<T>(): DispatchWaiterHub<T> {
  const waiters = new Map<string, Set<(value: T) => void>>();
  return {
    add(cmdId, deliver) {
      const entry = (value: T): void => deliver(value);
      const set = waiters.get(cmdId) ?? new Set<(value: T) => void>();
      set.add(entry);
      waiters.set(cmdId, set);
      return () => {
        const current = waiters.get(cmdId);
        if (!current || !current.delete(entry)) return;
        if (current.size === 0) waiters.delete(cmdId);
      };
    },
    settle(cmdId, value) {
      const set = waiters.get(cmdId);
      if (!set) return 0;
      waiters.delete(cmdId);
      for (const deliver of set) {
        try {
          deliver(value);
        } catch {
          // 한 대기의 실패(이미 닫힌 응답 등)가 나머지 대기를 막지 않는다.
        }
      }
      return set.size;
    },
    count(cmdId) {
      if (cmdId !== undefined) return waiters.get(cmdId)?.size ?? 0;
      let total = 0;
      for (const set of waiters.values()) total += set.size;
      return total;
    },
  };
}

export interface DispatchStatusWaitOptions {
  cmdId: string;
  /** 조회 판정 때 읽은 모습. */
  initial: DispatchJob;
  /** `parseDispatchStatusWaitMs` 로 거른 값. 0 이면 붙들지 않는다. */
  waitMs: number;
  waiters: DispatchWaiterHub<DispatchJob>;
  /** 장부의 지금 모습 — 대기를 건 직후와 제한시간에 다시 읽는다. */
  current: () => DispatchJob | undefined;
  /**
   * 정확히 한 번 불린다(연결 close 로 걷히면 불리지 않는다). `waited` = 붙들었다 풀었다,
   * `timedOut` = 끝나지 않은 채 시간이 다 됐다 — 이때 준 모습은 결과가 아니라 진행 상태다.
   */
  respond: (job: DispatchJob, meta: { waited: boolean; timedOut: boolean }) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * §5.3 #10-2 ⑨ — 상태 조회를 끝날 때까지(최대 `waitMs`) 붙든다. 변화 없는 `executing` 을 곧바로 돌려주면 부르는 쪽
 * 모델이 그만큼 턴을 돌며 같은 안내를 되풀이한다. 붙드는 방법은 dispatch 동기 대기와 같은 대기 허브 —
 * 풀려도(제한시간·close) **작업은 그대로**다. 돌려받은 함수는 연결 close 용이다.
 */
export function waitForDispatchStatus(options: DispatchStatusWaitOptions): () => void {
  const { cmdId, initial, waitMs, waiters, current, respond } = options;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
  if (waitMs <= 0 || isTerminalDispatchJobStatus(initial.status)) {
    respond(initial, { waited: false, timedOut: false });
    return () => {};
  }
  let done = false;
  let timer: unknown;
  let release: () => void = () => {};
  const finish = (job: DispatchJob, meta: { waited: boolean; timedOut: boolean }): void => {
    if (done) return;
    done = true;
    if (timer !== undefined) clearTimer(timer);
    release();
    respond(job, meta);
  };
  release = waiters.add(cmdId, (finished) => finish(finished, { waited: true, timedOut: false }));
  // 판정과 대기 사이에 끝났으면 그 settle 은 이 대기를 몰랐다 — 걸고 나서 한 번 더 읽어 결과 유실을 막는다.
  const latest = current() ?? initial;
  if (isTerminalDispatchJobStatus(latest.status)) {
    finish(latest, { waited: false, timedOut: false });
    return () => {};
  }
  timer = setTimer(() => {
    // 시계와 완료가 같은 틈에 오면 장부가 이긴다 — 끝났으면 끝 상태를 준다.
    const snapshot = current() ?? latest;
    finish(snapshot, { waited: true, timedOut: !isTerminalDispatchJobStatus(snapshot.status) });
  }, waitMs);
  return () => {
    if (done) return;
    done = true;
    if (timer !== undefined) clearTimer(timer);
    release();
  };
}
