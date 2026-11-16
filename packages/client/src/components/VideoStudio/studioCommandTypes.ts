import type { VideoFormatId } from '@vibisual/video';

import type { StudioIconName } from './studioIcons.js';
import type { RailDrawer } from './StudioRail.js';
import type { DocSummary } from './videoApi.js';

/**
 * §5.13 (V) 37-22 — 명령 등록부의 모양. 단축키 판정(`useStudioKeys`)과 팔레트(`StudioPalette`)가 같은 표(`studioCommands.ts`)를 읽는다.
 */

/** 단축키가 부르는 동작과 그 판정에 드는 값. 시험이 이 모양 그대로 만든다 — 칸을 빼거나 필수로 바꾸지 마라. */
export interface StudioKeyActions {
  readonly disabled: boolean;
  readonly hasMedia: boolean;
  readonly canSplit: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly duplicate: () => void;
  readonly remove: () => void;
  readonly split: () => void;
  readonly togglePlay: () => void;
  readonly step: (frames: number) => void;
  readonly toggleLoop: () => void;
  readonly toggleSafe: () => void;
  readonly toggleZoom: () => void;
  readonly setInteraction: (mode: 'point' | 'note') => void;
  /** §5.13 (AA) 42-3 — 미리보기 음소거 `M`. */
  readonly toggleMute?: () => void;
  /** Esc — 모드·열린 판을 닫는다. 닫은 것이 있으면 true. */
  readonly escape: () => boolean;
  /** 37-21 — 고른 것을 한 칸(`big` = 10칸) 옮긴다. 옮길 것이 없으면 false(키를 삼키지 않는다). */
  readonly nudge?: (dx: number, dy: number, big: boolean) => boolean;
  /** 37-22 — 팔레트를 연다. 없으면 여는 키도 먹지 않는다. */
  readonly openPalette?: () => void;
  /** 37-22 — 팔레트가 열려 있는 동안 스튜디오 단축키는 쉰다. */
  readonly paletteOpen?: boolean;
  /** 37-24 (C) — 건너뛰기 간격만큼 뒤(-1)·앞(1)으로. 없으면 맨 방향키는 종전대로 한 프레임을 옮긴다. */
  readonly skip?: (direction: -1 | 1) => void;
  /** 37-24 (E) — 전체 화면 켜기/끄기. 없으면(API 없음) 키도 먹지 않는다. */
  readonly toggleFullscreen?: () => void;
}

/** 팔레트만 쓰는 상태와 동작(키가 없는 명령 · 흐림/숨김 판정). */
export interface StudioPaletteState {
  readonly hasDoc: boolean;
  /** 시작 화면이 서 있다(편집 화면의 손잡이가 없다). */
  readonly startMode: boolean;
  readonly playing: boolean;
  readonly loop: boolean;
  readonly muted: boolean;
  readonly safeArea: boolean;
  readonly zoom: 'fit' | 'actual' | 'free';
  readonly interaction: 'none' | 'point' | 'note';
  /** 37-24 (E) — 전체 화면 중이다. */
  readonly fullscreen?: boolean;
  readonly hasSelection: boolean;
  /** Esc 가 닫을 것이 있다(모드·떠 있는 판). */
  readonly escapable: boolean;
  readonly drawer: RailDrawer | null;
  readonly hasTranscript: boolean;
  readonly hasCode: boolean;
  readonly precisionOpen: boolean;
  readonly historyOpen: boolean;
  readonly aiCollapsed: boolean;
  readonly format: VideoFormatId | null;
  readonly canExport: boolean;
  readonly hasCaptions: boolean;
  /** 문서 갤러리와 같은 목록(`studio.docs`). */
  readonly docs: readonly DocSummary[];
  readonly currentDocId: string | null;
  readonly openDrawer: (drawer: RailDrawer) => void;
  readonly togglePrecision: () => void;
  readonly toggleHistory: () => void;
  readonly checkpoint: () => void;
  readonly toggleAi: () => void;
  readonly setFormat: (format: VideoFormatId) => void;
  /** 갤러리와 같은 열기 길(머리줄 `onOpenDoc`). */
  readonly openDoc: (id: string) => void;
  readonly newDoc: () => void;
  /** 갤러리가 열릴 때와 같이 목록을 새로 읽는다. */
  readonly refreshDocs: () => void;
  readonly renderNow: () => void;
  readonly exportPreset: (format: VideoFormatId) => void;
  readonly exportSettings: () => void;
  readonly exportQueue: () => void;
  readonly png: () => void;
  readonly srt: () => void;
  /** §5.13 (V) 37-23 (K) — 바뀐 것 카드의 [이 바퀴 되돌리기]와 같은 함수(바퀴 시작 판이 없으면 없다). */
  readonly undoPass?: (() => void) | null;
  /** §5.13 (V) 37-23 (K) — AI 패널의 대화 거르개와 같은 상태(장면이 없는 문서면 null). */
  readonly sceneChat?: { readonly value: string | null; readonly options: readonly { readonly chapterId: string; readonly label: string }[]; readonly onChange: (chapterId: string | null) => void } | null;
}

