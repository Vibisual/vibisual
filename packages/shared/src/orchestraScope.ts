/**
 * §5.3 #10-4 — 오케스트라 켬/끔 2층 판정 + 설정·런·계획 신고 계약(순수). 층은 프로젝트 → 에이전트뿐 — 세션마다 갈리면 어느 탭 명령이 편성될지 모른다.
 * `autoGoalScope`(§5.10)를 빌리지 않는다 — 묶으면 오케스트라 전용 칸이 그 타입으로 샌다. 판정은 여기 하나, 시각은 부르는 쪽이 `now` 로.
 */
import {
  ORCHESTRA_DEFAULT_MAX_MEMBERS,
  ORCHESTRA_HOP_TEXT_MAX,
  ORCHESTRA_MAX_MEMBERS_LIMIT,
  ORCHESTRA_PLAN_NOTE_MAX,
  ORCHESTRA_PLAN_REASON_MAX,
  ORCHESTRA_PLAN_SPLIT_BASIS_MAX,
  ORCHESTRA_RUN_HOPS_MAX,
  ORCHESTRA_RUN_MAX_PER_PROJECT,
  ORCHESTRA_RUN_REQUEST_MAX,
  ORCHESTRA_RUN_SNAPSHOT_MAX,
  SPEC_SCOPE_ENTRY_MAX,
} from './constants.js';
import { findAgentToolTemplate } from './agentToolTemplates.js';
import { ORCHESTRA_STRATEGIES, findOrchestraStrategy, isOrchestraStrategyId } from './orchestraCatalog.js';
import type { OrchestraStrategy } from './orchestraCatalog.js';
import type {
  OrchestraConductorPermission,
  OrchestraFormationBasis,
  OrchestraIntent,
  OrchestraMemberEngine,
  OrchestraMemberIsolation,
  OrchestraPlan,
  OrchestraPlanChoice,
  OrchestraRun,
  OrchestraRunHop,
  OrchestraRunHopRole,
  OrchestraRunPhase,
  OrchestraRunVerification,
  OrchestraScope,
  OrchestraSettings,
  OrchestraStrategyId,
  OrchestraSummary,
  OrchestraTopology,
} from './types.js';

/** 층 순서는 **위에서 아래로** 고정이다. 뒤바꾸면 덮어쓰기 방향이 통째로 뒤집힌다. */
export const ORCHESTRA_SCOPE_ORDER: readonly OrchestraScope[] = ['project', 'agent'];

/** IntentGate 분류(#10-2 표) + 편성 없이 답할 질문. */
export const ORCHESTRA_INTENTS: readonly OrchestraIntent[] = ['question', 'quick-fix', 'feature', 'research', 'debug', 'refactor'];

/**
 * 편성 — `none` 은 편성하지 않고 지휘자가 직접 답한다. `self` 는 같은 세션이 평소 설정으로 직접 한다(§5.3 #10-6 (F) —
 * 사용자가 `allowSelf` 를 켰을 때만 신고를 받는다. 이 목록은 모양 검사용이라 늘 넷 + `self` 다).
 */
export const ORCHESTRA_TOPOLOGIES: readonly OrchestraTopology[] = ['none', 'single', 'pipeline', 'parallel', 'self'];

/** §5.3 #10-6 (F) — 편성 기준 둘. 없으면 `role`(종전 표). */
export const ORCHESTRA_FORMATION_BASES: readonly OrchestraFormationBasis[] = ['role', 'dependency'];

/** §5.3 #10-6 (F) — 사용자 스위치 셋(켬 = true, 끔 = 칸 없음). */
const ORCHESTRA_FLAG_FIELDS = ['allowSelf', 'crossEngineReview', 'splitRules'] as const;

/** §5.3 #10-6 (A) — 인계 사슬 역할 전부. */
export const ORCHESTRA_HOP_ROLES: readonly OrchestraRunHopRole[] = ['conductor', 'self', 'entry', 'member', 'review', 'rework'];

/** 멤버 엔진 셋 — `auto` 는 지휘자가 역할마다 고른다. */
export const ORCHESTRA_MEMBER_ENGINES: readonly OrchestraMemberEngine[] = ['claude', 'codex', 'auto'];

/** 멤버 작업 폴더 격리 둘 — 기본은 `none`(이 기능이 없던 때와 같다). */
export const ORCHESTRA_MEMBER_ISOLATIONS: readonly OrchestraMemberIsolation[] = ['none', 'worktree'];

/** 지휘 턴 권한 둘. */
export const ORCHESTRA_CONDUCTOR_PERMISSIONS: readonly OrchestraConductorPermission[] = ['bypass', 'inherit'];

/** 런 단계 전부. */
export const ORCHESTRA_RUN_PHASES: readonly OrchestraRunPhase[] = ['conducting', 'dispatched', 'completed', 'answered', 'unreported', 'error'];

