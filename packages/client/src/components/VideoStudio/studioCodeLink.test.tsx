import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, hitTest, resolveTimeline, sourceTargetsAtLine, type PickedSource, type SourceLine, type VideoDoc } from '@vibisual/video';
import type { StageLocated, StagePick } from '@vibisual/video/render';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key) }),
}));
const opened = vi.hoisted(() => vi.fn());
vi.mock('../IDE/useWorkspaceExplorer.js', () => ({ openWorkspaceFile: opened }));

import { createSourceCache, normalizeNewlines, type SourceCache } from './codeLinkSource.js';
import { StudioCodeView, type StudioCodeViewProps } from './StudioCodeView.js';
import { CODE_ROW_PX, scrollTopFor, visibleRows } from './StudioCodeLines.js';
import { buildStudioAgentContext, describePointed, type StudioPointed } from './studioAgentMessage.js';
import { usePreviewInteraction, type PreviewInteraction } from './usePreviewInteraction.js';
import { useStudioCodeLink, type StudioCodeLink } from './useStudioCodeLink.js';
import type { CompositionSourceEnvelope } from './videoApi.js';

/**
 * §5.13 (V) 37-20 — 화면 요소 ↔ 코드 줄. 줄은 찾았을 때만 말하고(지어내지 않는다), 코드 칸은 읽기만 한다.
 */
const COMP = '.vibisual/video/compositions/intro/index.html';
const HTML = [
  '<body>',                           // 1
  '<div id="stage">',                 // 2
  '  <h1 class="title">Hello</h1>',   // 3
  '  <div class="bars"></div>',       // 4
  '</div>',                           // 5
  '<script>var a = 1;</script>',      // 6
  '</body>',                          // 7
].join('\n');

function fixture(contentHash = 'h1'): VideoDoc {
  return {
    ...createEmptyDoc('vid', 'Demo'),
    size: { width: 1920, height: 1080 },
    assets: { comp: { id: 'comp', kind: 'composition', source: { kind: 'file', path: COMP }, contentHash, duration: 4, width: 1920, height: 1080 } },
    tracks: [{ id: 'visual', kind: 'visual', items: [{ id: 'c1', kind: 'composition', assetId: 'comp', at: 0, duration: 4 }] }],
  };
}

const TITLE: PickedSource = { self: { tag: 'h1', n: 0, of: 1, id: '', cls: 'title', attrs: '', same: 1 }, up: [{ tag: 'div', n: 0, of: 5, id: 'stage', cls: '', attrs: '', same: 1 }] };
const MADE: PickedSource = { self: { tag: 'div', n: 3, of: 5, id: '', cls: 'bar', attrs: '', same: 3 }, up: [{ tag: 'div', n: 1, of: 5, id: '', cls: 'bars', attrs: '', same: 1 }] };

function envelope(text: string, path = COMP): CompositionSourceEnvelope {
  return { path, text, bytes: text.length, truncated: false, contentHash: 'h1', files: [COMP, COMP.replace('index.html', 'app.js')] };
}

let renderer: ReactTestRenderer | null = null;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = null; opened.mockClear(); });

