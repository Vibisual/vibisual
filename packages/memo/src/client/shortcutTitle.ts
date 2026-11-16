import type { MemoClientHost } from '../host.js';
import type { MemoText } from './ui.js';

/** 단추 title: 호스트가 단축키 표기를 줄 때만 조합을 덧붙인다. */
export function titled(tr: MemoText, host: MemoClientHost, label: string, combo: string): string {
  return host.shortcutLabel ? tr('withShortcut', { label, keys: host.shortcutLabel(combo) }) : label;
}
