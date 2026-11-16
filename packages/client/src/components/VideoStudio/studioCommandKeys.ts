import { STUDIO_COMMANDS } from './studioCommands.js';
import type { StudioCommand, StudioCommandContext, StudioKeyBinding } from './studioCommandTypes.js';

/**
 * §5.13 (V) 37-22 (B) — 키 → 등록부 명령. 판정은 `ctrlKey || metaKey`. 표를 위에서 읽어 키가 맞고 `enabled` 가 참인 첫 줄 하나만
 * 실행한다. 공통 문턱(처리된 키 · 한글 조합 · 입력칸 · 팔레트 열림)을 넘은 키만 본다.
 */

/** 판정에 쓰는 키 사건의 모양(React `KeyboardEvent` 의 부분 — 시험이 이 모양으로 흉내 낸다). */
export interface StudioKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
  readonly nativeEvent: { readonly isComposing?: boolean };
  readonly target: unknown;
  preventDefault(): void;
}

/** 입력 중이면 스튜디오 단축키는 비켜 선다(글자를 치는 키를 가로채지 않는다). */
const TYPING_SELECTOR = 'input,textarea,select,[contenteditable="true"]';

function isTyping(target: unknown): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === 'function' && el.closest(TYPING_SELECTOR) !== null;
}

function bindingMatches(b: StudioKeyBinding, key: string, mod: boolean, e: Pick<StudioKeyEvent, 'shiftKey' | 'altKey'>): boolean {
  return b.key === key
    && (b.mod === undefined || b.mod === mod)
    && (b.shift === undefined || b.shift === e.shiftKey)
    && (b.alt === undefined || b.alt === e.altKey);
}

/** 이 키가 그 명령의 단축키인가(조건·문턱은 보지 않는다 — 팔레트가 제 여는 키로 닫힐 때). */
export function isCommandKey(e: Pick<StudioKeyEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, command: StudioCommand | undefined): boolean {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  return command?.keys?.some((b) => bindingMatches(b, key, mod, e)) ?? false;
}

/** 이 키가 부를 명령과 그 키(없으면 null). 순수 — 실행하지 않는다. */
export function findStudioKeyCommand(e: StudioKeyEvent, c: StudioCommandContext, table: readonly StudioCommand[] = STUDIO_COMMANDS): { readonly command: StudioCommand; readonly binding: StudioKeyBinding } | null {
  if (e.defaultPrevented || e.nativeEvent.isComposing) return null;
  if (c.paletteOpen || isTyping(e.target)) return null;
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  for (const command of table) {
    const binding = command.keys?.find((b) => bindingMatches(b, key, mod, e));
    if (binding && (command.enabled?.(c) ?? true)) return { command, binding };
  }
  return null;
}

/** 키를 받아 명령을 실행한다. 실행했고 `run` 이 `false` 가 아니면 키를 삼킨다(`preventDefault`). 실행했으면 true. */
export function dispatchStudioKey(e: StudioKeyEvent, c: StudioCommandContext, table: readonly StudioCommand[] = STUDIO_COMMANDS): boolean {
  const hit = findStudioKeyCommand(e, c, table);
  if (!hit) return false;
  const handled = hit.command.run(c, { shift: e.shiftKey, ...(hit.binding.arg ? { arg: hit.binding.arg } : {}) });
  if (handled !== false) e.preventDefault();
  return true;
}
