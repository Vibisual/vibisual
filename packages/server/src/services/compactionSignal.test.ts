import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCompactionSignal } from '@vibisual/shared';

/**
 * §5.5 #17-24 ⑥ — CLI 스트림 한 줄에서 "압축 시작/끝"을 읽는다(2026-10-04).
 *
 * CLI 가 턴 도중에 대화를 접는 2.4~6분 동안 라이브 1줄은 "생각 중"으로 서 있었다 — 사용자가 본 "생각 중
 * 1시간"의 절반이 이것이었다(나머지 절반은 압축이 너무 잦았던 것, `compactFloor.test.ts`). 이 파일은
 * 표식을 세우고 걷는 판정과, 그 판정이 서버의 모든 갈래에 배선돼 있는지를 고정한다.
 */
describe('readCompactionSignal', () => {
  it('status:"compacting" 이 시작이다', () => {
    expect(readCompactionSignal({ type: 'system', subtype: 'status', status: 'compacting' })).toBe('start');
  });

  it('compact_boundary 와 compact_result 가 끝이다(성공·실패 모두)', () => {
    expect(readCompactionSignal({
      type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 160_000 },
    })).toBe('end');
    expect(readCompactionSignal({ type: 'system', subtype: 'status', status: null, compact_result: 'success' })).toBe('end');
    expect(readCompactionSignal({
      type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'x',
    })).toBe('end');
  });

  it('status 가 비면(null·없음) 끝이다', () => {
    expect(readCompactionSignal({ type: 'system', subtype: 'status', status: null })).toBe('end');
    expect(readCompactionSignal({ type: 'system', subtype: 'status' })).toBe('end');
  });

  it("'requesting' 은 아무것도 바꾸지 않는다 — 압축과 무관한 상태다", () => {
    expect(readCompactionSignal({ type: 'system', subtype: 'status', status: 'requesting' })).toBeNull();
  });

  it('일반 응답 줄이 오면 압축은 끝난 것이다 — 끝 신호를 놓쳐도 표식이 굳지 않는다', () => {
    for (const type of ['assistant', 'user', 'result']) {
      expect(readCompactionSignal({ type }), type).toBe('end');
    }
  });

  it('그 밖의 줄과 모양이 다른 입력은 null', () => {
    expect(readCompactionSignal({ type: 'system', subtype: 'init' })).toBeNull();
    expect(readCompactionSignal({ type: 'stream_event' })).toBeNull();
    for (const v of [null, undefined, 'compacting', 3, []]) {
      expect(readCompactionSignal(v)).toBeNull();
    }
  });
});

describe('서버 배선 — 세우는 자리와 걷는 자리가 모두 있다', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
  const count = (s: string, needle: string): number => s.split(needle).length - 1;

  it('stdout 세 갈래(에이전트 뷰·일회성·상주 자식)가 모두 같은 함수로 줄을 읽는다', () => {
    // 정의 1 + 호출 3. 한 갈래라도 빠지면 그 경로의 압축은 "생각 중"으로 남는다.
    expect(count(read('./subAgentManager.ts'), 'noteCompactionLine(')).toBe(4);
  });

  it('자식이 닫히거나 뷰가 끝나면 표식을 걷는다 — 굳은 "압축 중" 방지', () => {
    // 정의 1 + 줄 판정 1 + 훅 1 + 닫힘 1 + 뷰 끝 1.
    expect(count(read('./subAgentManager.ts'), 'setCompacting(')).toBe(5);
  });

  it('재기동하면 디스크에서 되살아나지 않는다 — 압축 중인 자식은 재기동을 넘어 살지 못한다', () => {
    expect(read('./subAgentManager.ts')).toContain('delete item.compactingSince;');
  });

  it('훅 경로: PreCompact 가 세우고 끝 이벤트가 걷는다', () => {
    const s = read('../index.ts');
    expect(s).toContain("subAgentManager.noteCompactionHook(bgOwnerSub.id, 'start')");
    expect(s).toContain("subAgentManager.noteCompactionHook(bgOwnerSub.id, 'end')");
    expect(s).toContain('endsCompaction(body.hook_event_name)');
  });

  it('세션 상태 방송 지문에 압축 표식이 들어 있다 — 빠지면 표식이 바뀌어도 화면이 모른다', () => {
    expect(read('../index.ts')).toContain("`${s.id}:${s.status}:${s.compactingSince ?? ''}`");
  });
});