/** 설정에서 문자열로 받는 칸 — 모델·강도. 빈 문자열은 "정하지 않음"이라 칸을 지운다. */
const ORCHESTRA_STRING_FIELDS = [
  'conductorClaudeModel',
  'conductorClaudeEffort',
  'conductorCodexModel',
  'conductorCodexReasoning',
  'memberClaudeModel',
  'memberClaudeEffort',
  'memberCodexModel',
  'memberCodexReasoning',
] as const;
type OrchestraStringField = (typeof ORCHESTRA_STRING_FIELDS)[number];

/**
 * 모델·강도 문자열은 모양만 본다 — 목록은 CLI 에서 동적으로 온다(§4, `claude-opus-5[1m]`·`gpt-5.1-codex`·`high` 통과).
 * 목적은 줄바꿈·따옴표 차단이다(지휘 규칙 본문·CLI 인자로 흘러간다).
 */
const ORCHESTRA_MODEL_TOKEN_RE = /^[A-Za-z0-9._:/\-[\]]{1,100}$/;

/** 층 하나가 지금 무엇을 말하고 있는가 — 화면이 **상속과 명시를 구분해** 그리기 위한 것. */
export interface OrchestraScopeState {
  scope: OrchestraScope;
  /** 이 층에 실제로 적힌 값. `null` = 안 정함(위에서 물려받는다). */
  own: boolean | null;
  /** 이 층까지 접었을 때의 값. */
  effective: boolean;
  /** 이 층에 값이 없어 물려받았는가. */
  inherited: boolean;
  /** 그 층을 고를 수 있는가 — 에이전트 층은 id 가 있어야 칸을 만들 수 있다. */
  available: boolean;
}

/** 판정에 필요한 칸만. */
export type OrchestraEnablement = Pick<OrchestraSettings, 'enabledProject' | 'enabledAgents'>;

function own(map: Record<string, boolean> | undefined, id: string | null | undefined): boolean | null {
  if (!map || typeof id !== 'string' || id === '') return null;
  const v = map[id];
  return typeof v === 'boolean' ? v : null;
}

/** `agent ?? project ?? false`. 기본은 꺼짐 — 아무도 안 정했으면 가로채지도 싣지도 않는다. 지휘자가 만든 멤버는 에이전트 칸이 명시적 `false` 다(재귀 방지). */
export function resolveOrchestraEnabled(
  settings: OrchestraEnablement | null | undefined,
  agentId?: string | null,
): boolean {
  if (!settings) return false;
  const agent = own(settings.enabledAgents, agentId);
  if (agent !== null) return agent;
  return settings.enabledProject === true;
}

/** **어느 층에서든 켜져 있는가** — "프로젝트 끔 + 이 에이전트만 켬"도 켜진 것이다. */
export function orchestraActiveAnywhere(settings: OrchestraEnablement | null | undefined): boolean {
  if (!settings) return false;
  if (settings.enabledProject === true) return true;
  return settings.enabledAgents !== undefined && Object.values(settings.enabledAgents).some((v) => v === true);
}

/** 두 층의 지금 상태 — 스위치가 그리는 그대로. 마지막 층의 `effective` 는 `resolveOrchestraEnabled` 와 같다. */
export function orchestraScopeStates(
  settings: OrchestraEnablement | null | undefined,
  agentId?: string | null,
): OrchestraScopeState[] {
  const projectOwn = settings?.enabledProject === true ? true : settings?.enabledProject === false ? false : null;
  const agentOwn = own(settings?.enabledAgents, agentId);
  const projectEff = projectOwn === true;
  const agentEff = agentOwn ?? projectEff;
  return [
    { scope: 'project', own: projectOwn, effective: projectEff, inherited: projectOwn === null, available: true },
    {
      scope: 'agent',
      own: agentOwn,
      effective: agentEff,
      inherited: agentOwn === null,
      available: typeof agentId === 'string' && agentId !== '',
    },
  ];
}

/**
 * 층 한 칸만 갈아 끼운 **새 설정**을 만든다 — 나머지 칸은 그대로 옮겨 담는다.
 * `enabled === null` 은 **그 칸을 지운다**(= 상속으로 되돌린다). `false` 와 다르다.
 */
export function withOrchestraScope(
  settings: OrchestraSettings,
  scope: OrchestraScope,
  id: string | null,
  enabled: boolean | null,
): OrchestraSettings {
  if (scope === 'project') {
    const next = { ...settings };
    if (enabled === null) delete next.enabledProject;
    else next.enabledProject = enabled;
    return next;
  }
  if (typeof id !== 'string' || id.trim() === '') return { ...settings };
  const map = { ...(settings.enabledAgents ?? {}) };
  if (enabled === null) delete map[id];
  else map[id] = enabled;
  const next = { ...settings };
  if (Object.keys(map).length === 0) delete next.enabledAgents;
  else next.enabledAgents = capOrchestraMap(map);
  return next;
}

/**
 * 에이전트 칸 맵의 칸 수 상한 — 사라진 에이전트의 칸이 남아 단조 증가한다(§3.2.4).
 * 객체 키는 삽입 순서를 지키므로 **가장 먼저 적힌 칸부터** 버린다.
 */
