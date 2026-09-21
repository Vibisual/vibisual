/**
 * §6(조합 입력 보호) · §5.5 #17-2·#17-18 — **보내는 입력칸의 Enter 판정 한 곳.**
 *
 * 약속은 한 줄이다: **줄을 만드는 손짓은 보내는 손짓의 반대편 하나뿐이다.** 한글·일본어·중국어를
 * 치면 마지막 글자는 거의 언제나 조합 중이라, 조합 중 Enter 를 통째로 "입력기 것"으로 넘기면 그
 * 사람에게는 **첫 Enter 가 늘 줄바꿈**이 된다(브라우저 기본 동작). 보내려면 두 번 눌러야 하고,
 * 보낸 글에는 쓰지도 않은 빈 줄이 남는다.
 *
 * 그래서 조합을 **두 가지**로 갈라 본다. 이 구분이 이 파일의 전부다:
 *  - `imeConsumed` — 입력기가 **먹은** 키(조합 중·일본어/중국어 변환 확정). 글자를 고르는 손짓이지
 *    보내는 손짓이 아니다. 줄바꿈만 막고 **아무 일도 하지 않는다**(`imeCommit`). 여기서 보내면
 *    변환 후보를 고르던 사람의 문장이 고르는 중에 날아간다.
 *  - 확정 직후 — 한글 commit 은 진짜 Enter 로 온다(`isComposing` 이 이미 꺼져 있다). 글자는 칸에
 *    들어와 있으므로 이것은 **보내기**다. 이걸 조합으로 세던 것이 신고된 버그였다.
 *
 * 보내는 손짓은 칸마다 다르다(`EnterSendGesture`) — 한 줄 명령칸은 Enter, 여러 줄을 먼저 쓰는
 * 칸은 Ctrl/Cmd+Enter. 판정은 같은 함수가 한다.
 *
 * 판정을 순수 함수로 떼어 두는 이유는 실기 없이 세 OS·세 입력기의 조합을 전부 시험하기 위함이다
 * ([multiplatform.md](../../../../docs/rules/multiplatform.md) — "플랫폼 분기는 인자로 받는다").
 */

/** 이 칸에서 **보내는** 손짓이 무엇인가. 나머지 Enter 는 전부 줄바꿈이다. */
export type EnterSendGesture =
  /** Enter 가 보내기 · Shift+Enter 가 줄바꿈(IDE 명령칸·메모·댓글). */
  | 'enter'
  /** Ctrl/Cmd+Enter 가 보내기 · 맨 Enter 는 줄바꿈(여러 줄을 먼저 쓰는 칸). */
  | 'chord';

export type EnterOutcome =
  /** Enter 가 아니거나 이 칸이 다룰 일이 아니다 — 뒤 판정에 넘긴다. */
  | { kind: 'pass' }
  /** 입력기가 먹은 키다 — 줄바꿈만 막고 아무 일도 하지 않는다(글자 확정은 입력기 몫). */
  | { kind: 'imeCommit' }
  /** 지금 보낸다(기본 동작 차단). */
  | { kind: 'submit' }
  /** 슬래시 목록에서 고른다(기본 동작 차단). */
  | { kind: 'slash' }
  /** 줄을 추가한다 — 브라우저에게 맡긴다(기본 동작 유지). */
  | { kind: 'newline' };

export interface EnterKeyFacts {
  key: string;
  shiftKey: boolean;
  /** Ctrl 또는 Meta(⌘) — 판정은 언제나 둘의 합이다(multiplatform 정본 5축: `ctrlKey || metaKey`). */
  chordKey: boolean;
  /** 입력기가 이 키를 먹었다(`isImeConsumedKey`) — 조합 중이거나 변환을 확정한 키. */
  imeConsumed: boolean;
  /** 슬래시 드롭다운에서 지금 고를 수 있는 항목 수(0 = 닫혔거나 고를 것이 없다). */
  slashMatchCount: number;
  /** 이 칸에서 보내는 손짓(기본 `'enter'`). */
  gesture?: EnterSendGesture;
}

export function decideEnterKey(facts: EnterKeyFacts): EnterOutcome {
  if (facts.key !== 'Enter') return { kind: 'pass' };
  // ① 보내는 손짓인가? 아니면 줄 추가다 — 조합 중이어도 같다(입력기가 확정하고 브라우저가 줄을 넣는다).
  const sending = facts.gesture === 'chord' ? facts.chordKey : !facts.shiftKey;
  if (!sending) return { kind: 'newline' };
  // ② 입력기가 먹은 키는 우리 것이 아니다. 줄만 막는다 — 보내면 변환 중인 문장이 날아간다.
  if (facts.imeConsumed) return { kind: 'imeCommit' };
  // ③ 여기부터는 확정된 글 위에서의 진짜 명령이다.
  if (facts.slashMatchCount > 0) return { kind: 'slash' };
  return { kind: 'submit' };
}

/**
 * 기본 동작(줄바꿈)을 막아야 하는 결과인가 — `preventDefault` 판정을 한 곳에 둔다.
 *
 * `imeCommit` 도 포함이다. 그 칸은 `IME_ENTER_OWNER` 로 전역 가드에서 빠져 있어, 우리가 막지 않으면
 * 브라우저 기본 줄바꿈이 그대로 남는다 — 고치려던 증상 그 자체다.
 */
export function enterCancelsDefault(outcome: EnterOutcome): boolean {
  return outcome.kind === 'imeCommit' || outcome.kind === 'submit' || outcome.kind === 'slash';
}
