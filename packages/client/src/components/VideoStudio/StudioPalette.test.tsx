import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string, vars?: Record<string, unknown>): string => (vars ? `${key}|${JSON.stringify(vars)}` : key);
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: React.ReactNode }) => children }));

import { recordedContext } from './studioCommandFixtures.js';
import type { StudioCommandContext, StudioKeyActions, StudioPaletteState } from './studioCommandTypes.js';
import { StudioPalette, type StudioPaletteProps } from './StudioPalette.js';
import { useStudioPalette, type StudioPaletteHost } from './useStudioPalette.js';

let view: ReactTestRenderer | undefined;
let props: StudioPaletteProps;
let log: string[];

function mount(actions: Partial<StudioKeyActions> = {}, palette: Partial<StudioPaletteState> = {}, recent: readonly string[] = []): void {
  log = [];
  props = { context: recordedContext(log, actions, palette), recent, onRun: vi.fn(), onClose: vi.fn() };
  act(() => { view = create(createElement(StudioPalette, props)); });
}
afterEach(() => { act(() => { view?.unmount(); }); view = undefined; });

const root = (): ReactTestInstance => (view as ReactTestRenderer).root;
const textOf = (n: ReactTestInstance | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''));
const input = (): ReactTestInstance => root().findByType('input');
const options = (): ReactTestInstance[] => root().findAll((n) => n.type === 'li' && n.props.role === 'option');
/** 줄의 이름(첫 글자 덩이 — 시험의 `t` 는 키를 그대로 돌려준다). */
const names = (): string[] => options().map((o) => textOf(o.findAll((n) => n.type === 'span' && String(n.props.className).includes('font-medium'))[0] as ReactTestInstance));
const activeName = (): string | undefined => names()[options().findIndex((o) => o.props['aria-selected'] === true)];

interface Pressed { readonly stopPropagation: ReturnType<typeof vi.fn>; readonly preventDefault: ReturnType<typeof vi.fn> }
function press(key: string, init: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; composing?: boolean } = {}): Pressed {
  const event = {
    key, ctrlKey: init.ctrl === true, metaKey: init.meta === true, shiftKey: init.shift === true, altKey: init.alt === true,
    nativeEvent: { isComposing: init.composing === true }, stopPropagation: vi.fn(), preventDefault: vi.fn(),
  };
  act(() => { input().props.onKeyDown(event); });
  return event;
}
const type = (value: string): void => { act(() => { input().props.onChange({ target: { value } }); }); };

const P = 'panel.videoStudio';

describe('명령 팔레트 — 열림', () => {
  it('묶음 머리글 아래 명령이 서고 첫 실행 가능한 줄이 골라져 있다', () => {
    mount();
    expect(names()[0]).toBe(`${P}.play`);
    expect(activeName()).toBe(`${P}.play`);
    const text = textOf(root());
    for (const group of ['playback', 'edit', 'mode', 'view', 'panel', 'doc', 'export']) expect(text, group).toContain(`${P}.palette.group.${group}`);
    expect(names()).not.toContain(`${P}.palette.title`);
  });

  it('최근 쓴 명령은 최근 머리글 아래 맨 위에 선다', () => {
    mount({}, {}, ['srt']);
    expect(names()[0]).toBe(`${P}.export.srt`);
    expect(textOf(root())).toContain(`${P}.header.recent`);
  });

  it('발치 안내의 키는 번역문이 아니라 보간 자리로 들어간다', () => {
    mount();
    const footer = textOf(root().findByType('p'));
    expect(footer.startsWith(`${P}.palette.footer|`)).toBe(true);
    const vars = JSON.parse(footer.slice(footer.indexOf('|') + 1)) as Record<string, string>;
    expect(Object.keys(vars).sort()).toEqual(['close', 'move', 'run']);
    expect(Object.values(vars).every((v) => v.length > 0)).toBe(true);
  });

  it('흐린 줄은 누를 수 없다고 알리고 처음 고르는 줄에서 빠진다', () => {
    mount({ hasMedia: false });
    const first = options()[0] as ReactTestInstance;
    expect(first.props['aria-disabled']).toBe(true);
    expect(first.props.onClick).toBeUndefined();
    expect(activeName()).toBe(`${P}.preview.prevFrame`);
  });
});

