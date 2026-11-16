import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardPathText } from './CardPathText.js';
import { clearExternalPathCache, clearWorkspacePathCache } from './useWorkspacePathKind.js';

/** §5.5 #17-27 ⑬ (l) — 카드 글자의 경로가 디스크 판정을 거쳐 손잡이가 되고, 왼쪽 클릭·우클릭이 레일로 간다. */

const ROOT = 'C:/repo';

const mocks = vi.hoisted(() => ({
  openAppWindow: vi.fn(() => true),
  openIDEEditorFile: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { path?: string; app?: string }) => (opts?.path ? `${key}|${opts.path}` : opts?.app ? `${key}|${opts.app}` : key) }),
}));
vi.mock('./useIDEProjectRoot.js', () => ({ useIDEProjectRoot: () => ROOT }));
vi.mock('./idePane.js', () => ({ useIDEPaneKey: () => 'pane' }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: { getState: () => ({ openIDEEditorFile: mocks.openIDEEditorFile }) },
}));
vi.mock('../../stores/mediaConvert.js', () => ({
  fetchCachedConversion: vi.fn(async () => null),
  useMediaConvert: { getState: () => ({ open: vi.fn() }) },
}));
vi.mock('../../apps/appWindows.js', () => ({ openAppWindow: mocks.openAppWindow }));
vi.mock('../../apps/registry.js', () => ({
  getInternalApp: () => ({ name: 'Vibisound', icon: () => null }),
  workspaceOpenClaims: () => [{ appId: 'vibisound', opens: ['.wav'] }],
}));
vi.mock('./runExecutableFile.js', () => ({ runExecutableFile: vi.fn(async () => {}) }));
vi.mock('./IDEContextMenu.js', () => ({
  IDEContextMenu: (props: { items: { id?: string; label: string; onClick: () => void }[] }) => (
    <ul data-testid="menu">{props.items.map((i) => <li key={i.id} data-id={i.id} onClick={i.onClick}>{i.label}</li>)}</ul>
  ),
}));

/** 디스크 답을 정한다 — 루트 안 경로는 `disk`, 루트 밖은 `outside` 표에서 찾고 나머지는 404. */
function stubDisk(disk: Record<string, { kind: 'file' | 'directory'; executable?: boolean }>, outside: Record<string, 'file' | 'directory'> = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    const q = new URL(url, 'http://x').searchParams;
    if (url.startsWith('/api/workspace-path')) {
      const rel = q.get('path') ?? '';
      const hit = disk[rel];
      return hit
        ? { ok: true, status: 200, json: async () => ({ root: ROOT, path: rel, absPath: `${ROOT}/${rel}`, kind: hit.kind, executable: hit.executable === true }) }
        : { ok: false, status: 404, json: async () => ({}) };
    }
    const abs = q.get('path') ?? '';
    const kind = outside[abs];
    return kind
      ? { ok: true, status: 200, json: async () => ({ absPath: abs, kind }) }
      : { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let view: ReactTestRenderer;

async function draw(text: string): Promise<void> {
  await act(async () => {
    view = create(<CardPathText text={text} />);
  });
  // 후보마다 한 번씩 답을 기다려 다시 그린다.
  await act(async () => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  });
}

const handles = (): ReactTestInstance[] => view.root.findAll((n) => n.type === 'button');
/** 그려진 글자 전부(버튼 안 포함) — 원문이 그대로 보이는지 본다. */
function shownText(node: ReactTestInstance | string = view.root): string {
  if (typeof node === 'string') return node;
  return node.children.map(shownText).join('');
}
const posted = (fetchMock: ReturnType<typeof vi.fn>, url: string): unknown[] =>
  fetchMock.mock.calls
    .filter(([u, init]) => u === url && (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as unknown);

const click = (btn: ReactTestInstance): void => {
  act(() => { btn.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }); });
};
const rightClick = (btn: ReactTestInstance): void => {
  act(() => {
    btn.props.onContextMenu({
      preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 20,
      currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) },
    });
  });
};
const menuIds = (): string[] => view.root.findAll((n) => n.type === 'li').map((n) => String(n.props['data-id']));
const pick = (id: string): void => {
  act(() => { view.root.find((n) => n.type === 'li' && n.props['data-id'] === id).props.onClick(); });
};

