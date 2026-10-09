import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundNumberField } from './SoundNumberField.js';

vi.mock('react-i18next', () => {
  const t = (key: string): string => key;
  return { useTranslation: () => ({ t }) };
});
interface InputEvents {
  value: string;
  onFocus(): void;
  onBlur(): void;
  onChange(event: { target: { value: string } }): void;
  onKeyDown(event: { key: string; currentTarget: { blur(): void } }): void;
}
let view: ReactTestRenderer | undefined;
const commit = vi.fn<(value: number, version: number) => void>();
function render(value = 10, version = 1): void {
  act(() => {
    const element = <SoundNumberField label="Position" value={value} version={version} min={0} max={100} onCommit={commit} />;
    if (view) view.update(element); else view = create(element);
  });
}
function input(): InputEvents { return view!.root.findByType('input').props as InputEvents; }
function change(value: string): void { act(() => input().onChange({ target: { value } })); }
function focus(): void { act(() => input().onFocus()); }
function blur(): void { act(() => input().onBlur()); }
beforeEach(() => commit.mockReset());
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('audio number-field draft protection', () => {
  it('preserves in-progress typing across an external edit and rejects the stale commit', () => {
    render(); focus(); change('12'); render(20, 2);
    expect(input().value).toBe('12');
    blur();
    expect(commit).not.toHaveBeenCalled();
    expect(input().value).toBe('20');
    expect(view?.root.findByProps({ role: 'alert' }).children).toContain('panel.vibisound.workbench.reloadedDraft');
    focus(); change('21'); blur();
    expect(commit).toHaveBeenCalledWith(21, 2);
  });

  it('commits valid edits against the version captured on focus', () => {
    render(10, 7); focus(); change('12.25'); blur();
    expect(commit).toHaveBeenCalledExactlyOnceWith(12.25, 7);
  });

  it('updates unfocused values immediately and discards unchanged stale drafts harmlessly', () => {
    render(); render(20, 2); expect(input().value).toBe('20');
    focus(); render(30, 3); blur();
    expect(input().value).toBe('30');
    expect(commit).not.toHaveBeenCalled();
    expect(view?.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });

  it.each(['', ' ', 'NaN', 'Infinity', '-1', '101'])('rejects invalid numeric input %j', (value) => {
    render(); focus(); change(value); blur();
    expect(commit).not.toHaveBeenCalled();
    expect(input().value).toBe('10');
    expect(view?.root.findByProps({ role: 'alert' }).children).toContain('panel.vibisound.workbench.invalidNumber');
  });

  it('Escape cancels the pending edit without committing when focus later leaves', () => {
    render(); focus(); change('15');
    act(() => input().onKeyDown({ key: 'Escape', currentTarget: { blur: () => undefined } }));
    expect(input().value).toBe('10'); blur();
    expect(commit).not.toHaveBeenCalled();
  });

  it('Enter commits through the same blur path', () => {
    render(); focus(); change('15');
    const leave = vi.fn(() => input().onBlur());
    act(() => input().onKeyDown({ key: 'Enter', currentTarget: { blur: leave } }));
    expect(leave).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledExactlyOnceWith(15, 1);
  });
});