describe('명령 팔레트 — 검색과 실행', () => {
  it('검색어로 줄을 거르고 Enter 로 고른 줄을 실행한다', () => {
    mount();
    type('editor.undo');
    expect(names()).toEqual([`${P}.editor.undo`]);
    const pressed = press('Enter');
    expect(props.onRun).toHaveBeenCalledWith('undo');
    expect(pressed.preventDefault).toHaveBeenCalled();
  });

  it('화살표로 옮겨 고른 줄을 실행하고 흐린 줄은 건너뛴다', () => {
    mount({ disabled: true });
    type('editor.');
    expect(names()).toEqual([`${P}.editor.undo`, `${P}.editor.redo`, `${P}.editor.duplicate`, `${P}.editor.split`, `${P}.editor.loop`]);
    expect(activeName()).toBe(`${P}.editor.loop`);
    press('ArrowUp');
    expect(activeName()).toBe(`${P}.editor.loop`);
    press('Enter');
    expect(props.onRun).toHaveBeenCalledWith('toggleLoop');
  });

  it('줄을 누르면 실행하고, 누르는 순간 검색 칸의 초점을 뺏지 않는다', () => {
    mount();
    const second = options()[1] as ReactTestInstance;
    const down = { preventDefault: vi.fn() };
    act(() => { second.props.onMouseDown(down); second.props.onClick(); });
    expect(down.preventDefault).toHaveBeenCalled();
    expect(props.onRun).toHaveBeenCalledWith('stepBack');
  });

  it('맞는 것이 없으면 그 검색어를 넣은 안내를 보인다', () => {
    mount();
    type('zzzz');
    expect(options()).toHaveLength(0);
    expect(textOf(root())).toContain(`${P}.palette.empty|{"query":"zzzz"}`);
    press('Enter');
    expect(props.onRun).not.toHaveBeenCalled();
  });
});

