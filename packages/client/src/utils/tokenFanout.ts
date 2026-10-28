/**
 * §3.2.4 ② — 서브에이전트 토큰 조회 연쇄 축소. `/api/tokens/:sessionId` 는 자체 턴이 비면(커스텀 에이전트) 서브 세션을 모두 합산하는데, 순차면 서브 수만큼 왕복이 줄줄이 인다.
 * 바꾸는 것은 왕복을 겹치는 것뿐 — 결과는 **입력 순서 그대로**라 호출부 병합(뒤 categories 가 이긴다 등)이 순차와 같다.
 * 동시 실행 수 상한: 서버가 로컬 단일 프로세스라 무제한 병렬은 메인 스레드를 한꺼번에 막는다.
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
