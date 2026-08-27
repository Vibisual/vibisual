import { describe, expect, it } from 'vitest';

import { canCreateMainViewBubble, isMainCanvasView } from './canvasScope.js';

/**
 * §5.7 #26 — **워크트리 안에서 누른 것이 부모 캔버스로 새면 안 된다.**
 *
 * 사용자 보고의 뿌리: 워크트리로 드릴다운한 상태에서 우클릭 → 캡처/앱/플레이/스펙/랩/선반을 누르면
 * ① 프로젝트가 `activeProject`(= 부모 탭)로 잡히고 ② 그 버블은 메인 뷰에서만 렌더되므로 지금 화면에는
 * 나타나지 않는다. 누른 사람에게는 **"눌렀는데 아무 일도 안 일어남"** 이고, 실제로는 부모 캔버스에
 * 유령이 하나 앉는다(돌아가서 지우기 전까지 모른다).
 *
 * 그래서 "그릴 수 없는 자리에서는 만들지도 메뉴에 내지도 않는다" 를 규칙으로 세웠다.
 * 여기서 고정하는 것은 **그 판정이 렌더 조건과 글자 그대로 같은 식**이라는 사실이다 —
 * 둘이 어긋나는 순간 같은 증상이 그대로 되살아난다.
 */
describe('메인 뷰 전용 버블의 생성 게이트 (§5.7 #26)', () => {
  it('최상위 캔버스에서는 만들 수 있다', () => {
    expect(isMainCanvasView({ currentFolderId: null, interiorView: null })).toBe(true);
    expect(canCreateMainViewBubble({ currentFolderId: null, interiorView: null, activeProject: 'proj' })).toBe(true);
  });

  it('워크트리로 드릴다운한 자리에서는 만들지 않는다 — 부모 캔버스로 새던 자리', () => {
    const inWorktree = { currentFolderId: 'worktree-123', interiorView: null };
    expect(isMainCanvasView(inWorktree)).toBe(false);
    expect(canCreateMainViewBubble({ ...inWorktree, activeProject: 'parent' })).toBe(false);
  });

  it('평범한 폴더 안에서도 같다 — 게이트는 폴더 종류를 가리지 않는다', () => {
    expect(canCreateMainViewBubble({ currentFolderId: 'folder-1', interiorView: null, activeProject: 'proj' })).toBe(false);
  });

  it('휴지통 같은 내부 뷰에서도 만들지 않는다', () => {
    expect(isMainCanvasView({ currentFolderId: null, interiorView: { kind: 'trash' } })).toBe(false);
    expect(
      canCreateMainViewBubble({ currentFolderId: null, interiorView: { kind: 'trash' }, activeProject: 'proj' }),
    ).toBe(false);
  });

  it('열린 프로젝트가 없으면 만들지 않는다 — 어느 탭에도 안 붙은 버블 방지', () => {
    expect(canCreateMainViewBubble({ currentFolderId: null, interiorView: null, activeProject: null })).toBe(false);
  });
});
