import type { CommandId } from '@vibisual/shared';
import { useKeymapStore } from '../../stores/keymap.js';
import { bindingLabel } from './bindingLabel.js';

/**
 * useBindingLabel.ts — **툴팁·`title` 안에 넣을 단축키 문구.**
 *
 * `KeyCap` 을 그릴 수 없는 자리(네이티브 `title`, `aria-label`, 번역문 보간)가 있다. 그런 곳에
 * `shortcutLabel('Ctrl+F')` 처럼 키를 적어 두면 사용자가 재매핑한 순간 **틀린 말**이 된다.
 * 이 훅은 같은 자리를 레지스트리의 지금 값으로 채운다.
 *
 * 스토어를 구독하므로 다른 창에서 키를 바꿔도(WS `keymap_updated`) 이 문구가 따라 바뀐다.
 */

/** 그 명령의 현재 **바인딩 문자열**(표기 전). 여러 개를 묶어 그릴 때 쓴다. */
export function useBindingRaw(cmd: CommandId): string | null {
  return useKeymapStore((s) => s.resolved[cmd]);
}

/** 그 명령의 현재 키 표기(해제됐으면 빈 문자열). */
export function useBindingLabel(cmd: CommandId): string {
  const binding = useKeymapStore((s) => s.resolved[cmd]);
  return bindingLabel(binding);
}

/**
 * `이름 (키)` 한 줄 — `title`/`aria-label` 에 그대로 넣는 형태.
 *
 * 키가 없으면(사용자가 해제) 괄호까지 통째로 뺀다 — 빈 괄호가 남으면 고장 난 것처럼 보인다.
 */
export function useTitleWithBinding(label: string, cmd: CommandId): string {
  const key = useBindingLabel(cmd);
  return key ? `${label} (${key})` : label;
}
