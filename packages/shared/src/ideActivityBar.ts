import type { IDEActivityBarPrefs } from './types.js';

/**
 * §5.5 #16-1 — IDE 활동바 순서·내려놓은 항목의 순수 로직. 문자열 배열만 다룬다 — 정본 목록·기본 순서·아이콘은 클라 `ideActivityItems.ts` 몫.
 * 저장 순서와 기본 순서를 합치는 규칙은 여기 하나다 — 서버 정규화와 클라 해석이 갈리면 끌어 둔 자리가 열 때마다 달라진다.
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

/** 디스크·전선 값을 믿을 수 있는 꼴로. 둘 다 비면 `undefined` — 저장하지 않는다(안 만진 사용자의 `app-state.json` 에 빈 칸이 생기면 매 저장이 diff 를 만든다). */
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
 * 지금 그릴 순서: 저장 순서에 있고 지금도 있는 항목은 그 순서대로, 지금 없는 항목은 버리고,
 * 새 항목은 기본 순서에서 바로 앞 이웃 뒤에 끼운다 — 꼬리에 붙이면 같은 결끼리 붙인 짝(MCP 옆 훅, 검증 옆 정독)이 양 끝으로 갈라진다.
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

/** 드래그 재정렬의 순수 계산. `to` 는 뽑기 전 기준 인덱스("이 칸 앞에" 그대로). 범위 밖은 양 끝으로 접는다(끌다 활동바 밖으로 나가는 일이 잦다). */
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
 * 보이는 것만 끌었을 때 전체 순서 고치기 — 화면 목록은 부분집합이다(내려놓은 칸·이 엔진에 없는 칸(§5.19 (G)) 제외).
 * 보이는 항목이 차지하던 슬롯에만 새 순서를 채운다 — 안 그러면 안 보이는 칸이 끝으로 쓸려, 도로 올렸을 때 엉뚱한 자리에 나타난다.
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
