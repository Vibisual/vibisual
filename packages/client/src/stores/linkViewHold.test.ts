import { describe, expect, it } from 'vitest';
import {
  applyLinkViewHolds,
  beginLinkViewHold,
  carriesHeldFields,
  linkViewHoldSince,
  NO_LINK_VIEW_HOLDS,
  settleLinkViewHold,
  withHeldFields,
  type LinkViewHolds,
} from './linkViewHold.js';

interface Item { id: string; linksHidden?: true; linkLens?: 'files'; label?: string }

const PENDING = 8000;
const SHOW = { linksHidden: undefined };
const HIDE = { linksHidden: true };

function node(id: string, patch: Partial<Item> = {}): Item {
  return { id, label: id, ...patch };
}

/** 누른 뒤의 붙들기와 그 PATCH 의 `since` — 누르기 전에 읽는 store 순서 그대로. */
function press(holds: LinkViewHolds, id: string, want: Record<string, unknown>, now: number): { holds: LinkViewHolds; since: number } {
  const since = linkViewHoldSince(holds, id, now);
  return { holds: beginLinkViewHold(holds, id, want, now), since };
}

describe('§5.4 #36 (H) 연결 보기 낙관 붙들기 — PATCH 전에 떠난 스냅샷이 누른 값을 되돌리지 않는다', () => {
  it('[연결선 보이기] 뒤 PATCH 가 답하기 전에 온 옛 스냅샷(숨김)은 화면을 되돌리지 못한다', () => {
    const { holds } = press(NO_LINK_VIEW_HOLDS, 'a', SHOW, 1000);
    const stale = [node('a', { linksHidden: true }), node('b')];
    const out = applyLinkViewHolds(stale, holds, 1100, PENDING);
    expect(out.list[0]?.linksHidden).toBeUndefined();
    expect('linksHidden' in out.list[0]!).toBe(false); // 칸째 지운다 — 낙관 반영과 같은 모양
    expect(out.list[1]).toBe(stale[1]); // 붙들지 않는 노드는 그대로
    expect(out.holds).toBe(holds); // 아직 답이 없다 — 계속 붙든다
  });

  it('PATCH 가 답한 뒤 같은 값을 실어 온 스냅샷에서 놓는다 — 그 뒤로는 서버 값이 그대로 들어온다', () => {
    const pressed = press(NO_LINK_VIEW_HOLDS, 'a', SHOW, 1000);
    const settled = settleLinkViewHold(pressed.holds, 'a', pressed.since, true);
    const fresh = [node('a')];
    const out = applyLinkViewHolds(fresh, settled, 1200, PENDING);
    expect(out.list).toBe(fresh);
    expect(out.holds).toEqual({});

    const later = [node('a', { linksHidden: true })]; // 다른 창이 다시 숨겼다
    expect(applyLinkViewHolds(later, out.holds, 1300, PENDING).list).toBe(later);
  });

  it('답은 왔어도 옛 스냅샷이 늦게 적용되면 계속 붙든다(클라 묶음 창에 걸려 있던 것)', () => {
    const pressed = press(NO_LINK_VIEW_HOLDS, 'a', SHOW, 1000);
    const settled = settleLinkViewHold(pressed.holds, 'a', pressed.since, true);
    const out = applyLinkViewHolds([node('a', { linksHidden: true })], settled, 1150, PENDING);
    expect(out.list[0]?.linksHidden).toBeUndefined();
    expect(out.holds).toBe(settled);
  });

  it('PATCH 가 실패하면 곧바로 놓는다 — 다음 스냅샷의 서버 값이 그대로 보인다', () => {
    const pressed = press(NO_LINK_VIEW_HOLDS, 'a', SHOW, 1000);
    const failed = settleLinkViewHold(pressed.holds, 'a', pressed.since, false);
    expect(failed).toEqual({});
    const server = [node('a', { linksHidden: true })];
    expect(applyLinkViewHolds(server, failed, 1100, PENDING).list).toBe(server);
  });

  it('pendingMs 가 지나면 서버 값이 이긴다(서버가 끝내 다른 값을 말할 때의 안전망)', () => {
    const pressed = press(NO_LINK_VIEW_HOLDS, 'a', SHOW, 1000);
    const settled = settleLinkViewHold(pressed.holds, 'a', pressed.since, true);
    const server = [node('a', { linksHidden: true })];
    const out = applyLinkViewHolds(server, settled, 1000 + PENDING + 1, PENDING);
    expect(out.list).toBe(server);
    expect(out.holds).toEqual({});
  });

  it('숨김 → 보임을 빨리 두 번 누르면, 첫 PATCH 전 스냅샷이 우연히 같아도 놓지 않는다', () => {
    const first = press(NO_LINK_VIEW_HOLDS, 'a', HIDE, 1000);
    const second = press(first.holds, 'a', SHOW, 1050);
    expect(second.since).toBe(first.since);

    // 두 PATCH 가 다 가기 전의 스냅샷(보임)은 바람과 같지만 확인이 아니다.
    const beforeAny = applyLinkViewHolds([node('a')], second.holds, 1060, PENDING);
    expect(beforeAny.holds).toBe(second.holds);

    let holds = settleLinkViewHold(second.holds, 'a', first.since, true);
    holds = settleLinkViewHold(holds, 'a', second.since, true);
    // 두 PATCH 사이에 떠난 스냅샷(숨김)이 늦게 와도 보임을 지킨다.
    const between = applyLinkViewHolds([node('a', { linksHidden: true })], holds, 1200, PENDING);
    expect(between.list[0]?.linksHidden).toBeUndefined();
    expect(between.holds).toBe(holds);
    // 마지막 값을 실어 온 스냅샷에서야 놓는다.
    expect(applyLinkViewHolds([node('a')], holds, 1300, PENDING).holds).toEqual({});
  });

  it('놓인 붙들기의 늦은 답은 그 뒤에 선 붙들기의 수를 깎지 않는다', () => {
    const old = press(NO_LINK_VIEW_HOLDS, 'a', HIDE, 1000);
    const expired = applyLinkViewHolds([node('a')], old.holds, 1000 + PENDING + 1, PENDING).holds;
    expect(expired).toEqual({});
    const fresh = press(expired, 'a', SHOW, 1000 + PENDING + 50);
    const lateAnswer = settleLinkViewHold(fresh.holds, 'a', old.since, true);
    expect(lateAnswer).toBe(fresh.holds);
    expect(lateAnswer['a']?.inFlight).toBe(1);
  });

  it('누른 칸만 덧씌운다 — 다른 칸은 서버 값 그대로, 같은 칸은 마지막 값이 이긴다', () => {
    let { holds } = press(NO_LINK_VIEW_HOLDS, 'a', { linkLens: 'files' }, 1000);
    holds = press(holds, 'a', SHOW, 1010).holds;
    holds = press(holds, 'a', HIDE, 1020).holds;
    const out = applyLinkViewHolds([node('a', { label: '새 이름' })], holds, 1100, PENDING);
    expect(out.list[0]).toEqual({ id: 'a', label: '새 이름', linkLens: 'files', linksHidden: true });
  });

  it('붙든 것이 없거나 이번 목록에 없으면 같은 배열·같은 붙들기 객체를 돌려준다', () => {
    const list = [node('a')];
    const none = applyLinkViewHolds(list, NO_LINK_VIEW_HOLDS, 1000, PENDING);
    expect(none.list).toBe(list);
    expect(none.holds).toBe(NO_LINK_VIEW_HOLDS);

    const { holds } = press(NO_LINK_VIEW_HOLDS, 'gone', SHOW, 1000);
    const absent = applyLinkViewHolds(list, holds, 1100, PENDING);
    expect(absent.list).toBe(list);
    expect(absent.holds).toBe(holds); // 범위 밖일 뿐일 수 있다 — 만료가 거둔다
  });

  it('적기와 덧씌우기는 같은 모양이다 — 기본값은 칸이 없고, 이미 실은 값이면 바꿀 것이 없다', () => {
    const shown = withHeldFields(node('a', { linksHidden: true }), SHOW);
    expect(Object.keys(shown)).not.toContain('linksHidden');
    expect(carriesHeldFields(shown, SHOW)).toBe(true);
    expect(carriesHeldFields(shown, HIDE)).toBe(false);
    expect(withHeldFields(shown, HIDE).linksHidden).toBe(true);
  });
});
