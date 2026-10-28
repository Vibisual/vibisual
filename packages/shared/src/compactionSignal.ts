/**
 * §5.5 #17-24 ⑥ — 스트림 한 줄이 압축 시작·끝을 말하는가. CLI 가 턴 도중 접는 2.4~6분엔 스트림이 조용해 이 판정이 없으면 "생각 중"만 자란다.
 * 시작 = `status:"compacting"`. 끝 = `compact_boundary` · `compact_result` status · `status:null` · 뒤이은 assistant/user/result 줄.
 * `status:"requesting"` 은 끝이 아니다(요약 요청이 낸다). 경로 셋이 이 한 곳을 쓴다 — JSONL 엔 status 가 없어 시작은 `PreCompact` 훅이 메운다.
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
