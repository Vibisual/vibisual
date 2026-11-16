import { describe, it, expect } from 'vitest';
import { modelIdsFromHookBody } from './hookEventClass.js';
import { normalizeObservedModelId } from './modelRegistryService.js';

/** §4 (상태바 모델 칸 ③⑤) — 훅 본문에서 배울 모델 ID: 세 이벤트의 세 필드만, 모양 판정은 레지스트리 쪽 정규화가 맡는다. */
describe('modelIdsFromHookBody', () => {
  it('SessionStart.model 을 읽는다', () => {
    expect(modelIdsFromHookBody({ hook_event_name: 'SessionStart', session_id: 's', model: 'claude-fable-5-2' })).toEqual(['claude-fable-5-2']);
  });

  it('모델 전환 훅은 from·to 둘 다(중복은 한 번)', () => {
    expect(modelIdsFromHookBody({ hook_event_name: 'PostModelSwitch', from_model: 'claude-opus-5-5', to_model: 'claude-fable-5-2' }))
      .toEqual(['claude-fable-5-2', 'claude-opus-5-5']);
    expect(modelIdsFromHookBody({ hook_event_name: 'PreModelSwitch', from_model: 'claude-opus-5-5', to_model: 'claude-opus-5-5' }))
      .toEqual(['claude-opus-5-5']);
  });

  it('`{ id }` 꼴도 받는다(상태줄 JSON 과 같은 모양)', () => {
    expect(modelIdsFromHookBody({ hook_event_name: 'SessionStart', model: { id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5' } })).toEqual(['claude-sonnet-5-5']);
  });

  it('세 이벤트 밖에서는 같은 필드가 있어도 읽지 않는다 — 훅은 빈도가 높다', () => {
    expect(modelIdsFromHookBody({ hook_event_name: 'PreToolUse', model: 'claude-fable-5-2' })).toEqual([]);
    expect(modelIdsFromHookBody({ hook_event_name: 'Stop', to_model: 'claude-fable-5-2' })).toEqual([]);
  });

  it('비문자열·빈 값은 떨어진다', () => {
    expect(modelIdsFromHookBody({ hook_event_name: 'SessionStart', model: 42 })).toEqual([]);
    expect(modelIdsFromHookBody({ hook_event_name: 'SessionStart', model: '  ' })).toEqual([]);
    expect(modelIdsFromHookBody({ hook_event_name: 'SessionStart' })).toEqual([]);
  });

  it('별칭·표시명은 여기서 통과하되 레지스트리 정규화에서 떨어진다 — 한 벌의 판정만 둔다', () => {
    const ids = modelIdsFromHookBody({ hook_event_name: 'PostModelSwitch', from_model: 'opus', to_model: 'Claude Fable 5.2' });
    expect(ids).toEqual(['Claude Fable 5.2', 'opus']);
    for (const id of ids) expect(normalizeObservedModelId(id)).toBeNull();
    expect(normalizeObservedModelId('claude-fable-5-2')).toBe('claude-fable-5-2');
  });
});
