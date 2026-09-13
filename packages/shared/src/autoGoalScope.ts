/**
 * §5.10 — 자동 목표 켬/끔의 **3층 판정**(순수 함수).
 *
 * 사용자 지시는 "정독 키고 끄는 것처럼 똑같이 만들어"였다. 그래서 층·값·손짓·저장 규약이 전부
 * #17-44 ⑧ 과 같다 — **프로젝트 · 에이전트 · 세션**, `세션 ?? 에이전트 ?? 프로젝트 ?? 꺼짐`.
 *
 * 각 층은 2값이 아니라 **3값**이다(`켬`·`끔`·`상속`). 2값이면 아래 층이 늘 상위를 덮어써서
 * "프로젝트에서 켜고 이 세션만 끄기"와 "아무것도 안 정함"을 구분할 수 없다.
 *
 * **정독 모듈을 빌려 쓰지 않고 한 벌 더 두는 이유** — 판정 중복 금지가 막는 것은 *같은 기능*을
 * 두 곳에서 세는 일이다. 이것은 다른 기능의 다른 설정이고, 억지로 한 함수에 묶으면 자동 목표에만
 * 필요한 축(물린 후보 등)이 정독 타입으로 새어 들어가 두 기능이 서로의 변경에 걸린다.
 * 자동 목표 안에서의 판정은 여기 **하나**다 — 집행·게이트·REST·화면이 전부 이 함수를 부른다.
 *
 * 이 파일은 `node:fs`·플랫폼·시간을 모른다 — 서버·클라가 같은 함수를 그대로 부른다.
 */
import { AUTO_GOAL_DISMISSED_MAX, SPEC_SCOPE_ENTRY_MAX } from './constants.js';
import { pathKey } from './pathCase.js';
import type { PlatformName } from './pathCase.js';
import type { AutoGoalScope, AutoGoalSettings } from './types.js';

/** 판정에 필요한 칸만 — 설정 전체를 요구하면 호출부가 억지 객체를 짓는다. */
export type AutoGoalEnablement = Pick<
  AutoGoalSettings,
  'enabledProject' | 'enabledAgents' | 'enabledSessions'
>;

/** 지금 보고 있는 자리. 없는 축은 그 층을 고를 수 없다는 뜻이다(예: 세션 탭이 없는 화면). */
export interface AutoGoalScopeIds {
  agentId?: string | null;
  subAgentId?: string | null;
}

