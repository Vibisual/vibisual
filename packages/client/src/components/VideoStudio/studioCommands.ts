import { VIDEO_FORMAT_IDS, formatRatioLabel, type VideoFormatId } from '@vibisual/video';

import type { RailDrawer } from './StudioRail.js';
import type { StudioIconName } from './studioIcons.js';
import { docLabel, docRatioLabel, formatDocLength, galleryRows, searchKey } from './docGalleryModel.js';
import type { StudioCommand, StudioCommandChoice, StudioCommandContext, StudioKeyBinding } from './studioCommandTypes.js';

/**
 * §5.13 (V) 37-22 — 스튜디오 명령 등록부(정본 한 장). 키 판정(`studioCommandKeys.ts`)은 이 표를 위에서 읽어 첫 맞는 줄을 실행하고,
 * 팔레트(`StudioPalette.tsx`)는 같은 줄을 이름·설명·단축키로 보인다. 팔레트에만 있는 기능은 두지 않는다(37-1 — 화면 손잡이가 먼저다).
 */

const P = 'panel.videoStudio';
const D = `${P}.palette.detail`;

/** 맨 키 — Ctrl/Cmd·Alt 없이, Shift 는 상관없다(옮기기 전 판정문이 Shift 를 보지 않았다). */
const bare = (key: string, combo?: string): StudioKeyBinding => ({ key, mod: false, alt: false, ...(combo ? { combo } : {}) });

/** 장면별 대화 2단계의 '전체' 항목 id(장면 id 와 겹치지 않는 모양). */
const SCENE_CHAT_ALL = '*all';

const ARROWS: ReadonlyArray<{ readonly arg: string; readonly key: string; readonly combo: string; readonly glyph: string; readonly dx: number; readonly dy: number }> = [
  { arg: 'left', key: 'arrowleft', combo: 'Left', glyph: '←', dx: -1, dy: 0 },
  { arg: 'right', key: 'arrowright', combo: 'Right', glyph: '→', dx: 1, dy: 0 },
  { arg: 'up', key: 'arrowup', combo: 'Up', glyph: '↑', dx: 0, dy: -1 },
  { arg: 'down', key: 'arrowdown', combo: 'Down', glyph: '↓', dx: 0, dy: 1 },
];

/** 2단계 목록 거르기 — 낱말마다 이름·덧말의 부분 일치(갤러리와 같은 `searchKey`). */
export function filterChoices(list: readonly StudioCommandChoice[], query: string): StudioCommandChoice[] {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...list];
  return list.filter((ch) => { const hay = searchKey(`${ch.label} ${ch.hint ?? ''}`); return words.every((w) => hay.includes(w)); });
}

/** 편집 화면이 서 있다(시작 화면·문서 없음이 아니다). 팔레트 문맥이 없으면(시험) 선다. */
const onEditor = (c: StudioCommandContext): boolean => !c.palette || (c.palette.hasDoc && !c.palette.startMode);
const hasDoc = (c: StudioCommandContext): boolean => !c.palette || c.palette.hasDoc;

const RAIL: ReadonlyArray<{ readonly id: RailDrawer; readonly icon: StudioIconName; readonly when?: (c: StudioCommandContext) => boolean }> = [
  { id: 'media', icon: 'media' },
  { id: 'parts', icon: 'parts' },
  { id: 'style', icon: 'style' },
  { id: 'notes', icon: 'notes' },
  { id: 'transcript', icon: 'transcript', when: (c) => c.palette?.hasTranscript === true },
  { id: 'code', icon: 'code', when: (c) => c.palette?.hasCode === true },
];

function formatChoices(current: VideoFormatId | null, label: (id: VideoFormatId) => string): StudioCommandChoice[] {
  return VIDEO_FORMAT_IDS.map((id) => ({ id, label: label(id), hint: formatRatioLabel(id), active: id === current }));
}

const isFormat = (id: string | undefined): id is VideoFormatId => !!id && (VIDEO_FORMAT_IDS as readonly string[]).includes(id);