export function capOrchestraMap(
  map: Record<string, boolean>,
  max: number = SPEC_SCOPE_ENTRY_MAX,
): Record<string, boolean> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const out: Record<string, boolean> = {};
  for (const k of keys.slice(keys.length - max)) out[k] = map[k] as boolean;
  return out;
}

/** 한 런에서 새로 만들 수 있는 멤버 수 — 없거나 어긋나면 기본값, 범위 밖이면 가장자리로. */
export function resolveOrchestraMaxMembers(settings: OrchestraSettings | null | undefined): number {
  const v = settings?.maxMembers;
  if (typeof v !== 'number' || !Number.isFinite(v)) return ORCHESTRA_DEFAULT_MAX_MEMBERS;
  return Math.min(ORCHESTRA_MAX_MEMBERS_LIMIT, Math.max(1, Math.round(v)));
}

/** §5.3 #10-6 (F) — 편성 기준. 없거나 모르는 값이면 `role`. Auto Agent 빌더도 이것을 읽는다. */
export function resolveOrchestraFormationBasis(settings: OrchestraSettings | null | undefined): OrchestraFormationBasis {
  return settings?.formationBasis === 'dependency' ? 'dependency' : 'role';
}

/** 지휘 턴 권한 — 없으면 `bypass`(#10-2 빌더와 같은 이유: loopback curl 을 스스로 친다). */
export function resolveOrchestraConductorPermission(settings: OrchestraSettings | null | undefined): OrchestraConductorPermission {
  return settings?.conductorPermission === 'inherit' ? 'inherit' : 'bypass';
}

/** 미지정 멤버는 지휘자 엔진을 따른다. 명시 선택은 설치 상태와 관계없이 보존한다. */
export function resolveOrchestraMemberEngine(
  settings: OrchestraSettings | null | undefined,
  conductorEngine: 'claude' | 'codex' = 'claude',
): OrchestraMemberEngine {
  const v = settings?.memberEngine;
  return v === 'claude' || v === 'codex' || v === 'auto' ? v : conductorEngine;
}

/**
 * 멤버의 작업 폴더 격리 — 없으면 `none`(지휘자와 같은 워킹트리). `parallel` 편성의 동시 수정을 막는 유일한 축이고,
 * 디스크·빌드 캐시 비용이라 지휘자가 아니라 사용자가 정한다.
 */
export function resolveOrchestraMemberIsolation(settings: OrchestraSettings | null | undefined): OrchestraMemberIsolation {
  return settings?.memberIsolation === 'worktree' ? 'worktree' : 'none';
}

/** 멤버의 도구 목록 템플릿 — 없거나 모르는 id 면 `undefined`(설정 창 기본값). `'all'` 은 못 박지 않는다 — 박으면 나중에 고친 기본 목록이 안 닿는다(§4 설정 3층). */
export function resolveOrchestraMemberToolTemplate(settings: OrchestraSettings | null | undefined): string | undefined {
  const id = settings?.memberToolTemplate;
  if (typeof id !== 'string' || id === '' || id === 'all') return undefined;
  return findAgentToolTemplate(id) ? id : undefined;
}

/**
 * 멤버 생성 때 서버가 심는 설정 칸(없으면 `null`). 지휘자 PATCH 로는 못 넣는 두 칸이다 — `tools` 는 loopback 유입에서 얼린 권한 축(§5.3 #12-1),
 * `isolation` 은 사용자가 정하는 비용. 유입 얼림을 푸는 게 아니라 사용자 설정을 집행하는 별도 길이다.
 */
export function orchestraMemberBirthConfig(
  settings: OrchestraSettings | null | undefined,
): { isolation?: OrchestraMemberIsolation; tools?: string[] } | null {
  const out: { isolation?: OrchestraMemberIsolation; tools?: string[] } = {};
  if (resolveOrchestraMemberIsolation(settings) === 'worktree') out.isolation = 'worktree';
  const templateId = resolveOrchestraMemberToolTemplate(settings);
  if (templateId) {
    const template = findAgentToolTemplate(templateId);
    if (template) out.tools = [...template.tools];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 지휘자에게 **고를 수 있게** 주는 방안 — 원문 순서, 참고 전용(11·12·13)과 사용자가 꺼 둔 것은 빠진다. */
export function orchestraAllowedStrategies(settings: OrchestraSettings | null | undefined): OrchestraStrategy[] {
  const off = new Set(settings?.disabledStrategies ?? []);
  return ORCHESTRA_STRATEGIES.filter((s) => s.apply.selectable && !off.has(s.id));
}

/** 이 방안을 지휘자가 지금 고를 수 있는가. */
export function isOrchestraStrategyAllowed(settings: OrchestraSettings | null | undefined, id: string): boolean {
  const s = findOrchestraStrategy(id);
  if (!s || !s.apply.selectable) return false;
  return !(settings?.disabledStrategies ?? []).includes(s.id);
}

function normalizeModelToken(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return ORCHESTRA_MODEL_TOKEN_RE.test(t) ? t : undefined;
}

function normalizeStrategyList(v: unknown): OrchestraStrategyId[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: OrchestraStrategyId[] = [];
  for (const x of v) if (isOrchestraStrategyId(x) && !out.includes(x)) out.push(x);
  return out.length > 0 ? out : undefined;
}

/** 에이전트 칸 맵 하나를 접는다 — boolean 이 아닌 칸은 버린다. */
export function normalizeOrchestraScopeMap(input: unknown): Record<string, boolean> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'boolean' && k.trim() !== '') out[k] = v;
  }
  return Object.keys(out).length > 0 ? capOrchestraMap(out) : undefined;
}