describe('문맥 블록 — 가리킨 것의 파일·줄', () => {
  const base: StudioPointed = { itemId: 'c1', t: 1.2, kind: 'composition', file: COMP, path: 'div#stage > h1.title', text: 'Hello' };

  it('줄을 찾았으면 <프로젝트 기준 경로>:<줄> 로 싣는다', () => {
    expect(describePointed({ ...base, line: 3, lineExact: true })).toBe(`item "c1" (composition) at 1.20s, file ${COMP}:3, element "div#stage > h1.title", text "Hello"`);
    const block = buildStudioAgentContext({ projectName: 'demo', doc: { id: 'vid', title: 'Demo', version: 1 }, playhead: 0, duration: 4, passId: 'p', mode: 'revise', pointed: [{ ...base, line: 3 }] });
    expect(block).toContain(`- Pointed at: item "c1" (composition) at 1.20s, file ${COMP}:3, element`);
  });

  it('런타임에 만든 요소는 조상 줄이라고 말한다(그 줄이 요소 자신이라고 읽히지 않게)', () => {
    expect(describePointed({ ...base, line: 4, lineExact: false })).toContain(`file ${COMP} (no source line of its own — created at runtime inside the element at line 4), element`);
  });

  it('줄을 모르면 지어내지 않는다 — 종전처럼 파일만', () => {
    expect(describePointed(base)).toContain(`file ${COMP}, element`);
    for (const line of [0, -2, 1.5, Number.NaN]) expect(describePointed({ ...base, line })).toContain(`file ${COMP}, element`);
    // 파일이 없는 것(기본 씬·문서 아이템)에는 줄도 없다.
    expect(describePointed({ itemId: 't1', t: 0, kind: 'text', line: 9 })).toBe('item "t1" (text) at 0.00s');
  });

  it('경로는 세 OS 에서 같은 모양이다(역슬래시 ❌)', () => {
    expect(describePointed({ ...base, file: 'comps\\intro\\index.html', line: 3 })).toContain('file comps/intro/index.html:3,');
  });
});

