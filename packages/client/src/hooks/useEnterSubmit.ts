import { useCallback, useRef } from 'react';
import { isImeConsumedKey } from '../utils/inputComposition.js';
import { decideEnterKey, enterCancelsDefault, type EnterSendGesture } from '../utils/inputEnterKey.js';

/**
 * §6(조합 입력 보호) — **보내는 입력칸의 Enter 집행 한 곳.** CJK 는 마지막 글자가 늘 조합 중이라 Enter 를 입력기에 넘기면 첫 Enter 가 줄바꿈이 된다(Chromium 은 textarea 의 Ctrl+Enter 도 InsertNewline).
 * 기준은 **"입력기가 이 키를 먹었느냐"**(`decideEnterKey`) — 먹힌 키는 줄만 막고 진짜 Enter 는 보낸다. ⚠ 칸에 `{...IME_ENTER_OWNER}` 가 없으면 전역 IME 가드가 먼저 붙든다(`enterKeyOwnerContract.test.ts`).
 * @param submit 인자로 **입력칸의 현재 DOM 값**을 받는다 — 확정 직후 프레임엔 React 상태에 마지막 글자가 없을 수 있다.
 * @param gesture 기본 `'enter'`. `'chord'` 면 Ctrl/Cmd+Enter 가 보내기, 맨 Enter 가 줄.
 * @returns 처리했으면 `true`.
 */
export function runEnterKey(
  e: React.KeyboardEvent,
  submit: (liveValue: string) => void,
  gesture: EnterSendGesture = 'enter',
): boolean {
  const outcome = decideEnterKey({
    key: e.key,
    shiftKey: e.shiftKey,
    // 판정은 언제나 둘의 합 — mac 은 ⌘, win·linux 는 Ctrl(multiplatform 정본 5축).
    chordKey: e.ctrlKey || e.metaKey,
    imeConsumed: isImeConsumedKey(e.nativeEvent),
    // 슬래시 드롭다운은 IDE 입력칸만 갖는다 — 그쪽은 자기 자리에서 같은 판정을 집행한다.
    slashMatchCount: 0,
    gesture,
  });
  if (!enterCancelsDefault(outcome)) return outcome.kind === 'newline';
  // 입력기가 먹은 키까지 여기서 막는다 — 이 칸은 가드 밖이라 안 막으면 줄이 그대로 남는다.
  e.preventDefault();
  if (outcome.kind === 'imeCommit') return true;
  const el = e.currentTarget as unknown as { value?: unknown };
  submit(typeof el?.value === 'string' ? el.value : '');
  return true;
}

/**
 * `runEnterKey` 의 훅 꼴 — 칸에 `{...IME_ENTER_OWNER}`, `onKeyDown` 첫 줄에 `if (onEnter(e)) return;`. 훅을 못 쓰는 자리(map 안)는 `runEnterKey` 를 직접.
 * @param submit 매 렌더 새로 만들어져도 된다 — 누를 때 그 시점의 것을 부른다.
 */
export function useEnterSubmit(
  submit: (liveValue: string) => void,
  gesture: EnterSendGesture = 'enter',
): (e: React.KeyboardEvent) => boolean {
  const submitRef = useRef(submit);
  submitRef.current = submit;
  return useCallback(
    (e: React.KeyboardEvent): boolean => runEnterKey(e, (v) => submitRef.current(v), gesture),
    [gesture],
  );
}