/** 바깥에서 온 설정(체크포인트·손으로 적은 JSON)을 계약 안으로 접는다 — 모양이 어긋난 칸은 버린다. */
export function normalizeOrchestraSettings(input: unknown): OrchestraSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const r = input as Record<string, unknown>;
  const out: OrchestraSettings = {};
  if (typeof r.enabledProject === 'boolean') out.enabledProject = r.enabledProject;
  const agents = normalizeOrchestraScopeMap(r.enabledAgents);
  if (agents) out.enabledAgents = agents;
  for (const f of ORCHESTRA_STRING_FIELDS) {
    const v = normalizeModelToken(r[f]);
    if (v !== undefined) out[f] = v;
  }
  if (r.conductorPermission === 'bypass' || r.conductorPermission === 'inherit') out.conductorPermission = r.conductorPermission;
  if (typeof r.askQuestions === 'boolean') out.askQuestions = r.askQuestions;
  if (r.memberEngine === 'claude' || r.memberEngine === 'codex' || r.memberEngine === 'auto') out.memberEngine = r.memberEngine;
  if (typeof r.maxMembers === 'number' && Number.isFinite(r.maxMembers)) {
    out.maxMembers = Math.min(ORCHESTRA_MAX_MEMBERS_LIMIT, Math.max(1, Math.round(r.maxMembers)));
  }
  if (r.memberIsolation === 'none' || r.memberIsolation === 'worktree') out.memberIsolation = r.memberIsolation;
  // 템플릿 id 는 목록에 있는 것만 — 사라진 템플릿의 id 가 남아 "좁혔다고 믿는 빈 칸"이 되지 않게.
  if (typeof r.memberToolTemplate === 'string' && findAgentToolTemplate(r.memberToolTemplate)) {
    out.memberToolTemplate = r.memberToolTemplate;
  }
  const off = normalizeStrategyList(r.disabledStrategies);
  if (off) out.disabledStrategies = off;
  // §5.3 #10-6 (F) — 켠 것만 남긴다(`false` 는 안 정한 것과 같다 — 칸을 늘리지 않는다).
  for (const f of ORCHESTRA_FLAG_FIELDS) if (r[f] === true) out[f] = true;
  if (r.formationBasis === 'dependency') out.formationBasis = 'dependency';
  if (typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)) out.updatedAt = r.updatedAt;
  return out;
}

/** `PUT /api/orchestra/settings` 의 patch 검사 결과. */
export type OrchestraSettingsPatchResult =
  | { ok: true; settings: OrchestraSettings }
  | { ok: false; field: string };

/**
 * 설정 patch — 보낸 칸만 바뀐다(부분 페이로드가 나머지를 지우지 않게, §4 agent-config PUT 사고). `null`·빈 문자열 = 그 칸 지움.
 * 켬/끔 칸은 받지 않는다(`withOrchestraScope` 한 길 — 두 창구면 서로 덮는다). 모양이 틀린 값은 버리지 않고 칸 이름으로 실패(REST 400).
 */