describe('명령 팔레트 — 키는 여기서 끝난다', () => {
  it('어떤 키도 스튜디오 뿌리로 흘려보내지 않는다 — 열린 동안 스튜디오 단축키는 쉰다', () => {
    mount();
    for (const key of [' ', 's', 'Backspace', 'ArrowLeft', 'Enter', 'Escape', 'a']) expect(press(key).stopPropagation, key).toHaveBeenCalled();
    expect(press('z', { ctrl: true }).stopPropagation).toHaveBeenCalled();
  });

  it('글자 키는 가로채지 않는다 — 검색 칸에 그대로 쳐진다', () => {
    mount();
    for (const key of ['s', ' ', 'k', 'Backspace']) expect(press(key).preventDefault, key).not.toHaveBeenCalled();
  });

  it('Esc 로 닫는다', () => {
    mount();
    press('Escape');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('여는 키를 다시 누르면 닫힌다 — Ctrl 로도 Cmd 로도', () => {
    mount();
    expect(press('k', { ctrl: true }).preventDefault).toHaveBeenCalled();
    press('k', { meta: true });
    expect(props.onClose).toHaveBeenCalledTimes(2);
    press('k', { ctrl: true, shift: true });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('Tab 으로 초점이 판 밖으로 나가지 않는다', () => {
    mount();
    expect(press('Tab').preventDefault).toHaveBeenCalled();
  });
});

describe('명령 팔레트 — 한글 조합 중', () => {
  it('조합을 확정하는 Enter 가 명령을 실행하지 않는다', () => {
    mount();
    type('editor.undo');
    act(() => { input().props.onCompositionStart(); });
    expect(press('Enter').preventDefault).not.toHaveBeenCalled();
    expect(press('Enter', { composing: true }).preventDefault).not.toHaveBeenCalled();
    expect(props.onRun).not.toHaveBeenCalled();
    act(() => { input().props.onCompositionEnd(); });
    press('Enter');
    expect(props.onRun).toHaveBeenCalledWith('undo');
  });

  it('조합 중에는 화살표·Esc·여는 키도 가로채지 않는다', () => {
    mount();
    const before = activeName();
    for (const [key, init] of [['ArrowDown', {}], ['Escape', {}], ['k', { ctrl: true }]] as const) {
      expect(press(key, { ...init, composing: true }).preventDefault, key).not.toHaveBeenCalled();
    }
    expect(activeName()).toBe(before);
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe('명령 팔레트 — 2단계 고르기', () => {
  const enterStep = (query: string): void => { type(query); press('Enter'); };

  it('고를 것이 있는 명령은 실행하지 않고 그 목록으로 넘어간다', () => {
    mount({}, { format: 'portrait' });
    enterStep('header.format');
    expect(props.onRun).not.toHaveBeenCalled();
    expect(names()).toEqual([`${P}.formats.landscape`, `${P}.formats.portrait`, `${P}.formats.square`]);
    expect(input().props.value).toBe('');
    expect(textOf(options()[1] as ReactTestInstance)).toContain(`${P}.palette.current`);
    press('ArrowDown');
    press('Enter');
    expect(props.onRun).toHaveBeenCalledWith('format', 'portrait');
  });

  it('2단계의 검색 칸은 그 목록을 거른다', () => {
    mount();
    enterStep('palette.name.openDoc');
    expect(log).toEqual(['refreshDocs']);
    expect(names()).toEqual(['가을 여행', 'alpha outro', 'Alpha Intro']);
    type('alpha');
    expect(names()).toEqual(['alpha outro', 'Alpha Intro']);
    press('Enter');
    expect(props.onRun).toHaveBeenCalledWith('openDoc', 'c');
  });

  it('Esc 는 닫지 않고 1단계로 돌아간다', () => {
    mount();
    enterStep('header.format');
    press('Escape');
    expect(props.onClose).not.toHaveBeenCalled();
    expect(names()).toContain(`${P}.play`);
    press('Escape');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('빈 칸의 Backspace 와 [뒤로] 가 1단계로 돌아간다', () => {
    mount();
    enterStep('header.format');
    type('land');
    expect(press('Backspace').preventDefault).not.toHaveBeenCalled();
    expect(names()).toEqual([`${P}.formats.landscape`]);
    type('');
    press('Backspace');
    expect(names()).toContain(`${P}.play`);
    enterStep('header.format');
    const back = root().findByType('button');
    expect(back.props['aria-label']).toBe(`${P}.palette.back`);
    act(() => { back.props.onClick(); });
    expect(names()).toContain(`${P}.play`);
  });
});

describe('명령 팔레트 — 열림 상태와 실행(useStudioPalette)', () => {
  let host: StudioPaletteHost;
  const Probe = (): null => { host = useStudioPalette(); return null; };
  const mountHost = (): void => { act(() => { view = create(createElement(Probe)); }); };
  const run = (context: StudioCommandContext, id: string, arg?: string): void => { act(() => { host.run(context, id, arg); }); };

  it('실행하면 닫히고, 키로 부를 때와 같은 동작이 불리며 최근 목록에 오른다', () => {
    mountHost();
    const calls: string[] = [];
    act(() => { host.openPalette(); });
    expect(host.open).toBe(true);
    run(recordedContext(calls), 'undo');
    expect([calls, host.open, host.recent]).toEqual([['undo'], false, ['undo']]);
    run(recordedContext(calls), 'format', 'square');
    expect([calls, host.recent]).toEqual([['undo', 'setFormat(square)'], ['format', 'undo']]);
  });

  it('실행 조건이 거짓인 명령은 닫기만 하고 실행하지 않는다', () => {
    mountHost();
    const calls: string[] = [];
    act(() => { host.openPalette(); });
    run(recordedContext(calls, { disabled: true }), 'undo');
    run(recordedContext(calls), 'no-such-command');
    expect([calls, host.open, host.recent]).toEqual([[], false, []]);
  });

  it('닫기는 열림만 바꾼다', () => {
    mountHost();
    act(() => { host.openPalette(); });
    act(() => { host.close(); });
    expect(host.open).toBe(false);
  });
});
