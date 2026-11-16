import { describe, expect, it } from 'vitest';

import en from '../../i18n/locales/en.json';
import ko from '../../i18n/locales/ko.json';
import { formatShortcut } from '../../utils/platform.js';
import { searchKey } from './docGalleryModel.js';
import { recordedContext } from './studioCommandFixtures.js';
import { STUDIO_COMMANDS, filterChoices, studioCommand } from './studioCommands.js';
import type { StudioCommand, StudioCommandChoice, StudioCommandContext, StudioCommandGroup, StudioKeyActions, StudioPaletteState, Translate } from './studioCommandTypes.js';
import {
  PALETTE_GROUP_ORDER, PALETTE_RECENT_MAX, firstEnabled, nextEnabled, paletteKeyAction, paletteRows, pushRecent, rankPaletteRows,
  type PaletteLabels, type PaletteRow,
} from './studioPaletteModel.js';

/** 로케일 묶음에서 키를 읽는다(없으면 키 그대로 — 화면에 날것의 키가 뜨는 모양과 같다). */
const lookup = (bundle: unknown): Translate => (key) => {
  const value = key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), bundle);
  return typeof value === 'string' ? value : key;
};
/** 한글 화면: 지금 언어는 ko, 영문 고정 번역은 en, 단축키 표기는 맥이 아닌 쪽. */
const KO: PaletteLabels = { t: lookup(ko), tEn: lookup(en), shortcut: (combo) => formatShortcut(combo, false) };

const rowsFor = (actions: Partial<StudioKeyActions> = {}, palette: Partial<StudioPaletteState> = {}): PaletteRow[] => paletteRows(recordedContext([], actions, palette), KO);
const idsFor = (actions: Partial<StudioKeyActions> = {}, palette: Partial<StudioPaletteState> = {}): string[] => rowsFor(actions, palette).map((r) => r.id);
const rowOf = (id: string, actions: Partial<StudioKeyActions> = {}, palette: Partial<StudioPaletteState> = {}): PaletteRow => {
  const row = rowsFor(actions, palette).find((r) => r.id === id);
  if (!row) throw new Error(`줄이 없다: ${id}`);
  return row;
};

describe('팔레트 줄 — 무엇을 세우나(shown)', () => {
  it('편집 화면에서는 팔레트 자신만 빼고 다 선다', () => {
    expect(idsFor()).toEqual(STUDIO_COMMANDS.filter((c) => c.id !== 'palette').map((c) => c.id));
  });

  it('문서가 없으면 문서 열기와 나가기만 남는다 — 닫을 것도 없으면 문서 열기뿐', () => {
    expect(idsFor({}, { hasDoc: false, startMode: true })).toEqual(['escape', 'openDoc']);
    expect(idsFor({}, { hasDoc: false, startMode: true, escapable: false })).toEqual(['openDoc']);
  });

  it('시작 화면에서는 편집 화면의 손잡이에 닿는 명령을 숨긴다', () => {
    const ids = idsFor({}, { startMode: true });
    for (const hidden of ['togglePlay', 'stepBack', 'split', 'toggleSafe', 'point', 'note', 'drawer.media', 'precision', 'aiPanel']) expect(ids, hidden).not.toContain(hidden);
    for (const kept of ['openDoc', 'newDoc', 'history', 'renderNow']) expect(ids, kept).toContain(kept);
  });

  it('자막이 없으면 대본 서랍을, 코드 컴포지션이 없으면 코드 칸을 숨긴다', () => {
    expect(idsFor({}, { hasTranscript: false })).not.toContain('drawer.transcript');
    expect(idsFor({}, { hasCode: false })).not.toContain('drawer.code');
    expect(idsFor()).toEqual(expect.arrayContaining(['drawer.media', 'drawer.parts', 'drawer.style', 'drawer.notes', 'drawer.transcript', 'drawer.code']));
  });

  it('고른 것이 없으면 고른 것에 하는 명령을, 판 기록이 열려 있으면 AI 패널 접기를 숨긴다', () => {
    const ids = idsFor({}, { hasSelection: false });
    for (const hidden of ['duplicate', 'nudge', 'remove']) expect(ids, hidden).not.toContain(hidden);
    expect(idsFor({}, { historyOpen: true })).not.toContain('aiPanel');
  });
});

