import { useCallback, useRef } from 'react';
import { afterInputComposition, isComposingKeyEvent } from '../utils/inputComposition.js';
import { decideEnterKey, enterCancelsDefault } from '../utils/inputEnterKey.js';

/**
 * §6(조합 입력 보호) — **Enter 로 보내는 여러 줄 입력칸의 Enter 집행 한 곳.**
 *
 * 그런 칸의 약속은 하나다: **줄을 만드는 손짓은 Shift+Enter 뿐.** 그런데 한글·일본어·중국어를 치면
 * 마지막 글자는 거의 언제나 조합 중이라, 조합 중 Enter 를 입력기에게 넘기면 그 사람에게는 **첫 Enter
 * 가 늘 줄바꿈**이 된다(브라우저 기본 동작). 보내려면 두 번 눌러야 하고, 보낸 글에는 쓰지도 않은 빈
 * 줄이 남는다. 그래서 여기서는 줄바꿈만 막아 두고 **확정된 다음 프레임에** 보낸다.
 *
 * 쓰는 법 — 판정은 이 훅이, 나머지 키는 부르는 쪽이 이어서 다룬다:
 * ```tsx
 * const onEnter = useEnterSubmit(handleSend);
 * <textarea {...IME_ENTER_OWNER} onKeyDown={(e) => {
 *   if (onEnter(e)) return;              // Enter/Shift+Enter 는 여기서 끝난다
 *   if (e.key === 'Escape') close();
 * }} />
 * ```
 * ⚠ `{...IME_ENTER_OWNER}` 를 빠뜨리면 전역 IME 가드가 조합 중 Enter 를 먼저 붙들어
 *   이 핸들러가 아예 불리지 않는다(= 줄바꿈만 남는다).
 *
 * @param submit 보낼 때 할 일. 매 렌더 새로 만들어져도 된다 — 확정 뒤 **그 시점의 것**을 부른다.
 * @returns 이 키를 자기가 처리했으면 `true`(부르는 쪽은 그대로 `return`).
 */
export function useEnterSubmit(
  submit: () => void,
): (e: React.KeyboardEvent) => boolean {
  const submitRef = useRef(submit);
  submitRef.current = submit;
  return useCallback((e: React.KeyboardEvent): boolean => {
    const outcome = decideEnterKey({
      key: e.key,
      shiftKey: e.shiftKey,
      composing: isComposingKeyEvent(e.nativeEvent),
      // 슬래시 드롭다운은 IDE 입력칸만 갖는다 — 그쪽은 자기 자리에서 같은 판정을 집행한다.
      slashMatchCount: 0,
    });
    if (!enterCancelsDefault(outcome)) return outcome.kind === 'newline';
    e.preventDefault();
    if (outcome.kind !== 'submitAfterCommit') {
      submitRef.current();
      return true;
    }
    // 조합 확정 대기 — 창이 닫히거나(언마운트) 초점을 잃으면 예약은 스스로 버려진다.
    const el = e.currentTarget;
    afterInputComposition(el, () => {
      if (el.isConnected) submitRef.current();
    });
    return true;
  }, []);
}
