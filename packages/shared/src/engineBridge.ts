/**
 * §4 엔진 다리 — Claude Code 모드(2.1.287+)로 우리 세션 안에서 엔진이 사실(턴 시작·끝·도구·사용량)을 올린다(감지기 전용). 훅은 Esc 로 끊은 턴·긴 도구 호출을 못 본다.
 * 순수 판정만(시각은 인자). 모드 본체(`hooks/mods/vibisual-bridge/hooks/register.js`)는 이 파일을 import 못 하니 전선 모양 정본 `parseEngineBridgeReport` 와 함께 고친다.
 */
import type { RateLimitInfo } from './types.js';

/** 동봉 모드의 플러그인 이름(`.claude-plugin/plugin.json` 의 `name`). */
export const ENGINE_BRIDGE_PLUGIN_NAME = 'vibisual-bridge';
/** 모드가 기본으로 켜진 첫 판(공식 문서: "Mods are on by default … v2.1.287 or later") — 그 아래 판엔 `hooks.json` 의 `modules` 를 싣지 않는다. */
export const ENGINE_BRIDGE_MIN_CLI_VERSION = '2.1.287';
/** 모드가 생존 신호를 보내는 간격. 서버가 답에 실어 내려 준다(모드의 기본값과 같은 값). */
export const ENGINE_BRIDGE_HEARTBEAT_MS = 30_000;
/** 이보다 오래 소식이 없으면 그 다리는 끊긴 것으로 본다(생존 신호 세 번 + 여유). */
export const ENGINE_BRIDGE_STALE_MS = 95_000;
/** 엔진이 턴이 돈다 해도 이만큼 진척이 없으면 보증하지 않는다 — §2.4 생존 판정에 맡긴다. */
export const ENGINE_BRIDGE_VOUCH_PROGRESS_MS = 30 * 60_000;
/** 서버가 들고 있는 다리 상태 수 상한(§3.2.4 F′ — 키가 세션 수만큼 는다). */
export const ENGINE_BRIDGE_STATE_MAX = 500;
/** 끝났거나 소식이 끊긴 다리를 진단용으로 남겨 두는 시간. */
export const ENGINE_BRIDGE_ENDED_KEEP_MS = 10 * 60_000;
/** 신고 한 번에 받는 사건 수 상한 — 모드도 같은 값으로 쌓아 둔다. */
export const ENGINE_BRIDGE_EVENTS_MAX = 200;

const TEXT_MAX = 200;
const NAME_MAX = 80;
const REASON_MAX = 40;
const INSTANCE_RE = /^[\w.-]{1,80}$/;
const DAY_MS = 86_400_000;

export type EngineBridgeTurnState = 'running' | 'idle' | 'unknown';
export type EngineBridgeEventKind = 'attach' | 'turn-start' | 'turn-end' | 'clear' | 'end';
/** 엔진의 `turn.complete` 이유. 모르는 값은 `unknown` 으로 접는다. */
export type EngineBridgeTurnEndReason = 'answer' | 'aborted' | 'refusal' | 'error' | 'unknown';

const EVENT_KINDS: readonly EngineBridgeEventKind[] = ['attach', 'turn-start', 'turn-end', 'clear', 'end'];
const TURN_STATES: readonly EngineBridgeTurnState[] = ['running', 'idle', 'unknown'];
const TURN_END_REASONS: readonly EngineBridgeTurnEndReason[] = ['answer', 'aborted', 'refusal', 'error'];

/** 모드가 스폰 env 에서 읽은 신원. 서버는 살아 있는 sub 와 대조한 뒤에만 믿는다. */
export interface EngineBridgeIdentity {
  /** 세션 탭(sub) id — 헤드리스 `VIBISUAL_SUBAGENT_ID` / CMD `VIBISUAL_SUB_AGENT_ID`. */
  subAgentId: string;
  /** 버블(에이전트) id. */
  agentId: string;
  /** CMD 터미널 칸 id(`term:<agentId>:<sub>#<pane>`). 헤드리스면 빈 문자열. */
  termId: string;
  /** CLI 대화 id(`$.session.id()`). `/clear` 뒤에는 바뀐다. */
  sessionId: string;
  /** 엔진 판올림(`$.session.version().version`). */
  cliVersion: string;
  interactive: boolean;
  surface: string | null;
}

