import { describe, expect, it } from 'vitest';

import { DEFAULT_IDE_OVERLAY } from './graphStore.js';
import type { IDEOverlayState } from './graphStore.js';
import { captureIDEPaneHandoff, coerceIDEPaneHandoff, handoffPanePatch } from './idePaneHandoff.js';

/**
 * SCENARIO.md §5.5 #17-6 (H) — **창이 자리를 옮겨도 하던 일을 잃지 않는다**.
 *
 * 종전에는 앱 밖으로 꺼내거나 되돌릴 때 받는 쪽이 `openIDEOverlay` 로 창을 새로 만들어,
 * 열어 둔 편집 탭이 전부 닫히고(`editorFiles: []`) 뷰가 첫 화면으로 돌아가고 붙어 있던 변을
 * 잊었다. 화면 없이 확인할 수 있도록 그 이월을 순수 함수로 갈라 두고, 여기서 못 박는다.
 */

const AGENT = 'agent-1';
const PROJ = 'alpha';

function pane(over: Partial<IDEOverlayState> = {}): IDEOverlayState {
  return {
    ...DEFAULT_IDE_OVERLAY,
    agentId: AGENT,
    paneKey: PROJ,
    projectId: PROJ,
    ...over,
  };
}

const FILE_A = { relPath: 'src/a.ts', absPath: '/repo/src/a.ts', name: 'a.ts' };
const FILE_B = { relPath: 'src/b.ts', absPath: '/repo/src/b.ts', name: 'b.ts' };

describe('captureIDEPaneHandoff', () => {
  it('보던 상태를 그대로 뜬다 (편집 탭·뷰·세션·붙은 변)', () => {
    const h = captureIDEPaneHandoff(pane({
      activeSessionId: 'sub-9',
      activeView: 'files',
      sidebarCollapsed: false,
      editorFiles: [FILE_A, FILE_B],
      activeEditorPath: FILE_B.relPath,
      dockSide: 'right',
      dockSize: 520,
      dockOrder: 2,
      dockSpan: 3,
    }));
    expect(h).toMatchObject({
      v: 1,
      agentId: AGENT,
      activeSessionId: 'sub-9',
      activeView: 'files',
      sidebarCollapsed: false,
      activeEditorPath: FILE_B.relPath,
      dockSide: 'right',
      dockSize: 520,
      dockOrder: 2,
      dockSpan: 3,
    });
    expect(h?.editorFiles.map((f) => f.relPath)).toEqual([FILE_A.relPath, FILE_B.relPath]);
  });

  it('빈 슬롯(에이전트 없음)은 지고 갈 것이 없다', () => {
    expect(captureIDEPaneHandoff(pane({ agentId: null }))).toBeNull();
  });

  it('원본을 복사한다 — 짐을 고쳐도 원래 창이 흔들리지 않는다', () => {
    const src = pane({ editorFiles: [FILE_A], float: { x: 1, y: 2, w: 3, h: 4 } });
    const h = captureIDEPaneHandoff(src)!;
    h.editorFiles[0]!.name = 'CHANGED';
    h.float!.x = 999;
    expect(src.editorFiles[0]!.name).toBe('a.ts');
    expect(src.float!.x).toBe(1);
  });
});

describe('coerceIDEPaneHandoff', () => {
  it('우리가 보낸 짐은 그대로 받는다', () => {
    const h = captureIDEPaneHandoff(pane({ editorFiles: [FILE_A], activeEditorPath: FILE_A.relPath }));
    expect(coerceIDEPaneHandoff(h)).toMatchObject({ agentId: AGENT, activeEditorPath: FILE_A.relPath });
  });

  it('모양이 아닌 값은 통째로 버린다 (반쯤 맞는 짐으로 창을 세우지 않는다)', () => {
    expect(coerceIDEPaneHandoff(null)).toBeNull();
    expect(coerceIDEPaneHandoff('nope')).toBeNull();
    expect(coerceIDEPaneHandoff({})).toBeNull();
    // 판 번호가 다르면(옛 창이 새 앱에 짐을 넘김) 받지 않는다.
    expect(coerceIDEPaneHandoff({ v: 2, agentId: AGENT })).toBeNull();
    // 에이전트를 모르면 어느 창의 짐인지 알 수 없다.
    expect(coerceIDEPaneHandoff({ v: 1, agentId: '' })).toBeNull();
  });

  it('모르는 변·깨진 좌표는 조용히 기본값으로 내려앉는다', () => {
    const out = coerceIDEPaneHandoff({
      v: 1,
      agentId: AGENT,
      dockSide: 'diagonal',
      dockSize: Number.NaN,
      float: { x: 1, y: 2, w: 'wide', h: 4 },
    })!;
    expect(out.dockSide).toBeNull();
    expect(out.dockSize).toBe(0);
    expect(out.float).toBeNull();
  });

  it('탭 목록에서 모양이 깨진 항목만 골라낸다', () => {
    const out = coerceIDEPaneHandoff({
      v: 1,
      agentId: AGENT,
      editorFiles: [FILE_A, { relPath: '' }, { name: 'x' }, null, FILE_B],
    })!;
    expect(out.editorFiles.map((f) => f.relPath)).toEqual([FILE_A.relPath, FILE_B.relPath]);
  });

  it('저장하지 않은 표시(dirty)는 지고 오지 않는다 — 새 창이 "고쳤다"고 거짓말하면 안 된다', () => {
    const out = coerceIDEPaneHandoff({
      v: 1,
      agentId: AGENT,
      editorFiles: [{ ...FILE_A, dirty: true }],
    })!;
    expect(out.editorFiles[0]!.dirty).toBeUndefined();
  });
});

