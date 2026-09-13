/**
 * keymap.ts — **앱 단축키의 단일 진실 공급원(SSOT).**
 *
 * 여태 단축키는 `keydown` 핸들러 128곳(78개 파일)에 흩어져 있었고, "무엇이 있는가"를 아는 곳이
 * 하나도 없었다. 그래서 세 가지가 동시에 불가능했다 — **힌트**(있는 줄도 모른다) ·
 * **재매핑**(고칠 자리가 없다) · **충돌 검사**(비교할 목록이 없다). 도움말(§6 인터랙션 규칙 표 ·
 * Guide 창)은 손으로 적어 두었기 때문에 구현과 어긋나도 아무도 알 수 없었다.
 *
 * 이 모듈은 **선언한 곳이 곧 실행하는 곳**이 되게 한다. `COMMANDS` 한 표에서
 * ① 실제 키 판정(`matchesBinding`) ② 화면 힌트 ③ 설정 화면 ④ 충돌 판정이 **전부** 나온다.
 * 표에 없는 키는 힌트에도 설정에도 뜨지 않는다 — **거짓말하지 않는 것**이 이 표의 첫 규칙이다.
 * (등록해 놓고 핸들러가 이 표를 안 보면, 사용자가 재매핑해도 아무 일이 안 일어난다.)
 *
 * ## 바인딩 문자열 규약 — 새 어휘를 발명하지 않는다
 * 이미 `client/utils/platform.ts` 의 `formatShortcut()` 이 쓰던 토큰을 그대로 쓴다.
 * - `Ctrl` = **mod** — win/linux 는 Ctrl, mac 은 ⌘. 판정은 `ctrlKey || metaKey`.
 * - `Control` = **진짜 Control** — 세 OS 모두 Control. `Control+Tab` 처럼 mac 에서 ⌘ 가
 *   OS 에 이미 잡힌 자리에 쓴다(⌘Tab = 앱 전환, §5.5 #17-37 ③).
 * - `Alt` · `Shift` · 키 토큰 하나. 예: `Ctrl+Shift+Z`, `Alt+Digit`, `Escape`.
 *
 * ## 왜 순수 함수인가
 * 플랫폼 분기를 **인자로 받는다**(`platform: PlatformName`). 실기(mac·linux)가 없는 우리에게는
 * Windows 개발기에서 세 OS 를 단위 테스트로 고정하는 것이 규칙 준수를 확인하는 유일한 방법이다
 * ([docs/rules/multiplatform.md] 5축 — 단축키).
 */

import type { PlatformName } from './pathCase.js';

// ─────────────────────────────────────────────────────────────────────────────
// 스코프 — 어디서 듣는 키인가
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 단축키가 살아 있는 범위.
 *
 * 이 축이 없으면 충돌 검사는 쓸모가 없다 — 이 저장소만 해도 `Escape` 62곳 · `Enter` 44곳이라
 * 스코프 없이 비교하면 전부 빨갛게 뜬다. 형제 스코프(캔버스 ↔ 터미널)는 같은 키를 써도
 * **실제로 부딪히지 않는다**(동시에 활성이 아니다).
 */
export type CommandScope = 'global' | 'canvas' | 'ide' | 'editor' | 'terminal' | 'dialog';

/**
 * 스코프 트리(자식 → 부모). `null` = 뿌리.
 *
 * ```
 * global
 * ├─ canvas
 * ├─ dialog          (모달이 열려 있는 동안만)
 * └─ ide
 *    ├─ editor
 *    └─ terminal
 * ```
 */
export const SCOPE_PARENT: Record<CommandScope, CommandScope | null> = {
  global: null,
  canvas: 'global',
  ide: 'global',
  dialog: 'global',
  editor: 'ide',
  terminal: 'ide',
};

/** 모든 스코프(설정 화면 그룹 순서 = 넓은 것부터). */
export const COMMAND_SCOPES: readonly CommandScope[] = [
  'global', 'canvas', 'ide', 'editor', 'terminal', 'dialog',
];

/** 자기 자신 → 부모 → … → `global`. */
export function scopeChain(scope: CommandScope): CommandScope[] {
  const chain: CommandScope[] = [];
  let cur: CommandScope | null = scope;
  // 트리는 상수라 순환이 없지만, 표를 잘못 고쳤을 때 무한 루프로 앱이 멎지 않도록 상한을 둔다.
  let guard = COMMAND_SCOPES.length + 1;
  while (cur && guard-- > 0) {
    chain.push(cur);
    cur = SCOPE_PARENT[cur];
  }
  return chain;
}

