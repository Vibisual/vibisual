/**
 * §5.5 #17-2 (판올림 번호 발급 대기) — 한 턴에 실제로 나갈 프롬프트 조립 (순수 모듈).
 *
 * 종전에는 `subAgentManager.execute` 안에서 인라인으로 조립했는데, 그 조립이 **앞말을 항상 붙였다**:
 * 이어지는 턴은 `livePreamble`(엣지·집행 플러그인·의도 선언·세션 목표) + `---`, 첫 스폰은
 * `contextSummary … Task: <본문>`. 그래서 사용자가 친 `/compact` 는 메시지 **맨 앞**에 서지 못했고,
 * CLI 는 그것을 내장 명령이 아니라 평문으로 보고 모델에게 그대로 넘겼다 — `/` 드롭다운(#17-2 v3.19)이
 * 노출하는 내장 명령이 한 번도 실행된 적이 없던 이유이며, 루프의 회차 사이 압축(#17-11 ⑪)이
 * 압축 대신 모델 턴을 하나씩 더 태우던 이유다.
 *
 * 실측(CLI 2.1.231, stream-json stdin) — 맨 앞 `/context`: `model=<synthetic>` · turns 0 · $0
 * (CLI 자체 처리) / 앞에 한 줄만 붙인 같은 본문: turns 1 · $0.0125 (모델이 평문으로 답한다).
 *
 * 규칙은 셋뿐이다:
 *
 *  1. **슬래시 명령이면 원문 그대로** — 앞말도, `Task:` 래핑도, 첨부 경로도 붙이지 않는다.
 *     맨 앞 한 글자라도 앞서면 CLI 가 명령으로 집지 못한다.
 *  2. **슬래시가 아니면 종전 조립과 바이트 단위로 같다** — 이 모듈을 끼운 것만으로 기존 턴의
 *     프롬프트가 한 글자도 달라지면 안 된다.
 *  3. 부수 효과 0 — 상태도 시각도 보지 않는다. 세션 브리핑을 이월할지 말지도 **판단만** 돌려주고
 *     들고 있는 것은 호출자의 몫이다. 그래야 단위 테스트가 이 조립을 통째로 지킬 수 있다.
 */

/**
 * 슬래시 명령의 첫 토큰 이름 — `/` 를 뗀 나머지가 이 꼴이어야 한다(영숫자 + `-` `_` `:`).
 * 경로(`/usr/bin/claude`)나 산문(`/ 로 시작하는 문장`)이 명령으로 오인되지 않게 하는 경계.
 */
const SLASH_COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

/** 앞말과 본문 사이 구분선 — 종전 조립이 쓰던 것 그대로. */
const PREAMBLE_SEPARATOR = '\n\n---\n\n';

/** 첫 스폰에서 브리핑과 본문을 잇는 머리말 — 종전 조립이 쓰던 것 그대로. */
const TASK_LEAD = 'Task: ';

/** 조립에 필요한 입력 — 호출자가 그 턴에 아는 것만 추린 모양. */
export interface TurnPromptInput {
  /** 사용자가 친(또는 루프가 낸) 명령 본문. */
  text: string;
  /** paste 첨부의 서버 경로들. 슬래시 통과 경로에서는 붙이지 않는다. */
  attachments?: string[];
  /** 매 턴 앞에 붙는 live preamble(엣지·집행·의도·목표). 비어 있으면 구분선도 없다. */
  preamble?: string;
  /** 그 세션에 한 번만 실리는 전체 브리핑(카드 지시문·Brain 등). */
  contextSummary: string;
  /** 이 세션이 이미 CLI 세션 id 를 갖고 있는가(= `--resume` 경로인가). */
  hasSession: boolean;
  /** 앞선 슬래시 턴이 미뤄 둔 브리핑이 아직 남아 있는가. */
  carryContextSummary?: boolean;
}

/** 조립 결과 — 프롬프트 한 줄 + 호출자가 장부에 반영해야 할 두 비트. */
export interface TurnPrompt {
  /** 이 턴에 stream-json `user` 메시지로 나갈 텍스트. */
  prompt: string;
  /** CLI 가 내장 명령으로 집도록 원문 그대로 보냈는가. */
  slashPassthrough: boolean;
  /** 이번 턴이 브리핑을 미뤘는가 — 호출자가 다음 턴까지 들고 있어야 한다. */
  deferContextSummary: boolean;
  /** 이번 턴에 브리핑을 실었는가 — 호출자가 이월 표식을 지운다. */
  contextSummaryDelivered: boolean;
}

/**
 * 이 본문이 CLI 내장 명령·스킬 호출인가.
 * 판정은 **첫 토큰 하나**로만 한다 — 뒤에 인자가 몇 줄 붙든 명령은 명령이다(`/compact 지침…`).
 */
export function isSlashCommandText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return false;
  const firstToken = trimmed.split(/\s/, 1)[0] ?? '';
  return SLASH_COMMAND_NAME.test(firstToken.slice(1));
}

/**
 * 이 턴에 실제로 나갈 프롬프트를 만든다.
 *
 * 슬래시 명령이면 `text.trim()` 을 그대로 돌려주고(문자열 동일성 보장), 그 턴이 첫 스폰이었다면
 * 브리핑을 다음 턴으로 미룬다 — 세션에 한 번뿐인 브리핑을 슬래시 한 줄에 잃지 않기 위해서다.
 */
export function composeTurnPrompt(input: TurnPromptInput): TurnPrompt {
  const needsSummary = !input.hasSession || input.carryContextSummary === true;

  if (isSlashCommandText(input.text)) {
    return {
      prompt: input.text.trim(),
      slashPassthrough: true,
      deferContextSummary: needsSummary,
      contextSummaryDelivered: false,
    };
  }

  const attachments = input.attachments ?? [];
  const attachmentsSuffix = attachments.length > 0 ? `\n\n${attachments.join('\n')}` : '';
  const taskText = input.text + attachmentsSuffix;

  if (needsSummary) {
    return {
      prompt: `${input.contextSummary}${PREAMBLE_SEPARATOR}${TASK_LEAD}${taskText}`,
      slashPassthrough: false,
      deferContextSummary: false,
      contextSummaryDelivered: true,
    };
  }

  const preamble = (input.preamble ?? '').trim();
  const preambleBlock = preamble.length > 0 ? `${preamble}${PREAMBLE_SEPARATOR}` : '';
  return {
    prompt: `${preambleBlock}${taskText}`,
    slashPassthrough: false,
    deferContextSummary: false,
    contextSummaryDelivered: false,
  };
}
