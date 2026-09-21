/**
 * §5.3 #10-5 — 설정 덜어내기(Config Trim) **범위·저장 계약**.
 *
 * 오케스트라(`orchestraScope.ts`)와 자동 목표(`autoGoalScope.ts`)의 스위치 수학을 그대로 따른다.
 * 다른 점은 단 하나 — 여기는 **3단**이다: `프로젝트 전체` · `에이전트` · `이 세션만`.
 *
 * 세 단 모두 3상(`true` 켬 / `false` 끔 / 없음 = 윗단 물려받기)이고, 아무것도 안 정하면 **끔**이다.
 * 기본이 끔이라 사용자가 켜기 전에는 이 기능이 스폰 경로에 아예 닿지 않는다.
 */

import type {
  ConfigTrimExclusion,
  ConfigTrimRemoval,
  ConfigTrimRun,
  ConfigTrimRuleId,
  ConfigTrimScope,
  ConfigTrimSettings,
  ConfigTrimSummary,
} from './types.js';
import {
  CONFIG_TRIM_RUN_MAX_PER_PROJECT,
  CONFIG_TRIM_RUN_SNAPSHOT_MAX,
  SPEC_SCOPE_ENTRY_MAX,
} from './constants.js';
import { CONFIG_TRIM_RULE_BY_ID, CONFIG_TRIM_VALUE_MAX } from './configTrimRules.js';

/** 바깥(넓음) -> 안(좁음). 화면이 이 차례로 스위치를 그리고, 판정은 반대 차례로 읽는다. */
export const CONFIG_TRIM_SCOPE_ORDER: readonly ConfigTrimScope[] = ['project', 'agent', 'session'];

/** 이 판정에 필요한 식별자 — 없으면 그 단은 "고를 수 없음"이 된다. */
export interface ConfigTrimScopeIds {
  /** 커스텀 에이전트 id. */
  agentId?: string | undefined;
  /** 그 에이전트의 세션(서브에이전트) id — "이 세션만" 단이 쓰는 값. */
  subAgentId?: string | undefined;
}

/** 스위치 한 단의 지금 모습 — 화면이 이 그대로 그린다. */
export interface ConfigTrimScopeState {
  scope: ConfigTrimScope;
  /** 이 단이 **직접** 정한 값. `null` = 안 정함(윗단을 물려받는다). */
  own: boolean | null;
  /** 물려받기까지 셈한 이 단의 실제 값. */
  effective: boolean;
  /** 값이 윗단에서 왔는가. */
  inherited: boolean;
  /** 지금 이 화면에서 고를 수 있는가(식별자가 있는가). */
  available: boolean;
}

function own(map: Record<string, boolean> | undefined, id: string | undefined): boolean | null {
  if (!map || typeof id !== 'string' || id === '') return null;
  const v = map[id];
  return typeof v === 'boolean' ? v : null;
}

/**
 * 이 턴에 설정 덜어내기가 켜져 있는가 — **좁은 단이 이긴다**.
 * 세션 -> 에이전트 -> 프로젝트 차례로 보고, 아무 단도 정하지 않았으면 끔이다.
 */
export function resolveConfigTrimEnabled(
  settings: ConfigTrimSettings | undefined,
  ids?: ConfigTrimScopeIds,
): boolean {
  if (!settings) return false;
  const session = own(settings.enabledSessions, ids?.subAgentId);
  if (session !== null) return session;
  const agent = own(settings.enabledAgents, ids?.agentId);
  if (agent !== null) return agent;
  return settings.enabledProject === true;
}

/** 이 프로젝트 어딘가에 켜 둔 자리가 하나라도 있는가 — 활동바 점등 판정. */
export function configTrimActiveAnywhere(settings: ConfigTrimSettings | undefined): boolean {
  if (!settings) return false;
  if (settings.enabledProject === true) return true;
  for (const v of Object.values(settings.enabledAgents ?? {})) if (v === true) return true;
  for (const v of Object.values(settings.enabledSessions ?? {})) if (v === true) return true;
  return false;
}

/** 세 단의 지금 모습 — 화면이 `map` 하나로 스위치를 그린다. */
export function configTrimScopeStates(
  settings: ConfigTrimSettings | undefined,
  ids?: ConfigTrimScopeIds,
): ConfigTrimScopeState[] {
  const projectOwn = typeof settings?.enabledProject === 'boolean' ? settings.enabledProject : null;
  const agentOwn = own(settings?.enabledAgents, ids?.agentId);
  const sessionOwn = own(settings?.enabledSessions, ids?.subAgentId);
  const projectEff = projectOwn === true;
  const agentEff = agentOwn ?? projectEff;
  const sessionEff = sessionOwn ?? agentEff;
  return [
    {
      scope: 'project', own: projectOwn, effective: projectEff,
      inherited: false, available: true,
    },
    {
      scope: 'agent', own: agentOwn, effective: agentEff,
      inherited: agentOwn === null, available: typeof ids?.agentId === 'string' && ids.agentId !== '',
    },
    {
      scope: 'session', own: sessionOwn, effective: sessionEff,
      inherited: sessionOwn === null,
      available: typeof ids?.subAgentId === 'string' && ids.subAgentId !== '',
    },
  ];
}