describe('팔레트 줄 — 실행 조건(enabled)·켜짐(checked)·이름', () => {
  const disabledIds = (actions: Partial<StudioKeyActions>, palette: Partial<StudioPaletteState> = {}): string[] => rowsFor(actions, palette).filter((r) => !r.enabled).map((r) => r.id);

  it('아무 조건도 걸리지 않으면 흐린 줄이 없다', () => {
    expect(disabledIds({})).toEqual([]);
  });

  it('편집할 수 없으면 고치는 명령이 흐리게 선다(사라지지 않는다)', () => {
    expect(disabledIds({ disabled: true })).toEqual(['undo', 'redo', 'duplicate', 'remove', 'split', 'format']);
  });

  it('조건마다 그 명령만 흐려진다', () => {
    expect(disabledIds({ hasMedia: false })).toEqual(['togglePlay']);
    expect(disabledIds({ canSplit: false })).toEqual(['split']);
    expect(disabledIds({ toggleMute: undefined })).toEqual(['toggleMute']);
    expect(disabledIds({ nudge: undefined })).toEqual(['nudge']);
    expect(disabledIds({}, { canExport: false })).toEqual(['renderNow', 'exportPreset', 'png']);
    expect(disabledIds({}, { hasCaptions: false })).toEqual(['srt']);
    expect(disabledIds({}, { docs: [] })).toEqual(['openDoc']);
    expect(disabledIds({}, { format: null })).toEqual(['format']);
    expect(disabledIds({}, { undoPass: null })).toEqual(['undoPass']);
    expect(disabledIds({}, { sceneChat: null })).toEqual(['sceneChat']);
  });

  it('토글은 지금 상태를 켜짐으로 보인다', () => {
    const checked = (palette: Partial<StudioPaletteState>): string[] => rowsFor({}, palette).filter((r) => r.checked).map((r) => r.id);
    expect(checked({})).toEqual([]);
    expect(checked({ loop: true })).toEqual(['toggleLoop']);
    expect(checked({ safeArea: true })).toEqual(['toggleSafe']);
    expect(checked({ interaction: 'point' })).toEqual(['point']);
    expect(checked({ interaction: 'note' })).toEqual(['note']);
    expect(checked({ muted: true })).toEqual(['toggleMute']);
    expect(checked({ drawer: 'style' })).toEqual(['drawer.style']);
    expect(checked({ precisionOpen: true })).toEqual(['precision']);
    expect(checked({ historyOpen: true })).toEqual(['history']);
  });

  it('상태에 따라 바뀌는 이름은 화면 손잡이의 이름을 따라간다', () => {
    expect(rowOf('togglePlay').name).toBe(lookup(ko)('panel.videoStudio.play'));
    expect(rowOf('togglePlay', {}, { playing: true }).name).toBe(lookup(ko)('panel.videoStudio.pause'));
    expect(rowOf('toggleMute', {}, { muted: true }).name).toBe(lookup(ko)('panel.videoStudio.preview.unmute'));
    expect(rowOf('toggleZoom').name).toBe(lookup(ko)('panel.videoStudio.preview.actualSize'));
    expect(rowOf('toggleZoom', {}, { zoom: 'actual' }).name).toBe(lookup(ko)('panel.videoStudio.preview.fit'));
    expect(rowOf('aiPanel', {}, { aiCollapsed: true }).name).toBe(lookup(ko)('panel.videoStudio.ai.expand'));
  });

  it('단축키 표기와 2단계 여부를 등록부에서 그대로 싣는다', () => {
    expect(rowOf('undo').combo).toBe('Ctrl+Z');
    expect(rowOf('togglePlay').combo).toBe('Space');
    expect(rowOf('drawer.media').combo).toBeNull();
    expect(rowsFor().filter((r) => r.hasChoices).map((r) => r.id)).toEqual(['nudge', 'sceneChat', 'openDoc', 'format', 'exportPreset']);
  });

  it('이름과 설명에 번역 키가 날것으로 남지 않는다', () => {
    const raw = rowsFor().filter((r) => r.name.startsWith('panel.') || r.detail.startsWith('panel.')).map((r) => r.id);
    expect(raw).toEqual([]);
  });
});

