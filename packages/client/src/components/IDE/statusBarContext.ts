/**
 * §5.5 — IDE 상태바가 그리는 **한 줄의 주어를 하나로 고정**하고, **칸이 사라지지 않게** 한다.
 *
 * **왜 함수로 빼는가**: 상태바에는 성격이 다른 두 축의 숫자가 섞여 있다. `agent.*` 는 **버블 값**
 * (= 커스텀 에이전트라면 "가장 최근에 움직인 sub" 하나 + 모든 sub 의 토큰 합)이고,
 * `activeSession.*` 는 **지금 탭으로 고른 세션** 하나의 값이다. 종전 상태바는 칸마다
 * `activeSession?.X ?? agent.X` 로 **칸 단위 폴백**을 걸어, 고른 세션이 그 값을 아직 안 가졌으면
 * 조용히 버블 값으로 굴러떨어졌다. 그 결과가 사용자 보고였다 —
 * **"세션을 넘겨도 숫자가 안 변한다"**: 방금 연 세션 넷을 오가도 `입력 1267.2M / 출력 7.4M`
 * (= 그 에이전트의 **24개 세션 합계**)가 넷 다 똑같이 떠 있었다.
 *
 * **규칙 ① 주어는 하나다** — *세션 탭을 골랐으면 그 줄은 그 세션만 말한다.* 다른 세션의 숫자로
 * 칸을 채우지 않는다. 세션을 아예 안 골랐을 때만(훅 버블의 메인 탭 등) 버블 값을 쓴다.
 *
 * **규칙 ② 모르면 0 이라고 쓰되, 칸은 남긴다** — 이어진 사용자 보고가 그것이다("간헐적으로
 * 아래 내용이 사라지는데 안 사라지게"). 규칙 ①만 있으면 세션이 값을 못 가진 순간마다 칸이
 * **언마운트**되고, 옆 칸들이 그 폭만큼 왼쪽으로 밀렸다가 되돌아온다(스냅샷 한 틱이면 충분하다 —
 * 다른 인스턴스가 소유해 enrich 가 비거나, 아직 JSONL 이 없는 새 세션). 자리가 움직이는 줄은
 * 읽을 수가 없다. 그래서 **값의 유무로 칸을 지우지 않는다** — 모르면 `0` 이 뜨고, 그 `0` 자체가
 * "이 세션은 아직 안 썼다"는 정보다.
 *
 * **왜 짝으로 고르는가**: `used` 는 세션, `max` 는 버블처럼 섞으면 비율이 거짓이 된다. `BubbleNode`
 * 가 `effectiveSubOverride` 에서 부분 폴백을 금지하는 것과 같은 이유다 — 한 출처에서 둘 다 온다.
 *
 * **폴백이 허용되는 둘** — 어느 쪽도 *다른 세션*의 값이 아니라서 거짓말이 되지 않는다:
 *  - **모델**: 한 턴도 안 돈 세션은 `modelName` 이 없다. 그 자리에는 **이 에이전트에 설정된 모델**
 *    (= 그 세션이 다음 턴에 쓸 모델)을 적는다. 모든 세션에 똑같이 걸리는 설정값이다.
 *  - **컨텍스트 창 크기(`max`)**: 실측이 없으면 **그 모델의 창 크기**(레지스트리)를 쓴다. 창 크기는
 *    세션이 아니라 모델의 성질이므로, 첫 턴 전에도 `0/1.0M` 이 참이다.
 */
