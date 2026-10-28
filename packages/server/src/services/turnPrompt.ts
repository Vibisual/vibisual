/**
 * §5.5 #17-2 — 한 턴의 프롬프트 조립(순수 모듈). 앞말이 슬래시 명령 앞에 서면 CLI 가 명령으로 못 집는다
 * (실측 CLI 2.1.231: 맨 앞 `/context` = `<synthetic>` · turns 0 · $0 / 한 줄 앞서면 turns 1 · $0.0125).
 * ① 슬래시는 원문 그대로(앞말·`Task:`·첨부 ❌) ② 아니면 기존 조립과 바이트 단위로 같다 ③ 부수 효과 0 — 브리핑 이월도 판단만 돌려준다.
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
 * §5.11 정독 게이트 — 조립된 프롬프트에서 본문만 되찾는다(앞말째 라우팅하면 정독 블록 제목이 다음 "필수 절"을 고르는 자기 참조).
 * 첫 스폰 꼴(`브리핑 --- Task: 본문`)만 벗긴다 — 이어지는 턴은 원장이 조립 때 받는다(`specReadingService.notePrompt`).
 */
export function extractTaskText(prompt: string): string {
  const marker = `${PREAMBLE_SEPARATOR}${TASK_LEAD}`;
  const at = prompt.indexOf(marker);
  return at >= 0 ? prompt.slice(at + marker.length) : prompt;
}

/** 슬래시면 `text.trim()` 그대로, 첫 스폰이었으면 브리핑을 다음 턴으로 미룬다(한 번뿐인 브리핑을 잃지 않게). */
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
