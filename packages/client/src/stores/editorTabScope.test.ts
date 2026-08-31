import { beforeEach, describe, expect, it } from 'vitest';

import { IDE_EDITOR_MAX_TABS, IDE_EDITOR_TAB_SCOPE_MAX } from '@vibisual/shared';
import type { SubAgent } from '@vibisual/shared';
import { useGraphStore, DEFAULT_IDE_OVERLAY, type IDEEditorFile } from './graphStore.js';
import {
  editorTabScopeKey,
  pruneEditorTabScopes,
  setEditorTabsPinned,
  switchEditorTabScope,
  type EditorTabScopeState,
} from './editorTabScope.js';
import { listCells } from '../components/IDE/splitLayout.js';

/**
 * §5.5 #17-27 ⑯ — **탭 줄은 그 세션의 것이다** 의 규약.
 *
 * 사용자 지시: "이거 보조창 열린 세션에 종속되게 만들고 위에 고정 버튼 넣어서 다른 세션 넘어가도
 * 고정버튼 눌려져 있으면 계속 유지되게 하자 / 지금은 세션 넘나들어도 계속 유지가 돼".
 *
 * 여기서 못 박는 것은 화면이 아니라 약속이다 — ① 세션을 옮기면 탭도 함께 간다 ② 돌아오면 그대로
 * 돌아온다 ③ [고정] 이면 지금 탭이 따라간다 ④ 고정을 풀 때 열려 있던 탭을 잃지 않는다
 * ⑤ 접어 두는 세션 수에 상한이 있다. 세션을 오가며 눈으로 확인하기 가장 어려운 부류라 값으로 잰다.
 */

const PROJ = 'proj';
const AGENT = 'agent-1';

function file(name: string, dirty = false): IDEEditorFile {
  return { relPath: `src/${name}`, absPath: `C:/w/src/${name}`, name, ...(dirty ? { dirty: true } : {}) };
}

function pane(over: Partial<EditorTabScopeState> = {}): EditorTabScopeState {
  return {
    editorFiles: [],
    activeEditorPath: null,
    editorPinned: false,
    editorTabsBySession: {},
    ...over,
  };
}

// ─── 순수 계산 ────────────────────────────────────────────────────────────

