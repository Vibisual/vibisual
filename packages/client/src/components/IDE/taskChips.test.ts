/**
 * §5.5 #17-13 ⑤-3 — 작업 칩 시작·끝 합치기 회귀 방지.
 *
 * 지키는 것은 셋이다.
 *  ① 한 작업은 화면에서 **한 줄**이다(시작 + 끝 두 줄로 쌓이지 않는다).
 *  ② 합쳐진 줄은 **시작 줄의 id·자리**를 그대로 쓴다(가상 리스트 키가 흔들리면 스크롤이 튄다).
 *  ③ 짝이 없는 것(진행 중인 시작 · 시작이 잘려 나간 끝)은 손대지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { formatSystemChip, parseSystemTaskInfo } from '@vibisual/shared';
import { foldTaskChips } from './taskChips.js';

interface Row {
  id: string;
  kind: 'system' | 'text';
  content: string;
}

const read = (it: Row): string | null => (it.kind === 'system' ? it.content : null);
const write = (it: Row, content: string): Row => ({ ...it, content });
const fold = (rows: Row[]): Row[] => foldTaskChips(rows, read, write);

function start(id: string, taskId: string, description: string): Row {
  return { id, kind: 'system', content: formatSystemChip('task_started', { id: taskId, description }) };
}
function end(id: string, taskId: string, durationMs = 5_000): Row {
  return {
    id,
    kind: 'system',
    content: formatSystemChip('task_notification', { id: taskId, status: 'completed', summary: '끝', durationMs }),
  };
}
const text = (id: string): Row => ({ id, kind: 'text', content: '설명 한 줄' });

describe('foldTaskChips — 한 작업은 한 줄', () => {
  it('시작·끝이 한 줄로 접힌다 — 끝 줄은 사라지고 결과가 시작 줄에 얹힌다', () => {
    const out = fold([start('a', 't1', 'pnpm build'), end('b', 't1', 12_345)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('a');
    expect(parseSystemTaskInfo(out[0]!.content)).toEqual({
      id: 't1',
      description: 'pnpm build',
      status: 'completed',
      summary: '끝',
      durationMs: 12_345,
    });
  });

  it('합쳐진 줄은 제자리에 선다 — 앞뒤 항목 순서가 그대로', () => {
    const out = fold([text('x'), start('a', 't1', '작업'), text('y'), end('b', 't1'), text('z')]);
    expect(out.map((r) => r.id)).toEqual(['x', 'a', 'y', 'z']);
  });

  it('작업이 여럿이어도 각자 제 짝을 찾는다 — 시작 2줄 + 끝 2줄이 2줄로', () => {
    const out = fold([
      start('a1', 't1', '첫째'),
      start('a2', 't2', '둘째'),
      end('b1', 't1'),
      end('b2', 't2'),
    ]);
    expect(out.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(parseSystemTaskInfo(out[0]!.content)?.description).toBe('첫째');
    expect(parseSystemTaskInfo(out[1]!.content)?.description).toBe('둘째');
  });

  it('같은 id 가 다시 쓰여도 뒤엉키지 않는다 — 앞의 짝부터 차례로 닫힌다', () => {
    const out = fold([start('a1', 't1', '1회'), end('b1', 't1'), start('a2', 't1', '2회'), end('b2', 't1')]);
    expect(out.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(parseSystemTaskInfo(out[1]!.content)?.description).toBe('2회');
  });
});

describe('foldTaskChips — 짝이 없는 것은 손대지 않는다', () => {
  it('아직 도는 작업(끝이 안 온 시작)은 그대로', () => {
    const rows = [start('a', 't1', '도는 중')];
    expect(fold(rows)).toBe(rows);
  });

  it('짝 없는 끝(시작이 복원 예산 밖으로 밀림)은 홀로 남는다', () => {
    const rows = [end('b', 't9')];
    expect(fold(rows)).toBe(rows);
  });

  it('끝이 시작보다 앞에 있으면 접지 않는다 — 순서가 뒤집힌 것은 짝이 아니다', () => {
    const rows = [end('b', 't1'), start('a', 't1', '나중 시작')];
    expect(fold(rows)).toBe(rows);
  });

  it('payload 없는 옛 칩은 접을 근거가 없어 그대로 둔다', () => {
    const rows: Row[] = [
      { id: 'a', kind: 'system', content: '[task_started]' },
      { id: 'b', kind: 'system', content: '[task_notification]' },
    ];
    expect(fold(rows)).toBe(rows);
  });

  it('접을 게 없으면 입력 배열을 그대로 돌려준다 — 불필요한 재렌더 방지', () => {
    const rows = [text('x'), { id: 's', kind: 'system' as const, content: '[task_progress]' }];
    expect(fold(rows)).toBe(rows);
  });

  it('작업 칩이 아닌 system 본문은 건드리지 않는다', () => {
    const rows: Row[] = [{ id: 's', kind: 'system', content: 'Write 권한이 거부되었습니다' }];
    expect(fold(rows)).toBe(rows);
  });
});
