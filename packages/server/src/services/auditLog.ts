// SCENARIO.md §5.22 — 권한·감사 경계.
//
// **새 감시 계층이 아니다.** 도구 호출은 §5.3 훅 이벤트로 이미 우리 앞을 지나가고, 사람에게
// 묻는 창구도 §5.3 #12-1 권한 브로커가 이미 서 있다. 이 서비스는 그 두 길에서 받은 사실을
// **한 원장**에 적을 뿐이다 — 따로 가로채지도, 따로 저장하지도 않는다(디스크는 훅 경로가
// 이미 쓰는 코얼레스 체크포인트에 얹는다 — §5.7 v3.45).
//
// 원장이 하나인 이유: "무슨 도구로 어디를 만졌나"와 "사람이 뭐라 답했나"를 따로 두면 둘을
// 잇는 키가 또 필요해지고, 한쪽만 캡에 잘렸을 때 어느 쪽이 진실인지 판정할 수 없다.

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type {
  AuditBoundaryConfig,
  AuditCounts,
  AuditDecisionSource,
  AuditEntry,
  AuditRetired,
  AuditRiskKind,
  ProjectAuditLog,
} from '@vibisual/shared';
import {
  AUDIT_ENTRIES_MAX_PER_PROJECT,
  AUDIT_REASON_MAX_CHARS,
  AUDIT_SNAPSHOT_ENTRIES,
  classifyToolRisk,
  costDayKey,
  emptyAuditCounts,
  isDefaultAuditBoundary,
  normalizeAuditBoundary,
  summarizeToolCall,
} from '@vibisual/shared';
import { HOST_PLATFORM } from './pathKey.js';

/**
 * §5.22 `outside` — `~` 를 펴는 홈 디렉터리. 프로세스가 사는 동안 바뀌지 않으므로 한 번만 읽는다.
 * (플랫폼과 마찬가지로 **판정 함수 안에서 읽지 않고** 인자로 실어 보낸다 — 멀티플랫폼 규약.)
 */
const AUDIT_HOME_DIR = homedir();

/**
 * §5.22 — 이 호스트의 값(플랫폼·홈)을 물린 위험 판정.
 *
 * 승인 창구(`/api/permission-check`)와 원장 기록이 **같은 이 함수**를 쓴다. 두 자리가 저마다
 * 옵션을 지어 넣으면 같은 호출이 카드에서는 위험, 타임라인에서는 평범으로 갈린다.
 */
export function classifyToolRiskOnHost(
  toolName: string,
  toolInput?: Record<string, unknown> | null,
  roots: readonly string[] = [],
): AuditRiskKind[] {
  return classifyToolRisk(toolName, toolInput ?? undefined, {
    roots,
    platform: HOST_PLATFORM,
    homeDir: AUDIT_HOME_DIR,
  });
}

/**
 * 승인 창구(`/api/permission-check`)가 적은 줄을 뒤따라오는 훅 이벤트가 찾아가는 창.
 *
 * 훅 핸들러는 PreToolUse 에서 **승인 창구를 먼저 부르고**(사람을 최대 60초 기다린다) 그 답이
 * 난 뒤에 추적용 이벤트를 보낸다. 그래서 같은 호출이 두 길로 도착하고, 그 간격이 승인 대기만큼
 * 벌어질 수 있다 — 창을 짧게 잡으면 한 호출이 두 줄로 갈라진다.
 */
const AUDIT_PENDING_WINDOW_MS = 120_000;

/** 훅 경로가 넘겨 주는 호출 한 건. */
export interface AuditRecordInput {
  projectName: string;
  sessionId: string;
  agentId?: string;
  subAgentId?: string;
  agentLabel?: string;
  agentColor?: string;
  toolName: string;
  toolInput?: Record<string, unknown> | null;
  /** 같은 호출의 Pre/Post 를 한 줄로 합치는 키. */
  toolUseId?: string;
  /**
   * §5.22 `outside` — 이 호출이 머물러야 할 경계(프로젝트 루트 · 세션 cwd).
   *
   * 비면 `outside` 를 판정하지 않는다. 호출부가 **둘 다** 실어 주는 이유는, 루트 밖에 선
   * 워크트리나 별도 cwd 로 띄운 세션을 통째로 밖으로 몰면 그 세션의 모든 호출이 빨개져
   * 배지가 뜻을 잃기 때문이다.
   */
  roots?: readonly string[];
  at?: number;
  /**
   * 승인 창구가 먼저 적은 줄이면 `true` — 뒤따라올 훅 이벤트가 이 줄을 찾아가도록
   * 표식을 걸어 둔다(`tool_use_id` 는 승인 창구에 오지 않아 이 키로만 이어진다).
   */
  awaitHookEvent?: boolean;
}