/** 사건 한 건. 시각은 **보낸 순간으로부터의 거리**(`ageMs`)라 두 시계가 어긋날 일이 없다. */
export interface EngineBridgeEvent {
  kind: EngineBridgeEventKind;
  ageMs: number;
  turnId?: string;
  /** `turn-end` 의 끝 이유 · `end`/`clear` 의 세션 끝 이유. */
  reason?: string;
  durationMs?: number;
}

/** 보내는 순간의 수준 상태 — 사건을 놓쳐도 이것으로 바로잡는다. */
export interface EngineBridgeSnapshotWire {
  turnState: EngineBridgeTurnState;
  turnAgeMs?: number;
  progressAgeMs?: number;
  /** 도는 도구 — 동봉 모드는 보내지 않는다(2.1.299 부터 막을 수 있는 훅이 답을 못 하면 도구가 거부된다). 옛 모드 세션 때문에 받기는 둔다. */
  toolsInFlight: number;
  toolInFlight?: { name: string; ageMs: number };
}

export interface EngineBridgeRateLimitWire {
  /** `five_hour` · `seven_day` · 게이트웨이의 `spend_limit`. */
  kind: string;
  /** 0~100 퍼센트. */
  percentUsed: number;
  /** 리셋 시각(ISO 8601). */
  resetsAt?: string;
}

export interface EngineBridgeUsageWire {
  contextPercent?: number;
  contextTokens?: number;
  contextWindow?: number;
  rateLimits: EngineBridgeRateLimitWire[];
  costUsd?: number;
}

/** `POST /api/engine-bridge` 의 본문 한 벌. */
export interface EngineBridgeReport {
  v: 1;
  /** 모듈이 로드될 때 한 번 뽑는 표식 — 같은 키의 옛 프로세스가 보낸 늦은 신고를 가려낸다. */
  instance: string;
  identity: EngineBridgeIdentity;
  events: EngineBridgeEvent[];
  snapshot?: EngineBridgeSnapshotWire;
  usage?: EngineBridgeUsageWire;
}

/** 서버가 다리 하나(= 엔진 프로세스 하나)에 대해 세우는 상태. 시각은 서버 시계(ms). */
export interface EngineBridgeState {
  /** CMD = `term:<termId>`, 헤드리스 = `sub:<subAgentId>`. */
  key: string;
  instance: string;
  subAgentId: string;
  agentId: string;
  termId: string;
  sessionId: string;
  cliVersion: string;
  interactive: boolean;
  attachedAt: number;
  lastSeenAt: number;
  turnState: EngineBridgeTurnState;
  turnStartedAt?: number;
  lastProgressAt?: number;
  toolsInFlight: number;
  toolInFlight?: { name: string; since: number };
  lastTurnEnd?: { reason: EngineBridgeTurnEndReason; at: number; durationMs?: number };
  ended?: { reason: string; at: number };
  usage?: { contextPercent?: number; contextTokens?: number; contextWindow?: number; costUsd?: number; at: number };
}

/** `GET /api/engine-bridge` — 옵션창 상태 줄. */
export interface EngineBridgeStatus {
  /** 옵션창 스위치(`UserDefaults.advanced.engineBridge`, 기본 켬). */
  enabled: boolean;
  /** 동봉 파일을 찾아 `~/.vibisual/mods/` 에 옮겨 놓을 수 있었나. */
  modReady: boolean;
  /** 지금 실행본의 판올림. 아직 못 쟀으면 null. */
  cliVersion: string | null;
  /** 모드를 실을 수 있는 판인가. 모르면 null. */
  supported: boolean | null;
  minCliVersion: string;
  /** 다음 스폰에 모드가 실리는가(위 셋이 다 참). */
  active: boolean;
  /** 지금 붙어 있는(신선하고 끝나지 않은) 다리 수. */
  sessions: number;
}

