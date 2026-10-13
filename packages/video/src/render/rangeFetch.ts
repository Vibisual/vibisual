/**
 * 끝이 열린 구간 요청을 **묶어 보내는** fetch (SCENARIO.md §5.4 #36 (F)).
 *
 * Mediabunny 의 `UrlSource` 는 `Range: bytes=N-`(끝이 열린 구간)을 보내고, 충분히 읽으면 스트림을 끊는다. 브라우저의
 * 진짜 fetch 라면 끊는 순간 전송이 멈추지만, 호스트가 응답을 **통째로 받아 넘기는** fetch 를 쓰면(데스크톱 앱의 IPC
 * 전송이 그렇다) 대표 프레임 하나를 읽으려다 N 부터 파일 끝까지가 한 번에 건너온다.
 *
 * 그래서 `bytes=N-` 를 `bytes=N-(N+chunk-1)` 로 바꿔 보낸다. `UrlSource` 는 본문이 목표보다 일찍 끝나면 그 자리에서
 * 다음 구간을 다시 요청하므로(엄격 목표 일꾼) 결과는 같고, 건너오는 양은 실제로 읽은 만큼 + 구간 하나로 묶인다.
 * 파일 크기는 각 응답의 `Content-Range` 끝값(`/전체`)에서 그대로 읽힌다.
 *
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
