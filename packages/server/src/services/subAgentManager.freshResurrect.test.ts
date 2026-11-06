import { describe, it, expect } from 'vitest';
import { SubAgentManager } from './subAgentManager.js';

/**
 * §5.26 (G) `fresh` 부활 — 새 대화로 열고 첫 턴에만 끊긴 세션의 금고 브리핑을 싣는다.
 * 고정: 빈 탭에만 걸린다 · `--resume` 을 쓰지 않으니 `sessionId` 는 비어 있다 · 체크포인트를 왕복한다 · 한 번 걷으면 끝.
 */
describe('§5.26 (G) markFreshResurrect', () => {
  it('빈 탭에 끊긴 세션을 걸고 제목을 입힌다 — 이어붙이지 않는다', () => {
    const m = new SubAgentManager();
    const sub = m.create('agent-1');
    expect(m.markFreshResurrect(sub.id, 'dead-uuid', '파서 고치기')).toBe(true);
    const got = m.getSub(sub.id);
    expect(got?.freshBriefFrom).toBe('dead-uuid');
    expect(got?.sessionId).toBe('');
    expect(got?.label).toBe('파서 고치기');
  });

  it('이미 한 턴이라도 돈 탭에는 걸지 않는다 — 지난 대화에 "이어받았다"를 끼우면 거짓이다', () => {
    const m = new SubAgentManager();
    const sub = m.create('agent-1');
    expect(m.adoptSession(sub.id, 'live-uuid')).toBe(true);
    expect(m.markFreshResurrect(sub.id, 'dead-uuid')).toBe(false);
    expect(m.getSub(sub.id)?.freshBriefFrom).toBeUndefined();
  });

  it('보낸 뒤 걷으면 다시 실리지 않는다', () => {
    const m = new SubAgentManager();
    const sub = m.create('agent-1');
    m.markFreshResurrect(sub.id, 'dead-uuid');
    m.clearFreshBrief(sub.id);
    expect(m.getSub(sub.id)?.freshBriefFrom).toBeUndefined();
  });

  it('체크포인트를 왕복해도 표식이 산다 — 되살리자마자 껐다 켜도 첫 턴에 실려야 한다', () => {
    const m = new SubAgentManager();
    const sub = m.create('agent-1');
    m.markFreshResurrect(sub.id, 'dead-uuid');
    const revived = new SubAgentManager();
    revived.restore(m.getSnapshot(), 1);
    expect(revived.getSub(sub.id)?.freshBriefFrom).toBe('dead-uuid');
  });
});