describe('가리키기 — 집은 요소의 원본 줄', () => {
  const doc = fixture();
  const timeline = resolveTimeline(doc);
  const hit = hitTest(doc, timeline, 1, 960, 540)!;
  const pick = (source?: PickedSource): StagePick => ({
    op: hit.op, rect: { x: 100, y: 80, width: 400, height: 90 },
    element: { path: 'div#stage > h1.title', tag: 'h1', text: 'Hello', prop: null, rect: { x: 100, y: 80, width: 400, height: 90 }, ...(source ? { source } : {}) },
  });
  const pointed: StudioPointed[] = [];
  const notes: never[] = [];
  let result: PreviewInteraction;

  function mount(over: { pickAt: (x: number, y: number, o?: { readonly source?: boolean }) => Promise<StagePick | null>; sourceLine?: (h: unknown, p: StagePick, reveal: boolean, wait: boolean) => Promise<SourceLine | null>; addPointed: (p: StudioPointed) => void; interaction?: 'point' | 'none' }): void {
    function Probe(): null {
      result = usePreviewInteraction({
        projectName: 'demo', doc, timeline, playhead: 1, mode: 'stage', interaction: over.interaction ?? 'point', selectedItemId: null, setSelectedItemId: () => undefined,
        pickAt: over.pickAt, ...(over.sourceLine ? { sourceLine: over.sourceLine } : {}), addPointed: over.addPointed, pointed, notes, addNote: async () => null,
        onSetProp: () => undefined, onNoteAdded: () => undefined, extraRings: [{ id: 'code-0', rect: { x: 1, y: 2, width: 3, height: 4 }, tone: 'pointed' }],
      });
      return null;
    }
    act(() => { renderer = create(createElement(Probe)); });
  }

  it('픽스처가 컴포지션을 집는다', () => { expect(hit.op.kind).toBe('composition'); });

  it('누르면 자리 정보를 청하고(지나갈 때는 청하지 않는다) 찾은 줄을 칩에 싣는다', async () => {
    const pickAt = vi.fn(async (_x: number, _y: number, o?: { readonly source?: boolean }) => pick(o?.source ? TITLE : undefined));
    const sourceLine = vi.fn(async (): Promise<SourceLine | null> => ({ line: 3, col: 3, endLine: 3, exact: true, tag: 'h1' }));
    const addPointed = vi.fn();
    mount({ pickAt, sourceLine, addPointed });
    await act(async () => { result.onHover(960, 540); await new Promise((r) => setTimeout(r, 120)); });
    expect(pickAt).toHaveBeenLastCalledWith(960, 540);
    expect(sourceLine).not.toHaveBeenCalled();
    await act(async () => { result.onPress(960, 540); });
    expect(pickAt).toHaveBeenLastCalledWith(960, 540, { source: true });
    expect(sourceLine).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ element: expect.objectContaining({ source: TITLE }) }), true, true);
    expect(addPointed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: 'c1', file: COMP, line: 3, lineExact: true, path: 'div#stage > h1.title' }));
  });

  it('줄을 못 찾으면 줄 없이 붙는다 — 자리 정보가 없으면(캔버스 객체) 묻지도 않는다', async () => {
    const addPointed = vi.fn();
    const sourceLine = vi.fn(async (): Promise<SourceLine | null> => null);
    mount({ pickAt: async () => pick(MADE), sourceLine, addPointed });
    await act(async () => { result.onPress(960, 540); });
    expect(addPointed.mock.calls[0]![0]).not.toHaveProperty('line');
    act(() => renderer!.unmount());
    const quiet = vi.fn(async (): Promise<SourceLine | null> => ({ line: 9, col: 1, endLine: 9, exact: true, tag: 'p' }));
    mount({ pickAt: async () => pick(), sourceLine: quiet, addPointed });
    await act(async () => { result.onPress(960, 540); });
    expect(quiet).not.toHaveBeenCalled();
    expect(addPointed.mock.calls[1]![0]).not.toHaveProperty('line');
  });

  it('줄 찾기가 던져도 가리키기는 된다', async () => {
    const addPointed = vi.fn();
    mount({ pickAt: async () => pick(TITLE), sourceLine: async () => { throw new Error('offline'); }, addPointed });
    await act(async () => { result.onPress(960, 540); });
    expect(addPointed).toHaveBeenCalledOnce();
  });

  it('Alt 인스펙터 복사는 원본을 기다리지 않는다 — 읽어 둔 것이 없으면 줄 없이 곧바로, 뒤에서 읽어 둔 다음부터는 줄이 실린다', async () => {
    let finish: (env: CompositionSourceEnvelope) => void = () => undefined;
    const read = vi.fn(() => new Promise<CompositionSourceEnvelope>((resolve) => { finish = resolve; }));
    const cache = createSourceCache(read);
    let link: StudioCodeLink;
    function Probe(): null {
      // 코드 칸은 닫혀 있다 — 원본을 읽는 것은 인스펙터의 데우기뿐이다.
      link = useStudioCodeLink({
        projectName: 'demo', projectRoot: '/work/demo', doc, open: false, selectedItemId: null, playhead: 1, playing: false, ready: true,
        locateSource: async () => null, onReveal: () => undefined, cache,
      });
      result = usePreviewInteraction({
        projectName: 'demo', doc, timeline, playhead: 1, mode: 'stage', interaction: 'none', selectedItemId: null, setSelectedItemId: () => undefined,
        pickAt: async () => pick(TITLE), sourceLine: (h, p, reveal, wait) => link.resolvePick(h.op.resolved.item.assetId, p.element?.source, reveal, wait),
        addPointed: () => undefined, pointed, notes, addNote: async () => null, onSetProp: () => undefined, onNoteAdded: () => undefined,
      });
      return null;
    }
    act(() => { renderer = create(createElement(Probe)); });
    // 원본 읽기는 끝나지 않은 채다 — 기다렸다면 줄 찾기 상한(1.5초)까지 답이 없다.
    const soon = <T,>(answer: T | Promise<T>): Promise<T | 'late'> => Promise.race([Promise.resolve(answer), new Promise<'late'>((r) => setTimeout(() => r('late'), 200))]);
    const first = await soon(result.inspect(960, 540));
    if (first === 'late') throw new Error('inspector waited for the source');
    expect(read).toHaveBeenCalledOnce();
    expect(first[0]!.clipboard).toContain(`file ${COMP}, element`);
    expect(first[0]!.clipboard).not.toContain(`${COMP}:3`);
    // 읽는 중에 또 집어도 기다리지 않고, 같은 원본을 두 번 읽지 않는다.
    const again = await soon(result.inspect(960, 540));
    expect(again === 'late' ? 'late' : again[0]!.clipboard).not.toMatch(/late|:3,/);
    expect(read).toHaveBeenCalledOnce();
    await act(async () => { finish(envelope(HTML)); await new Promise((r) => setTimeout(r, 0)); });
    expect((await result.inspect(960, 540))[0]!.clipboard).toContain(`${COMP}:3`);
    expect(read).toHaveBeenCalledOnce();
  });

  it('코드에서 고른 줄의 테는 가리키기와 같은 실버 테로 겹표시에 선다', () => {
    mount({ pickAt: async () => null, addPointed: () => undefined, interaction: 'none' });
    expect(result.rings).toContainEqual({ id: 'code-0', rect: { x: 1, y: 2, width: 3, height: 4 }, tone: 'pointed' });
  });
});

