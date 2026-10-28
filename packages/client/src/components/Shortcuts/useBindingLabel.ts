import type { CommandId } from '@vibisual/shared';
import { useKeymapStore } from '../../stores/keymap.js';
import { bindingLabel } from './bindingLabel.js';

/**
 * `KeyCap` 을 못 그리는 자리(`title`·`aria-label`·번역 보간)의 단축키 문구 — 키를 박으면 재매핑에 틀린다.
 * 스토어 구독이라 다른 창의 변경(`keymap_updated`)도 따른다.
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

/** `이름 (키)` — 키가 없으면(해제) 괄호까지 뺀다. */
export function useTitleWithBinding(label: string, cmd: CommandId): string {
  const key = useBindingLabel(cmd);
  return key ? `${label} (${key})` : label;
}
