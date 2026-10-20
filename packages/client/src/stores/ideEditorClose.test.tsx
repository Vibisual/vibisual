import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorDocs, type EditorDocsApi } from '../components/IDE/useEditorDocs.js';
import { answerAppDialog, getAppDialog } from '../utils/appDialog.js';
import { DEFAULT_IDE_OVERLAY, useGraphStore } from './graphStore.js';

const PANE = 'editor-close-project';
let view: ReactTestRenderer | undefined;
let api: EditorDocsApi;
const fetchMock = vi.fn<typeof fetch>();
function Editor(): null { api = useEditorDocs('/project', PANE); return null; }
function Host(): React.JSX.Element | null {
  const pane = useGraphStore((s) => s.ideOverlays[PANE]);
  return pane ? <Editor key={pane.agentId} /> : null;
}
const close = (): void => useGraphStore.getState().closeIDEOverlay(PANE);
async function answer(approved: boolean): Promise<void> {
  const dialog = getAppDialog();
  expect(dialog).not.toBeNull();
  await act(async () => { answerAppDialog(dialog!.id, approved); });
}
async function edit(): Promise<void> {
  await act(async () => { view = create(<Host />); });
  await act(async () => { api.ensureLoaded('note.txt'); });
  act(() => { api.setDraft('note.txt', 'unsaved work'); });
}

beforeEach(() => {
  useGraphStore.setState({
    activeProject: PANE, closedIDEEditorTabs: [],
    ideOverlays: { [PANE]: { ...DEFAULT_IDE_OVERLAY, paneKey: PANE, projectId: PANE, agentId: 'agent', editorFiles: [], editorTabsBySession: {} } },
  });
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({
    text: 'disk', mtimeMs: 1, size: 4, eol: 'lf', binary: false, truncated: false, image: false, readOnly: false,
  })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  const dialog = getAppDialog();
  if (dialog) await act(async () => { answerAppDialog(dialog.id, false); });
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.unstubAllGlobals();
});

describe('IDE 창 전체 닫기에서 미저장 본문 보호', () => {
  it('창 목록·Esc도 쓰는 공통 닫기를 취소하면 편집기가 살아 있고 초안이 남는다', async () => {
    await edit();
    act(close);
    expect(useGraphStore.getState().ideOverlays[PANE]).toBeDefined();
    await answer(false);
    expect(api.docs['note.txt']?.draft).toBe('unsaved work');
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it('현재 탭 목록에 없는 접힌 세션의 초안도 확인한 뒤에만 닫는다', async () => {
    await edit();
    expect(useGraphStore.getState().ideOverlays[PANE]?.editorFiles).toEqual([]);
    act(close);
    await answer(true);
    expect(useGraphStore.getState().ideOverlays[PANE]).toBeUndefined();
    expect(view?.toJSON()).toBeNull();
  });

  it('버블로 접기 표식은 확인을 취소하면 남지 않고 실제 닫기 전에만 실행된다', async () => {
    await edit();
    const beforeClose = vi.fn(() => { expect(useGraphStore.getState().ideOverlays[PANE]).toBeDefined(); });
    act(() => useGraphStore.getState().closeIDEOverlay(PANE, { beforeClose }));
    await answer(false);
    expect(beforeClose).not.toHaveBeenCalled();
    act(() => useGraphStore.getState().closeIDEOverlay(PANE, { beforeClose }));
    await answer(true);
    expect(beforeClose).toHaveBeenCalledOnce();
    expect(useGraphStore.getState().ideOverlays[PANE]).toBeUndefined();
  });

  it('확인 대기 중 새로 입력한 본문은 이전 확인으로 버리지 않는다', async () => {
    await edit();
    act(close);
    act(() => { api.setDraft('note.txt', 'newer work'); });
    await answer(true);
    expect(useGraphStore.getState().ideOverlays[PANE]).toBeDefined();
    expect(api.docs['note.txt']?.draft).toBe('newer work');
  });

  it('확인 창을 중복으로 띄우지 않고 바뀐 슬롯 주인을 닫지 않는다', async () => {
    await edit();
    act(close);
    const id = getAppDialog()!.id;
    act(close);
    expect(getAppDialog()!.id).toBe(id);
    act(() => useGraphStore.setState((s) => ({ ideOverlays: { ...s.ideOverlays, [PANE]: { ...s.ideOverlays[PANE]!, agentId: 'other' } } })));
    await answer(true);
    expect(useGraphStore.getState().ideOverlays[PANE]?.agentId).toBe('other');
    expect(getAppDialog()).toBeNull();
  });

  it('깨끗한 창과 이미 완료한 창 인계는 종전처럼 즉시 닫힌다', async () => {
    act(close);
    expect(useGraphStore.getState().ideOverlays[PANE]).toBeUndefined();
    expect(getAppDialog()).toBeNull();
    useGraphStore.setState({ ideOverlays: { [PANE]: { ...DEFAULT_IDE_OVERLAY, paneKey: PANE, projectId: PANE, agentId: 'agent' } } });
    await edit();
    act(() => useGraphStore.getState().closeIDEOverlay(PANE, { rememberEditorTabs: false }));
    expect(useGraphStore.getState().ideOverlays[PANE]).toBeUndefined();
    expect(getAppDialog()).toBeNull();
  });

  it('닫을 창이 없는 북마크 목적지에서도 이동 콜백은 실행하고 다른 창은 닫지 않는다', () => {
    const beforeClose = vi.fn();
    useGraphStore.getState().closeIDEOverlay('other-project', { beforeClose });
    expect(beforeClose).toHaveBeenCalledOnce();
    expect(useGraphStore.getState().ideOverlays[PANE]).toBeDefined();
    expect(getAppDialog()).toBeNull();
  });
});