describe('원본 읽기 — 지문이 바뀔 때만 다시 읽는다', () => {
  it('같은 지문이면 한 번만 읽고, 줄 끝을 맞추고, HTML 에만 색인을 짓는다', async () => {
    const read = vi.fn(async (_p: string, _d: string, _a: string, file?: string) => envelope(file ? 'var a = 1;\r\nvar b = 2;' : HTML.replace(/\n/g, '\r\n'), file ?? COMP));
    const cache = createSourceCache(read);
    const a = await cache.load('demo', 'vid', 'comp', null, 'h1');
    expect(await cache.load('demo', 'vid', 'comp', null, 'h1')).toBe(a);
    expect(read).toHaveBeenCalledOnce();
    expect(a.text).toBe(HTML);
    expect(a.lineCount).toBe(7);
    expect(a.index?.byTag.get('h1')?.[0]?.line).toBe(3);
    const js = await cache.load('demo', 'vid', 'comp', COMP.replace('index.html', 'app.js'), 'h1');
    expect(js).toMatchObject({ index: null, lineCount: 2 });
    await cache.load('demo', 'vid', 'comp', null, 'h2');
    expect(read).toHaveBeenCalledTimes(3);
    expect(normalizeNewlines('a\rb\r\nc')).toBe('a\nb\nc');
  });

  it('실패는 기억하지 않는다', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(envelope(HTML));
    const cache = createSourceCache(read);
    await expect(cache.load('demo', 'vid', 'comp', null, 'h1')).rejects.toThrow('offline');
    await expect(cache.load('demo', 'vid', 'comp', null, 'h1')).resolves.toMatchObject({ path: COMP });
  });
});