interface LedgerState {
  /** 최신 순. */
  entries: AuditEntry[];
  byId: Map<string, AuditEntry>;
  byToolUse: Map<string, AuditEntry>;
  /** 승인 창구가 먼저 적은 줄 — 뒤따라오는 훅 이벤트 **한 번**이 소비한다. */
  pending: Map<string, { entryId: string; at: number }>;
  boundary: AuditBoundaryConfig;
  retired: AuditRetired;
}

/** 두 길(승인 창구·훅 이벤트)이 같은 호출임을 알아보는 키. */
function pendingKey(input: AuditRecordInput, summary: string): string {
  return `${input.sessionId}|${input.toolName}|${summary}`;
}

function emptyRetired(): AuditRetired {
  return { entries: 0, risky: 0, denied: 0 };
}

function clipReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const s = reason.replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > AUDIT_REASON_MAX_CHARS ? `${s.slice(0, AUDIT_REASON_MAX_CHARS - 1)}…` : s;
}

/**
 * 원장을 훑어 집계를 만든다 — 파생을 따로 누적하지 않는다(한 벌만 진실이면 어긋날 수 없다).
 *
 * 보관 상한이 사용자 손에 있어 원장이 길어질 수 있으므로, 이 접기는 **브로드캐스트마다가 아니라
 * 스냅샷을 만들 때** 도는 자리라는 전제 위에 있다. 상한을 크게 둔 사용자에게도 O(줄 수) 한 번이다.
 */
function foldCounts(state: LedgerState, now: number): AuditCounts {
  const today = costDayKey(now);
  const counts = emptyAuditCounts();
  for (const e of state.entries) {
    counts.total += 1;
    const risky = e.riskKinds.length > 0;
    if (risky) {
      counts.risky += 1;
      if (costDayKey(e.at) === today) counts.todayRisky += 1;
    }
    if (e.decision === 'deny') counts.denied += 1;
    if (e.escalated) counts.escalated += 1;
  }
  counts.total += state.retired.entries;
  counts.risky += state.retired.risky;
  counts.denied += state.retired.denied;
  return counts;
}

/**
 * 캡을 넘은 꼬리를 잘라 `retired` 합계로 접는다 — 숫자는 줄지 않는다(§9).
 *
 * `max <= 0` 이면 **이 축은 정리하지 않는다**(§3.2.3 의 `0`=무제한 규약). 여기 한 곳에서만
 * 그 뜻을 해석한다 — 호출부마다 `> 0` 을 각자 쓰면 한 곳이 빠졌을 때 조용히 무제한이 된다.
 */
function trim(state: LedgerState, max: number): void {
  if (max <= 0) return;
  while (state.entries.length > max) {
    const dropped = state.entries.pop();
    if (!dropped) break;
    state.byId.delete(dropped.id);
    if (dropped.toolUseId) state.byToolUse.delete(dropped.toolUseId);
    state.retired.entries += 1;
    if (dropped.riskKinds.length > 0) state.retired.risky += 1;
    if (dropped.decision === 'deny') state.retired.denied += 1;
  }
}

function sanitizeEntryOnLoad(e: AuditEntry): AuditEntry {
  return {
    ...e,
    riskKinds: Array.isArray(e.riskKinds) ? e.riskKinds.filter((k): k is AuditRiskKind => typeof k === 'string') : [],
  };
}

export class AuditLogService {
  private logs = new Map<string, LedgerState>();