describe('팔레트 순서 — 빈 검색', () => {
  it('등록부의 모든 묶음이 묶음 순서에 있다 — 빠진 묶음은 맨 앞으로 튄다', () => {
    expect([...new Set(STUDIO_COMMANDS.map((c) => c.group))].filter((g) => !PALETTE_GROUP_ORDER.includes(g))).toEqual([]);
  });

  it('묶음 순서대로 서고, 묶음 안에서는 표 순서다', () => {
    const ranked = rankPaletteRows(rowsFor(), '', []);
    const groups = ranked.map((r) => r.group).filter((g, i, all) => g !== all[i - 1]);
    expect(groups).toEqual(PALETTE_GROUP_ORDER);
    for (const group of PALETTE_GROUP_ORDER) {
      const orders = ranked.filter((r) => r.group === group).map((r) => r.order);
      expect(orders, group).toEqual([...orders].sort((a, b) => a - b));
    }
    expect(ranked.every((r) => !r.recent)).toBe(true);
  });

  it('최근 쓴 명령이 쓴 순서대로 맨 위에 서고 아래에 다시 서지 않는다', () => {
    const ranked = rankPaletteRows(rowsFor(), '', ['renderNow', 'undo']);
    expect(ranked.slice(0, 3).map((r) => [r.id, r.recent])).toEqual([['renderNow', true], ['undo', true], ['togglePlay', false]]);
    expect(ranked.filter((r) => r.id === 'renderNow' || r.id === 'undo')).toHaveLength(2);
    expect(ranked).toHaveLength(rowsFor().length);
  });

  it('지금 서지 않는 최근 명령은 건너뛰고 다섯 개까지만 세운다', () => {
    const recent = ['palette', 'no-such-command', 'srt', 'png', 'undo', 'redo', 'split', 'toggleLoop'];
    const head = rankPaletteRows(rowsFor(), '', recent).filter((r) => r.recent).map((r) => r.id);
    expect(head).toEqual(['srt', 'png', 'undo', 'redo', 'split']);
    expect(head).toHaveLength(PALETTE_RECENT_MAX);
  });
});

/** 순서 규칙만 보는 줄 — 문구가 바뀌어도 흔들리지 않게 손으로 만든다. */
function madeRow(id: string, order: number, name: string, detail: string, group: StudioCommandGroup = 'edit'): PaletteRow {
  return {
    id, group, icon: 'search', name, detail, combo: null, enabled: true, checked: false, hasChoices: false, order,
    haystack: searchKey(`${name} ${detail}`), nameKey: searchKey(name),
  };
}

