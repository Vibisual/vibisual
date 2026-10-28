// structuralShare — 서버 스냅샷 적용 때 내용이 같은 하위 트리는 이전 참조를 그대로 쓴다. 서버는 매번 전체 그래프를 보내 참조가 늘 새것이라,
// 안 하면 구독 전부(400+)가 리렌더되고 IDE 가 트랜스크립트를 다시 지어 타이핑이 밀린다. 순수 비교(할당 없음), 첫 차이에서 멈춘다.
// ⚠ **JSON 로 표현 가능한 순수 데이터**에만 — Map/Set/Date/클래스는 늘 "다름"이다(재사용이 안 될 뿐 오동작 ❌).

/**
 * prev 와 값이 같은 하위 트리를 prev 참조로 대체한 next 를 돌려준다.
 * 전체가 같으면 prev 자체를 돌려주므로 `Object.is(structuralShare(prev, next), prev)` 로 무변화 판정 가능.
 */
export function structuralShare<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (
    typeof prev !== 'object' || prev === null ||
    typeof next !== 'object' || next === null
  ) {
    return next;
  }

  const prevIsArray = Array.isArray(prev);
  const nextIsArray = Array.isArray(next);
  if (prevIsArray !== nextIsArray) return next;

  if (nextIsArray) {
    const p = prev as unknown[];
    const n = next as unknown[];
    // 길이가 달라도 겹치는 앞부분은 원소 참조를 재사용한다(append 되는 스트림 배열에서 원소 단위 memo 가 산다).
    // §9 — **첫 차이를 만나기 전까지는 아무것도 만들지 않는다**(미리 지었다 버리면 스냅샷마다 3MB 트리만큼 GC 쓰레기).
    let out: unknown[] | null = p.length === n.length ? null : new Array<unknown>(n.length);
    for (let i = 0; i < n.length; i++) {
      const shared = structuralShare(p[i], n[i]);
      if (out !== null) { out[i] = shared; continue; }
      if (!Object.is(shared, p[i])) {
        // 여기서 처음 갈라진다 — 앞부분은 값이 같다고 이미 확인했으므로 그대로 옮긴다.
        out = new Array<unknown>(n.length);
        for (let j = 0; j < i; j++) out[j] = p[j];
        out[i] = shared;
      }
    }
    return (out === null ? (prev as unknown) : out) as T;
  }

  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const nextKeys = Object.keys(n);
  // 같은 이유로 객체 쪽도 첫 차이에서야 만든다.
  let out: Record<string, unknown> | null = null;
  if (Object.keys(p).length !== nextKeys.length) {
    out = {};
  }
  for (let i = 0; i < nextKeys.length; i++) {
    const k = nextKeys[i]!;
    const shared = structuralShare(p[k], n[k]);
    if (out !== null) { out[k] = shared; continue; }
    if (!Object.is(shared, p[k])) {
      out = {};
      for (let j = 0; j < i; j++) { const pk = nextKeys[j]!; out[pk] = p[pk]; }
      out[k] = shared;
    }
  }
  return (out === null ? (prev as unknown) : out) as T;
}