export function applyOrchestraSettingsPatch(
  current: OrchestraSettings,
  patch: unknown,
  now: number,
): OrchestraSettingsPatchResult {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, field: 'patch' };
  const p = patch as Record<string, unknown>;
  const next: OrchestraSettings = { ...current };
  const clear = (v: unknown) => v === null || v === '';
  for (const key of Object.keys(p)) {
    const v = p[key];
    if ((ORCHESTRA_STRING_FIELDS as readonly string[]).includes(key)) {
      const f = key as OrchestraStringField;
      if (clear(v)) { delete next[f]; continue; }
      const t = normalizeModelToken(v);
      if (t === undefined) return { ok: false, field: key };
      next[f] = t;
      continue;
    }
    switch (key) {
      case 'conductorPermission':
        if (clear(v)) { delete next.conductorPermission; break; }
        if (v !== 'bypass' && v !== 'inherit') return { ok: false, field: key };
        next.conductorPermission = v;
        break;
      case 'askQuestions':
        if (clear(v)) { delete next.askQuestions; break; }
        if (typeof v !== 'boolean') return { ok: false, field: key };
        next.askQuestions = v;
        break;
      case 'memberEngine':
        if (clear(v)) { delete next.memberEngine; break; }
        if (v !== 'claude' && v !== 'codex' && v !== 'auto') return { ok: false, field: key };
        next.memberEngine = v;
        break;
      case 'maxMembers':
        if (clear(v)) { delete next.maxMembers; break; }
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > ORCHESTRA_MAX_MEMBERS_LIMIT) {
          return { ok: false, field: key };
        }
        next.maxMembers = v;
        break;
      case 'memberIsolation':
        if (clear(v)) { delete next.memberIsolation; break; }
        if (v !== 'none' && v !== 'worktree') return { ok: false, field: key };
        next.memberIsolation = v;
        break;
      case 'memberToolTemplate':
        if (clear(v)) { delete next.memberToolTemplate; break; }
        if (typeof v !== 'string' || !findAgentToolTemplate(v)) return { ok: false, field: key };
        next.memberToolTemplate = v;
        break;
      case 'disabledStrategies': {
        if (clear(v)) { delete next.disabledStrategies; break; }
        if (!Array.isArray(v) || v.some((x) => !isOrchestraStrategyId(x))) return { ok: false, field: key };
        const list = normalizeStrategyList(v);
        if (list) next.disabledStrategies = list;
        else delete next.disabledStrategies;
        break;
      }
      // §5.3 #10-6 (F) — 켬은 `true`, 끔(`false`·`null`)은 칸을 지운다 — 꺼진 상태가 곧 종전 동작이다.
      case 'allowSelf':
      case 'crossEngineReview':
      case 'splitRules':
        if (clear(v) || v === false) { delete next[key]; break; }
        if (v !== true) return { ok: false, field: key };
        next[key] = true;
        break;
      case 'formationBasis':
        if (clear(v) || v === 'role') { delete next.formationBasis; break; }
        if (v !== 'dependency') return { ok: false, field: key };
        next.formationBasis = 'dependency';
        break;
      default:
        return { ok: false, field: key };
    }
  }
  next.updatedAt = now;
  return { ok: true, settings: next };
}

/** 요청이 끝난 단계인가 — 편성 중과 위임 뒤 결과 회수 대기는 모두 아직 진행 중이다. */
export function isOrchestraRunSettled(phase: OrchestraRunPhase): boolean {
  return phase !== 'conducting' && phase !== 'dispatched';
}

/** 런 목록 끝에 하나를 더한다 — `ORCHESTRA_RUN_MAX_PER_PROJECT` 를 넘으면 가장 오래된 런부터 버린다. */
export function appendOrchestraRun(
  runs: readonly OrchestraRun[],
  run: OrchestraRun,
  max: number = ORCHESTRA_RUN_MAX_PER_PROJECT,
): OrchestraRun[] {
  const next = [...runs, run];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 스냅샷에 싣는 최근 런 — 전선 무게를 위해 꼬리만(나머지는 체크포인트에만 있다). */
export function orchestraRunsForSnapshot(runs: readonly OrchestraRun[]): OrchestraRun[] {
  return runs.length > ORCHESTRA_RUN_SNAPSHOT_MAX ? runs.slice(runs.length - ORCHESTRA_RUN_SNAPSHOT_MAX) : [...runs];
}

/** 런에 적어 두는 요청 원문 사본 — 명령 본문은 자르지 않고 이 기록용 사본만 자른다. */
export function clipOrchestraRequest(text: string): string {
  return text.length > ORCHESTRA_RUN_REQUEST_MAX ? text.slice(0, ORCHESTRA_RUN_REQUEST_MAX) : text;
}

function nonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function normalizeChoices(v: unknown): OrchestraPlanChoice[] {
  if (!Array.isArray(v)) return [];
  const out: OrchestraPlanChoice[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const c = x as Record<string, unknown>;
    if (!isOrchestraStrategyId(c.id) || typeof c.reason !== 'string') continue;
    out.push({ id: c.id, reason: c.reason.slice(0, ORCHESTRA_PLAN_REASON_MAX) });
  }
  return out;
}

function normalizePlan(v: unknown): OrchestraPlan | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const p = v as Record<string, unknown>;
  if (!(ORCHESTRA_INTENTS as readonly unknown[]).includes(p.intent)) return undefined;
  if (!(ORCHESTRA_TOPOLOGIES as readonly unknown[]).includes(p.topology)) return undefined;
  const plan: OrchestraPlan = {
    intent: p.intent as OrchestraIntent,
    topology: p.topology as OrchestraTopology,
    chosen: normalizeChoices(p.chosen),
  };
  const skipped = normalizeChoices(p.skipped);
  if (skipped.length > 0) plan.skipped = skipped;
  if (typeof p.entryAgentId === 'string' && p.entryAgentId !== '') plan.entryAgentId = p.entryAgentId;
  if (typeof p.note === 'string' && p.note !== '') plan.note = p.note.slice(0, ORCHESTRA_PLAN_NOTE_MAX);
  if (typeof p.splitBasis === 'string' && p.splitBasis !== '') plan.splitBasis = p.splitBasis.slice(0, ORCHESTRA_PLAN_SPLIT_BASIS_MAX);
  if (typeof p.reviewAgentId === 'string' && p.reviewAgentId !== '') plan.reviewAgentId = p.reviewAgentId;
  return plan;
}

