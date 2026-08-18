/**
 * §5.5 #17-11 ⑫(g) — 루프 한 회차의 프롬프트 합성 (순수 모듈).
 *
 * 루프 설정에 켜 둔 규약(진행 파일 · 회차당 한 가지 일 · 회차 커밋)을 사용자가 친 명령 본문에
 * 덧붙여 그 회차에 실제로 나갈 텍스트를 만든다. 규칙은 셋뿐이다:
 *
 *  1. **아무 옵션도 켜지 않으면 원문 그대로** — 종전 루프와 바이트 단위로 같아야 한다.
 *  2. 붙는 순서는 항상 같다(맨 위 한 줄 → 본문 → 규칙 블록) — 회차마다 프롬프트가 흔들리면
 *     모델이 회차 사이에 다른 규칙을 따른다.
 *  3. 부수 효과 0 — 파일도 읽지 않고 시각도 보지 않는다(호출자가 읽어서 넘긴다). 그래야
 *     단위 테스트가 이 조립을 통째로 지킬 수 있다.
 *
 * "한 가지 일" 규칙을 **맨 위와 규칙란 양쪽에** 넣는 것은 2026 우수 사례가 못 박는 지점이다 —
 * 한 번만 적으면 유능한 모델일수록 여러 일을 묶어 되돌리기 어려운 커밋을 만든다.
 */

/** 합성에 필요한 입력 — `SessionLoop` 에서 이 회차에 관계된 것만 추린 모양. */
export interface LoopRoundPromptInput {
  /** 이 회차에 보낼 본문(파일에서 읽어왔다면 그 내용). */
  command: string;
  /** 이번이 몇 회차인가 (1부터). */
  round: number;
  /** `mode==='count'` 일 때 목표 횟수. 무한이면 undefined. */
  total?: number;
  /** 진행 파일 경로(프로젝트 기준 상대). 비면 규약 없음. */
  progressFile?: string;
  /** "한 회차엔 한 가지 일만" 규칙 주입 여부. */
  oneTaskPerRound?: boolean;
  /** "변경이 있으면 이 회차에서 커밋" 규약 주입 여부. */
  commitEachRound?: boolean;
}

/** 회차 표기 — `3/10` 또는 무한이면 `3`. */
function roundLabel(round: number, total?: number): string {
  return total && total > 0 ? `${round}/${total}` : `${round}`;
}

/**
 * 이 회차에 실제로 나갈 프롬프트를 만든다.
 * 켜진 규약이 하나도 없으면 `command` 를 그대로 돌려준다(문자열 동일성 보장).
 */
export function composeLoopRoundText(input: LoopRoundPromptInput): string {
  const command = input.command;
  const rules: string[] = [];

  if (input.oneTaskPerRound) {
    rules.push(
      '한 회차에는 **한 가지 일만** 한다. 여러 개가 보이면 가장 중요한 하나만 끝내고, ' +
      '나머지는 손대지 말고 다음 회차로 남겨라(진행 기록에 적어 두면 된다).',
    );
  }
  if (input.progressFile) {
    rules.push(
      `진행 기록은 \`${input.progressFile}\` 에 둔다. **이 회차를 시작하기 전에 그 파일을 먼저 읽고**, ` +
      '끝낼 때 이번 회차에서 한 일·확인한 결과·다음에 할 일을 그 파일에 갱신해라. ' +
      '이 대화의 기억은 회차 사이에 사라질 수 있으므로, 이어서 할 일은 반드시 그 파일에 남겨야 한다.',
    );
  }
  if (input.commitEachRound) {
    rules.push(
      '이 회차에서 실제로 파일을 바꿨다면 회차를 끝내기 전에 커밋해라. 커밋 메시지에는 ' +
      `무엇을 바꿨는지와 무엇으로 확인했는지(테스트·빌드 등), 그리고 회차 번호(${roundLabel(input.round, input.total)})를 적는다. ` +
      '바꾼 것이 없으면 커밋하지 않는다.',
    );
  }

  if (rules.length === 0) return command;

  const parts: string[] = [];
  // 맨 위 한 줄 — 규칙란까지 내려가기 전에 먼저 눈에 들어와야 하는 것만.
  if (input.oneTaskPerRound) {
    parts.push(`[이 회차에서 할 일은 한 가지다 — 회차 ${roundLabel(input.round, input.total)}]`);
  }
  parts.push(command);
  parts.push(
    [
      `── 반복 실행 규칙 (회차 ${roundLabel(input.round, input.total)}) ──`,
      ...rules.map((r) => `- ${r}`),
    ].join('\n'),
  );

  return parts.join('\n\n');
}
