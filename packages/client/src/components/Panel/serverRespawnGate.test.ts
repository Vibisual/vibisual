import { describe, it, expect } from 'vitest';
import type { ServerEntry } from '@vibisual/shared';
import { serverRespawnGate } from './serverRespawnGate.js';

/**
 * §7.11 포트 인계 — 사용자 보고: "이건 iframe 버블인데 왜 재시작 불가야. 에이전트가 켰더라도
 * 우리 앱이 그대로 넘겨받아서 내가 껐다 켰다 할 수 있게 해줘야지."
 * 그 요구를 판정 규칙으로 고정한다.
 */
function entry(over: Partial<ServerEntry> = {}): ServerEntry {
  return { id: 's1', command: 'pnpm dev', port: 5173, startedAt: 0, alive: true, ...over };
}

describe('§7.11 포트 인계 Restart/Start 개폐 규칙', () => {
  it('살아 있는 신고 서버는 열린다 — 인계해서 재시작하면 되기 때문', () => {
    const g = serverRespawnGate(entry({ reportedOnly: true, alive: true }), 'restart');
    expect(g.canRespawn).toBe(true);
    expect(g.titleKey).toBe('panel.serverList.takeover');
  });

  it('이미 꺼진 신고 서버만 영구 불가 — 읽어 올 프로세스가 없다', () => {
    const g = serverRespawnGate(entry({ reportedOnly: true, alive: false }), 'start');
    expect(g.canRespawn).toBe(false);
    expect(g.titleKey).toBe('panel.serverList.noCommand');
  });

  it('인계를 시도했다 실패한 서버는 그 사유로 갈라 보여 준다', () => {
    const g = serverRespawnGate(entry({ reportedOnly: true, alive: true, takeoverFailed: true }), 'restart');
    expect(g.canRespawn).toBe(false);
    expect(g.titleKey).toBe('panel.serverList.takeoverFailed');
  });

  it('iframe 카드는 위성의 alive 를 함께 넘긴다 — entry 갱신이 늦어도 버튼이 잠기지 않는다', () => {
    const late = entry({ reportedOnly: true, alive: false });
    expect(serverRespawnGate(late, 'start').canRespawn).toBe(false);
    expect(serverRespawnGate(late, 'start', true).canRespawn).toBe(true);
  });

  it('명령을 아는 서버는 종전대로 항상 열린다', () => {
    expect(serverRespawnGate(entry({ alive: false }), 'start')).toEqual({
      canRespawn: true, titleKey: 'panel.serverList.start',
    });
    expect(serverRespawnGate(entry(), 'restart').titleKey).toBe('panel.serverList.restart');
  });

  it('매칭 entry 가 아예 없으면 그렇게 말한다', () => {
    expect(serverRespawnGate(null, 'restart')).toEqual({
      canRespawn: false, titleKey: 'panel.serverList.noEntry',
    });
  });
});