// ── 판올림 ─────────────────────────────────────────────────────────────────────

/** 앞의 숫자 세 마디만 본다 — `2.1.287-dev.…` 같은 개발판도 2.1.287 의 기능을 가진다. */
function versionCore(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 이 판올림의 실행본에 모드를 실을 수 있는가. 모르는 값·못 읽는 값은 `false`(싣지 않는다). */
export function isEngineBridgeCliSupported(
  version: string | null | undefined,
  min: string = ENGINE_BRIDGE_MIN_CLI_VERSION,
): boolean {
  if (typeof version !== 'string') return false;
  const a = versionCore(version);
  const b = versionCore(min);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}

// ── 전선 모양 검사 ──────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clipText(v: unknown, max: number = TEXT_MAX): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** 0 이상의 유한한 수만 받는다. 상한을 넘으면 상한으로 접는다. */
function nonNegative(v: unknown, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
  return Math.min(v, max);
}

function parseEvent(v: unknown): EngineBridgeEvent | null {
  if (!isRecord(v)) return null;
  const kind = v['kind'];
  if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind as EngineBridgeEventKind)) return null;
  const event: EngineBridgeEvent = { kind: kind as EngineBridgeEventKind, ageMs: nonNegative(v['ageMs'], DAY_MS) ?? 0 };
  const turnId = clipText(v['turnId'], NAME_MAX);
  if (turnId) event.turnId = turnId;
  const reason = clipText(v['reason'], REASON_MAX);
  if (reason) event.reason = reason;
  const durationMs = nonNegative(v['durationMs'], 30 * DAY_MS);
  if (durationMs !== undefined) event.durationMs = durationMs;
  return event;
}

function parseSnapshot(v: unknown): EngineBridgeSnapshotWire | undefined {
  if (!isRecord(v)) return undefined;
  const state = v['turnState'];
  const snap: EngineBridgeSnapshotWire = {
    turnState: typeof state === 'string' && TURN_STATES.includes(state as EngineBridgeTurnState)
      ? state as EngineBridgeTurnState
      : 'unknown',
    toolsInFlight: Math.floor(nonNegative(v['toolsInFlight'], 1000) ?? 0),
  };
  const turnAgeMs = nonNegative(v['turnAgeMs'], 30 * DAY_MS);
  if (turnAgeMs !== undefined) snap.turnAgeMs = turnAgeMs;
  const progressAgeMs = nonNegative(v['progressAgeMs'], 30 * DAY_MS);
  if (progressAgeMs !== undefined) snap.progressAgeMs = progressAgeMs;
  const tool = v['toolInFlight'];
  if (isRecord(tool)) {
    const name = clipText(tool['name'], NAME_MAX);
    const ageMs = nonNegative(tool['ageMs'], 30 * DAY_MS);
    if (name && ageMs !== undefined) snap.toolInFlight = { name, ageMs };
  }
  return snap;
}

function parseUsage(v: unknown): EngineBridgeUsageWire | undefined {
  if (!isRecord(v)) return undefined;
  const usage: EngineBridgeUsageWire = { rateLimits: [] };
  const percent = nonNegative(v['contextPercent'], 100);
  if (percent !== undefined) usage.contextPercent = percent;
  const tokens = nonNegative(v['contextTokens'], 1e9);
  if (tokens !== undefined) usage.contextTokens = tokens;
  const window = nonNegative(v['contextWindow'], 1e9);
  if (window !== undefined) usage.contextWindow = window;
  const cost = nonNegative(v['costUsd'], 1e7);
  if (cost !== undefined) usage.costUsd = cost;
  const limits = v['rateLimits'];
  if (Array.isArray(limits)) {
    for (const r of limits.slice(0, 10)) {
      if (!isRecord(r)) continue;
      const kind = clipText(r['kind'], REASON_MAX);
      const percentUsed = nonNegative(r['percentUsed'], 1000);
      if (!kind || percentUsed === undefined) continue;
      const resetsAt = clipText(r['resetsAt'], 64);
      usage.rateLimits.push({ kind, percentUsed, ...(resetsAt ? { resetsAt } : {}) });
    }
  }
  return usage;
}

