/**
 * §5.5 #17-13 ⑤-3 — CLI 작업 이벤트 → 작업 칩 변환 회귀 방지.
 *
 * (A) CLI 가 `skip_transcript` 로 "인라인 대화록에서는 숨기라"고 표시한 살림성 작업은 **이벤트 자체를
 *     만들지 않는다**(버퍼·디스크·복원 예산에서 함께 빠진다).
 * (B) 남는 작업 칩은 payload(작업 이름·결과·요약·소요 시간)를 싣고 나가야 클라가 시작·끝을 한 줄로 접는다.
 *     payload 를 버리면 화면에는 뜻 없는 `작업 시작`·`작업 알림` 두 줄이 다시 쌓인다.
 */
import { describe, it, expect } from 'vitest';
import { parseSystemTaskInfo } from '@vibisual/shared';
import { parseStreamLine } from './subAgentManager.js';

const parse = (obj: Record<string, unknown>) => parseStreamLine(obj, 'sub-a', 'agent-1');

describe('parseStreamLine — (A) skip_transcript 는 인라인에서 숨긴다', () => {
  it('살림성 작업의 시작·끝은 이벤트가 만들어지지 않는다', () => {
    expect(parse({ type: 'system', subtype: 'task_started', task_id: 'x1', description: '살림', skip_transcript: true })).toEqual([]);
    expect(parse({ type: 'system', subtype: 'task_notification', task_id: 'x1', status: 'completed', summary: '끝', skip_transcript: true })).toEqual([]);
  });

  it('플래그가 없거나 false 면 종전대로 남는다 — 숨기는 것은 CLI 가 표시한 것뿐', () => {
    expect(parse({ type: 'system', subtype: 'task_started', task_id: 'x2', description: '보이는 작업' })).toHaveLength(1);
    expect(parse({ type: 'system', subtype: 'task_started', task_id: 'x3', description: '보이는 작업', skip_transcript: false })).toHaveLength(1);
  });
});

describe('parseStreamLine — (B) 작업 칩은 payload 를 싣는다', () => {
  it('시작 칩에 작업 이름과 서브에이전트 종류가 실린다', () => {
    const events = parse({
      type: 'system',
      subtype: 'task_started',
      task_id: 'tk-1',
      description: 'pnpm build 실행',
      subagent_type: 'verifier',
    });
    expect(events).toHaveLength(1);
    expect(parseSystemTaskInfo(events[0]!.content)).toEqual({
      id: 'tk-1',
      description: 'pnpm build 실행',
      subagentType: 'verifier',
    });
  });

  it('끝 칩에 결과·요약·소요 시간이 실린다', () => {
    const events = parse({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'tk-1',
      status: 'failed',
      summary: '타입 오류 2건',
      usage: { total_tokens: 100, tool_uses: 3, duration_ms: 8_400 },
    });
    expect(parseSystemTaskInfo(events[0]!.content)).toEqual({
      id: 'tk-1',
      status: 'failed',
      summary: '타입 오류 2건',
      durationMs: 8_400,
    });
  });

  it('작업 칩이 아닌 subtype 은 종전 그대로 민 칩이다 — payload 를 지어내지 않는다', () => {
    expect(parse({ type: 'system', subtype: 'task_progress', task_id: 'tk-1' })[0]!.content).toBe('[task_progress]');
    expect(parse({ type: 'system', subtype: 'compact_boundary' })[0]!.content).toBe('[compact_boundary]');
  });

  it('task_id 가 없으면 민 칩으로 — 짝지을 열쇠가 없으면 접을 수도 없다', () => {
    expect(parse({ type: 'system', subtype: 'task_started', description: '이름만' })[0]!.content).toBe('[task_started]');
  });

  it('세션 메타(init·hook·turn_duration)는 종전대로 버려진다', () => {
    for (const subtype of ['init', 'hook_started', 'hook_response', 'notification', 'turn_duration']) {
      expect(parse({ type: 'system', subtype })).toEqual([]);
    }
  });
});