/** 층 하나가 지금 무엇을 말하고 있는가 — 화면이 **상속과 명시를 구분해** 그리기 위한 것. */
export interface AutoGoalScopeState {
  scope: AutoGoalScope;
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
export const AUTO_GOAL_SCOPE_ORDER: readonly AutoGoalScope[] = ['project', 'agent', 'session'];

/** 맵에서 한 칸을 읽는다. 없거나 boolean 이 아니면 "안 정함"이다(손으로 적은 JSON 이 그대로 들어온다). */
function own(map: Record<string, boolean> | undefined, id: string | null | undefined): boolean | null {
  if (!map || typeof id !== 'string' || id === '') return null;
  const v = map[id];
  return typeof v === 'boolean' ? v : null;
}

/**
 * 이 자리에서 자동 목표가 켜져 있는가.
 *
 * **기본은 꺼짐이다**(사용자 결정) — 어느 층도 정하지 않은 프로젝트에서는 행동을 훑지도,
 * 스킬을 짓지도, 프롬프트에 한 글자도 싣지도 않는다. 이 기능이 없던 때와 완전히 같아야 한다.
 */
export function resolveAutoGoalEnabled(
  settings: AutoGoalEnablement | null | undefined,
  ids?: AutoGoalScopeIds,
): boolean {
  if (!settings) return false;
  const session = own(settings.enabledSessions, ids?.subAgentId);
  if (session !== null) return session;
  const agent = own(settings.enabledAgents, ids?.agentId);
  if (agent !== null) return agent;
  return settings.enabledProject === true;
}

/**
 * **지목한 경로가 지금 열려 있는 프로젝트인가** — 맞으면 그 프로젝트의 정본 경로를, 아니면 `null`.
 *
 * 자동 목표의 저장고는 프로젝트 폴더 안(`.vibisual/skills/`)에 있고, REST 창구는 경로를 **문자열로**
 * 받는다. 그러면 "아무 경로나 넣어 그 폴더의 절차 목록을 읽어 간다"가 가능해진다 — 폐기된 브레인이
 * `resolveBrainQueryProject` 로 닫아 두던 바로 그 구멍(OWASP LLM08 · 저장고 경계)이다. 저장고가
 * 바뀌었다고 구멍까지 물려받을 이유는 없으므로 같은 자리에 같은 빗장을 건다.
 *
 * **비교는 `pathKey` 로 한다**(`.toLowerCase()` ❌). Linux 에서 `Feature-X` 와 `feature-x` 는 실재하는
 * 서로 다른 폴더라, 접어서 비교하면 남의 프로젝트 저장고가 열린다. 플랫폼을 인자로 받는 것은 실기 없이
 * 세 OS 를 단위 테스트로 확인하기 위해서다(멀티플랫폼 규칙 ①).
 *
 * 돌려주는 것이 **요청 문자열이 아니라 열려 있는 쪽의 경로**인 이유: 대소문자 무관 FS 에서 사용자가
 * 다른 케이스로 적어 보내도 디스크 접근은 앱이 아는 한 가지 표기로 모이게 하려는 것이다.
 *
 * `platform` 은 **생략할 수 없다.** 옛 함수들이 "생략하면 예전대로 접는다"를 남긴 것은 그 시절 저장된
 * 데이터를 계속 읽기 위해서였다. 이 빗장에는 물려받을 과거가 없고, 접는 쪽이 기본이 되는 순간
 * Linux 에서 남의 폴더가 열린다 — 그래서 부르는 쪽이 어느 OS 인지 말하게 한다.
 */
export function resolveAutoGoalProjectRoot(
  requestedPath: string,
  loadedPaths: readonly string[],
  platform: PlatformName,
): string | null {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') return null;
  const exact = loadedPaths.find((p) => p === requestedPath);
  if (exact !== undefined) return exact;
  const want = pathKey(requestedPath, platform);
  return loadedPaths.find((p) => pathKey(p, platform) === want) ?? null;
}

/**
 * **어느 층에서든 켜져 있는가** — 이 프로젝트에 자동 목표 축이 존재하는지의 판정.
 *
 * `resolveAutoGoalEnabled(settings)` 로는 답할 수 없다. 그것은 층을 안 넘기면 **프로젝트 층만**
 * 보는데, 아래 층이 위를 덮는 규약에서는 "프로젝트 끔 + 이 에이전트만 켬"이 정상 상태다. 그 자리를
 * 프로젝트 층만 보고 판단하면 켜 둔 에이전트가 화면·전선에서 통째로 사라진다.
 *
 * 스냅샷 요약을 실을지 말지가 이 함수 하나로 갈린다(§5.10).
 */
export function autoGoalActiveAnywhere(settings: AutoGoalEnablement | null | undefined): boolean {
  if (!settings) return false;
  if (settings.enabledProject === true) return true;
  const maps = [settings.enabledAgents, settings.enabledSessions];
  return maps.some((m) => m !== undefined && Object.values(m).some((v) => v === true));
}

/**
 * 세 층의 지금 상태 — 스위치가 그리는 그대로.
 *
 * `effective` 는 **그 층까지만 접은** 값이라, 화면이 "프로젝트에서 켬 → 이 세션에서 끔" 같은
 * 사슬을 한 줄씩 보여 줄 수 있다. 마지막 층의 `effective` 는 `resolveAutoGoalEnabled` 와 항상 같다.
 */
export function autoGoalScopeStates(
  settings: AutoGoalEnablement | null | undefined,
  ids?: AutoGoalScopeIds,
): AutoGoalScopeState[] {
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
 * 전량 교체로 이 일을 하면 물린 후보 목록이 함께 실려 나가고, 화면이 그것을 모르는 상태에서
 * 보내면 **사용자가 물린 기록이 통째로 되살아난다**(§4 `agent-config` PUT 이 겪은 그 사고 —
 * 조용해서 더 나쁘다).
 *
 * `enabled === null` 은 **그 칸을 지운다**(= 상속으로 되돌린다). `false` 와 다르다.
 */
export function withAutoGoalScope(
  settings: AutoGoalSettings,
  scope: AutoGoalScope,
  id: string | null,
  enabled: boolean | null,
): AutoGoalSettings {
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
  return { ...settings, [key]: capAutoGoalMap(map) };
}

/**
 * 후보 하나를 물리거나(다시 제안하지 않음) 그 물림을 푼다.
 *
 * **지우는 것이 아니라 덮는 것이다** — 같은 절차가 계속 관찰돼도 제안만 멈추고, 풀면 그 자리에서
 * 다시 후보로 선다(§5.10 이 세운 "끄기는 동작 정지이지 삭제가 아니다"와 같은 규율).
 */
export function withAutoGoalDismissed(
  settings: AutoGoalSettings,
  candidateId: string,
  dismissed: boolean,
): AutoGoalSettings {
  const id = candidateId.trim();
  if (id === '') return { ...settings };
  const list = (settings.dismissed ?? []).filter((x) => x !== id);
  if (dismissed) list.push(id);
  // 가장 먼저 물린 것부터 버린다 — 오래전에 물린 절차는 관찰에서도 이미 사라졌을 가능성이 높다.
  const capped = list.length > AUTO_GOAL_DISMISSED_MAX ? list.slice(list.length - AUTO_GOAL_DISMISSED_MAX) : list;
  if (capped.length === 0) {
    const next = { ...settings };
    delete next.dismissed;
    return next;
  }
  return { ...settings, dismissed: capped };
}

/**
 * 층 맵의 칸 수 상한.
 *
 * 에이전트·세션 id 는 사라져도 이 맵에는 남는 **잔칸**이라, 오래 쓰는 프로젝트에서 단조 증가한다
 * (§3.2.4 "키 개수엔 캡이 없다"가 잡아 온 그 모양). 객체 키는 삽입 순서를 지키므로 **가장 먼저
 * 적힌 칸부터** 버린다.
 */
export function capAutoGoalMap(
  map: Record<string, boolean>,
  max: number = SPEC_SCOPE_ENTRY_MAX,
): Record<string, boolean> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const out: Record<string, boolean> = {};
  for (const k of keys.slice(keys.length - max)) out[k] = map[k] as boolean;
  return out;
}

/** 바깥에서 온 설정을 계약 안으로 접는다 — 모양이 어긋난 칸은 버린다(손으로 적은 JSON 대비). */
export function normalizeAutoGoalSettings(input: unknown): AutoGoalSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const r = input as Partial<AutoGoalSettings>;
  const out: AutoGoalSettings = {};
  if (typeof r.enabledProject === 'boolean') out.enabledProject = r.enabledProject;
  const agents = normalizeAutoGoalScopeMap(r.enabledAgents);
  if (agents) out.enabledAgents = agents;
  const sessions = normalizeAutoGoalScopeMap(r.enabledSessions);
  if (sessions) out.enabledSessions = sessions;
  if (Array.isArray(r.dismissed)) {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const x of r.dismissed) {
      if (typeof x !== 'string') continue;
      const id = x.trim();
      if (id === '' || seen.has(id)) continue;
      seen.add(id);
      list.push(id);
    }
    if (list.length > 0) {
      out.dismissed = list.length > AUTO_GOAL_DISMISSED_MAX
        ? list.slice(list.length - AUTO_GOAL_DISMISSED_MAX)
        : list;
    }
  }
  if (typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)) out.updatedAt = r.updatedAt;
  return out;
}

/** 층 맵 하나를 접는다 — boolean 이 아닌 칸은 버린다. */
export function normalizeAutoGoalScopeMap(input: unknown): Record<string, boolean> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'boolean' && k.trim() !== '') out[k] = v;
  }
  return Object.keys(out).length > 0 ? capAutoGoalMap(out) : undefined;
}
