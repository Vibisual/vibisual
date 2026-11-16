import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorNumber } from './InspectorFields.js';

vi.mock('../Creation/ColorField.js', () => ({ ColorField: () => null }));
const mounted: ReactTestRenderer[] = [];
afterEach(() => { act(() => mounted.splice(0).forEach((r) => r.unmount())); });

function field(value: number) {
  const onCommit = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(createElement(InspectorNumber, { label: 'Width', caption: 'W', value, onCommit })); });
  mounted.push(renderer);
  const input = () => renderer.root.findByType('input');
  return {
    onCommit,
    focus: () => act(() => input().props.onFocus({ currentTarget: { select: vi.fn() } })),
    type: (text: string) => act(() => input().props.onChange({ target: { value: text } })),
    blur: () => act(() => input().props.onBlur()),
    // 실제 브라우저처럼 blur 가 다시 그리기 전에 같은 render 의 핸들러로 돈다.
    key: (key: string, extra: Record<string, unknown> = {}) => act(() => {
      const onBlur = input().props.onBlur as () => void;
      input().props.onKeyDown({ key, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: { blur: onBlur }, ...extra });
    }),
  };
}

describe('InspectorNumber (§5.13 (R-9) 레이어 편집기 ⑤)', () => {
  it('Enter commits the typed value once', () => {
    const f = field(100);
    f.focus(); f.type('250'); f.key('Enter');
    expect(f.onCommit).toHaveBeenCalledExactlyOnceWith(250);
  });
  it('Escape throws the typed value away even though blur runs before the next render', () => {
    const f = field(100);
    f.focus(); f.type('500'); f.key('Escape');
    expect(f.onCommit).not.toHaveBeenCalled();
  });
  it('focusing and leaving a rounded value does not rewrite it', () => {
    const f = field(412.7384);
    f.focus(); f.blur();
    expect(f.onCommit).not.toHaveBeenCalled();
  });
  it('arrow keys step by 1 and by 10 with Shift', () => {
    const f = field(10);
    f.focus(); f.key('ArrowUp'); f.key('ArrowDown', { shiftKey: true });
    expect(f.onCommit).toHaveBeenNthCalledWith(1, 11);
    expect(f.onCommit).toHaveBeenNthCalledWith(2, 1);
  });
});
