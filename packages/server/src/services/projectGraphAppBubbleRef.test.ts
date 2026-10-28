import { describe, expect, it } from 'vitest';
import { APP_BUBBLE_REF_MAX } from '@vibisual/shared';

import { ProjectGraph } from './projectGraph.js';

/** §5.13 (L)(T-15) ③ — 노드의 앱 작업 문서(`ref`) 갱신. 글자열이 아닌 값(앱 창이 깨진다)과 부분 PATCH 의 칸 지우기(노드가 문서를 잃는다)를 막는지 본다. */

type Updates = Parameters<ProjectGraph['updateAppBubble']>[1];

function makeBubble(): { graph: ProjectGraph; id: string } {
  const graph = new ProjectGraph();
  const info = graph.registerProject('/tmp/example-project');
  const bubble = graph.createAppBubble({ projectName: info.name, appId: 'vibistudio', x: 0, y: 0 });
  return { graph, id: bubble.id };
}

describe('§5.13 (L) AppBubble.ref 갱신', () => {
  it('글자열이면 앞뒤 공백을 다듬어 적고 스냅샷에도 실린다', () => {
    const { graph, id } = makeBubble();
    expect(graph.updateAppBubble(id, { ref: '  vid-1  ' })?.ref).toBe('vid-1');
    expect(graph.getSnapshot().appBubbles?.find((b) => b.id === id)?.ref).toBe('vid-1');
  });

  it('상한 길이로 자른다', () => {
    const { graph, id } = makeBubble();
    expect(graph.updateAppBubble(id, { ref: 'x'.repeat(APP_BUBBLE_REF_MAX + 50) })?.ref).toHaveLength(APP_BUBBLE_REF_MAX);
  });

  it('빈 글자와 null 은 묶음을 푼다', () => {
    const { graph, id } = makeBubble();
    graph.updateAppBubble(id, { ref: 'vid-1' });
    expect(graph.updateAppBubble(id, { ref: '   ' })?.ref).toBeUndefined();
    graph.updateAppBubble(id, { ref: 'vid-1' });
    expect(graph.updateAppBubble(id, { ref: null } as unknown as Updates)?.ref).toBeUndefined();
  });

  it('글자열이 아닌 값과 ref 없는 부분 PATCH 는 칸을 건드리지 않는다', () => {
    const { graph, id } = makeBubble();
    graph.updateAppBubble(id, { ref: 'vid-1' });
    expect(graph.updateAppBubble(id, { ref: 42 } as unknown as Updates)?.ref).toBe('vid-1');
    expect(graph.updateAppBubble(id, { ref: { id: 'x' } } as unknown as Updates)?.ref).toBe('vid-1');
    expect(graph.updateAppBubble(id, { x: 5 })?.ref).toBe('vid-1');
  });
});
