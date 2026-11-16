import type { StudioKeyEvent } from './studioCommandKeys.js';
import type { StudioCommandContext, StudioKeyActions, StudioPaletteState } from './studioCommandTypes.js';
import type { DocSummary } from './videoApi.js';

/** 시험 전용(§5.13 37-22) — 부른 동작을 `log` 에 적는 명령 문맥과 흉내 키 사건. 앱 코드는 가져다 쓰지 않는다. */

const say = (log: string[], name: string) => (...args: unknown[]): void => { log.push(args.length > 0 ? `${name}(${args.join(',')})` : name); };

/** 전부 실행할 수 있는 상태의 키 동작 묶음. `over` 로 조건·공급 여부를 바꾼다(`undefined` = 공급하지 않음). */
export function recordedActions(log: string[], over: Partial<StudioKeyActions> = {}): StudioKeyActions {
  return {
    disabled: false, hasMedia: true, canSplit: true,
    undo: say(log, 'undo'), redo: say(log, 'redo'), duplicate: say(log, 'duplicate'), remove: say(log, 'remove'), split: say(log, 'split'),
    togglePlay: say(log, 'togglePlay'), step: say(log, 'step'), toggleLoop: say(log, 'toggleLoop'), toggleSafe: say(log, 'toggleSafe'),
    toggleZoom: say(log, 'toggleZoom'), setInteraction: say(log, 'setInteraction'), toggleMute: say(log, 'toggleMute'),
    escape: () => { log.push('escape'); return true; },
    nudge: (dx, dy, big) => { log.push(`nudge(${dx},${dy},${big})`); return true; },
    openPalette: say(log, 'openPalette'), paletteOpen: false,
    skip: say(log, 'skip'), toggleFullscreen: say(log, 'toggleFullscreen'),
    ...over,
  };
}

export const FIXTURE_DOCS: readonly DocSummary[] = [
  { id: 'a', title: 'Alpha Intro', updatedAt: 100, version: 1, width: 1920, height: 1080, duration: 12 },
  { id: 'b', title: '가을 여행', updatedAt: 300, version: 1, width: 1080, height: 1920, duration: 30 },
  { id: 'c', title: 'alpha outro', updatedAt: 200, version: 1 },
];

/** 편집 화면이 서 있고 모든 명령이 서는 상태의 팔레트 문맥. */
export function recordedPalette(log: string[], over: Partial<StudioPaletteState> = {}): StudioPaletteState {
  return {
    hasDoc: true, startMode: false, playing: false, loop: false, muted: false, safeArea: false, zoom: 'fit', interaction: 'none',
    hasSelection: true, escapable: true, drawer: null, hasTranscript: true, hasCode: true, precisionOpen: false, historyOpen: false,
    aiCollapsed: false, format: 'landscape', canExport: true, hasCaptions: true, docs: FIXTURE_DOCS, currentDocId: 'a',
    openDrawer: say(log, 'openDrawer'), togglePrecision: say(log, 'togglePrecision'), toggleHistory: say(log, 'toggleHistory'),
    checkpoint: say(log, 'checkpoint'), toggleAi: say(log, 'toggleAi'), setFormat: say(log, 'setFormat'), openDoc: say(log, 'openDoc'),
    newDoc: say(log, 'newDoc'), refreshDocs: say(log, 'refreshDocs'), renderNow: say(log, 'renderNow'), exportPreset: say(log, 'exportPreset'),
    exportSettings: say(log, 'exportSettings'), exportQueue: say(log, 'exportQueue'), png: say(log, 'png'), srt: say(log, 'srt'),
    undoPass: say(log, 'undoPass'),
    sceneChat: { value: null, options: [{ chapterId: 's1', label: 'Scene 1' }], onChange: say(log, 'sceneChat') },
    ...over,
  };
}

export function recordedContext(log: string[], actions: Partial<StudioKeyActions> = {}, palette: Partial<StudioPaletteState> = {}): StudioCommandContext {
  return { ...recordedActions(log, actions), palette: recordedPalette(log, palette) };
}

export interface FakeKeyEvent extends StudioKeyEvent {
  /** `preventDefault()` 가 불렸다(키를 삼켰다). */
  swallowed: boolean;
}

export interface FakeKeyInit {
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly defaultPrevented?: boolean;
  readonly composing?: boolean;
  /** 키를 받은 요소의 꼬리표(`input` · `textarea` · `select` · `[contenteditable="true"]` · `div`). */
  readonly within?: string;
}

/** 그 꼬리표의 요소 안에서 난 키인 듯 `closest()` 가 답하는 흉내 대상. */
export function fakeTarget(within: string): { closest: (selector: string) => unknown } {
  return { closest: (selector) => (selector.split(',').includes(within) ? {} : null) };
}

export function keyEvent(key: string, init: FakeKeyInit = {}): FakeKeyEvent {
  const event: FakeKeyEvent = {
    key, ctrlKey: init.ctrl === true, metaKey: init.meta === true, shiftKey: init.shift === true, altKey: init.alt === true,
    defaultPrevented: init.defaultPrevented === true, nativeEvent: { isComposing: init.composing === true },
    target: fakeTarget(init.within ?? 'div'), swallowed: false,
    preventDefault: () => { event.swallowed = true; },
  };
  return event;
}