/** 모드 본문 검사(신뢰할 수 없는 입력) — 모양이 어긋나면 `null`, 글자는 자르고 수는 범위로 접고 모르는 사건은 버린다. sub 실재 여부는 서버가 대조한다. */
export function parseEngineBridgeReport(body: unknown): EngineBridgeReport | null {
  if (!isRecord(body)) return null;
  if (body['v'] !== 1) return null;
  const instance = body['instance'];
  if (typeof instance !== 'string' || !INSTANCE_RE.test(instance)) return null;
  const id = body['identity'];
  if (!isRecord(id)) return null;
  const surface = id['surface'];
  const identity: EngineBridgeIdentity = {
    subAgentId: clipText(id['subAgentId']),
    agentId: clipText(id['agentId']),
    termId: clipText(id['termId']),
    sessionId: clipText(id['sessionId']),
    cliVersion: clipText(id['cliVersion'], REASON_MAX),
    interactive: id['interactive'] === true,
    surface: typeof surface === 'string' ? surface.slice(0, REASON_MAX) : null,
  };
  if (!identity.subAgentId) return null;
  const rawEvents = Array.isArray(body['events']) ? body['events'] : [];
  const events: EngineBridgeEvent[] = [];
  for (const raw of rawEvents.slice(-ENGINE_BRIDGE_EVENTS_MAX)) {
    const ev = parseEvent(raw);
    if (ev) events.push(ev);
  }
  const report: EngineBridgeReport = { v: 1, instance, identity, events };
  const snapshot = parseSnapshot(body['snapshot']);
  if (snapshot) report.snapshot = snapshot;
  const usage = parseUsage(body['usage']);
  if (usage) report.usage = usage;
  return report;
}

/** 다리 상태의 열쇠 — CMD 는 터미널 칸, 헤드리스는 세션 탭. 한 칸에는 엔진 프로세스가 하나다. */
export function engineBridgeKeyOf(identity: Pick<EngineBridgeIdentity, 'termId' | 'subAgentId'>): string {
  return identity.termId ? `term:${identity.termId}` : `sub:${identity.subAgentId}`;
}

/** 엔진의 끝 이유를 우리 어휘로 접는다. */
export function normalizeEngineBridgeTurnEndReason(reason: string | undefined): EngineBridgeTurnEndReason {
  return reason && TURN_END_REASONS.includes(reason as EngineBridgeTurnEndReason)
    ? reason as EngineBridgeTurnEndReason
    : 'unknown';
}

// ── 판정 ───────────────────────────────────────────────────────────────────────

type FreshnessFields = Pick<EngineBridgeState, 'lastSeenAt' | 'ended'>;
type TurnFields = FreshnessFields & Pick<EngineBridgeState, 'turnState' | 'turnStartedAt' | 'lastProgressAt' | 'attachedAt'>;

/** 끝나지 않았고 생존 신호가 끊기지 않은 다리인가. */
export function isEngineBridgeFresh(state: FreshnessFields, now: number): boolean {
  return !state.ended && now - state.lastSeenAt <= ENGINE_BRIDGE_STALE_MS;
}

/** 엔진이 지금 "턴이 돈다"고 말하는가(신선한 다리의 말만 믿는다). */
export function isEngineBridgeTurnRunning(state: TurnFields, now: number): boolean {
  return isEngineBridgeFresh(state, now) && state.turnState === 'running';
}

/**
 * §2.4 — 생존 판정을 생략해도 되나: 턴이 돌고 최근(`ENGINE_BRIDGE_VOUCH_PROGRESS_MS`)에 진척이 있을 때만(멈춘 턴 찾기는 판정 몫).
 * `observedProgressAt`(대화록 마지막 쓰기)와 다리 진척 중 늦은 쪽을 본다 — 턴이 도는지는 다리만 말한다.
 */
