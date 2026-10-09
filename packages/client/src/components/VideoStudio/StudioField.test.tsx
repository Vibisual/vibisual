import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioNumberField, StudioTextField } from './StudioField.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }) }));
let view: ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; });
function input() { return view!.root.findByType('input'); }
function change(value: string): void { act(() => input().props.onChange({ target: { value } })); }
function key(key: string, extra = {}): void {
  act(() => input().props.onKeyDown({ key, stopPropagation: vi.fn(), preventDefault: vi.fn(), nativeEvent: {}, ...extra }));
}

describe('Studio fields', () => {
  it('commits a number on blur and only once when Enter is followed by blur', () => {
    const onCommit = vi.fn();
    act(() => { view = create(createElement(StudioNumberField, { label: 'Start', value: 1, onCommit })); });
    change('2.75');
    expect(onCommit).not.toHaveBeenCalled();
    key('Enter');
    act(() => input().props.onBlur());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2.75);
    change('3.5');
    act(() => input().props.onBlur());
    expect(onCommit).toHaveBeenLastCalledWith(3.5);
  });

  it.each(['', ' ', '-', 'NaN', 'Infinity', 'abc', '-1', '101'])('rejects invalid or out-of-range number %j', (value) => {
    const onCommit = vi.fn();
    act(() => { view = create(createElement(StudioNumberField, { label: 'Opacity', value: 1, min: 0, max: 100, onCommit })); });
    change(value);
    act(() => input().props.onBlur());
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().props['aria-invalid']).toBe(true);
    expect(view!.root.findByProps({ role: 'alert' })).toBeTruthy();
    key('Escape');
    expect(input().props.value).toBe('1');
    expect(input().props['aria-invalid']).toBeUndefined();
  });

  it('rejects fractional integers and permits correction after an error', () => {
    const onCommit = vi.fn();
    act(() => { view = create(createElement(StudioNumberField, { label: 'Width', value: 50, integer: true, onCommit })); });
    change('12.5'); key('Enter');
    expect(onCommit).not.toHaveBeenCalled();
    change('12'); key('Enter');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('reverts text with Escape and syncs an external document edit', () => {
    const onCommit = vi.fn();
    act(() => { view = create(createElement(StudioTextField, { label: 'Title', value: 'Original', onCommit })); });
    change('Draft'); key('Escape');
    act(() => input().props.onBlur());
    expect(input().props.value).toBe('Original');
    expect(onCommit).not.toHaveBeenCalled();
    act(() => view!.update(createElement(StudioTextField, { label: 'Title', value: 'Remote edit', onCommit })));
    expect(input().props.value).toBe('Remote edit');
  });

  it('shows the authoritative value until the host accepts a submitted edit', () => {
    const onCommit = vi.fn();
    act(() => { view = create(createElement(StudioTextField, { label: 'Title', value: 'Saved', onCommit })); });
    change('Rejected draft'); key('Enter');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('Rejected draft');
    expect(input().props.value).toBe('Saved');
    act(() => view!.update(createElement(StudioTextField, { label: 'Title', value: 'Accepted', onCommit })));
    expect(input().props.value).toBe('Accepted');
  });

  it('never commits a disabled field or unfinished IME composition', () => {
    const onCommit = vi.fn();
    act(() => { view = create(createElement(StudioTextField, { label: 'Title', value: 'Original', onCommit })); });
    change('Draft'); key('Enter', { nativeEvent: { isComposing: true } });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => view!.update(createElement(StudioTextField, { label: 'Title', value: 'Original', disabled: true, onCommit })));
    act(() => input().props.onBlur());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps multiline Enter for line breaks and commits with Ctrl or Meta Enter', () => {
    const onCommit = vi.fn();
    act(() => { view = create(createElement(StudioTextField, { label: 'Code', value: 'one', multiline: true, onCommit })); });
    act(() => view!.root.findByType('textarea').props.onChange({ target: { value: 'one\ntwo' } }));
    const event = { key: 'Enter', stopPropagation: vi.fn(), preventDefault: vi.fn(), nativeEvent: {} };
    act(() => view!.root.findByType('textarea').props.onKeyDown(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    act(() => view!.root.findByType('textarea').props.onKeyDown({ ...event, metaKey: true }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('one\ntwo');
  });
});