  /**
   * §3.2.3 B축 — 프로젝트당 보관 줄 수(`RetentionSettings.auditEntryMaxPerProject`).
   *
   * **주입으로 받는다.** 이 서비스가 앱 상태를 직접 읽으면 단위 테스트가 그 기계의 실제
   * `app-state.json` 에 좌우된다(테스트가 사용자 파일에 물린 사고는 이미 한 번 겪었다).
   * 기본 해석기는 상수 하나를 돌려주므로 주입 없이도 종전 그대로 동작한다.
   */
  constructor(private readonly resolveMaxEntries: () => number = () => AUDIT_ENTRIES_MAX_PER_PROJECT) {}

  /** 지금 유효한 보관 상한. `0` 이면 무제한(§3.2.3). */
  private maxEntries(): number {
    const raw = this.resolveMaxEntries();
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  }

  /**
   * 설정이 바뀐 직후 **지금 들고 있는 원장 전부**에 새 상한을 적용한다. 잘린 줄이 있으면 true.
   *
   * 이게 없으면 조용한 프로젝트는 다음 도구 호출이 올 때까지 옛 크기 그대로라,
   * 사용자에게는 "줄였는데 안 줄었다"로 보인다.
   */
  applyRetention(): boolean {
    const max = this.maxEntries();
    let changed = false;
    for (const state of this.logs.values()) {
      const before = state.entries.length;
      trim(state, max);
      if (state.entries.length !== before) changed = true;
    }
    return changed;
  }

  private state(projectName: string): LedgerState {
    let s = this.logs.get(projectName);
    if (!s) {
      s = {
        entries: [],
        byId: new Map(),
        byToolUse: new Map(),
        pending: new Map(),
        boundary: normalizeAuditBoundary(undefined),
        retired: emptyRetired(),
      };
      this.logs.set(projectName, s);
    }
    return s;
  }

  /**
   * 호출 한 건을 원장에 적는다. 같은 `toolUseId` 가 이미 있으면 **새 줄을 만들지 않고**
   * 그 줄을 갱신한다(Pre/Post 두 번 도착해도 한 줄 — 두 줄이면 같은 일이 두 번 일어난
   * 것처럼 보이고 원장 길이가 두 배가 된다).
   */
  record(input: AuditRecordInput): AuditEntry {
    const at = input.at ?? Date.now();
    const state = this.state(input.projectName);
    const riskKinds = classifyToolRiskOnHost(input.toolName, input.toolInput ?? undefined, input.roots ?? []);
    const { summary, target } = summarizeToolCall(input.toolName, input.toolInput ?? undefined);

    const key = pendingKey(input, summary);
    // 승인 창구가 먼저 적어 둔 줄이 있으면 그 줄로 합친다(한 호출이 두 줄로 갈라지지 않게).
    let existing = input.toolUseId ? state.byToolUse.get(input.toolUseId) : undefined;
    if (!existing && !input.awaitHookEvent) {
      const waiting = state.pending.get(key);
      if (waiting && at - waiting.at <= AUDIT_PENDING_WINDOW_MS) {
        existing = state.byId.get(waiting.entryId);
        state.pending.delete(key);
        if (existing && input.toolUseId && !existing.toolUseId) {
          existing.toolUseId = input.toolUseId;
          state.byToolUse.set(input.toolUseId, existing);
        }
      } else if (waiting) {
        state.pending.delete(key);
      }
    }
    if (existing) {
      // 나중 도착이 더 나은 정보를 들고 올 수 있다(Post 의 tool_input 이 채워져 오는 판본).
      if (riskKinds.length > 0) existing.riskKinds = riskKinds;
      if (summary && summary !== input.toolName) existing.summary = summary;
      if (target) existing.target = target;
      if (input.agentId && !existing.agentId) existing.agentId = input.agentId;
      if (input.subAgentId && !existing.subAgentId) existing.subAgentId = input.subAgentId;
      if (input.agentLabel) existing.agentLabel = input.agentLabel;
      if (input.agentColor) existing.agentColor = input.agentColor;
      return existing;
    }