describe('접고 펴기(고정 ❌)', () => {
  it('떠나는 세션 것은 접히고, 처음 가는 세션은 빈 편집창이다', () => {
    const before = pane({ editorFiles: [file('a.ts'), file('b.ts')], activeEditorPath: 'src/b.ts' });
    const after = switchEditorTabScope(before, 'sub-a', 'sub-b');
    expect(after.editorFiles).toEqual([]);
    expect(after.activeEditorPath).toBeNull();
    expect(after.editorTabsBySession['sub-a']?.files.map((f) => f.relPath)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(after.editorTabsBySession['sub-a']?.activePath).toBe('src/b.ts');
  });

  it('돌아오면 탭도 활성 탭도 그대로 돌아온다', () => {
    const away = switchEditorTabScope(
      pane({ editorFiles: [file('a.ts'), file('b.ts')], activeEditorPath: 'src/b.ts' }),
      'sub-a',
      'sub-b',
    );
    const back = switchEditorTabScope({ ...away, editorFiles: [file('c.ts')], activeEditorPath: 'src/c.ts' }, 'sub-b', 'sub-a');
    expect(back.editorFiles.map((f) => f.relPath)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(back.activeEditorPath).toBe('src/b.ts');
    // 편 묶음은 접어 둔 자리에서 빠진다 — 같은 탭이 두 곳에 살면 어느 쪽이 진짜인지 알 수 없다.
    expect(back.editorTabsBySession['sub-a']).toBeUndefined();
    expect(back.editorTabsBySession['sub-b']?.files.map((f) => f.relPath)).toEqual(['src/c.ts']);
  });

  it('세션 탭이 없는 전체 보기도 자기 칸을 가진다', () => {
    const after = switchEditorTabScope(pane({ editorFiles: [file('a.ts')], activeEditorPath: 'src/a.ts' }), null, 'sub-a');
    expect(editorTabScopeKey(null)).toBe('main');
    expect(after.editorTabsBySession.main?.files).toHaveLength(1);
  });

  it('같은 세션이면 아무 일도 없다(참조까지 그대로 = 리렌더 ❌)', () => {
    const before = pane({ editorFiles: [file('a.ts')], activeEditorPath: 'src/a.ts' });
    expect(switchEditorTabScope(before, 'sub-a', 'sub-a')).toBe(before);
  });

  it('빈 편집창은 키를 만들지 않는다(안 쓰는 세션이 자리를 먹지 않게)', () => {
    const after = switchEditorTabScope(pane(), 'sub-a', 'sub-b');
    expect(Object.keys(after.editorTabsBySession)).toEqual([]);
  });

  it(`접어 두는 세션은 ${IDE_EDITOR_TAB_SCOPE_MAX}개까지 — 넘으면 가장 오래전에 떠난 것부터 버린다`, () => {
    let cur = pane();
    for (let i = 0; i <= IDE_EDITOR_TAB_SCOPE_MAX; i += 1) {
      cur = { ...cur, editorFiles: [file(`f${i}.ts`)], activeEditorPath: `src/f${i}.ts` };
      cur = switchEditorTabScope(cur, `sub-${i}`, `sub-${i + 1}`);
    }
    const keys = Object.keys(cur.editorTabsBySession);
    expect(keys).toHaveLength(IDE_EDITOR_TAB_SCOPE_MAX);
    expect(keys).not.toContain('sub-0');
    expect(keys).toContain(`sub-${IDE_EDITOR_TAB_SCOPE_MAX}`);
  });
});

describe('[고정]', () => {
  it('켜져 있으면 세션을 옮겨도 지금 탭이 따라간다', () => {
    const before = pane({ editorFiles: [file('a.ts')], activeEditorPath: 'src/a.ts', editorPinned: true });
    const after = switchEditorTabScope(before, 'sub-a', 'sub-b');
    expect(after.editorFiles.map((f) => f.relPath)).toEqual(['src/a.ts']);
    expect(after.activeEditorPath).toBe('src/a.ts');
  });

  it('고정 중에도 떠나는 세션 것은 접어 둔다 — 그 세션의 탭 한 벌이 조용히 사라지지 않게', () => {
    const after = switchEditorTabScope(
      pane({ editorFiles: [file('a.ts')], activeEditorPath: 'src/a.ts', editorPinned: true }),
      'sub-a',
      'sub-b',
    );
    expect(after.editorTabsBySession['sub-a']?.files.map((f) => f.relPath)).toEqual(['src/a.ts']);
  });

  it('풀면 지금 탭이 이 세션 것이 되고, 접혀 있던 이 세션 탭이 뒤에 이어 붙는다', () => {
    const cur = pane({
      editorFiles: [file('a.ts')],
      activeEditorPath: 'src/a.ts',
      editorPinned: true,
      editorTabsBySession: { 'sub-b': { files: [file('b.ts')], activePath: 'src/b.ts' } },
    });
    const after = setEditorTabsPinned(cur, false, 'sub-b');
    expect(after.editorPinned).toBe(false);
    expect(after.editorFiles.map((f) => f.relPath)).toEqual(['src/a.ts', 'src/b.ts']);
    // 보고 있던 탭은 그대로 — 고정을 푸는 손짓이 화면을 딴 파일로 튀게 하지 않는다.
    expect(after.activeEditorPath).toBe('src/a.ts');
    expect(after.editorTabsBySession['sub-b']).toBeUndefined();
  });

  it('풀 때 같은 파일이 양쪽에 있으면 한 번만 선다', () => {
    const cur = pane({
      editorFiles: [file('a.ts')],
      activeEditorPath: 'src/a.ts',
      editorPinned: true,
      editorTabsBySession: { 'sub-b': { files: [file('a.ts'), file('b.ts')], activePath: 'src/a.ts' } },
    });
    const after = setEditorTabsPinned(cur, false, 'sub-b');
    expect(after.editorFiles.map((f) => f.relPath)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('합쳐서 상한을 넘으면 ③ 과 같은 규율로 안 고친 것부터 밀린다(고치던 파일은 남는다)', () => {
    const open = Array.from({ length: IDE_EDITOR_MAX_TABS }, (_, i) => file(`open${i}.ts`));
    const cur = pane({
      editorFiles: [file('dirty.ts', true), ...open],
      activeEditorPath: 'src/dirty.ts',
      editorPinned: true,
      editorTabsBySession: { 'sub-b': { files: [file('stashed.ts', true)], activePath: 'src/stashed.ts' } },
    });
    const after = setEditorTabsPinned(cur, false, 'sub-b');
    expect(after.editorFiles).toHaveLength(IDE_EDITOR_MAX_TABS);
    const kept = after.editorFiles.map((f) => f.relPath);
    expect(kept).toContain('src/dirty.ts');
    expect(kept).toContain('src/stashed.ts');
  });

  it('같은 값으로 다시 부르면 아무 일도 없다', () => {
    const cur = pane({ editorPinned: false });
    expect(setEditorTabsPinned(cur, false, 'sub-a')).toBe(cur);
  });
});

describe('사라진 세션 걷기', () => {
  it('살아 있지 않은 세션이 접어 둔 탭은 버린다(전체 보기 칸은 늘 남는다)', () => {
    const stashes = {
      'sub-a': { files: [file('a.ts')], activePath: 'src/a.ts' },
      'sub-gone': { files: [file('g.ts')], activePath: 'src/g.ts' },
      main: { files: [file('m.ts')], activePath: 'src/m.ts' },
    };
    const after = pruneEditorTabScopes(stashes, ['sub-a']);
    expect(Object.keys(after).sort()).toEqual(['main', 'sub-a']);
  });

  it('걷어낼 게 없으면 같은 객체를 돌려준다(리렌더 ❌)', () => {
    const stashes = { 'sub-a': { files: [file('a.ts')], activePath: 'src/a.ts' } };
    expect(pruneEditorTabScopes(stashes, ['sub-a'])).toBe(stashes);
  });
});

// ─── 스토어 배선 ──────────────────────────────────────────────────────────

function sub(id: string, parentAgentId: string): SubAgent {
  return { id, sessionId: `cc-${id}`, label: id, parentAgentId, status: 'idle', createdAt: 0, lastActivityAt: 0 };
}

const store = (): ReturnType<typeof useGraphStore.getState> => useGraphStore.getState();
const slot = () => store().ideOverlays[PROJ]!;
const openPaths = (): string[] => slot().editorFiles.map((f) => f.relPath);

function seed(): void {
  useGraphStore.setState({
    activeProject: PROJ,
    ideOverlays: {
      [PROJ]: { ...DEFAULT_IDE_OVERLAY, agentId: AGENT, paneKey: PROJ, projectId: PROJ, activeSessionId: 'sub-a' },
    },
    subAgents: { [AGENT]: ['sub-a', 'sub-b', 'sub-c'].map((id) => sub(id, AGENT)) },
    ideSplits: {},
    selectedSubByAgent: {},
    acknowledgedSubAgents: {},
  });
}

describe('스토어 — 세션 탭을 옮기면 편집창도 함께 간다', () => {
  beforeEach(() => { seed(); });

  it('세션을 옮기면 그 세션이 열어 둔 파일만 보인다', () => {
    store().openIDEEditorFile(file('a.ts'), PROJ);
    store().setIDEActiveSession('sub-b', PROJ);
    expect(openPaths()).toEqual([]);

    store().openIDEEditorFile(file('b.ts'), PROJ);
    expect(openPaths()).toEqual(['src/b.ts']);

    store().setIDEActiveSession('sub-a', PROJ);
    expect(openPaths()).toEqual(['src/a.ts']);
    expect(slot().activeEditorPath).toBe('src/a.ts');
  });

  it('[고정]을 켜면 세션을 넘나들어도 그대로 유지된다', () => {
    store().openIDEEditorFile(file('a.ts'), PROJ);
    store().setIDEEditorTabsPinned(true, PROJ);
    store().setIDEActiveSession('sub-b', PROJ);
    expect(openPaths()).toEqual(['src/a.ts']);
    store().setIDEActiveSession('sub-c', PROJ);
    expect(openPaths()).toEqual(['src/a.ts']);
  });

  it('사라진 세션이 접어 둔 탭은 다음 전환에서 걷힌다', () => {
    store().openIDEEditorFile(file('a.ts'), PROJ);
    store().setIDEActiveSession('sub-b', PROJ);
    expect(slot().editorTabsBySession['sub-a']).toBeDefined();
    // sub-a 가 지워졌다 — 그 묶음은 다시는 펴지지 않는다.
    useGraphStore.setState({ subAgents: { [AGENT]: ['sub-b', 'sub-c'].map((id) => sub(id, AGENT)) } });
    store().setIDEActiveSession('sub-c', PROJ);
    expect(slot().editorTabsBySession['sub-a']).toBeUndefined();
  });

  it('분할을 접어 창의 세션이 바뀔 때도 탭 줄이 함께 간다', () => {
    store().openIDEEditorFile(file('a.ts'), PROJ);
    store().dropSessionOnIDECell(PROJ, null, 'right', 'sub-b');
    const [first] = listCells(store().ideSplits[PROJ]!.layout);
    store().closeIDESplitCell(PROJ, first?.id ?? '');
    expect(slot().activeSessionId).toBe('sub-b');
    expect(openPaths()).toEqual([]);
    expect(slot().editorTabsBySession['sub-a']?.files.map((f) => f.relPath)).toEqual(['src/a.ts']);
  });
});
