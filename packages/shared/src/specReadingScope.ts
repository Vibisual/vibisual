/**
 * §5.5 #17-44 ⑧ — 정독 켬/끔의 3층 판정(순수): `세션 ?? 에이전트 ?? 프로젝트 ?? 꺼짐`. 층마다 3값(켬·끔·상속) —
 * 2값이면 "프로젝트는 켜고 이 세션만 끄기"와 "안 정함"을 못 가른다. 집행·게이트·배지·사이드바가 모두 여기를 본다
 * (각자 세면 "켜졌는데 프롬프트엔 없다"가 생긴다, §5.11).
 */
import { SPEC_SCOPE_ENTRY_MAX } from './constants.js';
import type { SpecReadingScope, SpecReadingSettings } from './types.js';

/** 판정에 필요한 칸만 — 설정 전체를 요구하면 테스트가 무거워지고 호출부가 억지 객체를 짓는다. */
export type SpecReadingEnablement = Pick<
  SpecReadingSettings,
  'enabledProject' | 'enabledAgents' | 'enabledSessions'
>;

/** 지금 보고 있는 자리. 없는 축은 그 층을 고를 수 없다는 뜻이다(예: 세션 탭이 없는 화면). */
export interface SpecReadingScopeIds {
  agentId?: string | null;
  subAgentId?: string | null;
}

/** 층 하나가 지금 무엇을 말하고 있는가 — 화면이 **상속과 명시를 구분해** 그리기 위한 것. */
export interface SpecReadingScopeState {
  scope: SpecReadingScope;
  /** 이 층에 실제로 적힌 값. `null` = 안 정함(위에서 물려받는다). */
  own: boolean | null;
  /** 이 층까지 접었을 때의 값 — 이 층이 비어 있으면 위 층의 값이 그대로 내려온다. */
  effective: boolean;
  /** 이 층에 값이 없어 물려받았는가. */
  inherited: boolean;
  /** 그 층을 고를 수 있는가 — 에이전트·세션은 id 가 있어야 칸을 만들 수 있다. */
  available: boolean;
}

/** 층 순서는 **위에서 아래로** 고정이다. 뒤바꾸면 덮어쓰기 방향이 통째로 뒤집힌다. */
export const SPEC_SCOPE_ORDER: readonly SpecReadingScope[] = ['project', 'agent', 'session'];

/** 맵에서 한 칸을 읽는다. 없거나 boolean 이 아니면 "안 정함"이다(손으로 적은 JSON 이 그대로 들어온다). */
function own(map: Record<string, boolean> | undefined, id: string | null | undefined): boolean | null {
  if (!map || typeof id !== 'string' || id === '') return null;
  const v = map[id];
  return typeof v === 'boolean' ? v : null;
}

/** 정독이 켜져 있는가. 기본은 꺼짐 — 아무 층도 안 정했으면 프롬프트·배지·게이트가 전혀 서지 않는다. */
export function resolveSpecReadingEnabled(
  settings: SpecReadingEnablement | null | undefined,
  ids?: SpecReadingScopeIds,
): boolean {
  if (!settings) return false;
  const session = own(settings.enabledSessions, ids?.subAgentId);
  if (session !== null) return session;
  const agent = own(settings.enabledAgents, ids?.agentId);
  if (agent !== null) return agent;
  return settings.enabledProject === true;
}

/** 세 층의 상태(팝오버용). `effective` 는 그 층까지 접은 값이라 사슬을 한 줄씩 보이고, 마지막 층은 `resolveSpecReadingEnabled` 와 같다. */
export function specReadingScopeStates(
  settings: SpecReadingEnablement | null | undefined,
  ids?: SpecReadingScopeIds,
): SpecReadingScopeState[] {
  const projectOwn = settings?.enabledProject === true ? true : settings?.enabledProject === false ? false : null;
  const agentOwn = own(settings?.enabledAgents, ids?.agentId);
  const sessionOwn = own(settings?.enabledSessions, ids?.subAgentId);

  const projectEff = projectOwn === true;
  const agentEff = agentOwn ?? projectEff;
  const sessionEff = sessionOwn ?? agentEff;

  return [
    { scope: 'project', own: projectOwn, effective: projectEff, inherited: projectOwn === null, available: true },
    {
      scope: 'agent',
      own: agentOwn,
      effective: agentEff,
      inherited: agentOwn === null,
      available: typeof ids?.agentId === 'string' && ids.agentId !== '',
    },
    {
      scope: 'session',
      own: sessionOwn,
      effective: sessionEff,
      inherited: sessionOwn === null,
      available: typeof ids?.subAgentId === 'string' && ids.subAgentId !== '',
    },
  ];
}

/** 층 한 칸만 바꾼 새 설정 — 전량 PUT 이면 강도·면제·뿌리가 기본값으로 강등된다(§4 agent-config PUT 사고). `null` = 그 칸 지움(상속), `false` 와 다르다. */
export function withSpecReadingScope(
  settings: SpecReadingSettings,
  scope: SpecReadingScope,
  id: string | null,
  enabled: boolean | null,
): SpecReadingSettings {
  if (scope === 'project') {
    const next = { ...settings };
    if (enabled === null) delete next.enabledProject;
    else next.enabledProject = enabled;
    return next;
  }
  const key = scope === 'agent' ? 'enabledAgents' : 'enabledSessions';
  if (typeof id !== 'string' || id.trim() === '') return { ...settings };
  const map = { ...(settings[key] ?? {}) };
  if (enabled === null) delete map[id];
  else map[id] = enabled;
  return { ...settings, [key]: capScopeMap(map) };
}

/** 층 맵 칸 수 상한 — 사라진 id 의 칸이 남아 단조 증가한다(§3.2.4). 키 삽입 순서대로 먼저 적힌 칸부터 버린다. */
export function capScopeMap(
  map: Record<string, boolean>,
  max: number = SPEC_SCOPE_ENTRY_MAX,
): Record<string, boolean> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const out: Record<string, boolean> = {};
  for (const k of keys.slice(keys.length - max)) out[k] = map[k] as boolean;
  return out;
}

/** 바깥에서 온 층 맵을 계약 안으로 접는다 — boolean 이 아닌 칸은 버린다(손으로 적은 JSON 대비). */
export function normalizeScopeMap(input: unknown): Record<string, boolean> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'boolean' && k.trim() !== '') out[k] = v;
  }
  return Object.keys(out).length > 0 ? capScopeMap(out) : undefined;
}
