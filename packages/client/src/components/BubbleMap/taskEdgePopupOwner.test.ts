import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskEdge } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { isTaskEdgePopupOwnedByActiveProject } from './taskEdgePopupOwner.js';

/**
 * §3.5 · §5.3 #12 — 태스크 엣지 설정창은 연 프로젝트의 것이다.
 *
 * 사용자 보고: 독립 IDE 창을 꺼내 둔 채 엣지 편집창을 열고 다른 프로젝트로 넘기면, 편집창이 옮겨 간
 * 프로젝트 위에도 떠 있었다. 독립 창이 앞 프로젝트를 구독 범위에 붙들어 그 엣지가 메인 창 스토어에
 * 남았고, 편집창은 "엣지가 스토어에 있나"로만 그려졌기 때문이다. 그래서 아래 시험은 전부
 * **엣지를 스토어에 남겨 둔 채로**(= 합집합 스냅샷) 탭을 옮긴다 — 그 조건을 빼면 옛 코드도 통과한다.
 *
 * 소스를 읽는 규약 시험은 `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에는 Node 타입이 없다
 * (`canvasControlsContract.test.ts` 와 같은 방식).
 */

const EDGE_ID = 'tedge-alpha-1';

function edge(): TaskEdge {
  return {
    id: EDGE_ID,
    sourceAgentId: 'agent-src',
    targetAgentId: 'agent-dst',
    command: 'review',
    status: 'idle',
    forwardMode: 'manual',
    templateId: null,
    projectId: 'alpha',
  } as TaskEdge;
}

/** 지금 스토어 기준으로 편집창이 이 창에 서는가 — `BubbleMap` 의 렌더 조건과 같은 식. */
function editPopupVisible(): boolean {
  const s = useGraphStore.getState();
  const popup = s.taskEdgeEditPopup;
  return !!popup
    && isTaskEdgePopupOwnedByActiveProject(popup.projectName, s.activeProject)
    && !!s.taskEdges[popup.edgeId];
}

describe('isTaskEdgePopupOwnedByActiveProject', () => {
  it('연 프로젝트를 보고 있을 때만 선다', () => {
    expect(isTaskEdgePopupOwnedByActiveProject('alpha', 'alpha')).toBe(true);
    expect(isTaskEdgePopupOwnedByActiveProject('alpha', 'beta')).toBe(false);
  });

  it('탭이 없던 자리에서 연 것은 탭이 생기면 서지 않는다', () => {
    expect(isTaskEdgePopupOwnedByActiveProject(null, null)).toBe(true);
    expect(isTaskEdgePopupOwnedByActiveProject(null, 'alpha')).toBe(false);
    expect(isTaskEdgePopupOwnedByActiveProject('alpha', null)).toBe(false);
  });
});

describe('편집창 — 프로젝트 전환', () => {
  beforeEach(() => {
    useGraphStore.setState({
      activeProject: 'alpha',
      // 경로를 모르게 두어 setActiveProject 가 서버 appState 를 건드리지 않게 한다.
      projects: {},
      stubProjects: {},
      taskEdges: { [EDGE_ID]: edge() },
      taskEdgeEditPopup: null,
      selectedTaskEdgeId: null,
    });
  });

  it('열 때 그 순간의 활성 프로젝트를 적는다', () => {
    useGraphStore.getState().openTaskEdgeEdit(EDGE_ID, 120, 80);
    expect(useGraphStore.getState().taskEdgeEditPopup).toEqual({
      edgeId: EDGE_ID, screenX: 120, screenY: 80, projectName: 'alpha',
    });
  });

  it('엣지가 스토어에 남아 있어도 다른 프로젝트 위에는 서지 않는다(독립 창이 앞 프로젝트를 붙든 경우)', () => {
    useGraphStore.getState().openTaskEdgeEdit(EDGE_ID, 120, 80);
    expect(editPopupVisible()).toBe(true);

    useGraphStore.getState().setActiveProject('beta');
    expect(useGraphStore.getState().taskEdges[EDGE_ID]).toBeDefined(); // 옛 조건은 여기서 참이었다
    expect(editPopupVisible()).toBe(false);
  });

  it('닫지 않는다 — 원래 프로젝트로 돌아오면 같은 자리에 다시 선다', () => {
    useGraphStore.getState().openTaskEdgeEdit(EDGE_ID, 120, 80);
    useGraphStore.getState().setActiveProject('beta');
    useGraphStore.getState().setActiveProject('alpha');
    expect(editPopupVisible()).toBe(true);
    expect(useGraphStore.getState().taskEdgeEditPopup).toMatchObject({ screenX: 120, screenY: 80 });
  });

  it('별창·독립 창의 로컬 전환도 같은 규칙이다', () => {
    useGraphStore.getState().openTaskEdgeEdit(EDGE_ID, 120, 80);
    useGraphStore.getState().setActiveProjectLocal('beta');
    expect(editPopupVisible()).toBe(false);
    useGraphStore.getState().setActiveProjectLocal('alpha');
    expect(editPopupVisible()).toBe(true);
  });

  it('엣지 선택은 따라가지 않는다 — DetailPanel [편집]이 설정창을 옮겨 간 프로젝트 소속으로 다시 열지 않게', () => {
    useGraphStore.getState().selectTaskEdge(EDGE_ID);
    useGraphStore.getState().setActiveProject('beta');
    expect(useGraphStore.getState().selectedTaskEdgeId).toBeNull();

    useGraphStore.getState().selectTaskEdge(EDGE_ID);
    useGraphStore.getState().setActiveProjectLocal('gamma');
    expect(useGraphStore.getState().selectedTaskEdgeId).toBeNull();
  });
});

// ── BubbleMap 렌더 규약 ─────────────────────────────────────────────────────
const bubbleMapSource = Object.values(
  import.meta.glob('./BubbleMap.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0] ?? '';

/** 산문(주석)에 적힌 이름에 걸리지 않도록 주석을 걷어낸 뒤 본다. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('BubbleMap — 설정창 렌더 지점', () => {
  const code = stripComments(bubbleMapSource);

  it('설정창을 그리는 모든 자리가 연 프로젝트 판정을 거친다(생성·편집)', () => {
    const renders = [...code.matchAll(/<TaskEdgePopup\s/g)].map((m) => m.index ?? 0);
    expect(renders.length, 'TaskEdgePopup 렌더 지점을 못 찾았다').toBeGreaterThanOrEqual(2);

    const guardStarts = [...code.matchAll(/\{taskEdge(?:Edit)?Popup\s*&&/g)].map((m) => m.index ?? 0);
    for (const at of renders) {
      const start = guardStarts.filter((g) => g < at).pop();
      expect(start, `렌더 지점(${at}) 앞에 조건부 렌더가 없다`).toBeDefined();
      expect(code.slice(start, at)).toContain('isTaskEdgePopupOwnedByActiveProject(');
    }
  });

  it('생성창도 열 때 프로젝트를 적는다', () => {
    const at = code.indexOf('setTaskEdgePopup({');
    expect(at, 'setTaskEdgePopup 발송 지점을 못 찾았다').toBeGreaterThan(0);
    expect(code.slice(at, code.indexOf('})', at))).toContain('projectName:');
  });
});
