import { useCallback, useRef } from 'react';
import { isImeConsumedKey } from '../utils/inputComposition.js';
import { decideEnterKey, enterCancelsDefault, type EnterSendGesture } from '../utils/inputEnterKey.js';

/**
 * §6(조합 입력 보호) — **보내는 입력칸의 Enter 집행 한 곳.**
 *
 * 그런 칸의 약속은 하나다: **줄을 만드는 손짓은 보내는 손짓의 반대편 하나뿐.** 그런데 한글·일본어·
 * 중국어를 치면 마지막 글자는 거의 언제나 조합 중이라, Enter 를 통째로 입력기에게 넘기면 그
 * 사람에게는 **첫 Enter 가 늘 줄바꿈**이 된다(브라우저 기본 동작). 보내려면 두 번 눌러야 하고,
 * 보낸 글에는 쓰지도 않은 빈 줄이 남는다. Ctrl/Cmd+Enter 로 보내는 칸도 똑같이 깨진다 — Chromium 은
 * textarea 안의 Ctrl+Enter 를 InsertNewline 으로 옮기기 때문이다.
 *
 * 그래서 나누는 기준은 "조합 중이냐"가 아니라 **"입력기가 이 키를 먹었느냐"**다(`decideEnterKey`).
 * 먹힌 키는 줄만 막고 흘려보내고, 한글 확정처럼 입력기를 빠져나온 진짜 Enter 는 그 자리에서 보낸다.
 *
 * ⚠ 쓰는 칸에 `{...IME_ENTER_OWNER}` 를 빠뜨리면 전역 IME 가드가 조합 중 Enter 를 먼저 붙들어
 *   이 집행이 아예 불리지 않는다(= 줄바꿈만 남는다). `enterKeyOwnerContract.test.ts` 가 집행한다.
 *
 * @param e 입력칸의 keydown.
 * @param submit 보낼 때 할 일. **인자로 입력칸의 현재 값**을 받는다 — 확정 직후 프레임에는 React
 *   상태가 아직 마지막 글자를 못 받았을 수 있고, 통제 입력칸이라 DOM 값이 사용자가 본 그대로다.
 *   상태를 읽어 보내는 칸은 반드시 이 값을 우선해야 마지막 글자가 빠지지 않는다.
 * @param gesture 보내는 손짓(기본 `'enter'`). `'chord'` 면 Ctrl/Cmd+Enter 가 보내기, 맨 Enter 가 줄.
 * @returns 이 키를 자기가 처리했으면 `true`(부르는 쪽은 그대로 `return`).
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
 * `runEnterKey` 를 렌더마다 새로 만들지 않는 훅 꼴 — 핸들러를 `useCallback` 으로 내려보내는 칸용.
 *
 * ```tsx
 * const onEnter = useEnterSubmit(handleSend);
 * <textarea {...IME_ENTER_OWNER} onKeyDown={(e) => {
 *   if (onEnter(e)) return;              // Enter/Shift+Enter 는 여기서 끝난다
 *   if (e.key === 'Escape') close();
 * }} />
 * ```
 * JSX 안에서 그때그때 부르는 자리(map 안처럼 훅을 쓸 수 없는 곳)는 `runEnterKey` 를 직접 쓴다.
 *
 * @param submit 매 렌더 새로 만들어져도 된다 — 누를 때 **그 시점의 것**을 부른다.
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