describe('useStudioCodeLink — 고른 줄과 화면 자리', () => {
  let link: StudioCodeLink;
  interface Over { doc?: VideoDoc; open?: boolean; playing?: boolean; playhead?: number; text?: string }
  const located: StageLocated[] = [{ itemId: 'c1', total: 1, rects: [{ x: 10, y: 20, width: 300, height: 60 }] }];

  function setup(first: Over = {}) {
    const state = { text: first.text ?? HTML };
    const cache: SourceCache = createSourceCache(async (_p, _d, _a, file) => envelope(state.text, file ?? COMP));
    const locateSource = vi.fn(async (): Promise<StageLocated[] | null> => located);
    const onReveal = vi.fn();
    const base = fixture();
    // 같은 부품을 다시 그려야 상태(고른 줄)가 남는다.
    function Probe(over: Over): null {
      link = useStudioCodeLink({
        projectName: 'demo', projectRoot: 'C:\\work\\demo', doc: over.doc ?? base, open: over.open ?? true, selectedItemId: null,
        playhead: over.playhead ?? 1, playing: over.playing ?? false, ready: true, locateSource, onReveal, cache,
      });
      return null;
    }
    const render = (over: Over): ReturnType<typeof createElement> => createElement(Probe, over);
    return { state, cache, locateSource, onReveal, render };
  }
  const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

  it('집은 요소의 줄을 찾아 코드 칸을 그 줄로 보내고(다른 서랍은 밀어내지 않는다), 못 찾으면 null', async () => {
    const s = setup();
    const doc = fixture();
    act(() => { renderer = create(s.render({ doc })); });
    await settle();
    let line: SourceLine | null = null;
    await act(async () => { line = await link.resolvePick('comp', TITLE, true); });
    expect(line).toMatchObject({ line: 3, exact: true });
    expect(link.focus).toMatchObject({ assetId: 'comp', origin: 'pick', line: 3, exact: true });
    expect(s.onReveal).toHaveBeenCalledExactlyOnceWith(false);
    // 런타임에 만든 요소 — 품은 요소의 줄.
    await act(async () => { line = await link.resolvePick('comp', MADE, false); });
    expect(line).toMatchObject({ line: 4, exact: false });
    expect(link.focus?.line).toBe(3);
    // 자리 정보가 없거나 컴포지션 소재가 아니면 줄이 없다.
    expect(await link.resolvePick('comp', undefined, true)).toBeNull();
    expect(await link.resolvePick('nope', TITLE, true)).toBeNull();
    expect(await link.resolvePick('comp', { self: { tag: 'canvas', n: 0, of: 1, id: '', cls: '', attrs: '', same: 1 }, up: [] }, true)).toBeNull();
  });

  it('줄을 누르면 그 줄의 요소를 무대에 물어 실버 테를 세운다', async () => {
    const s = setup();
    act(() => { renderer = create(s.render({})); });
    await settle();
    expect(link.status).toBe('ready');
    act(() => link.selectLine(3));
    await settle();
    expect(s.locateSource).toHaveBeenLastCalledWith('comp', [{ tag: 'h1', n: 0, of: 1, id: '', cls: 'title', attrs: '', alt: [], sig: true }]);
    expect(link.locate).toEqual({ state: 'shown', count: 1 });
    expect(link.rings).toEqual([{ id: 'code-0', rect: { x: 10, y: 20, width: 300, height: 60 }, tone: 'pointed' }]);
    expect(link.focus).toMatchObject({ origin: 'code', line: 3, endLine: 3 });
  });

  it('지금 화면에 없으면 테 없이 그렇다고 하고, 화면 요소가 아닌 줄은 묻지 않는다', async () => {
    const s = setup();
    act(() => { renderer = create(s.render({})); });
    await settle();
    s.locateSource.mockResolvedValue([{ itemId: 'c1', total: 1, rects: [] }]);
    act(() => link.selectLine(4));
    await settle();
    expect(link.locate.state).toBe('hidden');
    expect(link.rings).toEqual([]);
    s.locateSource.mockResolvedValue([]);
    act(() => link.selectLine(2));
    await settle();
    expect(link.locate.state).toBe('hidden');
    const asked = s.locateSource.mock.calls.length;
    act(() => link.selectLine(6));
    await settle();
    expect(link.locate.state).toBe('notElement');
    expect(s.locateSource.mock.calls.length).toBe(asked);
  });

  it('재생 중에는 묻지 않고 테를 걷는다 · 재생 머리를 옮기면 다시 묻는다 · 코드 칸을 닫으면 테도 걷힌다', async () => {
    const s = setup();
    act(() => { renderer = create(s.render({})); });
    await settle();
    act(() => link.selectLine(3));
    await settle();
    expect(s.locateSource).toHaveBeenCalledTimes(1);
    act(() => renderer!.update(s.render({ playing: true })));
    await settle();
    expect(link.rings).toEqual([]);
    expect(s.locateSource).toHaveBeenCalledTimes(1);
    act(() => renderer!.update(s.render({ playhead: 2 })));
    await settle();
    expect(s.locateSource).toHaveBeenCalledTimes(2);
    expect(link.rings).toHaveLength(1);
    act(() => renderer!.update(s.render({ playhead: 2, open: false })));
    await settle();
    expect(link.rings).toEqual([]);
    expect(link.locate.state).toBe('idle');
  });

  it('바깥에서 파일을 고치면(지문이 바뀌면) 다시 읽고, 집어서 고른 줄은 그 요소를 따라간다', async () => {
    const s = setup();
    act(() => { renderer = create(s.render({ doc: fixture('h1') })); });
    await settle();
    await act(async () => { await link.resolvePick('comp', TITLE, true); });
    expect(link.focus?.line).toBe(3);
    s.state.text = HTML.replace('<div id="stage">', '<!-- note -->\n\n<div id="stage">');
    act(() => renderer!.update(s.render({ doc: fixture('h2') })));
    await settle();
    expect(link.source?.lineCount).toBe(9);
    expect(link.focus?.line).toBe(5);
  });

  it('[에디터로 열기]는 기존 열기 길로 고른 줄을 넘긴다', async () => {
    const s = setup();
    act(() => { renderer = create(s.render({})); });
    await settle();
    act(() => link.openInEditor());
    expect(opened).toHaveBeenLastCalledWith('C:\\work\\demo', COMP, undefined);
    act(() => link.selectLine(4));
    await settle();
    act(() => link.openInEditor());
    expect(opened).toHaveBeenLastCalledWith('C:\\work\\demo', COMP, 4);
  });

  it('칩을 누르면 그 파일의 그 줄로 코드 칸을 연다(다른 서랍이 열려 있어도)', async () => {
    const s = setup();
    act(() => { renderer = create(s.render({ open: false })); });
    act(() => link.revealLine(COMP, 3, true));
    expect(s.onReveal).toHaveBeenCalledExactlyOnceWith(true);
    act(() => renderer!.update(s.render({ open: true })));
    await settle();
    expect(link.focus).toMatchObject({ line: 3, origin: 'pick' });
    act(() => link.revealLine('other/index.html', 3, true));
    expect(s.onReveal).toHaveBeenCalledOnce();
  });
});

