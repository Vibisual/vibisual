/**
 * §3.2.4 ② — 서브에이전트 토큰 조회 **연쇄 축소**.
 *
 * `/api/tokens/:sessionId` 는 자체 턴이 비면(커스텀 에이전트가 그렇다) 서브에이전트 세션을 모두
 * 뒤져 합산한다. 종전엔 그 조회가 `for … await` 순차라, 서브가 20개면 갱신 한 번에 왕복이 20번
 * **줄줄이** 일어났다 — 도구 이벤트가 활발할수록 이 줄이 길어졌다.
 *
 * 여기서 바꾸는 것은 **왕복을 겹치는 것뿐**이다. 결과 배열은 **입력 순서 그대로** 돌려주므로
 * 호출부의 병합 규칙(뒤에 오는 categories 가 이긴다 등)이 순차 때와 바이트 단위로 같다.
 * 동시 실행 수를 상한으로 묶는 이유는 서버가 로컬 단일 프로세스라, 무제한 병렬이 오히려 메인
 * 스레드를 한꺼번에 막기 때문이다.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  };

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
