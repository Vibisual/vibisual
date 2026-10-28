import { describe, it, expect } from 'vitest';
import {
  syncTabOrder,
  sameTabOrder,
  beginProjectTabOrderHold,
  settleProjectTabOrderHold,
  isProjectTabOrderHoldDone,
  heldProjectTabOrder,
  type TabOrderEntry,
} from './projectTabOrder.js';

/** §5.4 #14-2 (C-1) — 프로젝트 탭끼리는 서버 `openProjects` 순서를 따르고, 놓은 직후엔 그 순서를 붙든다. DOM 이 없어 순수 함수·소스 문자열로 본다. */

const A = 'C:/work/alpha';
const B = 'C:/work/beta';
const C = 'C:/work/gamma';
const D = 'C:/work/delta';

const p = (name: string, path: string): TabOrderEntry => ({ key: `p:${name}`, path });
const f = (id: string): TabOrderEntry => ({ key: `i:${id}` });

describe('syncTabOrder — 켤 때 줄이 서는 순서', () => {
  it('첫 스냅샷이 마지막으로 보던 프로젝트를 앞에 실어 와도, 줄은 저장된 순서로 선다', () => {
    // 첫 스냅샷: 마지막으로 보던 gamma 를 먼저 짓고 나머지를 붙인다.
    const items = [p('gamma', C), p('alpha', A), p('beta', B)];
    expect(syncTabOrder([], items, [A, B, C], 'win32')).toEqual(['p:alpha', 'p:beta', 'p:gamma']);
  });

  it('서버 순서를 아직 모르면(첫 스냅샷 전) 들어온 순서 그대로다 — 순서가 오면 그때 맞춘다', () => {
    const items = [p('gamma', C), p('alpha', A)];
    const first = syncTabOrder([], items, [], 'win32');
    expect(first).toEqual(['p:gamma', 'p:alpha']);
    expect(syncTabOrder(first, items, [A, C], 'win32')).toEqual(['p:alpha', 'p:gamma']);
  });

  it('iframe 탭은 제자리이고 프로젝트 탭끼리만 서버 순서로 다시 선다', () => {
    const prev = ['p:alpha', 'i:x', 'p:beta', 'p:gamma'];
    const items = [p('alpha', A), p('beta', B), p('gamma', C), f('x')];
    expect(syncTabOrder(prev, items, [C, A, B], 'win32')).toEqual(['p:gamma', 'i:x', 'p:alpha', 'p:beta']);
  });

  it('바뀐 것이 없으면 같은 순서다 — 부르는 쪽이 이전 배열을 그대로 쓴다', () => {
    const prev = ['p:alpha', 'i:x', 'p:beta'];
    const next = syncTabOrder(prev, [p('alpha', A), p('beta', B), f('x')], [A, B], 'win32');
    expect(sameTabOrder(prev, next)).toBe(true);
  });

  it('사라진 탭은 빠진다', () => {
    const prev = ['p:alpha', 'p:beta', 'i:x'];
    expect(syncTabOrder(prev, [p('alpha', A), f('x')], [A], 'win32')).toEqual(['p:alpha', 'i:x']);
  });
});

describe('syncTabOrder — 새로 붙는 탭', () => {
  it('새로 연 프로젝트(서버 목록 끝)는 종전처럼 줄 끝에 선다', () => {
    const prev = ['p:alpha', 'p:beta', 'i:x'];
    const items = [p('alpha', A), p('beta', B), p('gamma', C), f('x')];
    expect(syncTabOrder(prev, items, [A, B, C], 'win32')).toEqual(['p:alpha', 'p:beta', 'i:x', 'p:gamma']);
  });

  it('표시명이 바뀌어 키가 갈린 탭은 줄 끝으로 튀지 않고 제자리에 끼운다', () => {
    // 같은 basename 유일화가 풀리며 `p:app (beta)` → `p:app` 으로 키가 바뀌었다(경로는 그대로).
    const prev = ['p:alpha', 'p:app (beta)', 'p:gamma'];
    const items = [p('alpha', A), p('app', B), p('gamma', C)];
    expect(syncTabOrder(prev, items, [A, B, C], 'win32')).toEqual(['p:alpha', 'p:app', 'p:gamma']);
  });

  it('서버 목록에 아직 없는 프로젝트는 줄 끝 — 순서를 지어내지 않는다', () => {
    const prev = ['p:alpha'];
    expect(syncTabOrder(prev, [p('alpha', A), p('delta', D)], [A], 'win32')).toEqual(['p:alpha', 'p:delta']);
  });

  it('새 iframe 탭은 줄 끝에 붙는다', () => {
    const prev = ['p:alpha', 'p:beta'];
    expect(syncTabOrder(prev, [p('alpha', A), p('beta', B), f('y')], [A, B], 'win32')).toEqual(['p:alpha', 'p:beta', 'i:y']);
  });
});

describe('syncTabOrder — 경로 케이스는 OS 가 정한다', () => {
  it('win32 는 케이스가 다른 같은 경로를 같은 프로젝트로 맞춘다', () => {
    const items = [p('web', 'C:/Work/Web'), p('app', 'C:/Work/App')];
    expect(syncTabOrder([], items, ['c:/work/app', 'c:/work/web'], 'win32')).toEqual(['p:app', 'p:web']);
  });

  it('linux 는 접지 않는다 — 케이스가 다른 경로는 서버 순서에서 찾지 못해 들어온 순서 그대로다', () => {
    const items = [p('web', '/home/me/Web'), p('app', '/home/me/App')]; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(syncTabOrder([], items, ['/home/me/app', '/home/me/web'], 'linux')).toEqual(['p:web', 'p:app']); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });
});

