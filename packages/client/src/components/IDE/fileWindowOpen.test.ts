/**
 * §5.5 #17-27 ⑳ 파일 창(`openFileInFileWindow`) 계약: 프로젝트마다 판 하나(`agentId: null` 슬롯, 더 열면 탭) · IDE 창으로 안 셈 ·
 * 루트 안은 상대·밖은 절대경로 탭 · 경로를 모르면 false(연결 프로그램으로) · 닫으면 창·판 자리를 함께 걷는다.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectInfo, SubAgent } from '@vibisual/shared';

import { useFileWindowsStore, fileWindowSlotKey } from '../../stores/fileWindows.js';
import { resolvePaneKey, selectProjectIDEPanes, useGraphStore } from '../../stores/graphStore.js';
import { closeFileWindow, dropFileWindow, openFileInFileWindow } from './fileWindowOpen.js';
import { editorFileQuery } from './useEditorDocs.js';

const PROJECT = 'proj';
const ROOT = 'C:/work/proj';
const AGENT = 'agent-1';
const SLOT = fileWindowSlotKey(PROJECT);
const store = (): ReturnType<typeof useGraphStore.getState> => useGraphStore.getState();
const project = (name: string, path: string): ProjectInfo => ({ name, path });
const sub = (id: string): SubAgent => ({
  id, sessionId: `session-${id}`, label: id, parentAgentId: AGENT, status: 'idle', createdAt: 0, lastActivityAt: 0,
});

beforeEach(() => {
  useGraphStore.setState({
    activeProject: PROJECT,
    projects: { [PROJECT]: project(PROJECT, ROOT) },
    stubProjects: {},
    ideOverlays: {}, closedIDEEditorTabs: [], idePaneSeq: 0, ideSplits: {},
    nodeMap: {}, agentConfigs: {}, agentProjects: { [AGENT]: PROJECT }, selectedSubByAgent: {}, defaultSubAgents: {},
    subAgents: { [AGENT]: [sub('a')] },
    ideEditorReveal: null, imageLightbox: null,
  });
  useFileWindowsStore.setState({ windows: [] });
});

describe('openFileInFileWindow — 지금 탭의 프로젝트에 파일 창 하나', () => {
  it('판 자리(에이전트 없는 슬롯)를 세우고 그 파일 탭을 열고 창을 띄운다', () => {
    expect(openFileInFileWindow(`${ROOT}/src/app.ts`)).toBe(true);
    const slot = store().ideOverlays[SLOT]!;
    expect(slot).toMatchObject({ agentId: null, paneKey: SLOT, projectId: PROJECT, activeEditorPath: 'src/app.ts' });
    expect(slot.editorFiles).toEqual([{ relPath: 'src/app.ts', absPath: `${ROOT}/src/app.ts`, name: 'app.ts' }]);
    expect(useFileWindowsStore.getState().windows).toMatchObject([{ id: SLOT, projectName: PROJECT, projectRoot: ROOT }]);
  });

  it('또 열면 새 창이 아니라 탭이 늘고, 그 창이 앞으로 온다', () => {
    openFileInFileWindow(`${ROOT}/src/app.ts`);
    const firstFocus = useFileWindowsStore.getState().windows[0]!.focusAt;
    openFileInFileWindow(`${ROOT}/docs/notes.md`);
    expect(useFileWindowsStore.getState().windows).toHaveLength(1);
    expect(useFileWindowsStore.getState().windows[0]!.focusAt).toBeGreaterThanOrEqual(firstFocus);
    expect(store().ideOverlays[SLOT]!.editorFiles.map((f) => f.relPath)).toEqual(['src/app.ts', 'docs/notes.md']);
    expect(store().ideOverlays[SLOT]!.activeEditorPath).toBe('docs/notes.md');
    // 같은 파일은 같은 탭 — 두 번째 탭이 서지 않는다.
    openFileInFileWindow(`${ROOT}/src/app.ts`);
    expect(store().ideOverlays[SLOT]!.editorFiles).toHaveLength(2);
    expect(store().ideOverlays[SLOT]!.activeEditorPath).toBe('src/app.ts');
  });

  it('루트 밖 파일은 절대경로 탭이다 — 편집창이 그 폴더 + 이름으로 읽는다', () => {
    openFileInFileWindow('D:/elsewhere/notes/plan.md');
    expect(store().ideOverlays[SLOT]!.editorFiles[0]).toEqual({ relPath: 'D:/elsewhere/notes/plan.md', absPath: 'D:/elsewhere/notes/plan.md', name: 'plan.md' });
    expect(editorFileQuery(ROOT, 'D:/elsewhere/notes/plan.md')).toEqual({ root: 'D:/elsewhere/notes', path: 'plan.md' });
  });

  it('지금 탭의 프로젝트(경로)를 모르면 열지 않는다', () => {
    useGraphStore.setState({ activeProject: null });
    expect(openFileInFileWindow(`${ROOT}/src/app.ts`)).toBe(false);
    useGraphStore.setState({ activeProject: 'gone' });
    expect(openFileInFileWindow(`${ROOT}/src/app.ts`)).toBe(false);
    useGraphStore.setState({ activeProject: PROJECT });
    expect(openFileInFileWindow('')).toBe(false);
    expect(store().ideOverlays[SLOT]).toBeUndefined();
    expect(useFileWindowsStore.getState().windows).toEqual([]);
  });
});

describe('파일 창 슬롯은 IDE 창이 아니다', () => {
  it('IDE 창 목록 · 맨 앞 창 판정에 들지 않는다', () => {
    openFileInFileWindow(`${ROOT}/src/app.ts`);
    expect(selectProjectIDEPanes(store())).toEqual([]);
    expect(resolvePaneKey(store(), null)).toBe(PROJECT);
  });

  it('에이전트 IDE 를 열어도 그 자리를 쓰지 않고, 둘이 나란히 산다', () => {
    openFileInFileWindow(`${ROOT}/src/app.ts`);
    store().openIDEOverlay(AGENT);
    expect(store().ideOverlays[PROJECT]).toMatchObject({ agentId: AGENT });
    expect(store().ideOverlays[SLOT]).toMatchObject({ agentId: null, activeEditorPath: 'src/app.ts' });
    // 키 없는 여는 손잡이(맨 앞 창)는 에이전트 IDE 로 간다 — 파일 창 탭이 남의 창으로 새지 않는다.
    store().openIDEEditorFile({ relPath: 'README.md', absPath: `${ROOT}/README.md`, name: 'README.md' });
    expect(store().ideOverlays[PROJECT]!.activeEditorPath).toBe('README.md');
    expect(store().ideOverlays[SLOT]!.editorFiles.map((f) => f.relPath)).toEqual(['src/app.ts']);
  });
});

describe('닫기 — 창과 판 자리를 함께 걷는다', () => {
  it('저장하지 않은 초안이 없으면 확인 없이 닫힌다', () => {
    openFileInFileWindow(`${ROOT}/src/app.ts`);
    closeFileWindow(SLOT);
    expect(store().ideOverlays[SLOT]).toBeUndefined();
    expect(useFileWindowsStore.getState().windows).toEqual([]);
  });

  it('그 창에서 연 줄 이동 요청·그림 팝업도 함께 내린다 · 두 번 걷어도 탈이 없다', () => {
    openFileInFileWindow(`${ROOT}/src/app.ts`, { start: 3, end: 4 });
    expect(store().ideEditorReveal).toMatchObject({ paneKey: SLOT, relPath: 'src/app.ts', start: 3, end: 4 });
    dropFileWindow(SLOT);
    dropFileWindow(SLOT);
    expect(store().ideEditorReveal).toBeNull();
    expect(store().ideOverlays[SLOT]).toBeUndefined();
  });
});

describe('editorFileQuery — 탭 열쇠를 서버가 받는 루트·경로로', () => {
  it('상대 경로는 그대로, 절대경로는 그 파일의 폴더 + 이름(세 OS 모양)', () => {
    expect(editorFileQuery(ROOT, 'src/app.ts')).toEqual({ root: ROOT, path: 'src/app.ts' });
    expect(editorFileQuery(ROOT, 'C:\\Temp\\Out\\a.md')).toEqual({ root: 'C:/Temp/Out', path: 'a.md' });
    expect(editorFileQuery('/home/u/proj', '/tmp/probe/a.md')).toEqual({ root: '/tmp/probe', path: 'a.md' }); // privacy-ok — 테스트 픽스처
    // 드라이브 루트 · POSIX 루트의 파일은 구분자를 남긴다(`C:` 는 그 드라이브의 현재 폴더라는 다른 뜻이다).
    expect(editorFileQuery(ROOT, 'C:/boot.ini')).toEqual({ root: 'C:/', path: 'boot.ini' });
    expect(editorFileQuery('/home/u/proj', '/notes.md')).toEqual({ root: '/', path: 'notes.md' }); // privacy-ok — 테스트 픽스처
  });
});