describe('코드 칸 — 읽기만 한다', () => {
  const props = (over: Partial<StudioCodeViewProps> = {}): StudioCodeViewProps => ({
    assets: [{ id: 'comp', path: COMP }], assetId: 'comp', path: COMP, status: 'ready', text: HTML, files: [COMP, COMP.replace('index.html', 'app.js')],
    lineCount: 7, truncated: false, linked: true, focus: null, locate: { state: 'idle', count: 0 },
    onSelectAsset: vi.fn(), onSelectFile: vi.fn(), onSelectLine: vi.fn(), onOpenEditor: vi.fn(), onClose: vi.fn(), ...over,
  });
  const text = (node: unknown): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' && 'children' in node ? text((node as { children: unknown }).children) : '');

  it('입력 칸이 없다 — textarea·input·contenteditable 없이 줄만 그리고, 붙여넣기·입력 손잡이도 없다', () => {
    act(() => { renderer = create(createElement(StudioCodeView, props())); });
    const root = renderer!.root;
    expect(root.findAllByType('textarea')).toHaveLength(0);
    expect(root.findAllByType('input')).toHaveLength(0);
    expect(root.findAll((n) => n.props['contentEditable'] !== undefined || n.props['onPaste'] !== undefined || n.props['onInput'] !== undefined || n.props['onBeforeInput'] !== undefined)).toHaveLength(0);
    const rows = root.findAll((n) => n.props['role'] === 'option');
    expect(rows).toHaveLength(7);
    expect(text(rows[2]!.children)).toBe('3  <h1 class="title">Hello</h1>');
  });

  it('줄을 누르면 그 줄을 고르고, 고른 줄과 요소 범위를 표시한다', () => {
    const onSelectLine = vi.fn();
    act(() => { renderer = create(createElement(StudioCodeView, props({ onSelectLine, focus: { line: 2, endLine: 5, exact: true, origin: 'code', seq: 1 }, locate: { state: 'shown', count: 2 } }))); });
    const rows = renderer!.root.findAll((n) => n.props['role'] === 'option');
    act(() => rows[3]!.props.onClick());
    expect(onSelectLine).toHaveBeenCalledExactlyOnceWith(4);
    expect(rows.map((r) => r.props['aria-selected'])).toEqual([false, true, false, false, false, false, false]);
    expect(String(rows[2]!.props.className)).toContain('bg-white/[0.05]');
    expect(String(rows[5]!.props.className)).not.toContain('bg-white/[0.05]');
    expect(text(renderer!.root.findByType('p').children)).toContain('panel.videoStudio.code.shown {"count":2}');
  });

  it('↑/↓ 는 이 칸 안에서 고른 줄을 옮긴다 — 조합 입력·보조 키와는 겹치지 않는다', () => {
    const onSelectLine = vi.fn();
    act(() => { renderer = create(createElement(StudioCodeView, props({ onSelectLine, focus: { line: 3, endLine: 3, exact: true, origin: 'code', seq: 1 } }))); });
    const list = renderer!.root.find((n) => n.props['role'] === 'listbox');
    const key = (over: Record<string, unknown>) => ({ key: 'ArrowDown', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });
    act(() => list.props.onKeyDown(key({})));
    act(() => list.props.onKeyDown(key({ key: 'ArrowUp' })));
    expect(onSelectLine.mock.calls).toEqual([[4], [2]]);
    for (const over of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { nativeEvent: { isComposing: true } }, { key: 'ArrowLeft' }, { key: '1' }]) act(() => list.props.onKeyDown(key(over)));
    expect(onSelectLine).toHaveBeenCalledTimes(2);
  });

  it('줄 연결이 없는 파일(CSS·JS)은 읽을 수만 있다 — 줄을 고를 수 없다', () => {
    const onSelectLine = vi.fn();
    act(() => { renderer = create(createElement(StudioCodeView, props({ onSelectLine, linked: false, path: COMP.replace('index.html', 'app.js'), text: 'var a = 1;' }))); });
    const row = renderer!.root.find((n) => n.props['role'] === 'option');
    expect(row.props.onClick).toBeUndefined();
    expect(text(renderer!.root.findByType('p').children)).toContain('panel.videoStudio.code.noLink');
  });

  it('[에디터로 열기]는 손잡이 하나이고, 파일을 고르면 그 파일을 청한다', () => {
    const p = props({ focus: { line: 3, endLine: 3, exact: false, origin: 'pick', seq: 1 } });
    act(() => { renderer = create(createElement(StudioCodeView, p)); });
    const open = renderer!.root.findAllByType('button').find((b) => String(b.props['aria-label']).startsWith('panel.videoStudio.code.openEditorAt'))!;
    expect(open.props['aria-label']).toBe('panel.videoStudio.code.openEditorAt {"line":3}');
    act(() => open.props.onClick());
    expect(p.onOpenEditor).toHaveBeenCalledOnce();
    expect(text(renderer!.root.findByType('p').children)).toContain('panel.videoStudio.code.pickedInside');
    const select = renderer!.root.findByType('select');
    act(() => select.props.onChange({ target: { value: `f:${COMP.replace('index.html', 'app.js')}` } }));
    expect(p.onSelectFile).toHaveBeenCalledExactlyOnceWith(COMP.replace('index.html', 'app.js'));
  });
});