beforeEach(() => {
  vi.clearAllMocks();
  clearWorkspacePathCache();
  clearExternalPathCache();
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => {
  act(() => { view?.unmount(); });
  vi.unstubAllGlobals();
});

describe('CardPathText — 폴더', () => {
  it('글 속 폴더 경로가 손잡이가 되고 누르면 그 폴더를 연다, 나머지 글자는 그대로다', async () => {
    const text = '폴더 C:/repo/out-clones/listen/ 의 8개를 들어 보세요.';
    const fetchMock = stubDisk({ 'out-clones/listen': { kind: 'directory' } });
    await draw(text);

    const [btn] = handles();
    expect(handles()).toHaveLength(1);
    expect(btn?.props.title).toBe(`ide.streamRenderer.pathLink.openFolder|${ROOT}/out-clones/listen`);
    expect(shownText()).toBe(text);

    click(btn!);
    expect(posted(fetchMock, '/api/open-node-folder')).toEqual([
      { nodePath: 'out-clones/listen', absolutePath: `${ROOT}/out-clones/listen` },
    ]);
  });

  it('폴더 우클릭 — 폴더 열기와 복사', async () => {
    stubDisk({ 'out/listen': { kind: 'directory' } });
    await draw('out/listen 확인');
    rightClick(handles()[0]!);
    expect(menuIds()).toEqual(['reveal', 'copyPath', 'copyRelativePath']);
  });

  it('디스크에 없으면 버튼 없이 원래 글자 그대로다', async () => {
    const text = '폴더 out/없는곳/ 입니다';
    stubDisk({});
    await draw(text);
    expect(handles()).toHaveLength(0);
    expect(shownText()).toBe(text);
  });
});

describe('CardPathText — 파일', () => {
  it('앱이 받는 파일은 누르면 그 앱에서 열리고, 우클릭으로 안/밖/위치를 고른다', async () => {
    const fetchMock = stubDisk({ 'out/a.wav': { kind: 'file' } });
    await draw('결과 out/a.wav 입니다');
    const btn = handles()[0]!;

    click(btn);
    expect(mocks.openAppWindow).toHaveBeenCalledWith({ appId: 'vibisound', projectId: ROOT, file: 'out/a.wav' });

    rightClick(btn);
    expect(menuIds()).toEqual(['open', 'openDefaultApp', 'reveal', 'copyPath', 'copyRelativePath']);

    pick('openDefaultApp');
    expect(posted(fetchMock, '/api/open-external')).toEqual([{ absolutePath: `${ROOT}/out/a.wav` }]);
  });

  it('우클릭의 파일 위치 열기는 그 파일을 넘긴다', async () => {
    const fetchMock = stubDisk({ 'out/a.wav': { kind: 'file' } });
    await draw('out/a.wav');
    rightClick(handles()[0]!);
    pick('reveal');
    expect(posted(fetchMock, '/api/open-node-folder')).toEqual([{ nodePath: 'out/a.wav', absolutePath: `${ROOT}/out/a.wav` }]);
  });

  it('코드 파일은 편집창에서 열리고, 바깥 열기는 앱 밖 편집기다(연결 프로그램 ❌)', async () => {
    const fetchMock = stubDisk({ 'src/run.js': { kind: 'file' } });
    await draw('src/run.js 수정');
    const btn = handles()[0]!;

    click(btn);
    expect(mocks.openIDEEditorFile).toHaveBeenCalledTimes(1);

    rightClick(btn);
    expect(menuIds()).toEqual(['open', 'openExternalEditor', 'reveal', 'copyPath', 'copyRelativePath']);

    pick('openExternalEditor');
    expect(posted(fetchMock, '/api/open-node-file')).toEqual([{ nodePath: 'src/run.js', absolutePath: `${ROOT}/src/run.js` }]);
    expect(posted(fetchMock, '/api/open-external')).toEqual([]);
  });

  it('실행 파일 — 메뉴에 바깥 열기 줄이 없다', async () => {
    stubDisk({ 'bin/app.exe': { kind: 'file', executable: true } });
    await draw('bin/app.exe 실행');
    rightClick(handles()[0]!);
    expect(menuIds()).toEqual(['open', 'reveal', 'copyPath', 'copyRelativePath']);
  });
});

describe('CardPathText — 붙은 조사', () => {
  it('통째로 없으면 조사를 떼서 열고, 조사는 평문으로 남는다', async () => {
    const text = 'out/listen/의 파일';
    stubDisk({ 'out/listen': { kind: 'directory' } });
    await draw(text);
    expect(handles()).toHaveLength(1);
    expect(handles()[0]?.props.title).toBe(`ide.streamRenderer.pathLink.openFolder|${ROOT}/out/listen`);
    expect(shownText()).toBe(text);
  });

  it('조사처럼 끝나는 실제 이름이 있으면 그것이 이긴다', async () => {
    stubDisk({ 'out/노래의': { kind: 'directory' }, 'out/노래': { kind: 'directory' } });
    await draw('out/노래의 확인');
    expect(handles()).toHaveLength(1);
    expect(handles()[0]?.props.title).toBe(`ide.streamRenderer.pathLink.openFolder|${ROOT}/out/노래의`);
  });
});

describe('CardPathText — 루트 밖(⑬ (d))', () => {
  it('누르면 탐색기로만 가고, 우클릭은 위치와 복사뿐이다', async () => {
    const fetchMock = stubDisk({}, { 'D:/other/a.wav': 'file' });
    await draw('D:/other/a.wav 확인');
    const btn = handles()[0]!;

    click(btn);
    expect(posted(fetchMock, '/api/reveal-path')).toEqual([{ absPath: 'D:/other/a.wav' }]);
    expect(mocks.openAppWindow).not.toHaveBeenCalled();

    rightClick(btn);
    expect(menuIds()).toEqual(['reveal', 'copyPath']);
  });
});
