import type { IDEActivityBarPrefs } from './types.js';

/**
 * §5.5 #16-1 — IDE 좌측 **활동바 구성**(사용자가 정한 순서 + 내려놓은 항목)의 순수 로직.
 *
 * 이 모듈은 **어떤 항목이 있는지 모른다.** 다루는 것은 문자열 배열뿐이고, 정본 목록·기본 순서·
 * 아이콘은 클라의 `ideActivityItems.ts` 한 곳이 소유한다(`skillOrder` 가 스킬 이름을 서버에
 * 알리지 않는 것과 같은 규약). 그래서 다음 판올림에서 칸이 늘어도 서버·shared 는 안 고친다.
 *
 * 여기 사는 이유는 하나다 — **저장된 순서와 코드의 기본 순서를 합치는 규칙이 하나여야 한다.**
 * 서버가 정규화하고 클라가 다시 해석하는데 둘이 다른 답을 내면, 사용자가 끌어 둔 자리가
 * 창을 다시 열 때마다 조금씩 달라진다.
 */

/** 문자열 배열 정규화 — 문자열만, 빈 값·중복 제거(순서 보존). 비면 `undefined`. */
function cleanList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string' || !x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * 디스크·전선에서 온 값을 믿을 수 있는 꼴로. 둘 다 비면 `undefined` 를 돌려 **저장하지 않는다** —
 * 한 번도 활동바를 만진 적 없는 사용자의 `app-state.json` 에 빈 칸이 새로 생기면 매 저장이
 * diff 를 만든다(`recentlyClosedTabs` 와 같은 규약).
 */
export function normalizeIDEActivityBarPrefs(raw: unknown): IDEActivityBarPrefs | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as { order?: unknown; hidden?: unknown };
  const order = cleanList(r.order);
  const hidden = cleanList(r.hidden);
  if (!order && !hidden) return undefined;
  return {
    ...(order ? { order } : {}),
    ...(hidden ? { hidden } : {}),
  };
}

/**
 * **지금 그릴 순서.** 저장된 순서를 존중하되, 그 사이 새로 생긴 칸은 버리지 않고 끼워 넣는다.
 *
 * 규칙 셋:
 * 1. 저장 순서에 있고 지금도 존재하는 항목 → **그 순서 그대로**(사용자가 끌어 만든 자리).
 * 2. 지금은 없는 항목(판올림에서 빠진 것) → 버린다.
 * 3. 저장 순서에 없는 **새 항목** → 기본 순서에서 자기 **바로 앞 이웃** 뒤에 끼운다.
 *    맨 뒤로 몰지 않는 이유: 기본 순서는 "같은 결끼리 붙여 둔" 배치라(MCP 옆에 훅, 검증 옆에
 *    정독) 새 칸을 꼬리에 붙이면 그 짝이 화면 양 끝으로 갈라진다.
 */
export function resolveActivityOrder(
  saved: readonly string[] | undefined,
  defaults: readonly string[],
): string[] {
  const known = new Set(defaults);
  const out: string[] = [];
  const placed = new Set<string>();

  for (const v of saved ?? []) {
    if (!known.has(v) || placed.has(v)) continue;
    placed.add(v);
    out.push(v);
  }

  for (let i = 0; i < defaults.length; i += 1) {
    const view = defaults[i];
    if (view === undefined || placed.has(view)) continue;
    // 앞 이웃 중 이미 자리 잡은 가장 가까운 것 뒤. 아무도 없으면 맨 앞.
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = defaults[j];
      if (prev === undefined) continue;
      const idx = out.indexOf(prev);
      if (idx >= 0) { at = idx + 1; break; }
    }
    out.splice(at, 0, view);
    placed.add(view);
  }

  return out;
}

/**
 * 목록에서 한 항목을 뽑아 다른 자리에 꽂는다(드래그 재정렬의 순수 계산).
 *
 * `to` 는 **뽑기 전** 기준 인덱스다 — 화면이 "이 칸 앞에 놓겠다"고 말한 자리를 그대로 받는다.
 * 범위를 벗어나면 양 끝으로 접는다(끌다가 활동바 밖으로 나가는 일이 잦다).
 */
export function moveActivityItem(order: readonly string[], from: number, to: number): string[] {
  if (from < 0 || from >= order.length) return [...order];
  const next = [...order];
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...order];
  const target = Math.max(0, Math.min(next.length, to > from ? to - 1 : to));
  next.splice(target, 0, item);
  return next;
}

/**
 * **보이는 것만 끌었을 때 전체 순서를 어떻게 고치는가.**
 *
 * 화면에 선 항목은 전체 순서의 부분집합이다 — 내려놓은 칸과, 이 엔진에 없는 칸(§5.19 (G))이
 * 빠져 있다. 그래서 드래그가 만든 것은 **보이는 목록의 새 순서**뿐이고, 저장하는 것은 전체
 * 순서다. 안 보이는 칸을 임의로 밀어내지 않기 위해, **보이는 항목이 차지하던 자리(슬롯)** 는
 * 그대로 두고 그 자리들에만 새 순서를 채운다.
 *
 * 이렇게 하지 않으면 — 제외해 둔 칸을 도로 올렸을 때 그것이 뜬금없는 자리에 나타난다
 * (한 번 끌 때마다 안 보이는 칸들이 목록 끝으로 쓸려 가기 때문이다).
 */
export function applyVisibleOrder(
  order: readonly string[],
  visible: readonly string[],
  nextVisible: readonly string[],
): string[] {
  const inVisible = new Set(visible);
  const out = [...order];
  const slots: number[] = [];
  for (let i = 0; i < out.length; i += 1) {
    const v = out[i];
    if (v !== undefined && inVisible.has(v)) slots.push(i);
  }
  // 자리 수와 새 순서의 길이가 어긋나면(있을 수 없지만) 아무것도 하지 않는다 — 절반만 채우면
  // 항목이 중복되거나 사라진다.
  if (slots.length !== nextVisible.length) return out;
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const view = nextVisible[i];
    if (slot === undefined || view === undefined) continue;
    out[slot] = view;
  }
  return out;
}
