import { describe, expect, it } from 'vitest';
import type { IDEViewType } from '../../stores/graphStore.js';
import { LOCAL_PROVIDER_VIEWS, fallbackViewForProvider, isViewAllowedForProvider } from './ideProviderViews.js';

/**
 * §5.19 (G) — "클로드 전용 항목은 로컬 버블 IDE 에 뜨지 않는다"를 목록으로 못 박는다.
 * 나중에 활동바에 항목이 하나 늘 때, 그것이 프로바이더 중립인지 여기서 한 번 더 묻게 하는 것이
 * 이 테스트의 목적이다(무심코 늘어난 클로드 전용 입구가 로컬 IDE 에 새지 않게).
 */

const CLAUDE_ONLY: IDEViewType[] = ['mcp', 'context', 'skills', 'hooks', 'plugins', 'subagents'];

describe('§5.19 (G) 프로바이더별 활동바', () => {
  it('클로드 버블은 종전 그대로 전부 보인다', () => {
    for (const v of [...CLAUDE_ONLY, ...LOCAL_PROVIDER_VIEWS]) {
      expect(isViewAllowedForProvider(v, false)).toBe(true);
    }
  });

  it('로컬 버블에서는 클로드 CLI 에 매인 항목이 전부 빠진다', () => {
    for (const v of CLAUDE_ONLY) expect(isViewAllowedForProvider(v, true)).toBe(false);
  });

  it('로컬 버블에도 남는 것은 폴더·디버그를 포함한 중립 항목뿐이다', () => {
    expect([...LOCAL_PROVIDER_VIEWS].sort()).toEqual(['bookmarks', 'debug', 'files', 'goal', 'loop', 'summary']);
    for (const v of LOCAL_PROVIDER_VIEWS) expect(isViewAllowedForProvider(v, true)).toBe(true);
  });

  it('없는 뷰가 열려 있으면 파일로 떨어뜨린다(빈 사이드바 ❌)', () => {
    expect(fallbackViewForProvider('mcp', true)).toBe('files');
    expect(fallbackViewForProvider('plugins', true)).toBe('files');
    expect(fallbackViewForProvider('debug', true)).toBe('debug');
    expect(fallbackViewForProvider('mcp', false)).toBe('mcp');
  });
});
