/**
 * §5.5 #17-13 ⑤-1 — SystemNode 표현 결정(이름표 → 계열 패턴 → 기본) 회귀 테스트.
 *
 * CLI 판올림마다 새 subtype 이 늘어나므로, 확인해야 하는 것은 "이름을 아는 것이 제대로 나오는가" 보다
 * **모르는 이름이 엉뚱한 모양으로 떨어지지 않는가** 다.
 */
import { describe, it, expect } from 'vitest';
import { resolveSystemNodeStyle, humanizeSubtype } from './SystemNode.js';

/** 이 프로젝트 sub-streams 164,214줄에서 실제로 관측된 12종 — 전부 번역 라벨을 가져야 한다. */
const OBSERVED = [
  'thinking_tokens', 'status', 'task_progress', 'task_started', 'task_notification', 'task_updated',
  'notification', 'background_tasks_changed', 'commands_changed', 'api_retry',
  'model_refusal_fallback', 'compact_boundary',
];

describe('resolveSystemNodeStyle', () => {
  it('실측 관측 12종은 전부 이름표(번역 키)를 가진다', () => {
    for (const subtype of OBSERVED) {
      expect(resolveSystemNodeStyle(subtype).labelKey, subtype).toMatch(/^ide\.systemNode\./);
    }
  });

  it('이름표가 계열 패턴보다 우선한다', () => {
    // `api_retry` 는 /^api_/ 패턴에도 걸리지만 등록된 이름표가 이긴다.
    expect(resolveSystemNodeStyle('api_retry').labelKey).toBe('ide.systemNode.apiRetry');
    expect(resolveSystemNodeStyle('task_started').family).toBe('start');
  });

  it('모르는 이름도 뜻이 비슷하면 같은 계열로 떨어진다', () => {
    const cases: Record<string, string> = {
      mirror_error: 'alert',
      error_during_execution: 'alert',
      model_refusal_no_fallback: 'alert',
      worker_shutting_down: 'stop',
      agents_killed: 'stop',
      permission_retry: 'permission',   // 권한 규칙이 재시도 규칙보다 앞
      elicitation_complete: 'permission',
      model_consent_fallback: 'fallback',
      memory_saved: 'memory',           // `_saved$`(완료)보다 `^memory_` 가 앞
      memory_recall: 'memory',
      hook_progress: 'hook',
      post_turn_summary: 'summary',
      stop_hook_summary: 'stop',        // 중단 계열이 요약보다 앞(멈춤이 더 급한 신호)
      background_tasks: 'layers',
      local_command: 'command',
      session_state_changed: 'update',
      vcs_state_changed: 'update',
      set_permission_mode: 'permission',
      rename_session: 'update',
      turn_starting: 'start',
      code_change_published: 'done',
    };
    for (const [subtype, family] of Object.entries(cases)) {
      expect(resolveSystemNodeStyle(subtype).family, subtype).toBe(family);
    }
  });

  it('아무 규칙에도 안 걸리면 무채색 정보 점 + 번역하지 않은 원문 라벨', () => {
    const style = resolveSystemNodeStyle('zzz_brand_new_thing_v9');
    expect(style.family).toBe('info');
    expect(style.labelKey).toBe('');
    expect(humanizeSubtype('zzz_brand_new_thing_v9')).toBe('Zzz Brand New Thing V9');
  });

  it('계열 패턴으로 잡힌 것은 번역 키를 만들지 않는다(라벨은 원문 다듬기)', () => {
    expect(resolveSystemNodeStyle('vcs_state_changed').labelKey).toBe('');
    expect(humanizeSubtype('vcs_state_changed')).toBe('Vcs State Changed');
  });
});
