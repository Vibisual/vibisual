// structuralShare — 서버 스냅샷 적용 시 "내용이 같은 부분은 이전 참조를 그대로 쓰는" 구조적 공유.
//
// 왜 필요한가:
//   서버는 graph_snapshot 으로 **전체 그래프**를 실어 보낸다(부분 patch 아님). loadSnapshot 은 그걸
//   받아 agents·subAgents·edges·queuedCommands … 약 30개 슬라이스를 통째로 교체했다. JSON/구조화
//   클론으로 온 값이라 **내용이 한 글자도 안 바뀌어도 참조는 항상 새것**이다.
//
//   그 결과: 스냅샷 1건 = 스토어 구독 전 지점(400+)이 새 참조를 보고 리렌더, 그 슬라이스에 걸린
//   모든 useMemo 가 재계산. 에이전트가 출력을 스트리밍하는 동안 스냅샷은 16ms 로 코얼레스돼 계속
//   도착하므로, **아무것도 안 바뀐 프레임에도 앱 전체가 최대 60Hz 로 리렌더**됐다. IDE 는 그때마다
//   세션 전체 트랜스크립트를 재구축했고(메인 탭 buildEntries 는 O(전체 이벤트)), 같은 메인스레드를
//   쓰는 **타이핑이 밀렸다**. "FPS 는 정상인데 타자가 버벅인다" 의 정체.
//
// 무엇을 하는가:
//   next 를 훑으면서 prev 와 값이 같은 하위 트리는 **prev 의 참조를 되돌려준다**. 바뀐 가지만 새
//   객체가 되고, 안 바뀐 가지는 참조가 유지돼 하위 구독자가 조용히 있는다.
//   예) sub 'a' 만 이벤트가 붙었다면 subAgents 레코드는 새 객체지만 `subAgents['b']` 배열은 옛 참조
//       그대로 → b 를 보는 컴포넌트는 리렌더되지 않는다.
//
// 비용: 순수 비교(할당 없음)이며 첫 차이에서 빠져나온다. 리렌더 한 번 값도 안 되는 비용으로
//   리렌더 수십 건을 없앤다.
//
// ⚠ 서버 스냅샷처럼 **JSON 로 표현 가능한 순수 데이터**에만 쓸 것. Map/Set/Date/클래스 인스턴스는
//   키 순회로 비교되지 않으므로(항상 "다름" 판정) 참조 재사용이 안 될 뿐 오동작하진 않는다.

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
    const out = new Array<unknown>(n.length);
    // 길이가 달라도 겹치는 앞부분은 원소 참조를 재사용한다(스트림처럼 뒤에 append 되는 배열에서
    // 기존 원소들의 참조가 유지돼, 원소 단위 memo 가 살아남는다).
    let allSame = p.length === n.length;
    for (let i = 0; i < n.length; i++) {
      const shared = structuralShare(p[i], n[i]);
      out[i] = shared;
      if (allSame && !Object.is(shared, p[i])) allSame = false;
    }
    return (allSame ? (prev as unknown) : out) as T;
  }

  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const nextKeys = Object.keys(n);
  let allSame = Object.keys(p).length === nextKeys.length;
  const out: Record<string, unknown> = {};
  for (const k of nextKeys) {
    const shared = structuralShare(p[k], n[k]);
    out[k] = shared;
    if (allSame && !Object.is(shared, p[k])) allSame = false;
  }
  return (allSame ? (prev as unknown) : out) as T;
}
