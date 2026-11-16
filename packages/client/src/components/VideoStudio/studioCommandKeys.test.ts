import { describe, expect, it } from 'vitest';

import { formatShortcut } from '../../utils/platform.js';
import { fakeTarget, keyEvent, recordedActions, recordedContext, type FakeKeyEvent, type FakeKeyInit } from './studioCommandFixtures.js';
import { dispatchStudioKey, findStudioKeyCommand, isCommandKey } from './studioCommandKeys.js';
import { STUDIO_COMMANDS, commandCombo, studioCommand } from './studioCommands.js';
import type { StudioCommand, StudioKeyActions, StudioKeyBinding } from './studioCommandTypes.js';
import { paletteRows, type PaletteLabels } from './studioPaletteModel.js';

/**
 * §5.13 37-22 (B) — 등록부로 옮기기 전의 판정문(대조본). 고치지 않는다: 등록부가 이 판정과 같은 키에 같은 동작·같은 삼킴을 내는지 견준다.
 */
function legacyStudioKeys(a: StudioKeyActions, event: FakeKeyEvent): void {
  if (event.defaultPrevented || event.nativeEvent.isComposing) return;
  if ((event.target as ReturnType<typeof fakeTarget>).closest('input,textarea,select,[contenteditable="true"]')) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const take = (fn: () => void): void => { event.preventDefault(); fn(); };
  if (key === 'escape') { if (a.escape()) event.preventDefault(); return; }
  if (mod && key === 'z' && !a.disabled) return take(event.shiftKey ? a.redo : a.undo);
  if (mod && key === 'y' && !a.disabled) return take(a.redo);
  if (mod && key === 'd' && !a.disabled) return take(a.duplicate);
  if (mod || event.altKey) return;
  if ((key === 'delete' || key === 'backspace') && !a.disabled) return take(a.remove);
  if (key === 's' && !a.disabled && a.canSplit) return take(a.split);
  if (key === ' ' && a.hasMedia) return take(a.togglePlay);
  if (key === 'arrowleft' || key === 'arrowright') return take(() => a.step((key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 10 : 1)));
  if (key === 'l') return take(a.toggleLoop);
  if (key === 'g') return take(a.toggleSafe);
  if (key === 'f') return take(a.toggleZoom);
  if (key === 'p') return take(() => a.setInteraction('point'));
  if (key === 'n') return take(() => a.setInteraction('note'));
  if (key === 'm' && a.toggleMute) return take(a.toggleMute);
}

const KEYS = ['Escape', 'z', 'Z', 'y', 'd', 'Delete', 'Backspace', 's', 'S', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'l', 'g', 'f', 'p', 'n', 'm', 'k', 'K', 'a', 'Enter', 'Tab', '1'];
const BOOLS = [false, true];

const MODS: FakeKeyInit[] = BOOLS.flatMap((ctrl) => BOOLS.flatMap((meta) => BOOLS.flatMap((shift) => BOOLS.map((alt) => ({ ctrl, meta, shift, alt })))));

interface Flags { readonly disabled: boolean; readonly hasMedia: boolean; readonly canSplit: boolean; readonly mute: boolean; readonly escapes: boolean }
const FLAGS: Flags[] = BOOLS.flatMap((disabled) => BOOLS.flatMap((hasMedia) => BOOLS.flatMap((canSplit) => BOOLS.flatMap((mute) => BOOLS.map((escapes) => (
  { disabled, hasMedia, canSplit, mute, escapes }))))));

/** 그 조건의 동작 묶음. `fresh` = 옮긴 뒤 더해진 동작(옮기기·팔레트 열기·건너뛰기·전체 화면)을 공급한다. */
function actionsFor(log: string[], f: Flags, fresh: boolean): StudioKeyActions {
  return recordedActions(log, {
    disabled: f.disabled, hasMedia: f.hasMedia, canSplit: f.canSplit,
    escape: () => { log.push('escape'); return f.escapes; },
    ...(f.mute ? {} : { toggleMute: undefined }),
    ...(fresh ? {} : { nudge: undefined, openPalette: undefined, skip: undefined, toggleFullscreen: undefined }),
  });
}