export function engineBridgeVouchesRunning(state: TurnFields, now: number, observedProgressAt?: number): boolean {
  if (!isEngineBridgeTurnRunning(state, now)) return false;
  const bridged = state.lastProgressAt ?? state.turnStartedAt ?? state.attachedAt;
  const progressAt = observedProgressAt !== undefined && observedProgressAt > bridged ? observedProgressAt : bridged;
  return now - progressAt <= ENGINE_BRIDGE_VOUCH_PROGRESS_MS;
}

/**
 * §2.4 판정 모델에게 실어 보내는 증거 한 줄(영문 — 판정 프롬프트가 영문이다). 숫자는 해석하지 않고
 * 그대로 적는다(해석이 곧 판정이고, 그것은 모델의 일이다).
 */
export function describeEngineBridgeForProbe(
  state: Pick<EngineBridgeState, 'lastSeenAt' | 'ended' | 'turnState' | 'turnStartedAt' | 'lastProgressAt' | 'toolInFlight' | 'lastTurnEnd'>,
  now: number,
): string {
  const min = (ms: number): number => Math.max(0, Math.floor(ms / 60_000));
  if (state.ended) {
    return `the engine reported that this session ended (${state.ended.reason || 'unknown'}) ${min(now - state.ended.at)} min ago`;
  }
  if (now - state.lastSeenAt > ENGINE_BRIDGE_STALE_MS) {
    return `the engine stopped reporting ${min(now - state.lastSeenAt)} min ago (its process may be gone)`;
  }
  const heard = Math.max(0, Math.round((now - state.lastSeenAt) / 1000));
  if (state.turnState === 'running') {
    const started = state.turnStartedAt !== undefined ? `${min(now - state.turnStartedAt)} min ago` : 'at an unknown time';
    const progress = state.lastProgressAt !== undefined ? `${min(now - state.lastProgressAt)} min ago` : 'unknown';
    const tool = state.toolInFlight
      ? `; tool "${state.toolInFlight.name}" has been running for ${min(now - state.toolInFlight.since)} min`
      : '';
    return `the engine itself reports (heard ${heard} s ago): a turn IS running, started ${started}, last progress ${progress}${tool}`;
  }
  if (state.turnState === 'idle') {
    const last = state.lastTurnEnd
      ? `; the last turn ended ${min(now - state.lastTurnEnd.at)} min ago (${state.lastTurnEnd.reason})`
      : '';
    return `the engine itself reports (heard ${heard} s ago): NO turn is running${last}`;
  }
  return `the engine itself reports (heard ${heard} s ago): turn state unknown`;
}

/** 엔진 한도(5시간·7일)를 §4 `RateLimitInfo` 로 옮긴다(`/api/rate-limits` 와 같은 자리, 퍼센트 그대로, 리셋 ISO → epoch ms). 칸이 없는 창은 버린다 — 없으면 `null`. */
export function rateLimitsFromEngine(
  list: readonly EngineBridgeRateLimitWire[] | undefined,
): Partial<Omit<RateLimitInfo, 'updatedAt'>> | null {
  if (!list || list.length === 0) return null;
  const out: Partial<Omit<RateLimitInfo, 'updatedAt'>> = {};
  for (const r of list) {
    if (!Number.isFinite(r.percentUsed)) continue;
    const pct = Math.max(0, Math.min(100, r.percentUsed));
    const reset = typeof r.resetsAt === 'string' ? Date.parse(r.resetsAt) : Number.NaN;
    if (r.kind === 'five_hour') {
      out.used5h = pct;
      if (Number.isFinite(reset)) out.resetAt5h = reset;
    } else if (r.kind === 'seven_day') {
      out.used7d = pct;
      if (Number.isFinite(reset)) out.resetAt7d = reset;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