describe('보이는 줄만 그린다', () => {
  it('굴린 자리의 줄과 앞뒤 여유만 낸다', () => {
    expect(visibleRows(0, 0, CODE_ROW_PX, 5000)).toEqual({ first: 0, last: 60 });
    expect(visibleRows(20000, 400, CODE_ROW_PX, 5000)).toEqual({ first: 988, last: 1032 });
    expect(visibleRows(0, 400, CODE_ROW_PX, 3)).toEqual({ first: 0, last: 3 });
    expect(visibleRows(0, 400, CODE_ROW_PX, 0)).toEqual({ first: 0, last: 0 });
  });

  it('고른 줄이 이미 보이면 굴리지 않고, 안 보이면 위에서 3분의 1 자리에 둔다', () => {
    expect(scrollTopFor(5, 0, 400, CODE_ROW_PX)).toBeNull();
    expect(scrollTopFor(500, 0, 400, CODE_ROW_PX)).toBe(499 * CODE_ROW_PX - 133);
    expect(scrollTopFor(1, 900, 400, CODE_ROW_PX)).toBe(0);
  });

  it('줄에서 시작하는 요소를 원본 색인이 그대로 낸다(무대에 보내는 모양)', async () => {
    const cache = createSourceCache(async () => envelope(HTML));
    const src = await cache.load('demo', 'vid', 'comp', null, 'h1');
    expect(sourceTargetsAtLine(src.index!, 2).targets).toEqual([{ tag: 'div', n: 0, of: 2, id: 'stage', cls: '', attrs: '', alt: [], sig: true }]);
  });
});