describe('팔레트 검색 — 순서 규칙', () => {
  const rows = [
    madeRow('detailOnly', 0, 'Checkpoint', 'Keeps a render of this version'),
    madeRow('inside', 1, 'Prerender cache', 'Warms the frames'),
    madeRow('wordStart', 2, 'Queue render', 'Adds to the list'),
    madeRow('prefix', 3, 'Render now', 'Starts at once'),
    madeRow('other', 4, 'Split', 'Cuts a clip'),
  ];
  const find = (query: string, recent: readonly string[] = []): string[] => rankPaletteRows(rows, query, recent).map((r) => r.id);

  it('이름이 그 글자로 시작하거나 낱말이 시작하면 먼저, 이름 안에 있으면 다음, 설명에만 있으면 마지막', () => {
    expect(find('render')).toEqual(['wordStart', 'prefix', 'inside', 'detailOnly']);
  });

  it('같은 점수면 최근에 쓴 것이 앞서고, 그다음은 표 순서다', () => {
    expect(find('render', ['prefix'])).toEqual(['prefix', 'wordStart', 'inside', 'detailOnly']);
    expect(find('render', ['detailOnly'])).toEqual(['wordStart', 'prefix', 'inside', 'detailOnly']);
  });

  it('낱말마다 부분 일치해야 한다 — 순서는 상관없다', () => {
    expect(find('now render')).toEqual(['prefix']);
    expect(find('clip cuts')).toEqual(['other']);
    expect(find('render zzz')).toEqual([]);
  });

  it('대소문자를 가리지 않고 앞뒤 공백을 버린다', () => {
    expect(find('  RENDER ')).toEqual(find('render'));
  });

  it('검색 중에는 최근 칸을 세우지 않는다', () => {
    expect(rankPaletteRows(rows, 'render', ['prefix']).every((r) => !r.recent)).toBe(true);
  });
});

describe('팔레트 검색 — 실제 등록부', () => {
  const find = (query: string): string[] => rankPaletteRows(rowsFor(), query, []).map((r) => r.id);

  it('한글 화면에서 한글 이름으로 찾는다', () => {
    expect(find(lookup(ko)('panel.videoStudio.editor.undo'))[0]).toBe('undo');
    expect(find(lookup(ko)('panel.videoStudio.history.checkpoint'))[0]).toBe('checkpoint');
  });

  it('한글 화면에서 영문 이름으로도 찾는다', () => {
    expect(find('undo')[0]).toBe('undo');
    expect(find('next frame')[0]).toBe('stepForward');
    expect(find('render queue')[0]).toBe('exportQueue');
  });

  it('입력 중인 한글(분해형)도 합쳐서 견준다', () => {
    const word = lookup(ko)('panel.videoStudio.play');
    expect(word.normalize('NFD')).not.toBe(word);
    expect(find(word.normalize('NFD'))).toEqual(find(word));
    expect(find(word)).toContain('togglePlay');
  });

  it('단축키 글자로 찾는다', () => {
    expect(find('ctrl+d')).toEqual(['duplicate']);
    expect(find('ctrl+shift+z')).toEqual(['redo']);
    expect(find('space')).toContain('togglePlay');
  });

  it('묶음 이름으로 그 묶음을 모은다', () => {
    const group = lookup(ko)('panel.videoStudio.palette.group.export');
    expect(find(group)).toEqual(expect.arrayContaining(['renderNow', 'exportPreset', 'exportSettings', 'exportQueue', 'png', 'srt']));
  });

  it('맞는 것이 없으면 빈 목록이다', () => {
    expect(find('zzzz-nothing')).toEqual([]);
  });

  it('흐린 줄도 검색에는 걸린다 — 왜 못 쓰는지 보이게', () => {
    const rows = rankPaletteRows(rowsFor({ disabled: true }), 'undo', []);
    expect(rows[0]?.id).toBe('undo');
    expect(rows[0]?.enabled).toBe(false);
  });
});

describe('팔레트 — 최근 목록', () => {
  it('맨 앞에 넣고 중복을 지우며 다섯 개를 넘기지 않는다', () => {
    expect(pushRecent([], 'a')).toEqual(['a']);
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
  });
});