/** 키 개수에 상한을 둔다 — 넣은 차례로 오래된 것부터 버린다(§ 용량 폭증 감사). */
export function capConfigTrimMap(
  map: Record<string, boolean>,
  max: number = SPEC_SCOPE_ENTRY_MAX,
): Record<string, boolean> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const out: Record<string, boolean> = {};
  for (const k of keys.slice(keys.length - max)) out[k] = map[k] as boolean;
  return out;
}

/**
 * 스위치 한 칸을 바꾼 **새 설정**을 돌려준다 — `enabled === null` 이면 그 칸을 지운다(윗단 물려받기).
 * 켬/끔은 이 함수 하나로만 바뀐다(patch 로도 바꾸면 두 창구가 같은 칸을 덮는다).
 */
export function withConfigTrimScope(
  settings: ConfigTrimSettings | undefined,
  scope: ConfigTrimScope,
  id: string | undefined,
  enabled: boolean | null,
): ConfigTrimSettings {
  const next: ConfigTrimSettings = { ...(settings ?? {}) };
  if (scope === 'project') {
    if (enabled === null) delete next.enabledProject;
    else next.enabledProject = enabled;
    return next;
  }
  const field = scope === 'agent' ? 'enabledAgents' : 'enabledSessions';
  if (typeof id !== 'string' || id === '') return next;
  const map = { ...(next[field] ?? {}) };
  if (enabled === null) delete map[id];
  else map[id] = enabled;
  if (Object.keys(map).length === 0) delete next[field];
  else next[field] = capConfigTrimMap(map);
  return next;
}

function normalizeScopeMap(input: unknown): Record<string, boolean> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'boolean' && k.trim() !== '') out[k] = v;
  }
  return Object.keys(out).length > 0 ? capConfigTrimMap(out) : undefined;
}

function normalizeRuleList(input: unknown): ConfigTrimRuleId[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: ConfigTrimRuleId[] = [];
  for (const x of input) {
    if (typeof x !== 'string' || !(x in CONFIG_TRIM_RULE_BY_ID)) continue;
    const id = x as ConfigTrimRuleId;
    if (!out.includes(id)) out.push(id);
  }
  return out.length > 0 ? out : undefined;
}

/** 규칙 id 인가 — REST 가 모르는 id 를 조용히 삼키지 않게 쓴다. */
export function isConfigTrimRuleId(v: unknown): v is ConfigTrimRuleId {
  return typeof v === 'string' && v in CONFIG_TRIM_RULE_BY_ID;
}

/** 바깥에서 온 설정(체크포인트·손으로 적은 JSON)을 계약 안으로 접는다 — 모양이 어긋난 칸은 버린다. */
export function normalizeConfigTrimSettings(input: unknown): ConfigTrimSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const r = input as Record<string, unknown>;
  const out: ConfigTrimSettings = {};
  if (typeof r.enabledProject === 'boolean') out.enabledProject = r.enabledProject;
  const agents = normalizeScopeMap(r.enabledAgents);
  if (agents) out.enabledAgents = agents;
  const sessions = normalizeScopeMap(r.enabledSessions);
  if (sessions) out.enabledSessions = sessions;
  const off = normalizeRuleList(r.disabledRules);
  if (off) out.disabledRules = off;
  if (typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)) out.updatedAt = r.updatedAt;
  return out;
}

/** `PUT /api/config-trim/settings` 의 patch 검사 결과. */
export type ConfigTrimSettingsPatchResult =
  | { ok: true; settings: ConfigTrimSettings }
  | { ok: false; field: string };

/**
 * 설정 patch 를 적용한다 — **보낸 칸만** 바뀐다(부분 페이로드가 나머지를 지우지 않게).
 *
 * - 값 `null` 또는 빈 배열 = 그 칸을 지운다.
 * - 켬/끔 칸은 여기서 받지 않는다 — 스위치는 `withConfigTrimScope` 한 길로만 바뀐다.
 * - 모양이 어긋난 값은 조용히 버리지 않고 그 칸 이름으로 실패한다(REST 400).
 */
export function applyConfigTrimSettingsPatch(
  current: ConfigTrimSettings,
  patch: unknown,
  now: number,
): ConfigTrimSettingsPatchResult {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, field: 'patch' };
  const p = patch as Record<string, unknown>;
  const next: ConfigTrimSettings = { ...current };
  for (const key of Object.keys(p)) {
    const v = p[key];
    if (key !== 'disabledRules') return { ok: false, field: key };
    if (v === null) { delete next.disabledRules; continue; }
    if (!Array.isArray(v) || v.some((x) => !isConfigTrimRuleId(x))) return { ok: false, field: key };
    const list = normalizeRuleList(v);
    if (list) next.disabledRules = list;
    else delete next.disabledRules;
  }
  next.updatedAt = now;
  return { ok: true, settings: next };
}

