import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Layout/HoverTooltip.js', () => ({ HoverTooltip: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./studioIcons.js', () => ({ StudioIcon: () => null }));

import { StudioIconButton } from './StudioIconButton.js';

/**
 * §5.13 (Y) 40-10 ① — 재생 단추는 **누르는 순간** 반응한다(손을 떼기를 기다리지 않는다). 뒤따르는 클릭은 한 번만 삼키고, 키보드(Space ·
 * Enter)·보조 기술의 클릭은 늘 한 번 부른다. mac 의 Ctrl+클릭(보조 클릭)은 누르는 순간 처리에서 뺀다.
 */

let view: ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; });

function button(onPress: () => void, onClick: () => void) {
  act(() => { view = create(createElement(StudioIconButton, { icon: 'play', label: 'Play', onPress, onClick })); });
  return view!.root.findByType('button');
}

describe('§5.13 (Y) 40-10 ① — StudioIconButton onPress', () => {
  it('fires on pointer down and swallows the click that follows', () => {
    const press = vi.fn();
    const click = vi.fn();
    const b = button(press, click);
    act(() => b.props.onPointerDown({ button: 0, ctrlKey: false }));
    expect(press).toHaveBeenCalledOnce();
    act(() => b.props.onClick({ detail: 1 }));
    expect(click).not.toHaveBeenCalled();
  });

  it('a keyboard click still fires after a press that was dragged away (no click arrived)', () => {
    const press = vi.fn();
    const click = vi.fn();
    const b = button(press, click);
    act(() => b.props.onPointerDown({ button: 0, ctrlKey: false })); // 누른 채 밖으로 끌어 뗐다 — 클릭이 오지 않는다
    act(() => b.props.onClick({ detail: 0 })); // Space · Enter
    expect(click).toHaveBeenCalledOnce();
  });

  it('ignores secondary buttons and Ctrl-held presses (mac context click) — the click path stays as before', () => {
    const press = vi.fn();
    const click = vi.fn();
    const b = button(press, click);
    act(() => b.props.onPointerDown({ button: 2, ctrlKey: false }));
    act(() => b.props.onPointerDown({ button: 0, ctrlKey: true }));
    expect(press).not.toHaveBeenCalled();
    act(() => b.props.onClick({ detail: 1 }));
    expect(click).toHaveBeenCalledOnce();
  });
});
