import { describe, expect, it, vi } from 'vitest';
import {
  afterInputComposition, cancelPendingInputEdits, IME_ENTER_OWNER, installInputCompositionGuard,
  isComposingKeyEvent, isComposingNow, isImeConsumedKey, isInputComposing,
} from './inputComposition.js';

import { emit, field, harness } from './inputComposition.testHelpers.js';

describe('IME owns candidate keys without cancelling native editing', () => {
  it.each(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])(
    '%s cannot submit, clear, rename or indent while composing', (key) => {
      const h = harness(); const input = field();
      emit(h.view, 'compositionstart', input);
      const event = emit(h.view, 'keydown', input, { key, isComposing: false, keyCode: 13 });
      expect(h.command).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      h.dispose();
    },
  );

  it('handles compositionend before final keyCode 229, even after the settling frame', () => {
    const h = harness(); const input = field();
    emit(h.view, 'compositionstart', input);
    emit(h.view, 'compositionend', input);
    h.view.frame();
    expect(isInputComposing(input)).toBe(false);
    emit(h.view, 'keydown', input, { key: 'Enter', isComposing: false, keyCode: 229 });
    expect(h.command).not.toHaveBeenCalled();
    emit(h.view, 'keydown', input, { key: 'Enter', isComposing: false, keyCode: 13 });
    expect(h.command).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('a send-on-Enter field keeps Enter through the commit — withholding it only leaves a line break', () => {
    const h = harness();
    const input = Object.assign(field(), {
      getAttribute: (name: string) => (name === 'data-ime-enter' ? IME_ENTER_OWNER['data-ime-enter'] : null),
    });
    emit(h.view, 'compositionstart', input);
    const enter = emit(h.view, 'keydown', input, { key: 'Enter', isComposing: true, keyCode: 13 });
    expect(h.command).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(false); // the field cancels the break itself; the guard never does
    // Everything else about that field is unchanged: candidate keys still belong to the IME.
    for (const key of ['Escape', 'Tab', 'ArrowUp', 'ArrowDown']) {
      emit(h.view, 'keydown', input, { key, isComposing: true });
    }
    expect(h.command).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  /**
   * 신고된 증상의 **정확한 차례**다. 지금까지의 시험은 compositionend 와 확정 Enter 사이에서 늘
   * `h.view.frame()` 을 한 번 돌렸다 — 실제 입력 버스트에는 그 프레임이 없다. 그 한 칸 때문에
   * "확정 직후 Enter" 가 한 번도 시험된 적이 없었고, 한글 사용자에겐 그게 매번이었다.
   */
  it('the commit Enter in the same frame as compositionend is a send, not a line break', () => {
    const h = harness();
    const owner = Object.assign(field(), {
      getAttribute: (name: string) => (name === 'data-ime-enter' ? IME_ENTER_OWNER['data-ime-enter'] : null),
    });
    emit(h.view, 'compositionstart', owner);
    // 한글 확정 한 번에 keydown 은 둘이다: 입력기가 먹은 229, 그리고 입력기를 빠져나온 진짜 Enter.
    const eaten = emit(h.view, 'keydown', owner, { key: 'Enter', isComposing: true, keyCode: 229 });
    emit(h.view, 'compositionend', owner);
    // ⚠ 여기서 프레임을 넘기지 않는다.
    const commit = emit(h.view, 'keydown', owner, { key: 'Enter', isComposing: false, keyCode: 13 });

    // 가드는 둘 다 칸에 넘긴다 — 붙들면 기본 줄바꿈만 남는다. 기본 동작도 가드가 막지 않는다.
    expect(h.command).toHaveBeenCalledTimes(2);
    expect(eaten.defaultPrevented).toBe(false);
    expect(commit.defaultPrevented).toBe(false);

    // 둘을 가르는 것은 칸의 몫이고, 가를 근거가 바로 이 두 술어다.
    expect(isImeConsumedKey(eaten)).toBe(true);
    expect(isImeConsumedKey(commit)).toBe(false);
    // 확정 Enter 는 정착 프레임 안이라 "조합"으로 보이지만, 조합 **중**은 아니다 —
    //   글자는 이미 칸에 들어와 있다. 이 둘을 같은 것으로 세던 것이 버그였다.
    expect(isComposingKeyEvent(commit)).toBe(true);
    expect(isComposingNow(owner)).toBe(false);
    h.dispose();
  });

  it('a plain field still hands the settling Enter to the IME — nothing there sends on Enter', () => {
    const h = harness(); const input = field();
    emit(h.view, 'compositionstart', input);
    emit(h.view, 'compositionend', input);
    const settling = emit(h.view, 'keydown', input, { key: 'Enter', isComposing: false, keyCode: 13 });
    expect(h.command).not.toHaveBeenCalled();
    expect(settling.defaultPrevented).toBe(false);
    h.view.frame();
    emit(h.view, 'keydown', input, { key: 'Enter', isComposing: false, keyCode: 13 });
    expect(h.command).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('native composition flag works even when its start event was not observed', () => {
    const h = harness();
    emit(h.view, 'keydown', field(), { key: 'Enter', isComposing: true });
    expect(h.command).not.toHaveBeenCalled();
    h.dispose();
  });

  it('does not leak composition from one input into another or a button', () => {
    const h = harness(); const first = field(); const second = field('INPUT');
    emit(h.view, 'compositionstart', first);
    emit(h.view, 'keydown', second, { key: 'Enter' });
    emit(h.view, 'keydown', field('BUTTON'), { key: 'Enter', isComposing: true });
    expect(h.command).toHaveBeenCalledTimes(2);
    emit(h.view, 'focusout', first);
    emit(h.view, 'keydown', first, { key: 'Enter' });
    expect(h.command).toHaveBeenCalledTimes(3);
    h.dispose();
  });

  it.each(['한', 'あ', '中', 'é', 'ع', 'א', '😀', 'Backspace', 'Delete', ' '])(
    'does not filter ordinary text/edit key %s', (key) => {
      const h = harness(); const input = field();
      emit(h.view, 'compositionstart', input);
      const event = emit(h.view, 'keydown', input, { key, isComposing: true });
      expect(h.command).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
      h.dispose();
    },
  );

  it('does not intercept xterm composition or input events', () => {
    const h = harness(); const input = field(); const nativeInput = vi.fn();
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'input']) {
      h.view.addEventListener(type, nativeInput);
      expect(emit(h.view, type, input).defaultPrevented).toBe(false);
    }
    expect(nativeInput).toHaveBeenCalledTimes(4);
    h.dispose();
  });

  it('leaves xterm keydown finalization intact while app helpers still detect composition', () => {
    const h = harness();
    const input = Object.assign(field(), { classList: { contains: (name: string) => name === 'xterm-helper-textarea' } });
    emit(h.view, 'compositionstart', input);
    const event = emit(h.view, 'keydown', input, { key: 'Enter', keyCode: 13 });
    expect(h.command).toHaveBeenCalledTimes(1);
    expect(isComposingKeyEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    h.dispose();
  });
});

describe('programmatic edits wait for native composition commit', () => {
  it('queues voice results in order with a render boundary between edits', () => {
    const h = harness(); const input = field(); const edits: string[] = [];
    emit(h.view, 'compositionstart', input);
    afterInputComposition(input, () => edits.push('first'));
    afterInputComposition(input, () => edits.push('second'));
    expect(edits).toEqual([]);
    emit(h.view, 'compositionend', input);
    expect(edits).toEqual([]);
    h.view.frame(); expect(edits).toEqual(['first']);
    h.view.frame(); expect(edits).toEqual(['first', 'second']);
    h.dispose();
  });

  it.each(['blur', 'unmount', 'session switch'])(
    'does not replay delayed edits after %s', (reason) => {
      const h = harness(); const input = field(); const edit = vi.fn();
      emit(h.view, 'compositionstart', input);
      afterInputComposition(input, edit);
      emit(h.view, 'compositionend', input);
      if (reason === 'blur') emit(h.view, 'focusout', input);
      else if (reason === 'unmount') input.isConnected = false;
      else cancelPendingInputEdits(input);
      h.view.frame(); expect(edit).not.toHaveBeenCalled();
      h.dispose();
    },
  );

  it('a new composition before the frame keeps queued work waiting', () => {
    const h = harness(); const input = field(); const edit = vi.fn();
    emit(h.view, 'compositionstart', input);
    afterInputComposition(input, edit);
    emit(h.view, 'compositionend', input);
    emit(h.view, 'compositionstart', input);
    h.view.frame(); expect(edit).not.toHaveBeenCalled();
    emit(h.view, 'compositionend', input);
    h.view.frame(); expect(edit).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('new results cannot overtake older queued results between drain frames', () => {
    const h = harness(); const input = field(); const edits: string[] = [];
    emit(h.view, 'compositionstart', input);
    afterInputComposition(input, () => edits.push('first'));
    afterInputComposition(input, () => edits.push('second'));
    emit(h.view, 'compositionend', input);
    h.view.frame();
    afterInputComposition(input, () => edits.push('third'));
    expect(edits).toEqual(['first']);
    h.view.frame(); expect(edits).toEqual(['first', 'second']);
    h.view.frame(); expect(edits).toEqual(['first', 'second', 'third']);
    h.dispose();
  });

  it('ordinary same-task voice results also have separate render boundaries', () => {
    const h = harness();
    const input = Object.assign(field(), { ownerDocument: { defaultView: h.view } });
    const edits: string[] = [];
    afterInputComposition(input, () => edits.push('first'));
    afterInputComposition(input, () => edits.push('second'));
    expect(edits).toEqual([]);
    h.view.frame(); expect(edits).toEqual(['first']);
    h.view.frame(); expect(edits).toEqual(['first', 'second']);
    h.dispose();
  });

  it('a new input never receives the previous input pending edits after disposal/reinstall', () => {
    const h = harness(); const input = field(); const edit = vi.fn();
    emit(h.view, 'compositionstart', input);
    afterInputComposition(input, edit);
    emit(h.view, 'compositionend', input);
    h.dispose();
    expect(isInputComposing(input)).toBe(false);
    const dispose = installInputCompositionGuard(h.view as unknown as Window);
    h.view.frame(); expect(edit).not.toHaveBeenCalled();
    const other = Object.assign(field(), { ownerDocument: { defaultView: h.view } });
    afterInputComposition(other, edit);
    h.view.frame(); expect(edit).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('session cancellation clears composing state even when unmount emits no focusout', () => {
    const h = harness(); const input = field(); const edit = vi.fn();
    emit(h.view, 'compositionstart', input);
    afterInputComposition(input, edit);
    input.isConnected = false;
    cancelPendingInputEdits(input);
    expect(isInputComposing(input)).toBe(false);
    h.view.frame(); expect(edit).not.toHaveBeenCalled();
    h.dispose();
  });

  it('direct component guards use the same native/229/target decision', () => {
    expect(isComposingKeyEvent({ isComposing: true })).toBe(true);
    expect(isComposingKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isComposingKeyEvent({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