/**
 * 두 스코프가 **동시에 활성일 수 있는가**.
 * - `same` — 같은 스코프. 같은 키면 진짜 충돌이다.
 * - `ancestor` — 하나가 다른 하나의 조상. 자손이 조상을 **가린다**(대개 의도된 것 — 경고만).
 * - `none` — 형제. 같은 키를 써도 부딪히지 않는다.
 */
export function scopeRelation(a: CommandScope, b: CommandScope): 'same' | 'ancestor' | 'none' {
  if (a === b) return 'same';
  if (scopeChain(a).includes(b) || scopeChain(b).includes(a)) return 'ancestor';
  return 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// 키 토큰 — 자판 배열과 무관한 물리 키
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `KeyboardEvent.code` → 우리 키 토큰.
 *
 * **`e.key` 가 아니라 `e.code`** 를 쓴다 — 독일어(QWERTZ)·프랑스어(AZERTY) 자판에서 `e.key` 는
 * 자판이 새겨진 글자를 주므로 `Ctrl+Z` 가 자판마다 다른 물리 위치가 된다. `useBookmarks` 가 이미
 * 같은 이유로 `e.code` 를 쓰고 있다(§5.4 #30).
 */
export function keyTokenFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] as string;

  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1] as string;

  const fn = /^(F([1-9]|1[0-9]|2[0-4]))$/.exec(code);
  if (fn) return fn[1] as string;

  return NAMED_CODE_TOKEN[code] ?? null;
}

/** 이름이 붙은 물리 키(`code`) → 토큰. 여기 없는 코드는 바인딩에 쓸 수 없다. */
const NAMED_CODE_TOKEN: Record<string, string> = {
  Escape: 'Escape',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Slash: '/',
  NumpadDivide: '/',
  Backslash: '\\',
  Backquote: '`',
  Minus: '-',
  NumpadSubtract: '-',
  Equal: '=',
  NumpadAdd: '+',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  NumpadDecimal: '.',
};

/** 토큰 → 그 토큰이 받아들이는 `code` 들(역방향). 테스트·설명용. */
export function codesForKeyToken(token: string): string[] {
  const out: string[] = [];
  if (/^[A-Z]$/.test(token)) out.push(`Key${token}`);
  else if (/^[0-9]$/.test(token)) out.push(`Digit${token}`, `Numpad${token}`);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(token)) out.push(token);
  for (const [code, mapped] of Object.entries(NAMED_CODE_TOKEN)) {
    if (mapped === token) out.push(code);
  }
  return out;
}

/**
 * 자리표(placeholder) 토큰 — 한 명령이 **여러 키를 한 벌로** 받는 자리.
 *
 * 북마크(`Alt+1`…`Alt+0`)를 명령 20개로 쪼개면 설정 화면이 그것만으로 가득 찬다. 그렇다고
 * 표에서 빼면 힌트·충돌 검사가 그 키를 모르게 된다 — 자리표가 그 사이를 메운다.
 */
export const PLACEHOLDER_KEYS: Record<string, string[]> = {
  /** `0`~`9` — §5.4 #30 북마크 슬롯(0 = 10번). */
  Digit: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  /** `1`~`9` — §5.5 #17-37 N번째 탭(9 = 마지막). */
  Digit1To9: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
};

/** 자리표 토큰의 화면 표기(`Alt+1…0`). */
export const PLACEHOLDER_LABEL: Record<string, string> = {
  Digit: '1…0',
  Digit1To9: '1…9',
};

// ─────────────────────────────────────────────────────────────────────────────
// 바인딩 파싱 / 표기
// ─────────────────────────────────────────────────────────────────────────────

/** 바인딩 하나를 뜯어 놓은 모양. */
export interface ParsedBinding {
  /** `Ctrl` 토큰 — win/linux Ctrl · mac ⌘. 판정은 `ctrlKey || metaKey`. */
  mod: boolean;
  /** `Control` 토큰 — 세 OS 모두 진짜 Control. */
  control: boolean;
  alt: boolean;
  shift: boolean;
  /** 키 토큰(대문자 정규화). 자리표(`Digit`)일 수 있다. */
  key: string;
}

/** 모디파이어 별칭 → 우리 축. 대소문자 무시. */
const MODIFIER_ALIAS: Record<string, 'mod' | 'control' | 'alt' | 'shift'> = {
  ctrl: 'mod', cmd: 'mod', command: 'mod', meta: 'mod', mod: 'mod',
  control: 'control',
  alt: 'alt', option: 'alt', opt: 'alt',
  shift: 'shift',
};

