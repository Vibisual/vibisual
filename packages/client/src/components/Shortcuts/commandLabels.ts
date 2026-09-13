import { COMMANDS, type CommandId, type CommandScope } from '@vibisual/shared';

/**
 * commandLabels.ts — **명령 이름의 영어 원문 한 곳.**
 *
 * 번역 키는 `COMMANDS[id].labelKey` 이고 실제 문구는 로케일 파일에 있다. 여기 있는 것은
 * `t()` 의 `defaultValue` — 번역이 아직 없는 로케일에서도 빈 칸이 보이지 않게 한다.
 *
 * ⚠ **문구에 `Ctrl+` 를 박지 않는다.** 키는 사용자가 바꿀 수 있고 mac 에서는 기호가 다르므로,
 * 라벨은 **무엇을 하는지**만 말하고 키는 `KeyCap` 이 그린다(12개 로케일이 한꺼번에 틀어지는
 * 자리가 정확히 여기다).
 */

/** 명령 이름(영어 원문). */
export const COMMAND_LABEL_EN: Record<CommandId, string> = {
  'global.shortcutOverlay': 'Show keyboard shortcuts',
  'global.reopenClosedTab': 'Reopen closed tab',
  'canvas.copy': 'Copy selection',
  'canvas.paste': 'Paste',
  'canvas.deleteSelection': 'Delete selection',
  'bookmark.assign': 'Assign bookmark slot',
  'bookmark.jump': 'Jump to bookmark slot',
  'ide.tabNext': 'Next session tab',
  'ide.tabPrev': 'Previous session tab',
  'ide.tabNextAlt': 'Next session tab (alternate)',
  'ide.tabPrevAlt': 'Previous session tab (alternate)',
  'ide.tabNth': 'Jump to Nth session tab',
  'ide.renameTab': 'Rename session tab',
  'ide.dockLeft': 'Dock window to the left',
  'ide.dockRight': 'Dock window to the right',
  'ide.dockTop': 'Dock window to the top',
  'ide.dockBottom': 'Dock window to the bottom',
  'ide.toggleMaximize': 'Maximize or restore window',
  'ide.undock': 'Undock window',
  'ide.nextWindow': 'Bring next window to the front',
  'editor.save': 'Save file',
  'terminal.copy': 'Copy selection',
  'terminal.paste': 'Paste',
  'terminal.copyOrPass': 'Copy selection, or send to the shell',
  'terminal.pasteAlt': 'Paste (alternate)',
  'terminal.find': 'Find in terminal',
  'terminal.selectAll': 'Select all output',
  'terminal.fontIncrease': 'Larger terminal text',
  'terminal.fontDecrease': 'Smaller terminal text',
  'terminal.fontReset': 'Reset terminal text size',
};

/** 자리표를 쓰는 명령의 보충 한 줄(영어 원문). 없는 명령은 비운다. */
export const COMMAND_HINT_EN: Partial<Record<CommandId, string>> = {
  'bookmark.assign': 'Pins the current bubble or session to slot 1-10 (0 = slot 10).',
  'bookmark.jump': 'Jumps back to the bubble or session pinned to that slot.',
  'ide.tabNth': 'The last key is always the last tab, however many are open.',
  'terminal.copyOrPass': 'Copies when text is selected. With nothing selected the key goes to the shell, so Ctrl+C still interrupts.',
};

/** 스코프 이름(영어 원문) — 설정 화면·오버레이의 묶음 제목. */
export const SCOPE_LABEL_EN: Record<CommandScope, string> = {
  global: 'Anywhere',
  canvas: 'Canvas',
  ide: 'IDE window',
  editor: 'Code editor',
  terminal: 'Terminal',
  dialog: 'Dialogs',
};

/** 스코프 설명(영어 원문) — "어디서 듣는 키인가"를 한 줄로. */
export const SCOPE_DESC_EN: Record<CommandScope, string> = {
  global: 'Works everywhere, including while typing.',
  canvas: 'Works on the bubble map.',
  ide: 'Works while an IDE window is in front.',
  editor: 'Works in the file editor.',
  terminal: 'Works in the terminal.',
  dialog: 'Works while a dialog is open.',
};

/** 그 명령의 번역 키(없으면 식별자 그대로 — 표에 없는 값이 올 리는 없다). */
export function labelKeyOf(id: CommandId): string {
  return COMMANDS[id].labelKey;
}

/** 스코프의 번역 키. */
export function scopeLabelKey(scope: CommandScope): string {
  return `common.shortcuts.scope.${scope}`;
}

/** 스코프 설명의 번역 키. */
export function scopeDescKey(scope: CommandScope): string {
  return `common.shortcuts.scopeDesc.${scope}`;
}