/** 런 목록 끝에 하나를 더한다 — 상한을 넘으면 가장 오래된 런부터 버린다. */
export function appendConfigTrimRun(
  runs: readonly ConfigTrimRun[],
  run: ConfigTrimRun,
  max: number = CONFIG_TRIM_RUN_MAX_PER_PROJECT,
): ConfigTrimRun[] {
  const next = [...runs.filter((r) => r.runId !== run.runId), run];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 스냅샷에 싣는 최근 런 — 전선 무게를 위해 꼬리만(나머지는 체크포인트에만 있다). */
export function configTrimRunsForSnapshot(runs: readonly ConfigTrimRun[]): ConfigTrimRun[] {
  return runs.length > CONFIG_TRIM_RUN_SNAPSHOT_MAX
    ? runs.slice(runs.length - CONFIG_TRIM_RUN_SNAPSHOT_MAX)
    : [...runs];
}

function clip(s: string): string {
  return s.length > CONFIG_TRIM_VALUE_MAX ? s.slice(0, CONFIG_TRIM_VALUE_MAX) : s;
}

function normalizeRemovals(input: unknown): ConfigTrimRemoval[] {
  if (!Array.isArray(input)) return [];
  const out: ConfigTrimRemoval[] = [];
  for (const x of input) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.field !== 'string' || r.field === '') continue;
    if (!isConfigTrimRuleId(r.ruleId)) continue;
    if (typeof r.reason !== 'string' || r.reason === '') continue;
    out.push({
      field: r.field,
      ruleId: r.ruleId,
      reason: r.reason as ConfigTrimRemoval['reason'],
      before: clip(typeof r.before === 'string' ? r.before : ''),
    });
  }
  return out;
}

function normalizeExclusions(input: unknown): ConfigTrimExclusion[] {
  if (!Array.isArray(input)) return [];
  const out: ConfigTrimExclusion[] = [];
  for (const x of input) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.field !== 'string' || r.field === '') continue;
    if (typeof r.keep !== 'string' || r.keep === '') continue;
    const item: ConfigTrimExclusion = { field: r.field, keep: r.keep as ConfigTrimExclusion['keep'] };
    if (isConfigTrimRuleId(r.ruleId)) item.ruleId = r.ruleId;
    out.push(item);
  }
  return out;
}

/** 런 한 건을 계약 안으로 접는다 — 필수 칸이 어긋나면 `null`(그 기록은 버린다). */
export function normalizeConfigTrimRun(input: unknown): ConfigTrimRun | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const r = input as Record<string, unknown>;
  if (typeof r.runId !== 'string' || r.runId === '') return null;
  if (typeof r.agentId !== 'string' || r.agentId === '') return null;
  if (r.engine !== 'claude' && r.engine !== 'codex') return null;
  return {
    runId: r.runId,
    agentId: r.agentId,
    subAgentId: typeof r.subAgentId === 'string' ? r.subAgentId : '',
    commandId: typeof r.commandId === 'string' ? r.commandId : '',
    engine: r.engine,
    startedAt: typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) ? r.startedAt : 0,
    trimmed: normalizeRemovals(r.trimmed),
    excluded: normalizeExclusions(r.excluded),
  };
}

/** 런 목록을 접는다 — 어긋난 것은 버리고, 같은 runId 는 뒤의 것 하나만, 끝에서 ring 상한. */
export function normalizeConfigTrimRuns(input: unknown): ConfigTrimRun[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, ConfigTrimRun>();
  for (const x of input) {
    const run = normalizeConfigTrimRun(x);
    if (!run) continue;
    byId.delete(run.runId);
    byId.set(run.runId, run);
  }
  const list = [...byId.values()];
  return list.length > CONFIG_TRIM_RUN_MAX_PER_PROJECT
    ? list.slice(list.length - CONFIG_TRIM_RUN_MAX_PER_PROJECT)
    : list;
}

/**
 * 스냅샷 한 프로젝트분의 지문 — 클라 `applyConfigTrim` 이 무변화 프레임에 `set` 하지 않게 한다
 * (apply* 는 structuralShare 를 타지 않아 같은 값에도 리렌더된다).
 */
export function configTrimSummaryFingerprint(summary: ConfigTrimSummary | undefined): string {
  if (!summary) return '';
  const runs = summary.runs
    .map((r) => `${r.runId}:${r.startedAt}:${r.trimmed.length}:${r.excluded.length}`)
    .join(',');
  const s = summary.settings;
  return [
    s.updatedAt ?? 0,
    JSON.stringify(s.enabledAgents ?? {}),
    JSON.stringify(s.enabledSessions ?? {}),
    s.enabledProject ?? '',
    (s.disabledRules ?? []).join('+'),
    runs,
  ].join('|');
}