function clipHopText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim();
  if (t === '') return undefined;
  return t.length > ORCHESTRA_HOP_TEXT_MAX ? `${t.slice(0, ORCHESTRA_HOP_TEXT_MAX)}…` : t;
}

/** 인계 사슬 한 줄을 계약 안으로 접는다 — 필수 칸이 어긋나면 버린다. */
export function normalizeOrchestraHop(input: unknown): OrchestraRunHop | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const h = input as Record<string, unknown>;
  if (typeof h.commandId !== 'string' || h.commandId === '' || typeof h.agentId !== 'string' || h.agentId === '') return null;
  if (!(ORCHESTRA_HOP_ROLES as readonly unknown[]).includes(h.role)) return null;
  if (typeof h.queuedAt !== 'number' || !Number.isFinite(h.queuedAt)) return null;
  if (typeof h.endedAt !== 'number' || !Number.isFinite(h.endedAt)) return null;
  const hop: OrchestraRunHop = {
    commandId: h.commandId,
    agentId: h.agentId,
    role: h.role as OrchestraRunHopRole,
    instruction: clipHopText(h.instruction) ?? '',
    status: h.status === 'error' ? 'error' : 'completed',
    inputTokens: nonNegInt(h.inputTokens),
    outputTokens: nonNegInt(h.outputTokens),
    queuedAt: h.queuedAt,
    endedAt: h.endedAt,
  };
  const result = clipHopText(h.result);
  if (result !== undefined) hop.result = result;
  if (typeof h.startedAt === 'number' && Number.isFinite(h.startedAt)) hop.startedAt = h.startedAt;
  if (h.waitedOnConcurrency === true) hop.waitedOnConcurrency = true;
  return hop;
}

/**
 * 끝난 명령 하나로 사슬 한 줄을 더한다(글은 앞머리만). 같은 명령은 한 줄 — 이미 있으면 같은 배열을 돌려준다.
 * 상한(`ORCHESTRA_RUN_HOPS_MAX`)을 넘으면 오래된 줄부터 버린다.
 */
export function appendOrchestraHop(
  hops: readonly OrchestraRunHop[] | undefined,
  hop: OrchestraRunHop,
  max: number = ORCHESTRA_RUN_HOPS_MAX,
): OrchestraRunHop[] {
  const list = hops ?? [];
  if (list.some((h) => h.commandId === hop.commandId)) return list as OrchestraRunHop[];
  const normalized = normalizeOrchestraHop(hop);
  if (!normalized) return list as OrchestraRunHop[];
  const next = [...list, normalized];
  return next.length > max ? next.slice(next.length - max) : next;
}

function normalizeVerification(v: unknown): OrchestraRunVerification | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (r.verdict !== 'approve' && r.verdict !== 'reject' && r.verdict !== 'held') return undefined;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return undefined;
  return { verdict: r.verdict, passed: nonNegInt(r.passed), failed: nonNegInt(r.failed), at: r.at };
}

/** "확인됨" — 마지막 검수 판정이 승인이고 서버가 본 통과 증거가 하나 이상이다(§5.3 #10-3 와 같은 문턱). */
export function isOrchestraRunVerified(run: Pick<OrchestraRun, 'verification'>): boolean {
  const v = run.verification;
  return v !== undefined && v.verdict === 'approve' && v.passed > 0;
}

/** 체크포인트에서 읽은 런 하나를 계약 안으로 접는다 — 필수 칸이 어긋나면 버린다(`null`). */
export function normalizeOrchestraRun(input: unknown): OrchestraRun | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const r = input as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' && r[k] !== '' ? (r[k] as string) : null);
  const runId = str('runId');
  const projectPath = str('projectPath');
  const agentId = str('agentId');
  const commandId = str('commandId');
  if (!runId || !projectPath || !agentId || !commandId) return null;
  if (typeof r.startedAt !== 'number' || !Number.isFinite(r.startedAt)) return null;
  const phase = (ORCHESTRA_RUN_PHASES as readonly unknown[]).includes(r.phase) ? (r.phase as OrchestraRunPhase) : 'unreported';
  const run: OrchestraRun = {
    runId,
    projectPath,
    agentId,
    commandId,
    userRequest: typeof r.userRequest === 'string' ? clipOrchestraRequest(r.userRequest) : '',
    engine: r.engine === 'codex' ? 'codex' : 'claude',
    phase,
    startedAt: r.startedAt,
    memberAgentIds: Array.isArray(r.memberAgentIds)
      ? [...new Set(r.memberAgentIds.filter((x): x is string => typeof x === 'string' && x !== ''))]
      : [],
    inputTokens: nonNegInt(r.inputTokens),
    outputTokens: nonNegInt(r.outputTokens),
  };
  const created = nonNegInt(r.createdMemberCount);
  if (created > 0) run.createdMemberCount = created;
  if (typeof r.planAt === 'number' && Number.isFinite(r.planAt)) run.planAt = r.planAt;
  if (typeof r.endedAt === 'number' && Number.isFinite(r.endedAt)) run.endedAt = r.endedAt;
  const plan = normalizePlan(r.plan);
  if (plan) run.plan = plan;
  if (Array.isArray(r.hops)) {
    const hops = r.hops.map(normalizeOrchestraHop).filter((h): h is OrchestraRunHop => h !== null);
    if (hops.length > 0) run.hops = hops.length > ORCHESTRA_RUN_HOPS_MAX ? hops.slice(hops.length - ORCHESTRA_RUN_HOPS_MAX) : hops;
  }
  const verification = normalizeVerification(r.verification);
  if (verification) run.verification = verification;
  if (typeof r.selfCommandId === 'string' && r.selfCommandId !== '') run.selfCommandId = r.selfCommandId;
  return run;
}