describe('handoffPanePatch', () => {
  const handoff = captureIDEPaneHandoff(pane({
    activeSessionId: 'sub-9',
    sidebarCollapsed: false,
    editorFiles: [FILE_A, FILE_B],
    activeEditorPath: FILE_B.relPath,
    dockSide: 'right',
    dockSize: 520,
    dockOrder: 2,
    dockSpan: 3,
    float: { x: 10, y: 20, w: 800, h: 600 },
  }))!;

  it('앱 안으로 돌아올 때는 **붙어 있던 변까지** 되살린다', () => {
    const patch = handoffPanePatch(handoff, 'app');
    expect(patch).toMatchObject({
      activeSessionId: 'sub-9',
      sidebarCollapsed: false,
      activeEditorPath: FILE_B.relPath,
      dockSide: 'right',
      dockSize: 520,
      dockOrder: 2,
      dockSpan: 3,
    });
    expect(patch.float).toEqual({ x: 10, y: 20, w: 800, h: 600 });
    // 붙어 있던 창이 모달로 돌아오면 캔버스를 통째로 덮어 "원래 자리로 합쳤다"가 깨진다.
    expect(patch.openMode).toBe('floating');
  });

  it('독립 창은 자리 값을 물려받지 않는다 — 도킹된 창인 척하면 안 된다', () => {
    const patch = handoffPanePatch(handoff, 'detached');
    expect(patch.dockSide).toBeUndefined();
    expect(patch.float).toBeUndefined();
    expect(patch.openMode).toBeUndefined();
    // 하던 일(편집 탭·세션·사이드바)은 밖에서도 그대로 이어진다.
    expect(patch.editorFiles?.map((f) => f.relPath)).toEqual([FILE_A.relPath, FILE_B.relPath]);
    expect(patch.activeSessionId).toBe('sub-9');
  });

  it('열린 탭에 없는 경로를 고르고 있으면 아무 탭도 고르지 않는다', () => {
    const stray = { ...handoff, activeEditorPath: 'src/gone.ts' };
    expect(handoffPanePatch(stray, 'app').activeEditorPath).toBeNull();
  });

  it('앱 → 독립 창 → 앱 왕복에도 열어 둔 탭과 붙은 변이 살아남는다', () => {
    // ① 앱 안 창에서 짐을 뜬다 → ② 독립 창이 그것으로 선다(자리 값은 안 물려받되 짐에는 남아 있다)
    //   → ③ 그 창이 되돌아오며 다시 짐을 뜬다 → ④ 앱 안 창이 원래 자리로 복귀.
    const detachedPane = pane({
      ...handoffPanePatch(handoff, 'detached'),
      // 독립 창은 붙은 변을 안 물려받으므로 슬롯에는 짐이 지고 있던 값이 그대로 남아 있다
      //   (`AgentIDEOverlay` 의 도크 sync 가 독립 창에서는 이 값을 지우지 않는다).
      dockSide: handoff.dockSide,
      dockSize: handoff.dockSize,
      dockOrder: handoff.dockOrder,
      dockSpan: handoff.dockSpan,
      float: handoff.float,
    });
    const back = handoffPanePatch(captureIDEPaneHandoff(detachedPane)!, 'app');
    expect(back.editorFiles?.map((f) => f.relPath)).toEqual([FILE_A.relPath, FILE_B.relPath]);
    expect(back.activeEditorPath).toBe(FILE_B.relPath);
    expect(back.activeSessionId).toBe('sub-9');
    expect(back.dockSide).toBe('right');
    expect(back.dockSize).toBe(520);
  });
});
