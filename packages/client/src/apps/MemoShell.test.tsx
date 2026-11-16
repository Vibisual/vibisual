import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoShell } from '@vibisual/memo/client';
import type { MemoNote } from '@vibisual/memo';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let view: ReactTestRenderer | undefined;
let flush: () => Promise<boolean>;
let failed = false;
const root = '/project';
let note: MemoNote | null;
const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
  if (init?.method === 'PUT' && url.includes('/uploads/')) return new Response(JSON.stringify({ ok: true, received: Number(new URL(url, 'http://app').searchParams.get('offset')) + (init.body as Blob).size }));
  if (init?.method === 'POST' && url.includes('/assets?') && note) {
    const payload = JSON.parse(String(init.body));
    note = { ...note, version: note.version + 1, attachments: [...note.attachments, { id: 'asset-12345678', name: payload.name, mime: 'image/png', size: payload.size, createdAt: 1 }] };
    return new Response(JSON.stringify(note));
  }
  if (init?.method === 'POST' && url.includes('/notes?')) {
    if (failed) return new Response(JSON.stringify({ error: 'storage-failed' }), { status: 500 });
    const payload = JSON.parse(String(init.body));
    note = { ...payload, id: 'memo-12345678', owner: 'local', project: root, version: 1, createdAt: 1, updatedAt: 1, attachments: [], deletedAt: null, author: 'user' };
    return new Response(JSON.stringify(note));
  }
  return new Response(JSON.stringify({ notes: note ? [note] : [], settings: { aiEnabled: true } }));
});
const lifecycle = vi.fn((_params: Readonly<Record<string, string>>, _id: string | null, save: () => Promise<boolean>): void => { flush = save; });
const host = {
  Scroll: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  useLifecycle: lifecycle, openContext: vi.fn(),
  contexts: () => [{ kind: 'project' as const, id: root, label: 'Project', excerpt: '' }],
  useAIEnabled: () => true,
};
beforeEach(() => { vi.useFakeTimers(); note = null; failed = false; fetcher.mockClear(); lifecycle.mockClear(); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
const body = () => view!.root.findAllByType('textarea')[0]!;
const posts = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
async function mount(): Promise<void> { await act(async () => { view = create(createElement(MemoShell, { params: { projectId: root }, host })); }); }

describe('memo capture surface', () => {
  it('gives the editor scroll area a height so long notes scroll instead of being clipped', async () => {
    await mount();
    const scroll = view!.root.findAllByType(host.Scroll).find(node => node.findAllByType('textarea').length > 0)!;
    expect(String(scroll.props.className)).toContain('flex-1');
    expect(String(scroll.parent?.props.className).split(' ')).toEqual(expect.arrayContaining(['flex', 'flex-col']));
  });
  it('keeps Korean composition intact and autosaves its final text without a title', async () => {
    await mount();
    act(() => { body().props.onCompositionStart(); body().props.onChange({ target: { value: 'ㅎ' } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(posts()).toHaveLength(0);
    act(() => body().props.onCompositionEnd({ currentTarget: { value: '한글 기록' } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String(posts()[0]?.[1]?.body)).title).toBe('');
    expect(body().props.value).toBe('한글 기록');
    expect(lifecycle.mock.calls.at(-1)?.[1]).toBe('memo-12345678');
  });
  it('flushes typing immediately through the window close/transfer contract', async () => {
    await mount(); act(() => body().props.onChange({ target: { value: '닫기 직전 기록' } }));
    let saved = false; await act(async () => { saved = await flush(); });
    expect(saved).toBe(true); expect(posts()).toHaveLength(1); expect(body().props.value).toBe('닫기 직전 기록');
    expect(view!.root.findAllByProps({ role: 'status' })[0]?.children).toContain('memo.saved');
  });
  it('keeps the editor open and the full draft visible after a failed durable save', async () => {
    failed = true; await mount(); act(() => body().props.onChange({ target: { value: '저장 실패에도 보존할 기록' } }));
    let saved = true; await act(async () => { saved = await flush(); });
    expect(saved).toBe(false); expect(body().props.value).toBe('저장 실패에도 보존할 기록');
    expect(view!.root.findAllByProps({ role: 'alert' }).length).toBe(1);
    expect(view!.root.findAllByProps({ role: 'status' })[0]?.children).toContain('memo.saveFailed');
  });

  const keyEvent = (code: string, extra: Record<string, unknown> = {}) => ({ code, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });
  const rootKeyDown = () => view!.root.findAll(node => node.type === 'div' && typeof node.props.onKeyDown === 'function')[0]!.props.onKeyDown as (event: unknown) => void;
  const library = () => view!.root.findByType('aside');
  const button = (label: string) => view!.root.findAll(node => node.type === 'button' && node.props['aria-label'] === label)[0]!;
  it('saves immediately on Ctrl+S through the root key handler', async () => {
    await mount(); act(() => body().props.onChange({ target: { value: '바로 저장' } }));
    expect(posts()).toHaveLength(0);
    const event = keyEvent('KeyS');
    await act(async () => { rootKeyDown()(event); await vi.advanceTimersByTimeAsync(0); });
    expect(event.preventDefault).toHaveBeenCalled(); expect(posts()).toHaveLength(1);
  });
  it('ignores shortcuts while a Korean composition is in progress', async () => {
    await mount(); act(() => body().props.onChange({ target: { value: '조합 중' } }));
    const event = keyEvent('KeyS', { nativeEvent: { isComposing: true } });
    await act(async () => { rootKeyDown()(event); await vi.advanceTimersByTimeAsync(0); });
    expect(event.preventDefault).not.toHaveBeenCalled(); expect(posts()).toHaveLength(0);
  });
  it('hides the library from the toggle button and from Ctrl+Backslash', async () => {
    await mount();
    expect(library().props.className).toContain('basis-72');
    act(() => button('memo.toggleLibrary').props.onClick());
    expect(library().props.className).toContain('hidden');
    act(() => rootKeyDown()(keyEvent('Backslash')));
    expect(library().props.className).toContain('basis-72');
  });
  it('shows no selection checkboxes until the AI panel is opened', async () => {
    note = { id: 'memo-seed0001', owner: 'local', project: root, version: 1, createdAt: 1, updatedAt: 1, attachments: [], deletedAt: null, author: 'user', requestId: 'seed-request', title: '시드', body: '본문', tags: [], tasks: [], context: null, pinned: false, aiExcluded: false } as MemoNote;
    await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    const boxes = () => view!.root.findAll(node => node.type === 'input' && node.props.type === 'checkbox');
    expect(view!.root.findAllByType('li').length).toBeGreaterThan(0); expect(boxes()).toHaveLength(0);
    const ai = view!.root.findAll(node => node.type === 'button' && node.props['aria-pressed'] !== undefined && node.findAll(inner => inner.children.includes('memo.ai')).length > 0)[0]!;
    await act(async () => { ai.props.onClick(); await vi.advanceTimersByTimeAsync(0); });
    expect(boxes().length).toBeGreaterThan(0);
  });
  it('attaches a pasted clipboard image through chunk upload and keeps the editor unlocked', async () => {
    await mount();
    const onPaste = view!.root.findAll(node => node.type === 'div' && typeof node.props.onPaste === 'function')[0]!.props.onPaste as (event: unknown) => void;
    const event = { clipboardData: { files: [new File([new Uint8Array(9)], 'image.png', { type: 'image/png' })], getData: () => '' }, preventDefault: vi.fn() };
    await act(async () => { onPaste(event); for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0); });
    expect(event.preventDefault).toHaveBeenCalled();
    const sent = fetcher.mock.calls.filter(([url, init]) => init?.method === 'PUT' && url.includes('/uploads/'));
    expect(sent).toHaveLength(1); expect(new Headers(sent[0]?.[1]?.headers).get('content-type')).toBe('application/octet-stream');
    expect(note?.attachments[0]?.name).toMatch(/^capture-\d{8}-\d{6}\.png$/);
    const picture = view!.root.findAllByType('img')[0]!;
    expect(picture.props.src).toContain('/api/app/memo/media?'); expect(picture.props.src).toContain('asset=asset-12345678');
    expect(body().props.disabled).toBe(false); expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });
  it('leaves a paste that carries text to the editor', async () => {
    await mount();
    const onPaste = view!.root.findAll(node => node.type === 'div' && typeof node.props.onPaste === 'function')[0]!.props.onPaste as (event: unknown) => void;
    const event = { clipboardData: { files: [new File([new Uint8Array(9)], 'image.png', { type: 'image/png' })], getData: () => '표 내용' }, preventDefault: vi.fn() };
    await act(async () => { onPaste(event); await vi.advanceTimersByTimeAsync(0); });
    expect(event.preventDefault).not.toHaveBeenCalled(); expect(posts()).toHaveLength(0);
  });
});
