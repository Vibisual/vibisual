import { PLACEHOLDER_LABEL, parseBinding, formatBinding } from '@vibisual/shared';
import { formatShortcut, isMac } from '../../utils/platform.js';

/**
 * bindingLabel.ts — **바인딩 문자열을 화면 표기로.**
 *
 * 표기 규칙 자체는 이미 `utils/platform.ts` 의 `formatShortcut()` 이 갖고 있다(mac 기호 순서 ·
 * `Control` 과 `Ctrl` 의 구분). 여기서 더 하는 일은 하나뿐 — **자리표를 사람이 읽는 범위로**
 * 바꾸는 것이다(`Alt+Digit` → `Alt+1…0`). 표기 규칙을 여기 다시 쓰지 않는다(두 벌이 되면
 * 한쪽만 고쳐져 mac 라벨이 조용히 어긋난다).
 */

/** 자리표를 범위 표기로 바꾼 뒤 그 플랫폼의 표기로. 바인딩이 없으면(해제) 빈 문자열. */
export function bindingLabel(binding: string | null | undefined, mac = isMac()): string {
  if (!binding) return '';
  const parsed = parseBinding(binding);
  if (!parsed) return binding;
  const placeholder = PLACEHOLDER_LABEL[parsed.key];
  const combo = placeholder ? formatBinding({ ...parsed, key: placeholder }) : binding;
  return formatShortcut(combo, mac);
}

/**
 * 키캡을 여러 칸으로 쪼갠 조각들(`⌘` `⇧` `Z` / `Ctrl` `Shift` `Z`).
 *
 * mac 은 기호를 붙여 쓰는 것이 관례라 한 칸으로 두고, 그 외에는 `+` 로 쪼개 칸마다 그린다.
 */
export function bindingParts(binding: string | null | undefined, mac = isMac()): string[] {
  const label = bindingLabel(binding, mac);
  if (!label) return [];
  if (mac) return [label];
  // 끝에 붙은 `+` 는 키 자체다(`Ctrl++`) — 쪼개지 않는다.
  return label.split(/\+(?!$)/).filter((p) => p.length > 0);
}

/** 모디파이어 없이 그 키 하나만의 표기(`Left` → `←`). */
function bareKeyLabel(key: string, mac: boolean): string {
  return bindingLabel(formatBinding({ mod: false, control: false, alt: false, shift: false, key }), mac);
}

/**
 * 여러 바인딩을 **한 덩어리로** 표기한다(`Ctrl+Alt+←→↑↓`).
 *
 * 방향키 넷처럼 "모디파이어는 같고 마지막 키만 다른" 묶음이 실제로 있다. 넷을 그대로 늘어놓으면
 * (`Ctrl+Alt+← / Ctrl+Alt+→ / …`) 읽는 데 오히려 방해가 된다. 모디파이어가 전부 같을 때만
 * 붙여 쓰고, 사용자가 하나라도 다르게 바꿨으면 **정직하게 따로** 나열한다.
 */
export function groupBindingLabel(bindings: ReadonlyArray<string | null | undefined>, mac = isMac()): string {
  const present = bindings.filter((b): b is string => !!b);
  if (present.length === 0) return '';
  const apart = (): string => present.map((b) => bindingLabel(b, mac)).join(' / ');
  if (present.length === 1) return bindingLabel(present[0], mac);

  const parsed = present.map((b) => parseBinding(b));
  if (parsed.some((p) => p === null)) return apart();
  const first = parsed[0]!;
  const sameMods = parsed.every((p) =>
    p!.mod === first.mod && p!.control === first.control && p!.alt === first.alt && p!.shift === first.shift);
  if (!sameMods) return apart();

  // 모디파이어 한 벌을 앞에 두고 키만 이어 붙인다. 표기 규칙(mac 기호·순서)은 그대로 쓴다 —
  //   문자열 조립을 새로 하지 않고 **완성된 라벨에서 꼬리를 떼는** 방식이라 두 벌이 되지 않는다.
  const full = bindingLabel(formatBinding(first), mac);
  const firstTail = bareKeyLabel(first.key, mac);
  if (!firstTail || !full.endsWith(firstTail)) return apart();
  const prefix = full.slice(0, full.length - firstTail.length);
  return prefix + parsed.map((p) => bareKeyLabel(p!.key, mac)).join('');
}
