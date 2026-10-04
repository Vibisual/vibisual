/**
 * §5.5 #17-24 ⑥ — 스트림 한 줄이 **압축의 시작·끝**에 대해 무엇을 말하는가.
 *
 * CLI 가 턴 도중에 스스로 접는 2.4~6분 동안 스트림에는 아무 줄도 오지 않는다(요약은 CLI 안쪽의 별도
 * 호출이다). 그 사이 라이브 1줄이 "생각 중"으로 경과만 키운 것이 2026-10-04 사용자 보고("생각 중을
 * 1시간 넘게")의 화면이었다. 사실은 이미 온다 —
 *  - 시작: `system/status` 줄의 `status:"compacting"`(공개 SDK 타입 `SDKStatusMessage`).
 *  - 끝: `compact_boundary`(압축이 끝난 자리), 압축 결과(`compact_result`)를 실은 status, 비워진 status
 *    (`status:null`), 또는 그 뒤에 오는 assistant·user·result 줄(대화가 다시 흐른다 = 압축은 끝났다).
 *    압축이 실패해도 결과를 실은 status 나 턴을 닫는 result 줄이 온다.
 *  - `status:"requesting"` 처럼 압축과 무관한 상태 값은 **아무것도 바꾸지 않는다** — 요약을 만드는 요청이
 *    그 값을 낼 수 있어, 끝으로 읽으면 압축 도중에 "생각 중"으로 되돌아간다.
 *
 * 스트림 경로가 셋(persistent stdout · legacy stdout · agent-view JSONL)이라 판정을 여기 한 곳에 둔다
 * (`detectUsageLimitStop` 과 같은 규율). JSONL(agent-view)에는 status 줄이 없어 끝 신호만 보인다 —
 * 시작은 `PreCompact` 훅이 메운다.
 */
export type CompactionSignal = 'start' | 'end';

/** 한 줄 → 압축 시작(`start`) · 끝(`end`) · 무관(`null`). 줄을 고치지 않는다. */
export function readCompactionSignal(line: unknown): CompactionSignal | null {
  if (typeof line !== 'object' || line === null) return null;
  const o = line as Record<string, unknown>;
  const type = o['type'];
  if (type === 'system') {
    const subtype = o['subtype'];
    if (subtype === 'compact_boundary') return 'end';
    if (subtype !== 'status') return null;
    if (o['compact_result'] !== undefined && o['compact_result'] !== null) return 'end';
    const status = o['status'];
    if (status === 'compacting') return 'start';
    if (status === null || status === undefined) return 'end';
    return null;
  }
  if (type === 'assistant' || type === 'user' || type === 'result') return 'end';
  return null;
}