/** 키 토큰 별칭 → 정규 토큰. */
const KEY_ALIAS: Record<string, string> = {
  esc: 'Escape', escape: 'Escape',
  del: 'Delete', delete: 'Delete',
  ins: 'Insert', insert: 'Insert',
  return: 'Enter', enter: 'Enter',
  space: 'Space', spacebar: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  home: 'Home', end: 'End',
  pageup: 'PageUp', pgup: 'PageUp',
  pagedown: 'PageDown', pgdn: 'PageDown',
  up: 'Up', arrowup: 'Up',
  down: 'Down', arrowdown: 'Down',
  left: 'Left', arrowleft: 'Left',
  right: 'Right', arrowright: 'Right',
  digit: 'Digit', 'digit1to9': 'Digit1To9',
};

/**
 * `'Ctrl+Shift+Z'` → 토큰 배열.
 * 마지막 `+` 는 **키 자체**일 수 있으므로(`Ctrl++` = 확대) 끝에 붙은 것은 쪼개지 않는다.
 * (`formatShortcut` 의 `splitCombo` 와 같은 규칙 — 두 벌이 되면 한쪽만 고쳐져 어긋난다.)
 */
function splitCombo(combo: string): string[] {
  return combo
    .split(/\+(?!$)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 키 토큰 하나를 정규화. 받아들일 수 없으면 `null`. */
function normalizeKeyToken(raw: string): string | null {
  const lower = raw.toLowerCase();
  const aliased = KEY_ALIAS[lower];
  if (aliased) return aliased;
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^[0-9]$/.test(lower)) return lower;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
  // 이름 있는 물리 키(대소문자 무시) — `PageDown` 등.
  for (const token of Object.values(NAMED_CODE_TOKEN)) {
    if (token.toLowerCase() === lower) return token;
  }
  // 구두점은 한 글자 그대로.
  if (raw.length === 1 && Object.values(NAMED_CODE_TOKEN).includes(raw)) return raw;
  return null;
}

/** 바인딩 문자열 → 뜯어 놓은 모양. 못 읽으면 `null`(조용히 무시할 자리). */
export function parseBinding(binding: string): ParsedBinding | null {
  if (typeof binding !== 'string' || binding.trim().length === 0) return null;
  const tokens = splitCombo(binding);
  if (tokens.length === 0) return null;

  const out: ParsedBinding = { mod: false, control: false, alt: false, shift: false, key: '' };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    const axis = MODIFIER_ALIAS[token.toLowerCase()];
    if (axis && i < tokens.length - 1) {
      out[axis] = true;
      continue;
    }
    // 마지막 토큰이 키다. 모디파이어만 있고 키가 없으면 바인딩이 아니다.
    if (i !== tokens.length - 1) return null;
    const key = normalizeKeyToken(token);
    if (!key) return null;
    out.key = key;
  }
  return out.key ? out : null;
}

/** 뜯어 놓은 모양 → 정규 문자열(`Ctrl+Shift+Z`). 순서는 항상 같다 — 비교의 기준이 된다. */
export function formatBinding(b: ParsedBinding): string {
  const parts: string[] = [];
  if (b.control) parts.push('Control');
  if (b.mod) parts.push('Ctrl');
  if (b.alt) parts.push('Alt');
  if (b.shift) parts.push('Shift');
  parts.push(b.key);
  return parts.join('+');
}

/** 바인딩 문자열을 정규 표기로. 못 읽으면 `null`. */
export function normalizeBinding(binding: string): string | null {
  const parsed = parseBinding(binding);
  return parsed ? formatBinding(parsed) : null;
}