/** 런 목록을 접는다 — 어긋난 것은 버리고, 같은 runId 는 뒤의 것 하나만, 끝에서 ring 상한. */
export function normalizeOrchestraRuns(input: unknown): OrchestraRun[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, OrchestraRun>();
  for (const x of input) {
    const run = normalizeOrchestraRun(x);
    if (!run) continue;
    byId.delete(run.runId);
    byId.set(run.runId, run);
  }
  const list = [...byId.values()];
  return list.length > ORCHESTRA_RUN_MAX_PER_PROJECT ? list.slice(list.length - ORCHESTRA_RUN_MAX_PER_PROJECT) : list;
}

/**
 * 재시작 때 편성·회수 중이던 런은 프로세스와 함께 죽었다 — "돌고 있음"으로 두면 활동바 숫자가 안 줄어 `unreported` 로 닫는다.
 * 종료 시각이 찍힌 옛 `dispatched` 기록은 그대로 둔다.
 */
export function settleStaleOrchestraRuns(runs: readonly OrchestraRun[], now: number): OrchestraRun[] {
  return runs.map((r) => (
    r.phase === 'conducting' || (r.phase === 'dispatched' && r.endedAt === undefined)
      ? { ...r, phase: 'unreported', endedAt: r.endedAt ?? now }
      : r
  ));
}

/** 계획 신고 검사에 필요한 바깥 사정. */
export interface OrchestraPlanContext {
  settings: OrchestraSettings;
  /** 그 프로젝트의 커스텀 에이전트 id — `reusedAgentIds`·`entryAgentId` 검사용. */
  projectAgentIds: ReadonlySet<string>;
}

/** 계획 신고 검사 결과. 실패면 REST 400 본문에 그대로 싣는다. */
export type OrchestraPlanValidation =
  | { ok: true; plan: OrchestraPlan; reusedAgentIds: string[] }
  | { ok: false; error: string; ids?: string[] };