export type StudioCommandContext = StudioKeyActions & { readonly palette?: StudioPaletteState };

/** 키 하나. `mod`·`shift`·`alt` 를 비워 두면 눌렸든 아니든 받는다. `combo` 는 `shortcutLabel()` 에 넘기는 표기(없으면 표시하지 않는다). */
export interface StudioKeyBinding {
  /** `event.key.toLowerCase()`. */
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly combo?: string;
  /** 실행 함수에 넘길 갈래(방향 등). */
  readonly arg?: string;
}

/** 실행 방식 — 키로 불렸으면 Shift 와 그 키의 갈래, 팔레트 2단계면 고른 항목 id. */
export interface StudioRunHow {
  readonly shift: boolean;
  readonly arg?: string;
}

export type StudioCommandGroup = 'playback' | 'view' | 'mode' | 'edit' | 'panel' | 'doc' | 'export';

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** 2단계에서 고를 것. `label` 은 이미 번역된 글자(문서 제목은 사용자 글이다). */
export interface StudioCommandChoice {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  /** 오른쪽에 `shortcutLabel()` 로 그릴 단축키 표기. */
  readonly combo?: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
}

export interface StudioCommand {
  readonly id: string;
  readonly group: StudioCommandGroup;
  readonly icon: StudioIconName;
  /** 이름의 i18n 키(상태에 따라 바뀌는 이름은 함수). */
  readonly name: string | ((c: StudioCommandContext) => string);
  /** 설명의 i18n 키. */
  readonly detail: string;
  readonly keys?: readonly StudioKeyBinding[];
  /** 실행 조건 — 키 판정과 팔레트(흐림)가 같이 본다. 없으면 늘 된다. */
  readonly enabled?: (c: StudioCommandContext) => boolean;
  /** 팔레트 목록에 세울까(키 판정은 보지 않는다). 없으면 늘 선다. */
  readonly shown?: (c: StudioCommandContext) => boolean;
  /** 켜짐 표시(토글). */
  readonly checked?: (c: StudioCommandContext) => boolean;
  /** `false` 를 돌려주면 한 일이 없다 — 키를 삼키지 않는다. */
  readonly run: (c: StudioCommandContext, how: StudioRunHow) => boolean | void;
  /** 있으면 팔레트가 2단계로 고르게 하고 고른 id 를 `how.arg` 로 넘긴다. `query` 로 이미 거른 목록을 돌려준다. */
  readonly choices?: (c: StudioCommandContext, t: Translate, query: string) => readonly StudioCommandChoice[];
  /** 2단계에 들어설 때 한 번(목록 새로 읽기 등). */
  readonly prepare?: (c: StudioCommandContext) => void;
}
