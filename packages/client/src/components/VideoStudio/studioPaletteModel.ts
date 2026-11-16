import { STUDIO_COMMANDS, commandCombo } from './studioCommands.js';
import { searchKey } from './docGalleryModel.js';
import type { StudioCommand, StudioCommandContext, StudioCommandGroup, Translate } from './studioCommandTypes.js';
import type { StudioIconName } from './studioIcons.js';

/**
 * §5.13 (V) 37-22 — 팔레트의 순수 판단(줄 만들기·검색·순서·키). 화면(`StudioPalette.tsx`)은 이 값을 그대로 그린다.
 */

/** 빈 검색에서 맨 위에 세우는 최근 명령 수. */
export const PALETTE_RECENT_MAX = 5;

/** 빈 검색일 때 묶음이 서는 순서(키 판정 순서인 표 순서와 다르다). */
export const PALETTE_GROUP_ORDER: readonly StudioCommandGroup[] = ['playback', 'edit', 'mode', 'view', 'panel', 'doc', 'export'];

export interface PaletteRow {
  readonly id: string;
  readonly group: StudioCommandGroup;
  readonly icon: StudioIconName;
  readonly name: string;
  readonly detail: string;
  /** `shortcutLabel()` 에 넘길 표기. */
  readonly combo: string | null;
  readonly enabled: boolean;
  readonly checked: boolean;
  readonly hasChoices: boolean;
  /** 표 순서(같은 점수의 마지막 순서). */
  readonly order: number;
  /** 지금 언어 + 영문 이름·설명·묶음·단축키를 `searchKey` 로 접은 것. */
  readonly haystack: string;
  readonly nameKey: string;
}

export interface PaletteLabels {
  readonly t: Translate;
  /** 영문 고정 번역(한글 화면에서 영문 낱말로도 찾게). */
  readonly tEn: Translate;
  /** 단축키 표시(`shortcutLabel`). */
  readonly shortcut: (combo: string) => string;
}

const groupKey = (group: StudioCommandGroup): string => `panel.videoStudio.palette.group.${group}`;

function nameKeyOf(command: StudioCommand, c: StudioCommandContext): string {
  return typeof command.name === 'function' ? command.name(c) : command.name;
}

/** 지금 세울 명령들 → 줄. `shown` 이 거짓인 명령은 빠지고, `enabled` 가 거짓이면 흐린 줄이 된다. */
export function paletteRows(c: StudioCommandContext, labels: PaletteLabels, table: readonly StudioCommand[] = STUDIO_COMMANDS): PaletteRow[] {
  const rows: PaletteRow[] = [];
  table.forEach((command, order) => {
    if (command.shown && !command.shown(c)) return;
    const key = nameKeyOf(command, c);
    const combo = commandCombo(command);
    const name = labels.t(key);
    const detail = labels.t(command.detail);
    const words = [name, detail, labels.t(groupKey(command.group)), labels.tEn(key), labels.tEn(command.detail), labels.tEn(groupKey(command.group))];
    if (combo) words.push(combo, labels.shortcut(combo));
    rows.push({
      id: command.id, group: command.group, icon: command.icon, name, detail, combo,
      enabled: command.enabled?.(c) ?? true, checked: command.checked?.(c) ?? false, hasChoices: command.choices !== undefined,
      order, haystack: searchKey(words.join(' ')), nameKey: searchKey(`${name} ${labels.tEn(key)}`),
    });
  });
  return rows;
}

export interface RankedRow extends PaletteRow {
  /** 빈 검색에서 '최근' 칸에 선다. */
  readonly recent: boolean;
}

/**
 * 검색 → 순서. 빈 검색: 최근 명령(쓴 순서) → 나머지는 묶음 순서·표 순서. 검색: 낱말마다 부분 일치한 줄만, 이름이 그 글자로 시작 → 이름에
 * 들어 있음 → 설명 등에만 있음 순, 같으면 최근에 쓴 것 → 표 순서.
 */
export function rankPaletteRows(rows: readonly PaletteRow[], query: string, recent: readonly string[]): RankedRow[] {
  const recentIndex = (id: string): number => { const i = recent.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const needle = searchKey(query);
  if (needle === '') {
    const head = recent.flatMap((id) => rows.filter((r) => r.id === id)).slice(0, PALETTE_RECENT_MAX);
    const headIds = new Set(head.map((r) => r.id));
    const rest = rows.filter((r) => !headIds.has(r.id))
      .sort((a, b) => PALETTE_GROUP_ORDER.indexOf(a.group) - PALETTE_GROUP_ORDER.indexOf(b.group) || a.order - b.order);
    return [...head.map((r) => ({ ...r, recent: true })), ...rest.map((r) => ({ ...r, recent: false }))];
  }
  const words = needle.split(/\s+/).filter(Boolean);
  const score = (r: PaletteRow): number => (r.nameKey.startsWith(needle) || r.nameKey.includes(` ${needle}`) ? 0 : r.nameKey.includes(needle) ? 1 : 2);
  return rows.filter((r) => words.every((w) => r.haystack.includes(w)))
    .map((r) => ({ ...r, recent: false, s: score(r) }))
    .sort((a, b) => a.s - b.s || recentIndex(a.id) - recentIndex(b.id) || a.order - b.order)
    .map(({ s: _s, ...r }) => r);
}

/** 실행한 명령을 최근 목록 맨 앞으로(중복 없이 · 상한). */
export function pushRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, PALETTE_RECENT_MAX);
}

export type PaletteKeyAction =
  | { readonly kind: 'move'; readonly index: number }
  | { readonly kind: 'run' }
  | { readonly kind: 'back' }
  | { readonly kind: 'close' }
  | { readonly kind: 'none' };

/** 다음(위·아래) 실행할 수 있는 줄. 없으면 그대로(가장자리에서 돌지 않는다 — 갤러리와 같다). */
export function nextEnabled(enabled: readonly boolean[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < enabled.length; i += dir) if (enabled[i]) return i;
  return from;
}

/**
 * 검색 칸 키 → 동작. 한글 조합 중에는 어떤 키도 가로채지 않는다(조합 확정 Enter 가 명령을 실행하면 안 된다).
 * `Esc` 는 2단계면 1단계로, 아니면 닫기. 2단계에서 빈 칸의 `Backspace` 는 뒤로.
 */
export function paletteKeyAction(key: string, s: { readonly composing: boolean; readonly enabled: readonly boolean[]; readonly active: number; readonly step: boolean; readonly queryEmpty: boolean }): PaletteKeyAction {
  if (s.composing) return { kind: 'none' };
  switch (key) {
    case 'ArrowDown': return s.enabled.length === 0 ? { kind: 'none' } : { kind: 'move', index: nextEnabled(s.enabled, s.active, 1) };
    case 'ArrowUp': return s.enabled.length === 0 ? { kind: 'none' } : { kind: 'move', index: nextEnabled(s.enabled, s.active, -1) };
    case 'Enter': return s.enabled[s.active] === true ? { kind: 'run' } : { kind: 'none' };
    case 'Escape': return s.step ? { kind: 'back' } : { kind: 'close' };
    case 'Backspace': return s.step && s.queryEmpty ? { kind: 'back' } : { kind: 'none' };
    default: return { kind: 'none' };
  }
}

/** 처음 고를 줄 — 첫 실행 가능한 줄(없으면 -1). */
export function firstEnabled(enabled: readonly boolean[]): number {
  return enabled.indexOf(true);
}