/** 자리표를 실제 키들로 펼친다. 자리표가 아니면 자기 자신 하나. */
export function expandBinding(binding: string): string[] {
  const parsed = parseBinding(binding);
  if (!parsed) return [];
  const keys = PLACEHOLDER_KEYS[parsed.key];
  if (!keys) return [formatBinding(parsed)];
  return keys.map((key) => formatBinding({ ...parsed, key }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 키 이벤트 판정
// ─────────────────────────────────────────────────────────────────────────────

/** `KeyboardEvent` 중 판정에 쓰는 것만. 테스트가 진짜 이벤트를 만들지 않아도 되게 좁게 받는다. */
export interface KeyEventLike {
  /** 자판 배열과 무관한 물리 키(`KeyS`·`Digit3`·`PageDown`). */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * 이 이벤트가 그 바인딩인가.
 *
 * - `Ctrl` 토큰 → `ctrlKey || metaKey`(mac 은 ⌘). 멀티플랫폼 5축의 정본 규칙.
 * - `Control` 토큰 → `ctrlKey` 만. mac 에서도 진짜 Control(⌘Tab 은 OS 가 가져간다).
 * - **모디파이어는 정확히 일치해야 한다** — `Ctrl+C` 바인딩은 `Ctrl+Shift+C` 에 반응하지 않는다.
 *   느슨하게 두면 서로 다른 두 단축키가 한 손짓에 함께 발동한다.
 */
export function matchesBinding(e: KeyEventLike, binding: string): boolean {
  const b = parseBinding(binding);
  if (!b) return false;

  const token = keyTokenFromCode(e.code);
  if (!token) return false;

  const allowed = PLACEHOLDER_KEYS[b.key];
  if (allowed) {
    if (!allowed.includes(token)) return false;
  } else if (token !== b.key) {
    return false;
  }

  if (b.alt !== e.altKey) return false;
  if (b.shift !== e.shiftKey) return false;

  if (b.control) {
    // 진짜 Control 자리 — ⌘ 가 함께 눌린 것은 다른 손짓이다.
    if (!e.ctrlKey || e.metaKey) return false;
  } else if (b.mod) {
    if (!e.ctrlKey && !e.metaKey) return false;
  } else if (e.ctrlKey || e.metaKey) {
    // 모디파이어 없는 바인딩은 Ctrl/⌘ 가 눌린 상태를 가로채지 않는다.
    return false;
  }
  return true;
}

/** 이 이벤트가 눌린 조합을 바인딩 문자열로. 모디파이어만 눌렸으면 `null`(아직 조합이 아니다). */
export function bindingFromEvent(e: KeyEventLike, platform: PlatformName): string | null {
  const token = keyTokenFromCode(e.code);
  if (!token) return null;
  const mac = platform === 'darwin';
  return formatBinding({
    // mac 은 ⌘(metaKey)가 mod, Control 은 그대로 Control.
    // win/linux 는 Ctrl 하나뿐이라 mod 로 읽는다(진짜 Control 자리는 사용자가 만들지 않는다).
    mod: mac ? e.metaKey : e.ctrlKey,
    control: mac ? e.ctrlKey : false,
    alt: e.altKey,
    shift: e.shiftKey,
    key: token,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 명령 표 — 이 앱의 단축키 전부
// ─────────────────────────────────────────────────────────────────────────────

/** 명령 하나의 정의. */
export interface CommandDef {
  /** 어디서 듣는가. */
  scope: CommandScope;
  /** 기본 바인딩(정규 표기). `''` = 기본값 없음(사용자가 붙일 수 있는 빈 자리). */
  defaultBinding: string;
  /** i18n 키(`common.shortcuts.cmd.<id>`). 번역문에 `Ctrl+` 를 박지 않기 위해 **이름만** 여기 둔다. */
  labelKey: string;
  /**
   * 입력창·터미널에 포커스가 있어도 살아 있어야 하는가.
   *
   * 기본은 `false` — 타이핑을 가로채지 않는다. 탭 전환처럼 "어디서든 되어야 하는" 것만 `true`.
   */
  typingSafe?: boolean;
  /** 자리표를 쓰는 명령의 보충 설명 키(선택). */
  hintKey?: string;
}

/**
 * **등록된 단축키 전부.** 여기 없는 키는 힌트에도 설정에도 뜨지 않는다.
 *
 * ⚠ **핸들러가 이 표를 보지 않는 명령은 넣지 마라.** 넣어 두면 사용자가 재매핑해도 아무 일이
 * 일어나지 않는 "읽히지 않는 설정 스위치"가 된다 — 화면은 바뀌었는데 동작은 그대로인 그 결함이다.
 * 새 단축키는 이 표에 한 줄 + `useCommand(id, handler)` 한 줄이 전부다(§4 확장 포인트).
 */
export const COMMANDS = {
  // ── global — 어디서든 ──────────────────────────────────────────────────────
  'global.shortcutOverlay': {
    scope: 'global',
    defaultBinding: 'Ctrl+/',
    labelKey: 'common.shortcuts.cmd.global.shortcutOverlay',
    typingSafe: true,
  },
  // §5.4 #14-4 — 방금 닫은 탭 되살리기. 브라우저가 30년 가까이 같은 키를 써 왔으므로 여기서
  //   다른 키를 발명하면 그것만으로 못 찾는 기능이 된다.
  //   `typingSafe` 를 주지 **않는다** — 터미널은 xterm 의 textarea 라 "타이핑 중"으로 잡히고,
  //   거기서는 Ctrl+Shift+T 가 셸·터미널 쪽 관습(새 탭)이라 우리가 뺏으면 안 된다.
  'global.reopenClosedTab': {
    scope: 'global',
    defaultBinding: 'Ctrl+Shift+T',
    labelKey: 'common.shortcuts.cmd.global.reopenClosedTab',
  },

  // ── canvas — 캔버스를 보고 있을 때 ────────────────────────────────────────
  'canvas.copy': {
    scope: 'canvas',
    defaultBinding: 'Ctrl+C',
    labelKey: 'common.shortcuts.cmd.canvas.copy',
  },
  'canvas.paste': {
    scope: 'canvas',
    defaultBinding: 'Ctrl+V',
    labelKey: 'common.shortcuts.cmd.canvas.paste',
  },
  // §5.4 #34 — 고른 것을 지운다. **`Backspace` 는 일부러 없다**(사용자 지시 2026-09-11).
  //   종전에는 `BubbleMap` 의 옛 window 리스너가 `Delete`/`Backspace` 를 함께 받았고, 그 자리에는
  //   스코프도 IME 판정도 없어 **IDE 창·팝업 안에서 누른 지우기가 캔버스의 버블을 지웠다**
  //   (실측 2026-09-11: 도는 에이전트 버블이 휴지통으로 갔고 사용자는 누른 적이 없었다).
  //   표로 올라온 지금은 이 절의 규약이 그대로 걸린다 — `canvas` 스코프 밖에서는 울리지 않고,
  //   `typingSafe` 가 없으므로 입력칸(INPUT·TEXTAREA·contentEditable)에서도 비켜서며,
  //   모디파이어 없는 바인딩이라 `Ctrl+Delete` 같은 조합도 가로채지 않는다(`matchesBinding`).
  'canvas.deleteSelection': {
    scope: 'canvas',
    defaultBinding: 'Delete',
    labelKey: 'common.shortcuts.cmd.canvas.deleteSelection',
  },

  // ── bookmark — 캔버스·IDE 어디서든(§5.4 #30) ──────────────────────────────
  // 스코프가 `global` 인 이유: 북마크는 "지금 보고 있는 화면이 어디든" 그 자리를 찍고 그 자리로
  // 가는 기능이다(IDE 안에서도 동작한다). 타이핑 회피는 각 처리기가 스스로 판단한다 —
  // 지정은 IDE 안에서라면 입력칸에서도 받고(일반 타이핑이 아니다), 점프는 어디서든 비켜선다.
  'bookmark.assign': {
    scope: 'global',
    defaultBinding: 'Alt+Digit',
    labelKey: 'common.shortcuts.cmd.bookmark.assign',
    hintKey: 'common.shortcuts.cmd.bookmark.assignHint',
    typingSafe: true,
  },
  'bookmark.jump': {
    scope: 'global',
    defaultBinding: 'Digit',
    labelKey: 'common.shortcuts.cmd.bookmark.jump',
    hintKey: 'common.shortcuts.cmd.bookmark.jumpHint',
  },

  // ── ide — IDE 창이 앞에 있을 때 ───────────────────────────────────────────
  // Tab 계열만 진짜 Control 이다 — mac 의 ⌘Tab 은 OS 앱 전환이라 우리에게 오지 않는다(#17-37 ③).
  'ide.tabNext': {
    scope: 'ide',
    defaultBinding: 'Control+Tab',
    labelKey: 'common.shortcuts.cmd.ide.tabNext',
    typingSafe: true,
  },
  'ide.tabPrev': {
    scope: 'ide',
    defaultBinding: 'Control+Shift+Tab',
    labelKey: 'common.shortcuts.cmd.ide.tabPrev',
    typingSafe: true,
  },
  'ide.tabNextAlt': {
    scope: 'ide',
    defaultBinding: 'Ctrl+PageDown',
    labelKey: 'common.shortcuts.cmd.ide.tabNextAlt',
    typingSafe: true,
  },
  'ide.tabPrevAlt': {
    scope: 'ide',
    defaultBinding: 'Ctrl+PageUp',
    labelKey: 'common.shortcuts.cmd.ide.tabPrevAlt',
    typingSafe: true,
  },
  'ide.tabNth': {
    scope: 'ide',
    defaultBinding: 'Ctrl+Digit1To9',
    labelKey: 'common.shortcuts.cmd.ide.tabNth',
    hintKey: 'common.shortcuts.cmd.ide.tabNthHint',
    typingSafe: true,
  },

  // 탭 이름 바꾸기 — 터미널이 포커스를 쥔 상태(xterm textarea)에서도 되어야 하므로 `typingSafe`.
  //   리네임 입력칸 자기 자신만 처리기가 스스로 제외한다(VS Code 와 같은 F2).
  'ide.renameTab': {
    scope: 'ide',
    defaultBinding: 'F2',
    labelKey: 'common.shortcuts.cmd.ide.renameTab',
    typingSafe: true,
  },

  // ── ide — 창 배치(§5.5 #17-1) ─────────────────────────────────────────────
  // `Ctrl+Alt` 인 이유: 일부 유럽 자판에서 AltGr 이 곧 Ctrl+Alt 라 **글을 치는 중에는 비켜서야**
  // 한다. 그래서 이 묶음만은 `typingSafe` 를 주지 않는다(입력칸에서는 아예 듣지 않는다).
  'ide.dockLeft': {
    scope: 'ide',
    defaultBinding: 'Ctrl+Alt+Left',
    labelKey: 'common.shortcuts.cmd.ide.dockLeft',
  },
  'ide.dockRight': {
    scope: 'ide',
    defaultBinding: 'Ctrl+Alt+Right',
    labelKey: 'common.shortcuts.cmd.ide.dockRight',
  },
  'ide.dockTop': {
    scope: 'ide',
    defaultBinding: 'Ctrl+Alt+Up',
    labelKey: 'common.shortcuts.cmd.ide.dockTop',
  },
  'ide.dockBottom': {
    scope: 'ide',
    defaultBinding: 'Ctrl+Alt+Down',
    labelKey: 'common.shortcuts.cmd.ide.dockBottom',
  },
  'ide.toggleMaximize': {
    scope: 'ide',
    defaultBinding: 'Ctrl+Alt+Enter',
    labelKey: 'common.shortcuts.cmd.ide.toggleMaximize',
  },
  'ide.undock': {
    scope: 'ide',
    defaultBinding: 'Ctrl+Alt+D',
    labelKey: 'common.shortcuts.cmd.ide.undock',
  },
  'ide.nextWindow': {
    scope: 'ide',
    defaultBinding: 'Ctrl+Alt+W',
    labelKey: 'common.shortcuts.cmd.ide.nextWindow',
  },

  // ── editor — 코드 편집창 안 ───────────────────────────────────────────────
  // 편집창은 `textarea` 라 포커스가 있으면 항상 "타이핑 중"이다. 그래서 편집기 명령은
  // 전부 `typingSafe: true` 여야 한다 — 아니면 정작 편집할 때 하나도 안 듣는다.
  'editor.save': {
    scope: 'editor',
    defaultBinding: 'Ctrl+S',
    labelKey: 'common.shortcuts.cmd.editor.save',
    typingSafe: true,
  },

  // ── terminal — 터미널 안 ──────────────────────────────────────────────────
  // 터미널은 셸이 키를 먹는 자리라 규칙이 하나 더 있다: **셸에게 넘겨야 하는 키를 뺏지 않는다.**
  // 그래서 `Ctrl+C` 는 선택이 있을 때만 우리 것이고(없으면 SIGINT 로 내려간다), 그 판단은
  // 처리기가 `false` 를 돌려주는 것으로 표현한다.
  'terminal.copy': {
    scope: 'terminal',
    defaultBinding: 'Ctrl+Shift+C',
    labelKey: 'common.shortcuts.cmd.terminal.copy',
    typingSafe: true,
  },
  'terminal.paste': {
    scope: 'terminal',
    defaultBinding: 'Ctrl+Shift+V',
    labelKey: 'common.shortcuts.cmd.terminal.paste',
    typingSafe: true,
  },
  'terminal.copyOrPass': {
    scope: 'terminal',
    defaultBinding: 'Ctrl+C',
    labelKey: 'common.shortcuts.cmd.terminal.copyOrPass',
    hintKey: 'common.shortcuts.cmd.terminal.copyOrPassHint',
    typingSafe: true,
  },
  'terminal.pasteAlt': {
    scope: 'terminal',
    defaultBinding: 'Ctrl+V',
    labelKey: 'common.shortcuts.cmd.terminal.pasteAlt',
    typingSafe: true,
  },
  'terminal.find': {
    scope: 'terminal',
    defaultBinding: 'Ctrl+F',
    labelKey: 'common.shortcuts.cmd.terminal.find',
    typingSafe: true,
  },
  'terminal.selectAll': {
    scope: 'terminal',
    defaultBinding: 'Ctrl+A',
    labelKey: 'common.shortcuts.cmd.terminal.selectAll',
    typingSafe: true,
  },
  'terminal.fontIncrease': {
    scope: 'terminal',
    defaultBinding: 'Ctrl+=',
    labelKey: 'common.shortcuts.cmd.terminal.fontIncrease',
    typingSafe: true,
  },
  'terminal.fontDecrease': {
    scope: 'terminal',
    defaultBinding: 'Ctrl+-',
    labelKey: 'common.shortcuts.cmd.terminal.fontDecrease',
    typingSafe: true,
  },
  'terminal.fontReset': {
    scope: 'terminal',
    defaultBinding: 'Ctrl+0',
    labelKey: 'common.shortcuts.cmd.terminal.fontReset',
    typingSafe: true,
  },
} as const satisfies Record<string, CommandDef>;

/** 등록된 명령 식별자. */
export type CommandId = keyof typeof COMMANDS;

/**
 * 명령 정의를 **넓은 타입으로** 꺼낸다.
 *
 * `COMMANDS` 는 `as const satisfies` 라 항목마다 리터럴 타입이고, 그 유니온에서는 `typingSafe`
 * 처럼 **일부 항목에만 있는 칸**을 읽을 수 없다(그 칸이 없는 항목이 유니온에 섞여 있어서다).
 * 읽는 쪽은 전부 이 함수를 지난다.
 */
export function commandDef(id: CommandId): CommandDef {
  return COMMANDS[id];
}

/** 명령 목록(표 순서 그대로 — 설정 화면·오버레이가 이 순서로 그린다). */
export const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[];

/** 이 식별자가 표에 있는가(서버가 받은 값을 믿지 않기 위해). */
export function isCommandId(id: string): id is CommandId {
  return Object.prototype.hasOwnProperty.call(COMMANDS, id);
}

/** 기본 바인딩 전체. */
export function defaultKeymap(): Record<CommandId, string> {
  const out = {} as Record<CommandId, string>;
  for (const id of COMMAND_IDS) out[id] = COMMANDS[id].defaultBinding;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 사용자 덮어쓰기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 사용자가 바꾼 것만 담는다. **기본값은 코드에 둔다** — 그래야 다음 판올림에서 기본 바인딩을
 * 고칠 수 있고, 사용자가 안 건드린 칸은 자동으로 새 기본값을 따라간다(§3.2.2 설정 규약과 같은 결).
 *
 * 값이 `null` 이면 **해제**(그 명령을 키보드에서 내림)다 — "기본값으로 되돌림"과 구별해야 하므로
 * 지우는 것(키 삭제)과 다른 값이다.
 */
export type KeymapOverrides = Record<string, string | null>;

/** 받은 덮어쓰기를 믿을 수 있는 모양으로. 모르는 명령·못 읽는 바인딩은 버린다. */
export function normalizeKeymapOverrides(raw: unknown): KeymapOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: KeymapOverrides = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCommandId(id)) continue;
    if (value === null) { out[id] = null; continue; }
    if (typeof value !== 'string') continue;
    const normalized = normalizeBinding(value);
    if (!normalized) continue;
    // 기본값과 같으면 덮어쓸 것이 없다 — 저장해 두면 기본값이 바뀌어도 옛 값에 묶인다.
    if (normalized === COMMANDS[id].defaultBinding) continue;
    out[id] = normalized;
  }
  return out;
}

/** 기본값 + 덮어쓰기 = 지금 실제로 도는 바인딩. `null` = 해제된 명령. */
export function resolveKeymap(overrides: KeymapOverrides | undefined): Record<CommandId, string | null> {
  const out = {} as Record<CommandId, string | null>;
  for (const id of COMMAND_IDS) {
    const override = overrides ? overrides[id] : undefined;
    out[id] = override === undefined ? COMMANDS[id].defaultBinding : override;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 충돌 판정
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OS·창 관리자가 이미 가져간 조합. 여기에 배정하면 **우리에게 키가 오지 않는다** —
 * 사용자는 "설정은 했는데 안 먹는다"만 겪게 되므로 배정 자체를 막고 이유를 말한다.
 *
 * 표기는 그 OS 에서 사용자가 실제로 누르는 물리 조합 기준이다(mac 의 `Ctrl` = ⌘).
 */
export const OS_RESERVED_BINDINGS: Record<'win32' | 'darwin' | 'linux', readonly string[]> = {
  win32: [
    'Alt+Tab', 'Alt+F4', 'Alt+Escape',
    'Control+Shift+Escape',
    'Control+Alt+Delete',
  ],
  darwin: [
    // mac 에서 `Ctrl` 토큰은 ⌘ 다 — ⌘Tab(앱 전환)·⌘Space(Spotlight)·⌘Q(종료)는 OS 가 먼저 먹는다.
    'Ctrl+Tab', 'Ctrl+Space', 'Ctrl+Q', 'Ctrl+H', 'Ctrl+M',
    'Ctrl+Alt+Escape',
    'Ctrl+Shift+3', 'Ctrl+Shift+4', 'Ctrl+Shift+5',
  ],
  linux: [
    'Alt+Tab', 'Alt+F4', 'Alt+F2',
    'Control+Alt+T', 'Control+Alt+Delete',
  ],
};

/** 판정 결과 한 건. */
export type BindingIssueKind =
  /** 같은 스코프에 같은 조합 — 확정 불가. */
  | 'conflict'
  /** 자손이 조상을 가린다 — 대개 의도된 것이라 경고만. */
  | 'shadow'
  /** OS 가 이미 가져간 조합 — 우리에게 키가 오지 않는다. */
  | 'os-reserved'
  /** 모디파이어가 없어 입력창에서는 안 먹는다. */
  | 'typing-risk';

export interface BindingIssue {
  kind: BindingIssueKind;
  /** 부딪히는 상대 명령들(`conflict`·`shadow` 일 때). */
  with: CommandId[];
  /** 겹친 구체 조합(자리표를 펼친 뒤의 실제 키). */
  at?: string;
}

/** 문제 하나라도 확정을 막는가. `conflict`·`os-reserved` 만 막는다. */
export function blocksAssignment(issues: readonly BindingIssue[]): boolean {
  return issues.some((i) => i.kind === 'conflict' || i.kind === 'os-reserved');
}

/**
 * 이 명령에 이 바인딩을 줬을 때 무엇이 걸리는가.
 *
 * @param id       배정하려는 명령
 * @param binding  주려는 바인딩(정규 표기 아니어도 된다)
 * @param resolved 지금 도는 전체 바인딩(`resolveKeymap` 결과)
 * @param platform 판정할 OS — **인자로 받는다**(win 개발기에서 세 OS 를 테스트로 고정)
 */
export function inspectBinding(
  id: CommandId,
  binding: string,
  resolved: Record<CommandId, string | null>,
  platform: PlatformName,
): BindingIssue[] {
  const parsed = parseBinding(binding);
  if (!parsed) return [];
  const issues: BindingIssue[] = [];
  const mine = new Set(expandBinding(formatBinding(parsed)));

  // ① OS 예약 — 우리에게 키가 오지 않는 자리.
  const reserved = OS_RESERVED_BINDINGS[platform as 'win32' | 'darwin' | 'linux'] ?? [];
  for (const r of reserved) {
    const normalized = normalizeBinding(r);
    if (normalized && mine.has(normalized)) {
      issues.push({ kind: 'os-reserved', with: [], at: normalized });
      break;
    }
  }

  // ② 타이핑 위험 — 모디파이어 없는 조합은 입력창에서 살 수 없다.
  if (!parsed.mod && !parsed.control && !parsed.alt) {
    issues.push({ kind: 'typing-risk', with: [] });
  }

  // ③ 다른 명령과의 겹침 — 스코프 관계로 갈린다.
  const myScope = COMMANDS[id].scope;
  const sameScope: CommandId[] = [];
  const shadowing: CommandId[] = [];
  let firstOverlap: string | undefined;
  for (const other of COMMAND_IDS) {
    if (other === id) continue;
    const otherBinding = resolved[other];
    if (!otherBinding) continue;
    const overlap = expandBinding(otherBinding).find((b) => mine.has(b));
    if (!overlap) continue;
    const relation = scopeRelation(myScope, COMMANDS[other].scope);
    if (relation === 'same') { sameScope.push(other); firstOverlap ??= overlap; }
    else if (relation === 'ancestor') { shadowing.push(other); firstOverlap ??= overlap; }
    // 형제(`none`)는 동시에 활성이 아니라 부딪히지 않는다 — 여기가 오탐의 대부분을 없앤다.
  }
  if (sameScope.length > 0) issues.push({ kind: 'conflict', with: sameScope, at: firstOverlap });
  if (shadowing.length > 0) issues.push({ kind: 'shadow', with: shadowing, at: firstOverlap });

  return issues;
}

/** 지금 키맵 전체에서 **실제 충돌**만 뽑는다(설정 화면의 "충돌만 보기"). */
export function findKeymapConflicts(
  resolved: Record<CommandId, string | null>,
  platform: PlatformName,
): Array<{ id: CommandId; issues: BindingIssue[] }> {
  const out: Array<{ id: CommandId; issues: BindingIssue[] }> = [];
  for (const id of COMMAND_IDS) {
    const binding = resolved[id];
    if (!binding) continue;
    const issues = inspectBinding(id, binding, resolved, platform).filter(
      (i) => i.kind === 'conflict' || i.kind === 'os-reserved',
    );
    if (issues.length > 0) out.push({ id, issues });
  }
  return out;
}
