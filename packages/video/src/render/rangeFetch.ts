/**
 * §5.4 #36 (F) — 끝이 열린 구간(`bytes=N-`)을 `bytes=N-(N+chunk-1)` 로 묶는 fetch. 응답을 통째로 넘기는 호스트 fetch(데스크톱 IPC)에선
 * `UrlSource` 가 스트림을 끊어도 N~파일 끝이 다 건너온다. `UrlSource` 는 본문이 일찍 끝나면 다음 구간을 다시 청해 결과가 같다(크기는 `Content-Range` 끝값).
 * 끝이 닫힌 구간·구간 없는 요청은 건드리지 않는다.
 */
export function boundedRangeFetch(chunkBytes: number, base?: typeof fetch): typeof fetch {
  const chunk = Math.max(1, Math.floor(chunkBytes));
  return ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const send = base ?? ((i: RequestInfo | URL, n?: RequestInit) => globalThis.fetch(i, n));
    const headers = new Headers(init?.headers ?? undefined);
    const range = headers.get('Range');
    const open = range ? /^bytes=(\d+)-$/.exec(range.trim()) : null;
    if (!open) return send(input, init);
    const start = Number(open[1]);
    headers.set('Range', `bytes=${start}-${start + chunk - 1}`);
    // 평범한 객체로 넘긴다 — 호스트 fetch 가 `Headers` 를 그대로 옮기지 못할 수 있다.
    const plain: Record<string, string> = {};
    headers.forEach((value, key) => {
      plain[key] = value;
    });
    return send(input, { ...init, headers: plain });
  }) as typeof fetch;
}