    const entry: AuditEntry = {
      id: `audit-${randomUUID()}`,
      at,
      projectName: input.projectName,
      sessionId: input.sessionId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.subAgentId ? { subAgentId: input.subAgentId } : {}),
      ...(input.agentLabel ? { agentLabel: input.agentLabel } : {}),
      ...(input.agentColor ? { agentColor: input.agentColor } : {}),
      toolName: input.toolName,
      summary,
      ...(target ? { target } : {}),
      riskKinds,
      ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
    };

    state.entries.unshift(entry);
    state.byId.set(entry.id, entry);
    if (entry.toolUseId) state.byToolUse.set(entry.toolUseId, entry);
    if (input.awaitHookEvent) {
      // 오래된 표식은 여기서 함께 걷는다(별도 타이머 ❌).
      for (const [k, v] of state.pending) {
        if (at - v.at > AUDIT_PENDING_WINDOW_MS) state.pending.delete(k);
      }
      state.pending.set(key, { entryId: entry.id, at });
    }
    trim(state, this.maxEntries());
    return entry;
  }

  /** 승인 카드가 뜬 줄에 "물었다"는 표식을 남긴다. */
  markEscalated(projectName: string, entryId: string): void {
    const entry = this.logs.get(projectName)?.byId.get(entryId);
    if (entry) entry.escalated = true;
  }

  /**
   * 사람(또는 정책)의 답을 그 줄에 적는다. 없는 줄이면 false —
   * 결정만 따로 떠도는 원장을 만들지 않는다.
   */
  recordDecision(
    projectName: string,
    entryId: string,
    decision: 'allow' | 'deny',
    source: AuditDecisionSource,
    reason?: string,
    at: number = Date.now(),
  ): boolean {
    const entry = this.logs.get(projectName)?.byId.get(entryId);
    if (!entry) return false;
    entry.decision = decision;
    entry.decisionSource = source;
    const clipped = clipReason(reason);
    if (clipped) entry.decisionReason = clipped;
    entry.decidedAt = at;
    return true;
  }

  /** 그 프로젝트의 경계 스위치(없으면 기본 = 전부 묻는다). */
  getBoundary(projectName: string): AuditBoundaryConfig {
    return this.state(projectName).boundary;
  }

  /** 스위치 갱신. 부분 페이로드도 종류별 값을 잃지 않게 현재 값 위에 덮는다. */
  setBoundary(projectName: string, patch: Partial<AuditBoundaryConfig>): AuditBoundaryConfig {
    const state = this.state(projectName);
    const merged = normalizeAuditBoundary({
      escalateRisky: patch.escalateRisky ?? state.boundary.escalateRisky,
      kinds: { ...state.boundary.kinds, ...(patch.kinds ?? {}) },
    });
    state.boundary = merged;
    return merged;
  }

  /** 원장 한 줄 조회(REST 조회·테스트용). */
  getEntry(projectName: string, entryId: string): AuditEntry | undefined {
    return this.logs.get(projectName)?.byId.get(entryId);
  }

  /**
   * 전선용 — 프로젝트당 한 장. 집계는 여기서 접어 실어 준다(§3.1).
   *
   * **최근 몫만 싣는다**(§9). 원장 전량을 브로드캐스트마다 실으면 스냅샷이 통째로 무거워지므로
   * 화면이 쓰는 최근 `AUDIT_SNAPSHOT_ENTRIES` 줄만 보내고, 전량은 체크포인트와 조회 REST 에 둔다.
   * 집계는 **자르기 전 원장 전체**에서 접으므로 숫자는 그대로다.
   */
  getSnapshot(now: number = Date.now()): ProjectAuditLog[] {
    const out: ProjectAuditLog[] = [];
    for (const [projectName, state] of this.logs) {
      out.push(this.build(projectName, state, now, AUDIT_SNAPSHOT_ENTRIES));
    }
    return out;
  }

  /** 디스크 포맷 — 여기서 빠지면 결정 이력이 영영 없다(재계산 불가). */
  toCheckpoint(projectName: string, now: number = Date.now()): ProjectAuditLog | undefined {
    const state = this.logs.get(projectName);
    if (!state) return undefined;
    if (state.entries.length === 0 && state.retired.entries === 0 && isDefaultAuditBoundary(state.boundary)) {
      // 기록도 없고 스위치도 기본이면 저장할 것이 없다(빈 필드로 체크포인트를 늘리지 않는다).
      // 기본값 비교는 shared 한 곳(`isDefaultAuditBoundary`)에서만 한다 — 여기에 종전 기본을
      // 직접 적어 두면 기본이 뒤집힌 순간 **사용자가 켜 둔 경계가 저장되지 않고 사라진다**.
      return undefined;
    }
    return this.build(projectName, state, now);
  }

  private build(projectName: string, state: LedgerState, now: number, limit?: number): ProjectAuditLog {
    const rows = limit === undefined ? state.entries : state.entries.slice(0, limit);
    const log: ProjectAuditLog = {
      projectName,
      entries: rows.map((e) => ({ ...e })),
      boundary: { escalateRisky: state.boundary.escalateRisky, kinds: { ...state.boundary.kinds } },
      counts: foldCounts(state, now),
      updatedAt: state.entries[0]?.at ?? now,
    };
    if (state.retired.entries > 0) log.retired = { ...state.retired };
    return log;
  }

  /** 체크포인트 복원 — 없으면 빈 원장으로 시작(옛 체크포인트 호환). */
  restore(log: ProjectAuditLog | undefined): void {
    if (!log?.projectName) return;
    const state: LedgerState = {
      entries: [],
      byId: new Map(),
      byToolUse: new Map(),
      pending: new Map(),
      boundary: normalizeAuditBoundary(log.boundary),
      retired: log.retired ? { ...log.retired } : emptyRetired(),
    };
    for (const raw of log.entries ?? []) {
      if (!raw?.id) continue;
      const e = sanitizeEntryOnLoad(raw);
      state.entries.push(e);
      state.byId.set(e.id, e);
      if (e.toolUseId) state.byToolUse.set(e.toolUseId, e);
    }
    state.entries.sort((a, b) => b.at - a.at);
    trim(state, this.maxEntries());
    this.logs.set(log.projectName, state);
  }

  /**
   * 멀티프로젝트 부트 병합 — id 기준 합집합. 이미 있는 줄은 덮지 않는다
   * (지금 돌고 있는 원장이 디스크보다 새것이다).
   */
  merge(log: ProjectAuditLog | undefined): void {
    if (!log?.projectName) return;
    const state = this.state(log.projectName);
    if (state.entries.length === 0 && state.retired.entries === 0) {
      state.boundary = normalizeAuditBoundary(log.boundary);
      state.retired = log.retired ? { ...log.retired } : emptyRetired();
    }
    let added = false;
    for (const raw of log.entries ?? []) {
      if (!raw?.id || state.byId.has(raw.id)) continue;
      const e = sanitizeEntryOnLoad(raw);
      state.entries.push(e);
      state.byId.set(e.id, e);
      if (e.toolUseId && !state.byToolUse.has(e.toolUseId)) state.byToolUse.set(e.toolUseId, e);
      added = true;
    }
    if (added) {
      state.entries.sort((a, b) => b.at - a.at);
      trim(state, this.maxEntries());
    }
  }

  /** 프로젝트 이름이 바뀌면 원장도 따라간다(탭 relabel). */
  relabel(from: string, to: string): void {
    if (from === to) return;
    const state = this.logs.get(from);
    if (!state) return;
    for (const e of state.entries) e.projectName = to;
    this.logs.delete(from);
    const existing = this.logs.get(to);
    if (!existing) {
      this.logs.set(to, state);
      return;
    }
    // 이미 같은 이름의 원장이 있으면 합친다(id 기준 합집합).
    for (const e of state.entries) {
      if (existing.byId.has(e.id)) continue;
      existing.entries.push(e);
      existing.byId.set(e.id, e);
      if (e.toolUseId && !existing.byToolUse.has(e.toolUseId)) existing.byToolUse.set(e.toolUseId, e);
    }
    existing.retired.entries += state.retired.entries;
    existing.retired.risky += state.retired.risky;
    existing.retired.denied += state.retired.denied;
    existing.entries.sort((a, b) => b.at - a.at);
    trim(existing, this.maxEntries());
  }
}
