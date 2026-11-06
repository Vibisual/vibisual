import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskEdge } from '@vibisual/shared';
import { TaskEdgeDetail } from './TaskEdgeDetail.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (select: (state: unknown) => unknown) => select({
    agents: [], taskEdges: {},
    deleteTaskEdge: () => {}, openTaskEdgeEdit: () => {}, selectNode: () => {}, focusOnNode: () => {}, selectTaskEdge: () => {},
  }),
}));

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
});

function render(edge: Partial<TaskEdge>): string {
  const full: TaskEdge = {
    id: 'edge', sourceAgentId: 'a', targetAgentId: 'b', command: 'run checks',
    status: 'idle', forwardMode: 'manual', templateId: null, createdAt: 1, ...edge,
  };
  act(() => { renderer = create(createElement(TaskEdgeDetail, { edge: full })); });
  return JSON.stringify(renderer!.toJSON());
}

// §7.9 — 상세 패널의 Error 는 지금 실패한 엣지만. 서버는 성공에서 오류를 걷지만 옛 체크포인트엔 남아 있다.
describe('TaskEdgeDetail error box', () => {
  it('shows the current failure', () => {
    const html = render({ status: 'error', errorMessage: 'CURRENT_FAILURE' });
    expect(html).toContain('panel.taskEdgeDetail.errorLabel');
    expect(html).toContain('CURRENT_FAILURE');
  });

  it.each(['completed', 'executing'] as const)('hides a stale failure once the edge is %s', (status) => {
    const html = render({ status, lastResult: 'NEW_SUCCESS', errorMessage: 'OLD_FAILURE' });
    expect(html).not.toContain('panel.taskEdgeDetail.errorLabel');
    expect(html).not.toContain('OLD_FAILURE');
    expect(html).toContain('NEW_SUCCESS');
  });
});