const describeCase = (key: string, m: FakeKeyInit, f: Flags): string => `${JSON.stringify(key)} ${JSON.stringify(m)} ${JSON.stringify(f)}`;

describe('명령 등록부 — 옮기기 전 판정과 같다', () => {
  it('새 동작을 공급하지 않으면 키 × 수식키 × 조건 전 조합에서 동작과 삼킴이 같다', () => {
    const diffs: string[] = [];
    for (const f of FLAGS) for (const key of KEYS) for (const m of MODS) {
      const before: string[] = []; const after: string[] = [];
      const old = keyEvent(key, m); const now = keyEvent(key, m);
      legacyStudioKeys(actionsFor(before, f, false), old);
      dispatchStudioKey(now, actionsFor(after, f, false));
      if (before.join() !== after.join() || old.swallowed !== now.swallowed) {
        diffs.push(`${describeCase(key, m, f)} — 전: [${before.join()}] ${old.swallowed} · 후: [${after.join()}] ${now.swallowed}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it('새 키(옮기기·팔레트·전체 화면)는 예전에 아무 일도 없던 키에만 선다 — 바뀐 것은 맨 방향키(프레임 → 건너뛰기, 37-24 (C)) 하나다', () => {
    const diffs: string[] = [];
    let fresh = 0;
    let skips = 0;
    for (const f of FLAGS) for (const key of KEYS) for (const m of MODS) {
      const before: string[] = []; const after: string[] = [];
      const old = keyEvent(key, m); const now = keyEvent(key, m);
      legacyStudioKeys(actionsFor(before, f, false), old);
      dispatchStudioKey(now, actionsFor(after, f, true));
      const same = before.join() === after.join() && old.swallowed === now.swallowed;
      const onlyNew = before.length === 0 && !old.swallowed && after.length === 1 && /^(nudge\(|openPalette$|toggleFullscreen$)/.test(after[0] ?? '');
      if (onlyNew) fresh += 1;
      // 맨 ←/→ — 한 프레임 옮기던 자리에 같은 방향의 건너뛰기가 선다(삼킴은 그대로).
      const skipped = !m.shift && old.swallowed && now.swallowed && before.length === 1 && after.length === 1
        && ((before[0] === 'step(-1)' && after[0] === 'skip(-1)') || (before[0] === 'step(1)' && after[0] === 'skip(1)'));
      if (skipped) skips += 1;
      if (!same && !onlyNew && !skipped) diffs.push(`${describeCase(key, m, f)} — 전: [${before.join()}] · 후: [${after.join()}]`);
    }
    expect(diffs).toEqual([]);
    expect(fresh).toBeGreaterThan(0);
    expect(skips).toBeGreaterThan(0);
  });
});

describe('명령 등록부 — 공통 문턱', () => {
  const tryKey = (key: string, init: FakeKeyInit, over: Partial<StudioKeyActions> = {}): { log: string[]; event: FakeKeyEvent; ran: boolean } => {
    const log: string[] = [];
    const event = keyEvent(key, init);
    const ran = dispatchStudioKey(event, recordedActions(log, over));
    return { log, event, ran };
  };
  /** 문턱이 없으면 저마다 동작하는 키들 — 맨 키 · 수식키 조합 · Esc · 팔레트 여는 키. */
  const LIVE: ReadonlyArray<readonly [string, FakeKeyInit]> = [[' ', {}], ['s', {}], ['Backspace', {}], ['z', { ctrl: true }], ['ArrowLeft', { meta: true }], ['Escape', {}], ['k', { ctrl: true }], ['k', { meta: true }]];

  it('문턱이 없으면 그 키들은 모두 동작한다 — 아래 검사가 공짜로 통과하지 않는다', () => {
    for (const [key, init] of LIVE) expect(tryKey(key, init).log, `${key} ${JSON.stringify(init)}`).toHaveLength(1);
  });

  it.each(['input', 'textarea', 'select', '[contenteditable="true"]'])('입력 중(%s)에는 어떤 키도 먹지 않는다', (within) => {
    for (const [key, init] of LIVE) {
      const r = tryKey(key, { ...init, within });
      expect([r.log, r.event.swallowed, r.ran], `${key} ${JSON.stringify(init)}`).toEqual([[], false, false]);
    }
  });

  /** 그 종류의 `input` 에 초점이 있는 듯 답하는 흉내 대상. */
  const inputTarget = (type: string) => ({ closest: (selector: string) => (selector === 'input' ? { type } : null) });
  const pressOn = (key: string, type: string): { log: string[]; swallowed: boolean } => {
    const log: string[] = [];
    const event = { ...keyEvent(key), target: inputTarget(type), swallowed: false };
    event.preventDefault = () => { event.swallowed = true; };
    dispatchStudioKey(event, recordedActions(log));
    return { log, swallowed: event.swallowed };
  };

  it.each(['range', 'checkbox', 'radio', 'button', 'color', 'file'])('글자 없는 입력(%s)에 초점이 있어도 재생 키는 먹고 삼킨다 (37-24 (D-3))', (type) => {
    expect(pressOn(' ', type)).toEqual({ log: ['togglePlay'], swallowed: true });
  });

  it.each(['text', 'number', 'search', ''])('글자 칸(%j)에서는 먹지 않는다', (type) => {
    expect(pressOn(' ', type)).toEqual({ log: [], swallowed: false });
  });

  it('슬라이더·라디오의 값 키는 그 컨트롤 몫이고, 체크 칸에서는 방향키가 먹는다', () => {
    for (const type of ['range', 'radio']) for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) expect(pressOn(key, type), `${type} ${key}`).toEqual({ log: [], swallowed: false });
    expect(pressOn('ArrowLeft', 'checkbox').log).toHaveLength(1);
  });

  it('한글 조합 중에는 어떤 키도 먹지 않는다 — 조합을 확정하는 키가 명령을 부르지 않는다', () => {
    for (const [key, init] of LIVE) {
      const r = tryKey(key, { ...init, composing: true });
      expect([r.log, r.event.swallowed, r.ran], `${key} ${JSON.stringify(init)}`).toEqual([[], false, false]);
    }
  });

  it('이미 처리된 키는 건드리지 않는다 — 앱 단축키 표가 먼저 가져간 키', () => {
    for (const [key, init] of LIVE) {
      const r = tryKey(key, { ...init, defaultPrevented: true });
      expect([r.log, r.ran], `${key} ${JSON.stringify(init)}`).toEqual([[], false]);
    }
  });

  it('팔레트가 열려 있는 동안 스튜디오 단축키는 하나도 먹지 않는다', () => {
    for (const [key, init] of LIVE) {
      const r = tryKey(key, init, { paletteOpen: true });
      expect([r.log, r.event.swallowed, r.ran], `${key} ${JSON.stringify(init)}`).toEqual([[], false, false]);
    }
  });

  it('한 일이 없는 명령은 키를 삼키지 않는다 — 닫을 것 없는 Esc · 옮길 것 없는 방향키', () => {
    const esc = tryKey('Escape', {}, { escape: () => false });
    expect([esc.ran, esc.event.swallowed]).toEqual([true, false]);
    const arrow = tryKey('ArrowUp', { ctrl: true }, { nudge: () => false });
    expect([arrow.ran, arrow.event.swallowed]).toEqual([true, false]);
  });
});

describe('명령 등록부 — 팔레트 여는 키', () => {
  const open = (key: string, init: FakeKeyInit, over: Partial<StudioKeyActions> = {}): { log: string[]; swallowed: boolean } => {
    const log: string[] = [];
    const event = keyEvent(key, init);
    dispatchStudioKey(event, recordedActions(log, over));
    return { log, swallowed: event.swallowed };
  };

  it('Ctrl 로도 Cmd 로도 열린다 — 판정은 ctrlKey || metaKey', () => {
    expect(open('k', { ctrl: true })).toEqual({ log: ['openPalette'], swallowed: true });
    expect(open('k', { meta: true })).toEqual({ log: ['openPalette'], swallowed: true });
    expect(open('K', { ctrl: true })).toEqual({ log: ['openPalette'], swallowed: true });
  });

  it('Shift·Alt 가 함께 눌렸거나 수식키가 없으면 열리지 않는다', () => {
    for (const init of [{}, { shift: true }, { alt: true }, { ctrl: true, shift: true }, { ctrl: true, alt: true }, { meta: true, shift: true }, { meta: true, alt: true }]) {
      expect(open('k', init).log, JSON.stringify(init)).toEqual([]);
    }
  });

  it('여는 동작을 받지 못한 자리에서는 키를 삼키지 않는다', () => {
    expect(open('k', { ctrl: true }, { openPalette: undefined })).toEqual({ log: [], swallowed: false });
  });

  it('열린 팔레트가 제 여는 키를 알아본다(닫기) — 조건·문턱 없이 키만 본다', () => {
    const palette = studioCommand('palette');
    expect(isCommandKey(keyEvent('k', { ctrl: true }), palette)).toBe(true);
    expect(isCommandKey(keyEvent('K', { meta: true }), palette)).toBe(true);
    expect(isCommandKey(keyEvent('k', {}), palette)).toBe(false);
    expect(isCommandKey(keyEvent('k', { ctrl: true, shift: true }), palette)).toBe(false);
    expect(isCommandKey(keyEvent('k', { ctrl: true }), undefined)).toBe(false);
  });

  it('표기는 플랫폼을 따른다 — 맥은 기호, 그 밖은 Ctrl', () => {
    const combo = commandCombo(studioCommand('palette') as StudioCommand);
    expect(combo).toBe('Ctrl+K');
    expect(formatShortcut(combo as string, true)).toBe('⌘K');
    expect(formatShortcut(combo as string, false)).toBe('Ctrl+K');
  });
});

/** 표기(`Ctrl+Shift+Z`)를 그 키 사건으로. 표기와 판정이 따로 놀지 않는지 볼 때 쓴다. */
const COMBO_KEY: Readonly<Record<string, string>> = { esc: 'escape', space: ' ', left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown' };
function eventOfCombo(combo: string, modifier: 'ctrl' | 'meta'): FakeKeyEvent {
  const tokens = combo.split('+').map((x) => x.toLowerCase());
  const last = tokens[tokens.length - 1] ?? '';
  const mods = tokens.slice(0, -1);
  const held = mods.includes('ctrl');
  return keyEvent(COMBO_KEY[last] ?? last, { ctrl: held && modifier === 'ctrl', meta: held && modifier === 'meta', shift: mods.includes('shift'), alt: mods.includes('alt') });
}
const eventOfBinding = (b: StudioKeyBinding): FakeKeyEvent => keyEvent(b.key, { ctrl: b.mod === true, shift: b.shift === true, alt: b.alt === true });

const BINDINGS: ReadonlyArray<{ readonly id: string; readonly binding: StudioKeyBinding }> = STUDIO_COMMANDS
  .flatMap((command) => (command.keys ?? []).map((binding) => ({ id: command.id, binding })));

describe('명령 등록부 — 표 한 장', () => {
  it('명령 id 가 겹치지 않는다', () => {
    const ids = STUDIO_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('키는 소문자로 적는다 — 판정이 event.key 를 소문자로 접어 견준다', () => {
    expect(BINDINGS.filter(({ binding }) => binding.key !== binding.key.toLowerCase()).map(({ id }) => id)).toEqual([]);
  });

  it('같은 키 조합을 두 줄이 다투지 않는다', () => {
    const open = (x: boolean | undefined, y: boolean | undefined): boolean => x === undefined || y === undefined || x === y;
    const clashes: string[] = [];
    BINDINGS.forEach((a, i) => BINDINGS.slice(i + 1).forEach((b) => {
      if (a.binding.key === b.binding.key && open(a.binding.mod, b.binding.mod) && open(a.binding.shift, b.binding.shift) && open(a.binding.alt, b.binding.alt)) {
        clashes.push(`${a.id} ↔ ${b.id} (${a.binding.key})`);
      }
    }));
    expect(clashes).toEqual([]);
  });

  it('보이는 표기 그대로 누르면 그 명령이 불린다 — Ctrl 로도 Cmd 로도', () => {
    const labeled = BINDINGS.filter(({ binding }) => binding.combo !== undefined);
    expect(labeled.length).toBeGreaterThan(15);
    for (const { id, binding } of labeled) for (const modifier of ['ctrl', 'meta'] as const) {
      const hit = findStudioKeyCommand(eventOfCombo(binding.combo as string, modifier), recordedActions([]));
      expect([hit?.command.id, hit?.binding], `${binding.combo} (${modifier})`).toEqual([id, binding]);
    }
  });
});

describe('명령 등록부 — 키 판정과 팔레트가 같은 표를 읽는다', () => {
  const LABELS: PaletteLabels = { t: (key) => key, tEn: (key) => key, shortcut: (combo) => combo };

  it('팔레트의 줄은 등록부의 줄 그대로다 — 순서 · 단축키 표기', () => {
    const rows = paletteRows(recordedContext([]), LABELS);
    const shown = STUDIO_COMMANDS.filter((c) => c.id !== 'palette');
    expect(rows.map((r) => r.id)).toEqual(shown.map((c) => c.id));
    for (const row of rows) {
      const command = studioCommand(row.id) as StudioCommand;
      expect([row.order, row.combo, row.detail], row.id).toEqual([STUDIO_COMMANDS.indexOf(command), commandCombo(command), command.detail]);
    }
  });

  it('팔레트에서 흐린 줄은 키로도 먹지 않고, 서 있는 줄은 키로도 먹는다 — 실행 조건이 한 벌이다', () => {
    const checked: string[] = [];
    for (const f of FLAGS) {
      const context = { ...recordedContext([]), ...actionsFor([], f, true) };
      const rows = new Map(paletteRows(context, LABELS).map((r) => [r.id, r]));
      for (const { id, binding } of BINDINGS) {
        const row = rows.get(id);
        if (!row) continue;
        const hit = findStudioKeyCommand(eventOfBinding(binding), context);
        expect(hit?.command.id === id, `${id} ${binding.key} ${JSON.stringify(f)}`).toBe(row.enabled);
        checked.push(id);
      }
    }
    expect(new Set(checked).size).toBeGreaterThan(12);
  });

  it('키로 부른 것과 팔레트로 부른 것이 같은 동작을 낸다', () => {
    const differs: string[] = [];
    for (const { id, binding } of BINDINGS) {
      const byKey: string[] = []; const byPalette: string[] = [];
      dispatchStudioKey(eventOfBinding(binding), recordedContext(byKey));
      (studioCommand(id) as StudioCommand).run(recordedContext(byPalette), { shift: binding.shift === true, ...(binding.arg ? { arg: binding.arg } : {}) });
      if (byKey.length !== 1 || byKey.join() !== byPalette.join()) differs.push(`${id}: [${byKey.join()}] ↔ [${byPalette.join()}]`);
    }
    expect(differs).toEqual([]);
  });
});
