/**
 * §4 폴더 우클릭으로 프로젝트 열기 — main 이 넘긴 이름으로 [폴더 열기]와 같은 일을 한다: 그 탭을 세우고, 첫 실행 폴더 게이트를 닫는다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useGraphStore } from './graphStore.js';

const initial = useGraphStore.getState();

afterEach(() => {
  useGraphStore.setState(initial, true);
});

describe('activateOpenedProject', () => {
  it('그 탭으로 바꾸고 열린 폴더 게이트를 닫는다(스냅샷보다 먼저 와도 탭 이름은 남는다)', () => {
    useGraphStore.setState({ activeProject: 'old', projectGateForced: true, projectGateDismissed: true, currentFolderId: 'f1', navStack: ['x'] });
    useGraphStore.getState().activateOpenedProject('my-app');
    const s = useGraphStore.getState();
    expect(s.activeProject).toBe('my-app');
    expect(s.projectGateForced).toBe(false);
    expect(s.projectGateDismissed).toBe(false);
    expect(s.currentFolderId).toBeNull();
    expect(s.navStack).toEqual([]);
  });
});