export interface StatusBarScopeSource {
  /** 마지막 턴이 실제로 쓴 모델(세션) 또는 버블에 채워진 모델. */
  modelName?: string;
  contextUsed?: number;
  contextMax?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

/** 컨텍스트만 보는 호출부용 좁은 모양. */
export type StatusBarContextSource = Pick<StatusBarScopeSource, 'contextUsed' | 'contextMax'>;

export interface StatusBarContext {
  used: number;
  max: number;
}

export interface StatusBarUsage {
  /**
   * 이 줄이 말하는 주어. `'session'` 이면 숫자가 **고른 세션 하나**의 것이고, `'agent'` 이면
   * 버블 값이다. 화면 문구(툴팁)가 "이 세션"이라고 말할지 "이 에이전트"라고 말할지를 가른다.
   */
  scope: 'session' | 'agent';
  /** 모를 수 있는 유일한 칸 — 숫자가 아니라 이름이라 `0` 으로 대신할 수 없다. 호출부가 "모름"을 적는다. */
  model?: string;
  /** **항상 있다.** 모르면 `{ used: 0, max: 0 }` — 칸을 지우지 않는다(규칙 ②). */
  context: StatusBarContext;
  inputTokens: number;
  outputTokens: number;
}

/** 컨텍스트 창 크기를 실제로 아는 출처인가. `0`/`undefined` 는 "못 쟀다"는 뜻이라 쓰지 않는다. */
function hasContext(src: StatusBarContextSource | null | undefined): src is StatusBarContextSource {
  return !!src && typeof src.contextMax === 'number' && src.contextMax > 0;
}

/**
 * 그릴 컨텍스트 한 쌍(`used`/`max`). **세션을 골랐으면 세션 것만** 본다 — 세션을 안 골랐을 때만
 * 버블 값을 쓴다. 실측이 없으면 `fallbackMax`(그 모델의 창 크기)로 칸을 채우고, 그것마저 없으면
 * `{0, 0}` 을 돌려준다. **`null` 을 돌려주지 않는다** — 칸이 사라지면 줄이 흔들린다(규칙 ②).
 */
export function resolveStatusBarContext(
  agent: StatusBarContextSource,
  activeSession: StatusBarContextSource | null | undefined,
  fallbackMax = 0,
): StatusBarContext {
  const src: StatusBarContextSource = activeSession ?? agent;
  if (!hasContext(src)) return { used: 0, max: fallbackMax > 0 ? fallbackMax : 0 };
  return { used: src.contextUsed ?? 0, max: src.contextMax as number };
}

/**
 * 상태바 모델 칸. 고른 세션의 실측 모델이 1순위, 없으면 이 에이전트에 설정된 모델.
 * **다른 세션의 실측 모델은 절대 쓰지 않는다** — 그것이 "세션을 넘겨도 안 변한다"의 절반이었다.
 * 컨텍스트 창 크기 폴백이 이 값에 매이므로 별도 함수로 뺀다(호출부가 먼저 모델을 알아야 한다).
 */
export function resolveStatusBarModel(
  agent: StatusBarScopeSource,
  activeSession: StatusBarScopeSource | null | undefined,
  configuredModel?: string,
): string | undefined {
  const src: StatusBarScopeSource = activeSession ?? agent;
  return src.modelName ?? configuredModel;
}

export interface StatusBarUsageOptions {
  /**
   * 이 에이전트에 설정된 모델(별칭 해소 후). 아직 한 턴도 안 돈 세션의 모델 칸에만 쓰인다.
   * 다른 세션의 실측 모델은 절대 여기 넣지 마라.
   */
  configuredModel?: string;
  /** 실측 창 크기가 없을 때 쓸 그 모델의 창 크기(`getModelContextLimit`). 모르면 생략. */
  fallbackContextMax?: number;
}

/**
 * 상태바의 세션 종속 칸 전부(모델·컨텍스트·입출력 토큰)를 **한 주어**로 고른다.
 * 칸마다 따로 폴백하지 않는 것이 이 함수의 존재 이유다 — 칸별 폴백이 "세션을 넘겨도 안 변한다"의
 * 정체였고, 칸을 지우는 것이 "간헐적으로 사라진다"의 정체였다.
 */
export function resolveStatusBarUsage(
  agent: StatusBarScopeSource,
  activeSession: StatusBarScopeSource | null | undefined,
  opts: StatusBarUsageOptions = {},
): StatusBarUsage {
  const src: StatusBarScopeSource = activeSession ?? agent;
  return {
    scope: activeSession ? 'session' : 'agent',
    model: resolveStatusBarModel(agent, activeSession, opts.configuredModel),
    context: resolveStatusBarContext(agent, activeSession, opts.fallbackContextMax),
    inputTokens: src.totalInputTokens ?? 0,
    outputTokens: src.totalOutputTokens ?? 0,
  };
}
