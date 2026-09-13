import { describe, expect, it } from 'vitest';

import {
  SUBMENU_CLOSED,
  hoverPlainItem,
  hoverSubmenu,
  isSubmenuOpen,
  leaveSubmenu,
  toggleSubmenuPin,
  type SubmenuState,
} from './contextMenuSubmenu.js';

/**
 * §5.25 (B-1) — **클릭은 고정이다.**
 *
 * 사용자 보고의 뿌리: 엔진 칸(`Claude` / `Codex`)·앱 칸을 눌러 펼쳐도 마우스가 그 자리를 벗어나면
 * 곧바로 닫혔다. 칸을 여는 손짓이 호버와 클릭 둘인데 결과가 같았으니, 클릭은 아무 뜻이 없었다.
 *
 * 그래서 고정을 축으로 세웠다. 여기서 고정하는 것은 세 문장이다:
 *   ① 클릭한 칸은 마우스가 벗어나도 남는다(`leave` 가 안 닫는다).
 *   ② **다른 메뉴 항목에 마우스를 올리면 풀린다** — 다른 칸이든, 서브메뉴가 없는 평범한 항목이든.
 *   ③ 열려 있는 칸은 언제나 하나뿐이다.
 */
describe('우클릭 메뉴 서브메뉴 — 호버로 열고 클릭으로 고정 (§5.25 (B-1))', () => {
  describe('호버 — 종전 동작', () => {
    it('마우스를 올리면 펼쳐지고, 벗어나면 닫힌다', () => {
      const hovered = hoverSubmenu(SUBMENU_CLOSED, 'claude');
      expect(hovered).toEqual({ open: 'claude', pinned: false });
      expect(isSubmenuOpen(hovered, 'claude')).toBe(true);
      expect(leaveSubmenu(hovered, 'claude')).toEqual(SUBMENU_CLOSED);
    });

    it('다른 칸으로 옮기면 앞의 칸은 닫힌다 — 열려 있는 칸은 하나뿐', () => {
      const claude = hoverSubmenu(SUBMENU_CLOSED, 'claude');
      const codex = hoverSubmenu(claude, 'codex');
      expect(codex).toEqual({ open: 'codex', pinned: false });
      expect(isSubmenuOpen(codex, 'claude')).toBe(false);
    });

    it('이미 열린 칸에 다시 들어와도 상태가 그대로다 — 참조까지 같아 리렌더가 없다', () => {
      const claude = hoverSubmenu(SUBMENU_CLOSED, 'claude');
      expect(hoverSubmenu(claude, 'claude')).toBe(claude);
    });

    it('늦게 도착한 mouseleave 는 이미 넘어간 칸을 닫지 않는다', () => {
      const codex: SubmenuState = { open: 'codex', pinned: false };
      // 마우스는 이미 codex 로 넘어갔는데 claude 의 mouseleave 가 뒤늦게 온 경우.
      expect(leaveSubmenu(codex, 'claude')).toBe(codex);
    });
  });

  describe('클릭 = 고정 — 마우스가 벗어나도 유지된다', () => {
    it('클릭하면 고정된다', () => {
      expect(toggleSubmenuPin(SUBMENU_CLOSED, 'claude')).toEqual({ open: 'claude', pinned: true });
    });

    it('고정된 칸은 마우스가 벗어나도 닫히지 않는다 — 이번 변경의 핵심', () => {
      const pinned = toggleSubmenuPin(SUBMENU_CLOSED, 'claude');
      expect(leaveSubmenu(pinned, 'claude')).toBe(pinned);
      expect(isSubmenuOpen(leaveSubmenu(pinned, 'claude'), 'claude')).toBe(true);
    });

    it('호버로 열려 있던 칸을 클릭하면 그 자리에서 고정으로 바뀐다', () => {
      const hovered = hoverSubmenu(SUBMENU_CLOSED, 'apps');
      const pinned = toggleSubmenuPin(hovered, 'apps');
      expect(pinned).toEqual({ open: 'apps', pinned: true });
      expect(leaveSubmenu(pinned, 'apps')).toBe(pinned);
    });

    it('고정된 칸을 다시 클릭하면 닫힌다 — "클릭으로도 토글"의 연장', () => {
      const pinned = toggleSubmenuPin(SUBMENU_CLOSED, 'codex');
      expect(toggleSubmenuPin(pinned, 'codex')).toEqual(SUBMENU_CLOSED);
    });

    it('고정된 칸의 서브메뉴 위로 마우스가 들어와도 고정이 풀리지 않는다', () => {
      // 서브메뉴는 그 칸의 자식이라 같은 칸의 mouseenter 로 도착한다.
      const pinned = toggleSubmenuPin(SUBMENU_CLOSED, 'claude');
      expect(hoverSubmenu(pinned, 'claude')).toBe(pinned);
      expect(leaveSubmenu(hoverSubmenu(pinned, 'claude'), 'claude')).toEqual(pinned);
    });
  });

  describe('다른 메뉴를 호버하면 풀린다 — 종전 동작 유지', () => {
    it('고정된 칸이 있어도 다른 칸에 올리면 그 칸으로 넘어간다(고정 해제)', () => {
      const pinned = toggleSubmenuPin(SUBMENU_CLOSED, 'claude');
      const moved = hoverSubmenu(pinned, 'codex');
      expect(moved).toEqual({ open: 'codex', pinned: false });
      // 넘어간 칸은 고정이 아니므로 벗어나면 종전대로 닫힌다.
      expect(leaveSubmenu(moved, 'codex')).toEqual(SUBMENU_CLOSED);
    });

    it('서브메뉴가 없는 항목(CMD·All Model·캡처·두뇌…)에 올리면 고정이 풀리고 닫힌다', () => {
      const pinned = toggleSubmenuPin(SUBMENU_CLOSED, 'apps');
      expect(hoverPlainItem(pinned)).toEqual(SUBMENU_CLOSED);
    });

    it('이미 닫혀 있으면 평범한 항목 호버는 아무것도 바꾸지 않는다', () => {
      expect(hoverPlainItem(SUBMENU_CLOSED)).toBe(SUBMENU_CLOSED);
    });
  });
});
