import { PLACEHOLDER_LABEL, parseBinding, formatBinding } from '@vibisual/shared';
import { formatShortcut, isMac } from '../../utils/platform.js';

/** 표기 규칙(mac 기호·`Control`/`Ctrl`)은 `formatShortcut()` 한 곳 — 다시 쓰면 mac 라벨이 어긋난다. 여기선 자리표만 범위로 편다(`Alt+Digit` → `Alt+1…0`). */

/** 자리표를 범위 표기로 바꾼 뒤 그 플랫폼의 표기로. 바인딩이 없으면(해제) 빈 문자열. */
export function bindingLabel(binding: string | null | undefined, mac = isMac()): string {
  if (!binding) return '';
  const parsed = parseBinding(binding);
  if (!parsed) return binding;
  const placeholder = PLACEHOLDER_LABEL[parsed.key];
  const combo = placeholder ? formatBinding({ ...parsed, key: placeholder }) : binding;
  return formatShortcut(combo, mac);
}

/** 키캡 칸 조각 — mac 은 붙여 한 칸, 그 외엔 `+` 로 쪼갠다. */
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

/** 여러 바인딩 한 덩어리 표기(`Ctrl+Alt+←→↑↓`) — 모디파이어가 전부 같을 때만, 다르면 따로 나열. */
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