describe('팔레트 — 검색 칸의 키', () => {
  const state = (over: Partial<Parameters<typeof paletteKeyAction>[1]> = {}): Parameters<typeof paletteKeyAction>[1] => (
    { composing: false, enabled: [true, false, true], active: 0, step: false, queryEmpty: true, ...over });

  it('화살표는 흐린 줄을 건너뛰고 가장자리에서 돌지 않는다', () => {
    expect(nextEnabled([true, false, true], 0, 1)).toBe(2);
    expect(nextEnabled([true, false, true], 2, -1)).toBe(0);
    expect(nextEnabled([true, false, true], 2, 1)).toBe(2);
    expect(nextEnabled([true, false, false], 0, 1)).toBe(0);
    expect(nextEnabled([false, true], -1, 1)).toBe(1);
    expect(paletteKeyAction('ArrowDown', state())).toEqual({ kind: 'move', index: 2 });
    expect(paletteKeyAction('ArrowUp', state({ active: 2 }))).toEqual({ kind: 'move', index: 0 });
    expect(paletteKeyAction('ArrowDown', state({ enabled: [] }))).toEqual({ kind: 'none' });
  });

  it('처음 고를 줄은 첫 실행 가능한 줄이다', () => {
    expect(firstEnabled([false, false, true])).toBe(2);
    expect(firstEnabled([false])).toBe(-1);
    expect(firstEnabled([])).toBe(-1);
  });

  it('Enter 는 실행할 수 있는 줄만 실행한다', () => {
    expect(paletteKeyAction('Enter', state())).toEqual({ kind: 'run' });
    expect(paletteKeyAction('Enter', state({ active: 1 }))).toEqual({ kind: 'none' });
    expect(paletteKeyAction('Enter', state({ active: -1 }))).toEqual({ kind: 'none' });
  });

  it('Esc 는 닫고, 2단계에서는 1단계로 돌아간다', () => {
    expect(paletteKeyAction('Escape', state())).toEqual({ kind: 'close' });
    expect(paletteKeyAction('Escape', state({ step: true }))).toEqual({ kind: 'back' });
  });

  it('Backspace 는 2단계의 빈 칸에서만 뒤로 간다 — 글자를 지우는 키를 가로채지 않는다', () => {
    expect(paletteKeyAction('Backspace', state({ step: true }))).toEqual({ kind: 'back' });
    expect(paletteKeyAction('Backspace', state({ step: true, queryEmpty: false }))).toEqual({ kind: 'none' });
    expect(paletteKeyAction('Backspace', state())).toEqual({ kind: 'none' });
  });

  it('한글 조합 중에는 어떤 키도 가로채지 않는다 — 조합을 확정하는 Enter 가 명령을 실행하지 않는다', () => {
    for (const key of ['Enter', 'ArrowDown', 'ArrowUp', 'Escape', 'Backspace']) {
      expect(paletteKeyAction(key, state({ composing: true, step: true })), key).toEqual({ kind: 'none' });
    }
  });

  it('글자 키는 검색 칸에 맡긴다', () => {
    for (const key of ['a', ' ', 'k', 'Tab', 'Home']) expect(paletteKeyAction(key, state()), key).toEqual({ kind: 'none' });
  });
});

