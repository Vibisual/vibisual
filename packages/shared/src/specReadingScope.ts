/**
 * §5.5 #17-44 ⑧ — 정독 켬/끔의 **3층 판정**(순수 함수).
 *
 * 종전 켬/끔은 §5.11 플러그인 창의 `spec-driven` 토글 한 칸뿐이었다. 그래서 기능을 만나는 자리(활동바)와
 * 켜는 자리(모달 안 111장 목록)가 달랐고, 축이 프로젝트 하나라 "이 프로젝트는 켜되 지금 이 세션만 끄기"가
 * 구조적으로 불가능했다. 사용자 지시로 층을 셋 연다 — **프로젝트 · 에이전트 · 세션**.
 *
 * **아래가 위를 덮는다**: `세션 ?? 에이전트 ?? 프로젝트 ?? 꺼짐`.
 * 각 층은 2값이 아니라 **3값**이다(`켬`·`끔`·`상속`). 2값이면 아래 층이 늘 상위를 덮어써서 "프로젝트에서
 * 켜고 이 세션만 끄기"와 "아무것도 안 정함"을 구분할 수 없다.
 *
 * **판정이 여기 하나뿐인 이유** — 집행(프롬프트 블록)·게이트·활동바 배지·사이드바 뷰가 각자 세면 "화면은
 * 켜졌다는데 프롬프트엔 안 실린다"가 만들어지고, 그 순간 사용자는 켠 결과를 확인할 방법을 잃는다
 * (§5.11 v4.65 가 SSOT 카드에서 배운 그대로).
 *
 * 이 파일은 `node:fs`·플랫폼·시간을 모른다 — 서버·클라·플러그인이 같은 함수를 그대로 부른다.
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

/**
 * 이 자리에서 정독이 켜져 있는가.
 *
 * **기본은 꺼짐이다** — 어느 층도 정하지 않은 프로젝트에서는 프롬프트에 한 글자도 안 실리고 배지·게이트도
 * 서지 않는다. 이 기능이 없던 때와 완전히 같아야 한다.
 */
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

/**
 * 세 층의 지금 상태 — 팝오버가 그리는 그대로.
 *
 * `effective` 는 **그 층까지만 접은** 값이라, 화면이 "프로젝트에서 켬 → 이 세션에서 끔" 같은 사슬을
 * 한 줄씩 보여 줄 수 있다. 마지막 층의 `effective` 는 `resolveSpecReadingEnabled` 와 항상 같다.
 */
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

/**
 * 층 한 칸만 갈아 끼운 **새 설정**을 만든다 — 나머지 칸은 그대로 옮겨 담는다.
 *
 * 전량 교체(`PUT /settings`)로 이 일을 하면 강도·면제·뿌리가 함께 실려 나가고, 한 칸만 바꾼 요청이
 * 나머지를 기본값으로 강등시킨다(§4 `agent-config` PUT 이 겪은 그 사고 — 조용해서 더 나쁘다).
 *
 * `enabled === null` 은 **그 칸을 지운다**(= 상속으로 되돌린다). `false` 와 다르다.
 */
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

/**
 * 층 맵의 칸 수 상한.
 *
 * 에이전트·세션 id 는 사라져도 이 맵에는 남는 **잔칸**이라, 오래 쓰는 프로젝트에서 단조 증가한다
 * (§3.2.4 "키 개수엔 캡이 없다"가 잡아 온 그 모양). 객체 키는 삽입 순서를 지키므로 **가장 먼저 적힌
 * 칸부터** 버린다.
 */
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
