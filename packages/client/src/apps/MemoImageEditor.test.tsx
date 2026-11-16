import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoShell } from '@vibisual/memo/client';
import type { MemoNote } from '@vibisual/memo';
import { ImageLightboxView } from '../components/IDE/ImageAnnotator.js';
import { MemoImageEditor } from './MemoImageEditor.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, vars?: { name?: string }) => vars?.name ? `${key}:${vars.name}` : key }) }));
vi.mock('../components/IDE/ImageAnnotator.js', () => ({ ImageLightboxView: () => null }));
let view: ReactTestRenderer | undefined;
let note: MemoNote;
const host = {
  Scroll: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ImageEditor: MemoImageEditor, useLifecycle: vi.fn(), openContext: vi.fn(), contexts: () => [],
  mediaUrl: (path: string) => `vibproxy://proxy${path}`,
};
const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
  if (init?.method === 'PATCH') {
    const payload = JSON.parse(String(init.body)) as { detach: string };
    note = { ...note, version: note.version + 1, attachments: note.attachments.filter(item => item.id !== payload.detach) };
    return new Response(JSON.stringify(note));
  }
  return new Response(JSON.stringify(url.includes(`/notes/${note.id}?`) ? note : { notes: [note], settings: { aiEnabled: true } }));
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetcher); vi.stubGlobal('document', { activeElement: null }); vi.stubGlobal('HTMLElement', class {});
  note = {
    id: 'memo-test0001', owner: 'local', project: '/project', version: 1, createdAt: 1, updatedAt: 1, deletedAt: null,
    author: 'user', requestId: 'request-seed', title: '', body: '', tags: [], tasks: [], context: null, pinned: false, aiExcluded: false,
    attachments: [
      { id: 'asset-image001', name: 'picture.png', mime: 'image/png', size: 20, createdAt: 1 },
      { id: 'asset-video001', name: 'clip.mp4', mime: 'video/mp4', size: 30, createdAt: 1 },
      { id: 'asset-audio001', name: 'sound.mp3', mime: 'audio/mpeg', size: 40, createdAt: 1 },
    ],
  };
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(): Promise<void> {
  await act(async () => { view = create(createElement(MemoShell, { params: { projectId: '/project', memoId: note.id }, host })); });
}
async function click(label: string): Promise<void> {
  await act(async () => { view!.root.findAll(node => node.type === 'button' && node.props['aria-label'] === label)[0]!.props.onClick(); });
}

describe('memo images use the IDE editor', () => {
  it('opens the original streaming URL in the shared editor and closes without a second viewer', async () => {
    await mount(); await click('memo.openMedia:picture.png');
    const editor = view!.root.findByType(ImageLightboxView);
    expect(editor.props.state.url).toBe('vibproxy://proxy/api/app/memo/media?project=%2Fproject&note=memo-test0001&asset=asset-image001');
    expect(editor.props.canAttach).toBe(false);
    expect(editor.props.state.workspace).toBeUndefined();
    expect(view!.root.findAllByType('dialog')).toHaveLength(0);
    act(() => editor.props.onClose());
    expect(view!.root.findAllByType(ImageLightboxView)).toHaveLength(0);
  });
  it('keeps image attachments out of video and audio navigation', async () => {
    await mount(); await click('memo.openMedia:clip.mp4');
    expect(view!.root.findAllByType('video')).toHaveLength(1);
    expect(view!.root.findAllByType(ImageLightboxView)).toHaveLength(0);
    await click('memo.nextMedia');
    expect(view!.root.findAllByType('audio')).toHaveLength(1);
    await click('memo.nextMedia');
    expect(view!.root.findAllByType('video')).toHaveLength(1);
  });
  it('clears the image editor when moving to a new memo', async () => {
    await mount(); await click('memo.openMedia:picture.png');
    await act(async () => { view!.root.findAll(node => node.type === 'button' && node.children.includes('memo.new'))[0]!.props.onClick(); });
    expect(view!.root.findAllByType(ImageLightboxView)).toHaveLength(0);
  });
  it('clears the image editor when its attachment is removed', async () => {
    await mount(); await click('memo.openMedia:picture.png');
    await click('memo.detach:picture.png');
    expect(view!.root.findAllByType(ImageLightboxView)).toHaveLength(0);
  });
});
