/**
 * 도는 에이전트가 저절로 휴지통에 가던 회귀(2026-09-11 실측) — 옛 캔버스 keydown 이 `Backspace` 를 받았고 레지스트리(§5.24 #32) 밖이라
 * 스코프·입력칸·IME 판정이 없어 IDE 창의 지우기가 버블을 지웠다.
 * 못 박는 셋: 지우기 기본 키는 `Delete` 하나 · 캔버스가 `Backspace` 를 다시 받지 않음 · 키와 메뉴가 같은 판정·실행.
 * glob 이 비면 조용히 통과하므로 "읽어 왔다"를 먼저 못 박는다.
 */
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS } from '@vibisual/shared';

import {
  bubbleDeleteAction,
  bubbleDeleteBatchLabelKey,
  bubbleDeleteLabelKey,
  planSelectionDelete,
  runBubbleDelete,
  runSelectionDelete,
  type BubbleDeleteRunner,
  type DeletableBubble,
  type SelectionDeleteRunner,
} from './bubbleDeleteAction.js';
import { isCanvasSurfaceTarget } from './canvasSurface.js';

const SOURCES = import.meta.glob('./*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 주석을 걷어낸 소스 — 사고 경위를 적은 주석의 `Backspace` 가 검사를 붉히지 않게. */
function codeOf(name: string): string {
  const hit = Object.entries(SOURCES).find(([p]) => p.endsWith(`/${name}`));
  if (!hit) throw new Error(`소스 ${name} 을 찾지 못했다`);
  return hit[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const bubble = (b: Partial<DeletableBubble>): DeletableBubble =>
  ({ bubbleType: 'agent', ...b }) as DeletableBubble;

describe('지우기 키 배정 — Backspace 는 없다', () => {
  it('기본 배정은 `Delete` 하나다', () => {
    expect(COMMANDS['canvas.deleteSelection'].defaultBinding).toBe('Delete');
  });

  it('어떤 명령도 `Backspace` 를 기본으로 갖지 않는다', () => {
    const bound = Object.entries(COMMANDS)
      .filter(([, def]) => /Backspace/.test(def.defaultBinding))
      .map(([id]) => id);
    expect(bound, `Backspace 가 배정된 명령: ${bound.join(', ')}`).toEqual([]);
  });

  it('지우기는 캔버스 스코프다 — IDE 창·팝업에서 누른 키가 버블을 지우지 않는다', () => {
    expect(COMMANDS['canvas.deleteSelection'].scope).toBe('canvas');
  });

  it('소스를 실제로 읽어 왔다 — glob 이 비면 아래 검사가 헛통과한다', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(5);
  });

  it('캔버스가 `Backspace` 를 다시 지우기 키로 받지 않는다', () => {
    expect(codeOf('BubbleMap.tsx')).not.toMatch(/Backspace/);
  });
});

describe('지우기 판정 — 무엇이 되는가', () => {
  it('네비게이션 골격(root·back)은 지울 수 없다', () => {
    expect(bubbleDeleteAction(bubble({ bubbleType: 'root' }), { inTrashView: false }).kind).toBe('none');
    expect(bubbleDeleteAction(bubble({ bubbleType: 'back' }), { inTrashView: false }).kind).toBe('none');
  });

  it('없는 버블은 지울 수 없다 — 메뉴가 빈 상자로 뜨지 않게', () => {
    expect(bubbleDeleteAction(undefined, { inTrashView: false }).kind).toBe('none');
    expect(bubbleDeleteAction(null, { inTrashView: false }).kind).toBe('none');
  });

  it('커스텀 에이전트는 휴지통으로 간다(즉시 삭제가 아니다)', () => {
    expect(bubbleDeleteAction(bubble({ customCreated: true }), { inTrashView: false }).kind).toBe('trash');
  });

  it('훅이 만든 에이전트는 그냥 걷힌다 — 휴지통은 사용자가 만든 것만 받는다', () => {
    expect(bubbleDeleteAction(bubble({ customCreated: false }), { inTrashView: false }).kind).toBe('remove');
  });

  it('워크트리는 전용 흐름(merge 가드 + 폴더 삭제)으로 간다', () => {
    expect(bubbleDeleteAction(bubble({ bubbleType: 'worktree' }), { inTrashView: false }).kind).toBe('worktree');
  });

  it('휴지통 안에서 버려진 것은 영구 삭제다 — 일반 경로로 흘리면 디스크에 남는다', () => {
    const trashed = bubble({ customCreated: true, trashed: true });
    expect(bubbleDeleteAction(trashed, { inTrashView: true }).kind).toBe('purge');
    expect(bubbleDeleteAction(trashed, { inTrashView: false }).kind).toBe('trash');
  });

  it('휴지통 안이라도 버려지지 않은 버블은 대상이 아니다', () => {
    expect(bubbleDeleteAction(bubble({ customCreated: true }), { inTrashView: true }).kind).toBe('none');
  });

  it('고정(preserve-pin)해도 `kind` 는 그대로고 표시만 달라진다', () => {
    const pinned = bubbleDeleteAction(bubble({ customCreated: true, preservePinned: true }), { inTrashView: false });
    expect(pinned).toEqual({ kind: 'trash', pinned: true });
  });
});

describe('메뉴 문구 — 되돌릴 수 있는지가 말에 드러난다', () => {
  it('휴지통 이동과 영구 삭제를 같은 말로 적지 않는다', () => {
    expect(bubbleDeleteLabelKey('trash')).toBe('canvas.bubbleMenu.moveToTrash');
    expect(bubbleDeleteLabelKey('purge')).toBe('canvas.bubbleMenu.deleteForever');
    expect(bubbleDeleteLabelKey('remove')).toBe('canvas.bubbleMenu.delete');
    expect(bubbleDeleteLabelKey('worktree')).toBe('canvas.bubbleMenu.deleteWorktree');
  });

  it('지울 수 없는 버블에는 문구가 없다 — 항목 자체를 내지 않는다', () => {
    expect(bubbleDeleteLabelKey('none')).toBeNull();
  });
});

describe('지우기 실행 — 키와 메뉴가 같은 창구를 쓴다', () => {
  function spyRunner(): BubbleDeleteRunner & {
    calls: { purge: string[][]; worktree: [string, string][]; select: (string | null)[] };
  } {
    const calls = { purge: [] as string[][], worktree: [] as [string, string][], select: [] as (string | null)[] };
    return {
      calls,
      requestTrashPurge: (ids) => calls.purge.push(ids),
      requestWorktreeDelete: (id, label) => calls.worktree.push([id, label]),
      selectNode: (id) => calls.select.push(id),
    };
  }

  /** `fetch` 를 세워 두고 그 사이에만 부른다 — 테스트가 진짜 요청을 내보내지 않게. */
  function withFetch(run: (f: ReturnType<typeof vi.fn>) => void): ReturnType<typeof vi.fn> {
    const f = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    const prev = globalThis.fetch;
    globalThis.fetch = f as unknown as typeof fetch;
    try {
      run(f);
    } finally {
      globalThis.fetch = prev;
    }
    return f;
  }

  it('휴지통 이동은 REST 창구 하나로 간다 — 서버가 휴지통으로 돌린다', () => {
    const runner = spyRunner();
    const f = withFetch(() => {
      runBubbleDelete('agent-1', 'Agent 1', { kind: 'trash', pinned: false }, runner);
    });
    expect(f).toHaveBeenCalledWith('/api/bubble/agent-1', { method: 'DELETE' });
    expect(runner.calls.select).toEqual([null]);
    expect(runner.calls.purge).toEqual([]);
  });

  it('영구 삭제는 확인 팝업 경로로 간다 — REST 를 직접 때리지 않는다', () => {
    const runner = spyRunner();
    const f = withFetch(() => {
      runBubbleDelete('agent-2', 'Agent 2', { kind: 'purge', pinned: false }, runner);
    });
    expect(f).not.toHaveBeenCalled();
    expect(runner.calls.purge).toEqual([['agent-2']]);
  });

  it('워크트리는 가드 다이얼로그로 간다 — 폴더가 말없이 지워지지 않게', () => {
    const runner = spyRunner();
    const f = withFetch(() => {
      runBubbleDelete('wt-1', 'feature/x', { kind: 'worktree', pinned: false }, runner);
    });
    expect(f).not.toHaveBeenCalled();
    expect(runner.calls.worktree).toEqual([['wt-1', 'feature/x']]);
  });

  it('`none` 은 아무 일도 하지 않는다', () => {
    const runner = spyRunner();
    const f = withFetch(() => {
      runBubbleDelete('root', 'root', { kind: 'none', pinned: false }, runner);
    });
    expect(f).not.toHaveBeenCalled();
    expect(runner.calls).toEqual({ purge: [], worktree: [], select: [] });
  });
});

/** 묶음 위 우클릭이 생성 메뉴로 새던 회귀 — `.react-flow__nodesselection-rect`(`pointer-events: all`)가 버블을 덮어 빈 곳으로 판정됐다. */
describe('묶음 위 우클릭 — 빈 곳 메뉴로 새지 않는다', () => {
  /** `closest` 하나만 흉내 내는 최소 대상(테스트 환경엔 DOM 이 없다). */
  const targetIn = (...classes: string[]) => ({
    closest: (sel: string) => (sel.split(',').some((s) => classes.includes(s.trim())) ? {} : null),
  });

  it('다중 선택 상자 위는 캔버스 빈 곳이 아니다', () => {
    expect(isCanvasSurfaceTarget(targetIn('.react-flow', '.react-flow__nodesselection'))).toBe(false);
  });

  it('버블 위도 종전대로 빈 곳이 아니다', () => {
    expect(isCanvasSurfaceTarget(targetIn('.react-flow', '.react-flow__node'))).toBe(false);
  });

  it('진짜 빈 곳에서는 종전대로 생성 메뉴가 열린다', () => {
    expect(isCanvasSurfaceTarget(targetIn('.react-flow'))).toBe(true);
  });
});

describe('묶음 삭제 판정 — 키와 메뉴가 같은 것을 센다', () => {
  const nodeMap: Record<string, DeletableBubble | undefined> = {
    a: bubble({ customCreated: true }),
    b: bubble({ customCreated: true }),
    hook: bubble({ customCreated: false }),
    wt: bubble({ bubbleType: 'worktree' }),
    root: bubble({ bubbleType: 'root' }),
    trashed: bubble({ customCreated: true, trashed: true }),
  };
  const plan = (ids: string[], extra: { edges?: { id: string; type?: string; data?: unknown }[]; nodes?: { id: string; type?: string; data?: unknown }[] } = {}, inTrashView = false) =>
    planSelectionDelete(
      [...ids.map((id) => ({ id, type: 'bubble' })), ...(extra.nodes ?? [])],
      extra.edges ?? [],
      nodeMap,
      { inTrashView },
    );

  it('커스텀 에이전트만 골랐으면 통째로 휴지통행이라고 말한다', () => {
    const p = plan(['a', 'b']);
    expect(p.bubbleIds).toEqual(['a', 'b']);
    expect(p.kind).toBe('trash');
    expect(p.count).toBe(2);
  });

  it('되돌릴 수 없는 것이 섞이면 "휴지통으로 이동"이라 말하지 않는다', () => {
    // 그렇게 말하면 되돌릴 수 있다고 약속하는 셈이 된다.
    expect(plan(['a', 'hook']).kind).toBe('remove');
  });

  it('워크트리는 묶음에서 빠지고 **몇 개가 빠졌는지 남는다**', () => {
    const p = plan(['a', 'wt']);
    expect(p.bubbleIds).toEqual(['a']);
    expect(p.skippedWorktreeIds).toEqual(['wt']);
    expect(p.count).toBe(1);
  });

  it('골격은 조용히 빠진다 — 애초에 대상이 아니다', () => {
    const p = plan(['a', 'root']);
    expect(p.bubbleIds).toEqual(['a']);
    expect(p.skippedWorktreeIds).toEqual([]);
  });

  it('메모 상자·캡처·Task 엣지도 같은 묶음으로 센다', () => {
    const p = plan(['a'], {
      nodes: [
        { id: 'cb-node', type: 'commentBox', data: { commentBoxId: 'box-1' } },
        { id: 'cap-node', type: 'captureNode', data: { captureBubbleId: 'cap-1' } },
      ],
      edges: [{ id: 'task-7', type: 'taskEdge' }],
    });
    expect(p.commentBoxIds).toEqual(['box-1']);
    expect(p.captureIds).toEqual(['cap-1']);
    expect(p.taskEdgeIds).toEqual(['7']);
    expect(p.count).toBe(4);
  });

  // §6 — 앱·플레이·스펙·랩·선반 노드도 이제 박스·Shift·Ctrl/Cmd 로 묶음에 든다. 묶음에 들었는데 `Delete`·묶음
  //   메뉴가 그것을 세지 않으면 "고른 것 중 몇 개만 지워졌다"가 된다.
  it('store 가 좌표를 쥔 노드도 같은 묶음으로 센다 — 플레이 표지·프리뷰는 한 레코드다', () => {
    const p = plan(['a'], {
      nodes: [
        { id: 'app-node', type: 'appNode', data: { appBubbleId: 'app-1' } },
        { id: 'play-1', type: 'playNode', data: { playBubbleId: 'play-1' } },
        { id: 'play-1__preview', type: 'playPreviewNode', data: { playBubbleId: 'play-1' } },
        { id: 'spec-1', type: 'specNode', data: { specDocId: 'spec-1' } },
        { id: 'lab-1', type: 'labNode', data: { labRunId: 'lab-1' } },
        { id: 'shelf-1', type: 'shelfNode', data: { shelfBubbleId: 'shelf-1' } },
      ],
    });
    expect(p.appBubbleIds).toEqual(['app-1']);
    expect(p.playBubbleIds).toEqual(['play-1']);
    expect(p.specDocIds).toEqual(['spec-1']);
    expect(p.labRunIds).toEqual(['lab-1']);
    expect(p.shelfBubbleIds).toEqual(['shelf-1']);
    expect(p.count).toBe(6);
    // 되돌릴 수 없는 것이 섞였으니 "휴지통으로 이동"이라 말하지 않는다.
    expect(p.kind).toBe('remove');
  });

  it('휴지통 안에서는 store 노드도 손대지 않는다', () => {
    const p = plan(['trashed'], { nodes: [{ id: 'app-node', type: 'appNode', data: { appBubbleId: 'app-1' } }] }, true);
    expect(p.appBubbleIds).toEqual([]);
    expect(p.purgeIds).toEqual(['trashed']);
  });

  it('휴지통 안에서는 버려진 것의 영구 삭제만 담는다', () => {
    const p = plan(['trashed', 'a'], {}, true);
    expect(p.purgeIds).toEqual(['trashed']);
    expect(p.bubbleIds).toEqual([]);
    expect(p.kind).toBe('purge');
  });

  it('지울 것이 하나도 없으면 항목을 내지 않는다', () => {
    const p = plan(['root']);
    expect(p.kind).toBe('none');
    expect(bubbleDeleteBatchLabelKey(p.kind)).toBeNull();
  });

  it('묶음 문구는 단건과 다른 키다 — 수가 들어가는 자리가 언어마다 다르다', () => {
    expect(bubbleDeleteBatchLabelKey('trash')).toBe('canvas.bubbleMenu.moveToTrashN');
    expect(bubbleDeleteBatchLabelKey('remove')).toBe('canvas.bubbleMenu.deleteN');
    expect(bubbleDeleteBatchLabelKey('purge')).toBe('canvas.bubbleMenu.deleteForeverN');
  });
});

describe('묶음 삭제 실행 — 한 번의 스냅샷으로 사라진다', () => {
  interface Calls {
    purge: string[][]; edge: string[]; box: string[]; cap: string[];
    app: string[]; play: string[]; spec: string[]; lab: string[]; shelf: string[];
  }
  function runner(): SelectionDeleteRunner & { calls: Calls } {
    const calls: Calls = { purge: [], edge: [], box: [], cap: [], app: [], play: [], spec: [], lab: [], shelf: [] };
    return {
      calls,
      requestTrashPurge: (ids) => { calls.purge.push(ids); },
      deleteTaskEdge: (id) => { calls.edge.push(id); },
      deleteCommentBox: (id) => { calls.box.push(id); },
      deleteCaptureBubble: (id) => { calls.cap.push(id); },
      deleteAppBubble: (id) => { calls.app.push(id); },
      deletePlayBubble: (id) => { calls.play.push(id); },
      deleteSpecDoc: (id) => { calls.spec.push(id); },
      deleteLabRun: (id) => { calls.lab.push(id); },
      deleteShelfBubble: (id) => { calls.shelf.push(id); },
    };
  }
  function withFetch(run: (f: ReturnType<typeof vi.fn>) => void): ReturnType<typeof vi.fn> {
    const f = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    const prev = globalThis.fetch;
    globalThis.fetch = f as unknown as typeof fetch;
    try { run(f); } finally { globalThis.fetch = prev; }
    return f;
  }
  const empty = {
    purgeIds: [], bubbleIds: [], taskEdgeIds: [], commentBoxIds: [], captureIds: [],
    appBubbleIds: [], playBubbleIds: [], specDocIds: [], labRunIds: [], shelfBubbleIds: [],
    skippedWorktreeIds: [], kind: 'remove' as const, count: 0,
  };

  it('버블은 개별 DELETE 가 아니라 배치 창구 하나로 간다', () => {
    // 개별로 N 번 쏘면 서버가 스냅샷을 N 번 보내 버블이 나눠 사라진다.
    const r = runner();
    const f = withFetch(() => {
      runSelectionDelete({ ...empty, bubbleIds: ['a', 'b'], count: 2 }, r);
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('/api/bubbles/delete', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String((f.mock.calls[0]?.[1] as { body: string }).body))).toEqual({ ids: ['a', 'b'] });
  });

  it('휴지통 안이면 확인 팝업 하나로 끝나고 REST 를 직접 때리지 않는다', () => {
    const r = runner();
    const f = withFetch(() => {
      runSelectionDelete({ ...empty, purgeIds: ['t1', 't2'], kind: 'purge', count: 2 }, r);
    });
    expect(f).not.toHaveBeenCalled();
    expect(r.calls.purge).toEqual([['t1', 't2']]);
  });

  it('엣지·메모 상자·캡처는 각자의 창구로 간다', () => {
    const r = runner();
    withFetch(() => {
      runSelectionDelete({ ...empty, taskEdgeIds: ['7'], commentBoxIds: ['box-1'], captureIds: ['cap-1'], count: 3 }, r);
    });
    expect(r.calls.edge).toEqual(['7']);
    expect(r.calls.box).toEqual(['box-1']);
    expect(r.calls.cap).toEqual(['cap-1']);
  });

  it('앱·플레이·스펙·랩·선반은 각자의 창구로 간다 — 배치 창구(버블 전용)로 섞이지 않는다', () => {
    const r = runner();
    const f = withFetch(() => {
      runSelectionDelete({
        ...empty,
        appBubbleIds: ['app-1'], playBubbleIds: ['play-1'], specDocIds: ['spec-1'],
        labRunIds: ['lab-1'], shelfBubbleIds: ['shelf-1'], count: 5,
      }, r);
    });
    expect(f).not.toHaveBeenCalled();
    expect(r.calls).toMatchObject({
      app: ['app-1'], play: ['play-1'], spec: ['spec-1'], lab: ['lab-1'], shelf: ['shelf-1'],
    });
  });
});
