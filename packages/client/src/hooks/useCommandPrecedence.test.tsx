import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveKeymap, type CommandId } from '@vibisual/shared';
import { __resetCommandRegistry, useCommand } from './useCommand.js';
import { useKeymapStore } from '../stores/keymap.js';

/**
 * §5.5 #17-27 ⑲ · §5.24 #32 — 같은 스코프에선 **진짜 Control 바인딩을 먼저** 본다. 판정이 `ctrlKey || metaKey` 라 mac ⌃G 가 `Ctrl+G`(다음 찾기)에도 맞아,
 * 등록 차례로 고르면 다음 찾기가 ⌃G(줄 번호로 가기)를 가져간다. `window`·`HTMLElement` 만 흉내 낸다.
 */

class FakeElement {
  tagName = 'TEXTAREA';
  isContentEditable = false;
  /** 편집창 안의 본문처럼 — IDE 오버레이 안 · 편집 판 안(무대 아님). */
  closest(selector: string): object | null {
    return selector === '[data-ide-overlay]' || selector === '[data-ide-editor-pane]' ? {} : null;
  }
}

let renderer: ReactTestRenderer | null = null;
/** 디스패처는 `window` 에 리스너를 **한 번만** 건다(`ensureListener`) — 시험마다 새 가짜 창을 주면 둘째부터 키가 안 닿아 하나를 돌려 쓴다. */
const view = new EventTarget();

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = null;
  __resetCommandRegistry();
  vi.unstubAllGlobals();
});

function mount(handlers: Array<[CommandId, () => void]>): EventTarget {
  vi.stubGlobal('window', view);
  vi.stubGlobal('HTMLElement', FakeElement);
  function Probe(): null {
    for (const [id, run] of handlers) {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- 시험 안에서 목록이 바뀌지 않는다
      useCommand(id, () => { run(); });
    }
    return null;
  }
  act(() => { renderer = create(createElement(Probe)); });
  return view;
}

function press(view: EventTarget, init: { code: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): Event {
  const event = new Event('keydown', { cancelable: true });
  const target = new FakeElement();
  Object.defineProperties(event, {
    code: { value: init.code },
    key: { value: init.code.replace(/^Key/, '').toLowerCase() },
    keyCode: { value: 0 },
    isComposing: { value: false },
    ctrlKey: { value: init.ctrlKey ?? false },
    metaKey: { value: init.metaKey ?? false },
    shiftKey: { value: init.shiftKey ?? false },
    altKey: { value: init.altKey ?? false },
    target: { value: target },
  });
  view.dispatchEvent(event);
  return event;
}

describe('같은 스코프 안의 후보 — 진짜 Control 이 먼저', () => {
  it('mac 의 ⌃G 는 줄 번호로 가기, ⌘G 는 다음 찾기 — 다음 찾기를 먼저 등록해도', () => {
    useKeymapStore.setState({ resolved: resolveKeymap({}, 'darwin') });
    const findNext = vi.fn();
    const goToLine = vi.fn();
    // 일부러 다음 찾기를 먼저 등록한다 — 등록 차례로 고르면 ⌃G 를 다음 찾기가 가져간다.
    const view = mount([['editor.findNext', findNext], ['editor.goToLine', goToLine]]);

    const controlG = press(view, { code: 'KeyG', ctrlKey: true });
    expect(goToLine).toHaveBeenCalledTimes(1);
    expect(findNext).not.toHaveBeenCalled();
    expect(controlG.defaultPrevented).toBe(true);

    press(view, { code: 'KeyG', metaKey: true });
    expect(findNext).toHaveBeenCalledTimes(1);
    expect(goToLine).toHaveBeenCalledTimes(1);
  });

  it('win 은 Ctrl+G 가 줄 번호로 가기, F3 이 다음 찾기다', () => {
    useKeymapStore.setState({ resolved: resolveKeymap({}, 'win32') });
    const findNext = vi.fn();
    const goToLine = vi.fn();
    const view = mount([['editor.findNext', findNext], ['editor.goToLine', goToLine]]);

    press(view, { code: 'KeyG', ctrlKey: true });
    expect(goToLine).toHaveBeenCalledTimes(1);
    press(view, { code: 'F3' });
    expect(findNext).toHaveBeenCalledTimes(1);
  });

  it('편집창의 Ctrl+/ 는 줄 주석이 가져가고, 처리기가 넘기면(false) 전역 단축키 목록으로 흘러간다', () => {
    useKeymapStore.setState({ resolved: resolveKeymap({}, 'win32') });
    const overlay = vi.fn();
    vi.stubGlobal('window', view);
    vi.stubGlobal('HTMLElement', FakeElement);
    let comment: () => boolean = () => true;
    function Probe(): null {
      useCommand('global.shortcutOverlay', () => { overlay(); });
      useCommand('editor.toggleLineComment', () => comment());
      return null;
    }
    act(() => { renderer = create(createElement(Probe)); });

    press(view, { code: 'Slash', ctrlKey: true });
    expect(overlay).not.toHaveBeenCalled();
    // 주석을 달 수 없는 파일(읽기 전용·주석 기호 없음) — 처리기가 넘기면 목록이 뜬다.
    comment = () => false;
    press(view, { code: 'Slash', ctrlKey: true });
    expect(overlay).toHaveBeenCalledTimes(1);
  });
});