describe('팔레트 — 2단계 고르기', () => {
  const t = lookup(ko);
  const choicesOf = (id: string, query = '', palette: Partial<StudioPaletteState> = {}): readonly StudioCommandChoice[] => {
    const command = studioCommand(id) as StudioCommand;
    return command.choices ? command.choices(recordedContext([], {}, palette), t, query) : [];
  };

  it('낱말마다 이름·덧말의 부분 일치로 거른다', () => {
    const list: StudioCommandChoice[] = [{ id: 'a', label: 'Alpha Intro', hint: '16:9' }, { id: 'b', label: '가을 여행', hint: '9:16' }, { id: 'c', label: 'alpha outro' }];
    expect(filterChoices(list, '').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(filterChoices(list, 'ALPHA').map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterChoices(list, 'intro alpha').map((c) => c.id)).toEqual(['a']);
    expect(filterChoices(list, '9:16').map((c) => c.id)).toEqual(['b']);
    expect(filterChoices(list, '가을'.normalize('NFD')).map((c) => c.id)).toEqual(['b']);
    expect(filterChoices(list, 'zzz')).toEqual([]);
  });

  it('문서 열기는 갤러리와 같은 순서(최근 고친 것 먼저)·같은 제목 검색이고 지금 문서를 표시한다', () => {
    expect(choicesOf('openDoc').map((c) => [c.id, c.active])).toEqual([['b', false], ['c', false], ['a', true]]);
    expect(choicesOf('openDoc', 'alpha').map((c) => c.id)).toEqual(['c', 'a']);
    expect(choicesOf('openDoc', '', { docs: [] })).toEqual([]);
  });

  it('판형은 세 가지를 번역된 이름으로 세우고 지금 판형을 표시한다', () => {
    const formats = choicesOf('format', '', { format: 'portrait' });
    expect(formats.map((c) => c.id)).toEqual(['landscape', 'portrait', 'square']);
    expect(formats.map((c) => c.label)).toEqual(['landscape', 'portrait', 'square'].map((id) => t(`panel.videoStudio.formats.${id}`)));
    expect(formats.filter((c) => c.active).map((c) => c.id)).toEqual(['portrait']);
    expect(choicesOf('exportPreset').map((c) => c.label)).toEqual(['landscape', 'portrait', 'square'].map((id) => t(`panel.videoStudio.export.preset_${id}`)));
  });

  it('옮기기는 네 방향과 그 단축키 표기를 세운다', () => {
    expect(choicesOf('nudge').map((c) => [c.id, c.combo])).toEqual([['left', 'Ctrl+Left'], ['right', 'Ctrl+Right'], ['up', 'Ctrl+Up'], ['down', 'Ctrl+Down']]);
  });

  it('들어설 때 문서 목록을 새로 읽는다 — 갤러리가 열릴 때와 같다', () => {
    const log: string[] = [];
    studioCommand('openDoc')?.prepare?.(recordedContext(log));
    expect(log).toEqual(['refreshDocs']);
  });
});

describe('팔레트 — 실행은 화면 손잡이의 함수 하나를 부를 뿐이다', () => {
  const t = lookup(ko);
  /** 2단계 명령이면 첫 항목을 고른 것으로 실행한다. */
  const runOnce = (command: StudioCommand, context: StudioCommandContext): void => {
    const first = command.choices?.(context, t, '')[0]?.id;
    command.run(context, { shift: false, ...(first !== undefined ? { arg: first } : {}) });
  };

  it('모든 명령이 받은 함수를 정확히 한 번 부른다 — 팔레트에만 있는 동작이 없다', () => {
    const calls: Record<string, string[]> = {};
    for (const command of STUDIO_COMMANDS) {
      const log: string[] = [];
      runOnce(command, recordedContext(log));
      calls[command.id] = log;
    }
    expect(Object.entries(calls).filter(([, log]) => log.length !== 1).map(([id, log]) => `${id}: [${log.join()}]`)).toEqual([]);
  });

  it('서랍 여섯 개는 레일과 같은 상태로 연다', () => {
    for (const drawer of ['media', 'parts', 'style', 'notes', 'transcript', 'code']) {
      const log: string[] = [];
      studioCommand(`drawer.${drawer}`)?.run(recordedContext(log), { shift: false });
      expect(log, drawer).toEqual([`openDrawer(${drawer})`]);
    }
  });

  it('고른 것 없이 실행된 2단계 명령은 아무 일도 하지 않는다', () => {
    for (const [id, arg] of [['openDoc', undefined], ['format', 'bogus'], ['exportPreset', undefined], ['nudge', 'sideways'], ['sceneChat', undefined]] as const) {
      const log: string[] = [];
      studioCommand(id)?.run(recordedContext(log), { shift: false, ...(arg !== undefined ? { arg } : {}) });
      expect(log, id).toEqual([]);
    }
  });
});