describe('붙들기 — 놓은 직후 옛 스냅샷이 탭을 되돌리지 않는다', () => {
  const PENDING = 8000;

  it('붙드는 동안은 서버 순서 위에 놓은 순서를 얹는다 — 옛 순서를 실은 스냅샷이 와도 놓은 순서다', () => {
    const hold = beginProjectTabOrderHold(null, [C, A, B], 1000);
    expect(heldProjectTabOrder([A, B, C], hold, 'win32')).toEqual([C, A, B]);
  });

  it('얹어도 구성원은 서버 것이다 — 그 사이 새로 열린 탭은 남고 닫힌 탭은 빠진다', () => {
    const hold = beginProjectTabOrderHold(null, [C, A, B], 1000);
    // 그 사이 B 가 닫히고 D 가 열렸다.
    expect(heldProjectTabOrder([A, C, D], hold, 'win32')).toEqual([C, A, D]);
  });

  it('PATCH 가 답하기 전에는 서버 순서가 우연히 같아도 놓지 않는다', () => {
    const hold = beginProjectTabOrderHold(null, [A, B, C], 1000);
    expect(isProjectTabOrderHoldDone(hold, [A, B, C], 1100, PENDING, 'win32')).toBe(false);
  });

  it('다 답한 뒤 서버 순서가 놓은 순서를 따르면 놓는다', () => {
    const begun = beginProjectTabOrderHold(null, [C, A, B], 1000);
    const settled = settleProjectTabOrderHold(begun, begun.since, true);
    expect(settled?.inFlight).toBe(0);
    expect(isProjectTabOrderHoldDone(settled!, [A, B, C], 1100, PENDING, 'win32')).toBe(false); // 옛 스냅샷
    expect(isProjectTabOrderHoldDone(settled!, [C, A, B], 1200, PENDING, 'win32')).toBe(true);
  });

  it('두 번 놓으면 둘 다 답해야 놓는다', () => {
    const first = beginProjectTabOrderHold(null, [C, A, B], 1000);
    const second = beginProjectTabOrderHold(first, [A, B, C], 1500);
    expect(second.inFlight).toBe(2);
    expect(second.since).toBe(1000);
    const one = settleProjectTabOrderHold(second, 1000, true)!;
    // 첫 PATCH 전에 떠난 스냅샷([A,B,C])이 지금의 바람과 우연히 같다 — 아직 놓지 않는다.
    expect(isProjectTabOrderHoldDone(one, [A, B, C], 1600, PENDING, 'win32')).toBe(false);
    const both = settleProjectTabOrderHold(one, 1000, true)!;
    expect(isProjectTabOrderHoldDone(both, [A, B, C], 1700, PENDING, 'win32')).toBe(true);
  });

  it('PATCH 가 실패하면 곧바로 놓는다 — 서버가 받지 않은 순서를 화면이 붙들지 않는다', () => {
    const hold = beginProjectTabOrderHold(null, [C, A, B], 1000);
    expect(settleProjectTabOrderHold(hold, hold.since, false)).toBeNull();
  });

  it('놓인 뒤 늦게 온 답은 새 붙들기를 건드리지 않는다', () => {
    const fresh = beginProjectTabOrderHold(null, [B, A], 9000);
    expect(settleProjectTabOrderHold(fresh, 1000, false)).toBe(fresh);
    expect(settleProjectTabOrderHold(null, 1000, true)).toBeNull();
  });

  it('아무것도 오지 않으면 안전망 시간 뒤에 놓는다', () => {
    const hold = beginProjectTabOrderHold(null, [C, A, B], 1000);
    expect(isProjectTabOrderHoldDone(hold, [A, B, C], 1000 + PENDING, PENDING, 'win32')).toBe(false);
    expect(isProjectTabOrderHoldDone(hold, [A, B, C], 1001 + PENDING, PENDING, 'win32')).toBe(true);
  });

  it('붙든 것이 없으면 서버 순서 그대로다', () => {
    const server = [A, B];
    expect(heldProjectTabOrder(server, null, 'win32')).toBe(server);
  });
});

/** `TabBar` 가 실제로 이 길을 타는지 — 순서를 다시 휘발 상태에만 두는 되돌아감을 막는다. */
const sources = import.meta.glob(['./TabBar.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const tabBarSrc = sources['./TabBar.tsx'] ?? '';

describe('TabBar 배선', () => {
  it('줄 순서는 서버 `openProjects` 순서(+붙들기)로 맞춘다', () => {
    expect(tabBarSrc).toContain('appState?.openProjects');
    expect(tabBarSrc).toContain('heldProjectTabOrder(serverProjectOrder, orderHold');
    expect(tabBarSrc).toContain('syncTabOrder(prev, tabEntries, projectOrder, platform)');
    // 새 키를 무조건 줄 끝에 붙이던 옛 규칙이 돌아오면, 켤 때 줄이 첫 스냅샷 순서로 다시 선다.
    expect(tabBarSrc).not.toContain('return [...kept, ...newKeys]');
  });

  it('놓으면 프로젝트 탭 순서를 서버에 남긴다', () => {
    expect(tabBarSrc).toMatch(/if \(next\) commitProjectOrder\(next\)/);
    expect(tabBarSrc).toContain('reorderProjectTabs(paths)');
    expect(tabBarSrc).toContain('settleProjectTabOrderHold(orderHoldRef.current, since, ok)');
  });
});