/** 표의 순서가 곧 키 판정 순서다 — `escape` 가 맨 앞(수식키와 무관하게 먼저 받던 순서). */
export const STUDIO_COMMANDS: readonly StudioCommand[] = [
  {
    id: 'escape', group: 'mode', icon: 'close', name: `${P}.palette.name.escape`, detail: `${D}.escape`,
    keys: [{ key: 'escape', combo: 'Esc' }],
    shown: (c) => c.palette?.escapable !== false,
    run: (c) => c.escape(),
  },
  {
    id: 'palette', group: 'mode', icon: 'search', name: `${P}.palette.title`, detail: `${D}.palette`,
    keys: [{ key: 'k', mod: true, shift: false, alt: false, combo: 'Ctrl+K' }],
    enabled: (c) => c.openPalette !== undefined,
    // 열린 팔레트 안에 자기를 여는 줄은 세우지 않는다 — 골라도 닫혔다 다시 열릴 뿐이다.
    shown: () => false,
    run: (c) => { c.openPalette?.(); },
  },
  // ─── 정밀 편집 (Ctrl/Cmd 조합은 Alt 를 보지 않았다) ───
  {
    id: 'undo', group: 'edit', icon: 'undo', name: `${P}.editor.undo`, detail: `${D}.undo`,
    keys: [{ key: 'z', mod: true, shift: false, combo: 'Ctrl+Z' }],
    enabled: (c) => !c.disabled, shown: hasDoc,
    run: (c) => { c.undo(); },
  },
  {
    id: 'redo', group: 'edit', icon: 'redo', name: `${P}.editor.redo`, detail: `${D}.redo`,
    keys: [{ key: 'z', mod: true, shift: true, combo: 'Ctrl+Shift+Z' }, { key: 'y', mod: true, combo: 'Ctrl+Y' }],
    enabled: (c) => !c.disabled, shown: hasDoc,
    run: (c) => { c.redo(); },
  },
  {
    id: 'duplicate', group: 'edit', icon: 'duplicate', name: `${P}.editor.duplicate`, detail: `${D}.duplicate`,
    keys: [{ key: 'd', mod: true, combo: 'Ctrl+D' }],
    enabled: (c) => !c.disabled, shown: (c) => onEditor(c) && c.palette?.hasSelection !== false,
    run: (c) => { c.duplicate(); },
  },
  {
    id: 'nudge', group: 'edit', icon: 'grip', name: `${P}.palette.name.nudge`, detail: `${D}.nudge`,
    keys: ARROWS.map((a) => ({ key: a.key, mod: true, alt: false, combo: `Ctrl+${a.combo}`, arg: a.arg })),
    enabled: (c) => c.nudge !== undefined, shown: (c) => onEditor(c) && c.palette?.hasSelection !== false,
    run: (c, how) => {
      const a = ARROWS.find((x) => x.arg === how.arg);
      return a && c.nudge ? c.nudge(a.dx, a.dy, how.shift) : false;
    },
    choices: (_c, _t, query) => filterChoices(ARROWS.map((a) => ({ id: a.arg, label: a.glyph, combo: `Ctrl+${a.combo}` })), query),
  },
  {
    id: 'remove', group: 'edit', icon: 'trash', name: `${P}.removeItem`, detail: `${D}.remove`,
    keys: [bare('delete', 'Delete'), bare('backspace')],
    enabled: (c) => !c.disabled, shown: (c) => onEditor(c) && c.palette?.hasSelection !== false,
    run: (c) => { c.remove(); },
  },
  {
    id: 'split', group: 'edit', icon: 'split', name: `${P}.editor.split`, detail: `${D}.split`,
    keys: [bare('s', 'S')],
    enabled: (c) => !c.disabled && c.canSplit, shown: onEditor,
    run: (c) => { c.split(); },
  },
  // ─── 재생 ───
  {
    id: 'togglePlay', group: 'playback', icon: 'play', name: (c) => (c.palette?.playing ? `${P}.pause` : `${P}.play`), detail: `${D}.togglePlay`,
    keys: [bare(' ', 'Space')],
    enabled: (c) => c.hasMedia, shown: onEditor,
    run: (c) => { c.togglePlay(); },
  },
  {
    id: 'stepBack', group: 'playback', icon: 'prev', name: `${P}.preview.prevFrame`, detail: `${D}.stepBack`,
    keys: [{ key: ',', mod: false, alt: false, shift: false, combo: ',' }, { key: 'arrowleft', mod: false, alt: false, shift: true, combo: 'Shift+Left' }],
    shown: onEditor,
    run: (c, how) => { c.step(-1 * (how.shift ? 10 : 1)); },
  },
  {
    id: 'stepForward', group: 'playback', icon: 'next', name: `${P}.preview.nextFrame`, detail: `${D}.stepForward`,
    keys: [{ key: '.', mod: false, alt: false, shift: false, combo: '.' }, { key: 'arrowright', mod: false, alt: false, shift: true, combo: 'Shift+Right' }],
    shown: onEditor,
    run: (c, how) => { c.step(how.shift ? 10 : 1); },
  },
  // 37-24 (C) — 맨 방향키는 건너뛰기(프레임은 `,`/`.`). `skip` 공급이 없으면 종전대로 한 프레임을 옮긴다.
  {
    id: 'skipBack', group: 'playback', icon: 'skipBack', name: `${P}.palette.name.skipBack`, detail: `${D}.skipBack`,
    keys: [{ key: 'arrowleft', mod: false, alt: false, shift: false, combo: 'Left' }],
    shown: onEditor,
    run: (c) => { if (c.skip) c.skip(-1); else c.step(-1); },
  },
  {
    id: 'skipForward', group: 'playback', icon: 'skipForward', name: `${P}.palette.name.skipForward`, detail: `${D}.skipForward`,
    keys: [{ key: 'arrowright', mod: false, alt: false, shift: false, combo: 'Right' }],
    shown: onEditor,
    run: (c) => { if (c.skip) c.skip(1); else c.step(1); },
  },
  {
    id: 'toggleLoop', group: 'playback', icon: 'loop', name: `${P}.editor.loop`, detail: `${D}.toggleLoop`,
    keys: [bare('l', 'L')], shown: onEditor, checked: (c) => c.palette?.loop === true,
    run: (c) => { c.toggleLoop(); },
  },
  // ─── 보기 ───
  {
    id: 'toggleSafe', group: 'view', icon: 'safe', name: `${P}.preview.safeArea`, detail: `${D}.toggleSafe`,
    keys: [bare('g', 'G')], shown: onEditor, checked: (c) => c.palette?.safeArea === true,
    run: (c) => { c.toggleSafe(); },
  },
  // 37-24 (E) — `Alt+Enter`(예전에 아무 일도 없던 키). 공급이 없으면(API 없음) 먹지 않는다.
  {
    id: 'fullscreen', group: 'view', icon: 'fullscreen', name: (c) => (c.palette?.fullscreen ? `${P}.preview.exitFullscreen` : `${P}.preview.fullscreen`), detail: `${D}.fullscreen`,
    keys: [{ key: 'enter', mod: false, alt: true, shift: false, combo: 'Alt+Enter' }],
    enabled: (c) => c.toggleFullscreen !== undefined, shown: onEditor, checked: (c) => c.palette?.fullscreen === true,
    run: (c) => { c.toggleFullscreen?.(); },
  },
  {
    id: 'toggleZoom', group: 'view', icon: 'fit', name: (c) => (c.palette?.zoom !== undefined && c.palette.zoom !== 'fit' ? `${P}.preview.fit` : `${P}.preview.actualSize`), detail: `${D}.toggleZoom`,
    keys: [bare('f', 'F')], shown: onEditor,
    run: (c) => { c.toggleZoom(); },
  },
  // ─── 가리키기·메모 ───
  {
    id: 'point', group: 'mode', icon: 'point', name: `${P}.preview.point`, detail: `${D}.point`,
    keys: [bare('p', 'P')], shown: onEditor, checked: (c) => c.palette?.interaction === 'point',
    run: (c) => { c.setInteraction('point'); },
  },
  {
    id: 'note', group: 'mode', icon: 'note', name: `${P}.preview.note`, detail: `${D}.note`,
    keys: [bare('n', 'N')], shown: onEditor, checked: (c) => c.palette?.interaction === 'note',
    run: (c) => { c.setInteraction('note'); },
  },
  {
    id: 'toggleMute', group: 'playback', icon: 'volumeOff', name: (c) => (c.palette?.muted ? `${P}.preview.unmute` : `${P}.preview.mute`), detail: `${D}.toggleMute`,
    keys: [bare('m', 'M')],
    enabled: (c) => c.toggleMute !== undefined, shown: onEditor, checked: (c) => c.palette?.muted === true,
    run: (c) => { c.toggleMute?.(); },
  },
  // ─── 서랍·판 (키 없음 — 레일·조작 줄·머리줄과 같은 상태) ───
  ...RAIL.map((r): StudioCommand => ({
    id: `drawer.${r.id}`, group: 'panel', icon: r.icon, name: `${P}.rail.${r.id}`, detail: `${D}.drawer_${r.id}`,
    shown: (c) => onEditor(c) && (r.when?.(c) ?? true), checked: (c) => c.palette?.drawer === r.id,
    run: (c) => { c.palette?.openDrawer(r.id); },
  })),
  {
    id: 'precision', group: 'panel', icon: 'precision', name: `${P}.precision.toggle`, detail: `${D}.precision`,
    shown: onEditor, checked: (c) => c.palette?.precisionOpen === true,
    run: (c) => { c.palette?.togglePrecision(); },
  },
  {
    id: 'aiPanel', group: 'panel', icon: 'sparkle', name: (c) => (c.palette?.aiCollapsed ? `${P}.ai.expand` : `${P}.ai.collapse`), detail: `${D}.aiPanel`,
    shown: (c) => onEditor(c) && c.palette?.historyOpen !== true,
    run: (c) => { c.palette?.toggleAi(); },
  },
  {
    id: 'history', group: 'panel', icon: 'history', name: `${P}.header.history`, detail: `${D}.history`,
    enabled: (c) => c.palette?.hasDoc !== false, shown: hasDoc, checked: (c) => c.palette?.historyOpen === true,
    run: (c) => { c.palette?.toggleHistory(); },
  },
  {
    id: 'checkpoint', group: 'panel', icon: 'checkpoint', name: `${P}.history.checkpoint`, detail: `${D}.checkpoint`,
    enabled: (c) => c.palette?.hasDoc !== false, shown: hasDoc,
    run: (c) => { c.palette?.checkpoint(); },
  },
  // §5.13 (V) 37-23 (K) — 화면 손잡이(바뀐 것 카드·대화 거르개)와 같은 함수. 장면 단위 받기·되돌리기는 확인 띠가 있어 카드에서만 한다.
  {
    id: 'undoPass', group: 'panel', icon: 'undoPass', name: `${P}.ai.undoPass`, detail: `${D}.undoPass`,
    enabled: (c) => !!c.palette?.undoPass, shown: hasDoc,
    run: (c) => { c.palette?.undoPass?.(); },
  },
  {
    id: 'sceneChat', group: 'panel', icon: 'chat', name: `${P}.sceneReview.chatFilter`, detail: `${D}.sceneChat`,
    enabled: (c) => (c.palette?.sceneChat?.options.length ?? 0) > 0, shown: hasDoc,
    run: (c, how) => { if (how.arg) c.palette?.sceneChat?.onChange(how.arg === SCENE_CHAT_ALL ? null : how.arg); },
    choices: (c, t, query) => {
      const chat = c.palette?.sceneChat;
      if (!chat) return [];
      return filterChoices([
        { id: SCENE_CHAT_ALL, label: t(`${P}.sceneReview.chatAll`), active: chat.value === null },
        ...chat.options.map((o) => ({ id: o.chapterId, label: o.label, active: o.chapterId === chat.value })),
      ], query);
    },
  },
  // ─── 문서 ───
  {
    id: 'openDoc', group: 'doc', icon: 'folderOpen', name: `${P}.palette.name.openDoc`, detail: `${D}.openDoc`,
    enabled: (c) => (c.palette?.docs.length ?? 0) > 0,
    // 갤러리가 열릴 때처럼 낡은 목록(이름·길이·고친 시각)을 새로 읽는다.
    prepare: (c) => { c.palette?.refreshDocs(); },
    run: (c, how) => { if (how.arg) c.palette?.openDoc(how.arg); },
    // 갤러리와 같은 목록·같은 순서·같은 제목 부분 일치(`galleryRows`).
    choices: (c, _t, query) => galleryRows(c.palette?.docs ?? [], query).map((d) => ({
      id: d.id, label: docLabel(d), active: d.id === c.palette?.currentDocId,
      hint: [docRatioLabel(d), formatDocLength(d.duration)].filter((x): x is string => !!x).join(' · '),
    })),
  },
  {
    id: 'newDoc', group: 'doc', icon: 'plus', name: `${P}.newDoc`, detail: `${D}.newDoc`,
    shown: hasDoc,
    run: (c) => { c.palette?.newDoc(); },
  },
  {
    id: 'format', group: 'doc', icon: 'film', name: `${P}.header.format`, detail: `${D}.format`,
    enabled: (c) => !c.disabled && c.palette?.format != null, shown: hasDoc,
    run: (c, how) => { if (isFormat(how.arg)) c.palette?.setFormat(how.arg); },
    choices: (c, t, query) => filterChoices(formatChoices(c.palette?.format ?? null, (id) => t(`${P}.formats.${id}`)), query),
  },
  // ─── 내보내기 (내보내기 판과 같은 함수) ───
  {
    id: 'renderNow', group: 'export', icon: 'export', name: `${P}.export.renderNow`, detail: `${D}.renderNow`,
    enabled: (c) => c.palette?.canExport === true, shown: hasDoc,
    run: (c) => { c.palette?.renderNow(); },
  },
  {
    id: 'exportPreset', group: 'export', icon: 'export', name: `${P}.palette.name.exportPreset`, detail: `${D}.exportPreset`,
    enabled: (c) => c.palette?.canExport === true, shown: hasDoc,
    run: (c, how) => { if (isFormat(how.arg)) c.palette?.exportPreset(how.arg); },
    choices: (c, t, query) => filterChoices(formatChoices(c.palette?.format ?? null, (id) => t(`${P}.export.preset_${id}`)), query),
  },
  {
    id: 'exportSettings', group: 'export', icon: 'sliders', name: `${P}.export.settings`, detail: `${D}.exportSettings`,
    enabled: (c) => c.palette?.hasDoc !== false, shown: hasDoc,
    run: (c) => { c.palette?.exportSettings(); },
  },
  {
    id: 'exportQueue', group: 'export', icon: 'queue', name: `${P}.export.queue.title`, detail: `${D}.exportQueue`,
    enabled: (c) => c.palette?.hasDoc !== false, shown: hasDoc,
    run: (c) => { c.palette?.exportQueue(); },
  },
  {
    id: 'png', group: 'export', icon: 'image', name: `${P}.export.png`, detail: `${D}.png`,
    enabled: (c) => c.palette?.canExport === true, shown: hasDoc,
    run: (c) => { c.palette?.png(); },
  },
  {
    id: 'srt', group: 'export', icon: 'captions', name: `${P}.export.srt`, detail: `${D}.srt`,
    enabled: (c) => c.palette?.hasCaptions === true, shown: hasDoc,
    run: (c) => { c.palette?.srt(); },
  },
];

/** id → 명령. */
export function studioCommand(id: string): StudioCommand | undefined {
  return STUDIO_COMMANDS.find((c) => c.id === id);
}

/** 그 명령의 첫 단축키 표기(`shortcutLabel()` 에 넘긴다). 키가 없으면 null. */
export function commandCombo(command: StudioCommand): string | null {
  return command.keys?.find((k) => k.combo !== undefined)?.combo ?? null;
}
