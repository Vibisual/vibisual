import { describe, expect, it } from 'vitest';

import { canCreateMainViewBubble, isMainCanvasView } from './canvasScope.js';

/** §5.7 #26 — 폴더(워크트리) 안에서 만든 메인 뷰 전용 버블이 부모 캔버스의 유령이 되던 회귀. 생성 판정이 렌더 조건과 글자 그대로 같은 식임을 고정한다. */
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