/** 계획 신고 본문 검사(런 단계 검사는 부르는 쪽이 먼저). 조용히 고쳐 받지 않고 틀린 id 목록을 돌려준다 — 빼 버리면 신고와 저장이 어긋난다. */
export function validateOrchestraPlan(body: unknown, ctx: OrchestraPlanContext): OrchestraPlanValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body-not-object' };
  const b = body as Record<string, unknown>;
  if (!(ORCHESTRA_INTENTS as readonly unknown[]).includes(b.intent)) return { ok: false, error: 'invalid-intent' };
  if (!(ORCHESTRA_TOPOLOGIES as readonly unknown[]).includes(b.topology)) return { ok: false, error: 'invalid-topology' };
  // §5.3 #10-6 (F) — `self` 는 사용자가 [직접 하기 허용]을 켰을 때만. 꺼져 있으면 규칙에도 없는 편성이다.
  if (b.topology === 'self' && ctx.settings.allowSelf !== true) return { ok: false, error: 'topology-not-allowed' };

  const readChoices = (v: unknown, field: string): OrchestraPlanChoice[] | OrchestraPlanValidation => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) return { ok: false, error: `${field}-not-array` };
    const out: OrchestraPlanChoice[] = [];
    const unknownIds: string[] = [];
    for (const x of v) {
      if (!x || typeof x !== 'object') return { ok: false, error: `${field}-item-not-object` };
      const c = x as Record<string, unknown>;
      if (!isOrchestraStrategyId(c.id)) { unknownIds.push(String(c.id)); continue; }
      if (typeof c.reason !== 'string' || c.reason.trim() === '') return { ok: false, error: `${field}-reason-required`, ids: [c.id] };
      if (c.reason.length > ORCHESTRA_PLAN_REASON_MAX) return { ok: false, error: `${field}-reason-too-long`, ids: [c.id] };
      if (out.some((o) => o.id === c.id)) return { ok: false, error: `${field}-duplicate`, ids: [c.id] };
      out.push({ id: c.id, reason: c.reason.trim() });
    }
    if (unknownIds.length > 0) return { ok: false, error: `${field}-unknown-strategy`, ids: unknownIds };
    return out;
  };

  const chosen = readChoices(b.chosen, 'chosen');
  if (!Array.isArray(chosen)) return chosen;
  const skipped = readChoices(b.skipped, 'skipped');
  if (!Array.isArray(skipped)) return skipped;

  // 고른 것은 지금 고를 수 있는 것이어야 한다 — 참고 전용이거나 사용자가 꺼 둔 것이면 그 id 들을 돌려준다.
  const notAllowed = chosen.filter((c) => !isOrchestraStrategyAllowed(ctx.settings, c.id)).map((c) => c.id);
  if (notAllowed.length > 0) return { ok: false, error: 'strategy-not-allowed', ids: notAllowed };
  const both = chosen.filter((c) => skipped.some((s) => s.id === c.id)).map((c) => c.id);
  if (both.length > 0) return { ok: false, error: 'chosen-and-skipped', ids: both };

  let reused: string[] = [];
  if (b.reusedAgentIds !== undefined) {
    if (!Array.isArray(b.reusedAgentIds) || b.reusedAgentIds.some((x) => typeof x !== 'string')) {
      return { ok: false, error: 'reusedAgentIds-not-string-array' };
    }
    reused = [...new Set(b.reusedAgentIds as string[])];
    const foreign = reused.filter((id) => !ctx.projectAgentIds.has(id));
    if (foreign.length > 0) return { ok: false, error: 'reused-agent-not-in-project', ids: foreign };
  }

  const plan: OrchestraPlan = { intent: b.intent as OrchestraIntent, topology: b.topology as OrchestraTopology, chosen };
  if (skipped.length > 0) plan.skipped = skipped;
  if (b.entryAgentId !== undefined) {
    if (typeof b.entryAgentId !== 'string' || !ctx.projectAgentIds.has(b.entryAgentId)) {
      return { ok: false, error: 'entry-agent-not-in-project', ids: [String(b.entryAgentId)] };
    }
    plan.entryAgentId = b.entryAgentId;
  }
  if (b.note !== undefined) {
    if (typeof b.note !== 'string') return { ok: false, error: 'note-not-string' };
    if (b.note.length > ORCHESTRA_PLAN_NOTE_MAX) return { ok: false, error: 'note-too-long' };
    if (b.note.trim() !== '') plan.note = b.note.trim();
  }
  // §5.3 #10-6 (E) — 나눈 근거는 선택이다. 비어도 거절하지 않고, 모양만 본다(기록용).
  if (b.splitBasis !== undefined && b.splitBasis !== null) {
    if (typeof b.splitBasis !== 'string') return { ok: false, error: 'splitBasis-not-string' };
    if (b.splitBasis.length > ORCHESTRA_PLAN_SPLIT_BASIS_MAX) return { ok: false, error: 'splitBasis-too-long' };
    if (b.splitBasis.trim() !== '') plan.splitBasis = b.splitBasis.trim();
  }
  // §5.3 #10-6 (F) — 직접 하기의 검수자. 그 프로젝트의 커스텀 에이전트여야 하고(지휘자 자신 ❌), `self` 에서만 뜻이 있다.
  if (b.reviewAgentId !== undefined && b.reviewAgentId !== null) {
    if (b.topology !== 'self') return { ok: false, error: 'reviewAgentId-self-only' };
    if (typeof b.reviewAgentId !== 'string' || !ctx.projectAgentIds.has(b.reviewAgentId)) {
      return { ok: false, error: 'review-agent-not-in-project', ids: [String(b.reviewAgentId)] };
    }
    plan.reviewAgentId = b.reviewAgentId;
  }
  // 편성 없이 답하는데 방안을 골랐다면 — 막지 않는다. 지휘자 자신의 턴에도 적용되는 방안(출력 줄이기 등)이 있다.
  return { ok: true, plan, reusedAgentIds: reused };
}

/**
 * 스냅샷 한 프로젝트분의 지문 — 클라 `applyOrchestra` 가 무변화 프레임을 걸러 set 하지 않게 한다
 * (apply* 는 structuralShare 를 타지 않아 같은 값에도 리렌더된다).
 */
export function orchestraSummaryFingerprint(summary: OrchestraSummary | undefined): string {
  if (!summary) return '';
  const runs = summary.runs
    .map((r) => `${r.runId}:${r.phase}:${r.inputTokens}:${r.outputTokens}:${r.planAt ?? 0}:${r.endedAt ?? 0}:${r.memberAgentIds.length}`
      + `:${r.hops?.length ?? 0}:${r.verification ? `${r.verification.verdict}${r.verification.passed}/${r.verification.at}` : ''}:${r.selfCommandId ?? ''}`)
    .join(',');
  // 파생값(성적표·제안)은 런·엣지에서 온다 — 런이 같아도 엣지가 바뀌면 달라지므로 그대로 싣는다(작은 표다).
  const derived = `${JSON.stringify(summary.scorecard ?? [])}|${JSON.stringify(summary.suggestions ?? null)}`;
  return `${summary.settings.updatedAt ?? 0}|${JSON.stringify(summary.settings.enabledAgents ?? {})}|${summary.settings.enabledProject ?? ''}|${runs}|${derived}`;
}
