import { createElement, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPatch, createEmptyDoc, type VideoDoc, type VideoDocOp, type VideoItem } from '@vibisual/video';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), read: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string): string => key }) }));
vi.mock('./videoApi.js', () => ({ patchDoc: mocks.patch, readDoc: mocks.read, VersionConflictError: class extends Error {} }));

import { useLocalProps } from './useLocalProps.js';
import { useLocalTransform, type LocalTransform } from './useLocalTransform.js';
import { useVideoEdits } from './useVideoEdits.js';

/**
 * §5.13 (V) 37-21 (C) — 끌기 한 번은 평소 편집 경로(`useVideoEdits` — 판본 검사·되돌리기 이력)에 **한 칸**으로 쌓인다.
 * 끄는 동안 서버에는 아무것도 가지 않는다.
 */
const card: VideoItem = { id: 'card', kind: 'shape', at: 0, duration: 4, transform: { x: 100, y: 50, width: 200, height: 100 } };
let server: VideoDoc;
let view: ReactTestRenderer | undefined;
let edits: ReturnType<typeof useVideoEdits>;
let layout: LocalTransform;
let shown: VideoDoc | null;
const pending = { current: 0 };
const transformOf = (doc: VideoDoc | null) => doc?.tracks[0]?.items[0]?.transform;

function Harness(): null {
  const [doc, setDoc] = useState<VideoDoc>(server);
  edits = useVideoEdits('demo', doc, setDoc, () => undefined, pending);
  const props = useLocalProps(doc, edits.applyOps);
  layout = useLocalTransform(props.previewDoc, edits.applyOps);
  shown = layout.previewDoc;
  return null;
}

beforeEach(() => {
  server = { ...createEmptyDoc('vid', 'Demo'), tracks: [{ id: 'visual', kind: 'visual', items: [card] }] };
  mocks.patch.mockReset().mockImplementation(async (_project: string, _id: string, baseVersion: number, ops: VideoDocOp[]) => {
    const result = applyPatch(server, { baseVersion, ops }, 200);
    if (!result.ok) throw new Error(JSON.stringify(result));
    server = result.doc;
    return { doc: server };
  });
  mocks.read.mockReset().mockImplementation(async () => ({ doc: server }));
  act(() => { view = create(createElement(Harness)); });
});
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('끌기 한 번 = 판본 하나 = 되돌리기 한 칸', () => {
  it('끄는 동안에는 서버에 아무것도 보내지 않고, 놓으면 한 번 — 되돌리기 한 번으로 처음 자리다', async () => {
    const version = server.version;
    for (let i = 1; i <= 40; i += 1) act(() => layout.preview('card', { x: 100 + i * 5, y: 50 + i }));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(edits.canUndo).toBe(false);
    await act(async () => { layout.commit('card', { x: 300, y: 90 }); });
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(server.version).toBe(version + 1);
    expect(transformOf(shown)).toEqual({ x: 300, y: 90, width: 200, height: 100 });
    expect(edits.canUndo).toBe(true);
    await act(async () => { await edits.undo(); });
    expect(transformOf(shown)).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    expect(edits.canUndo).toBe(false);
    await act(async () => { await edits.redo(); });
    expect(transformOf(shown)).toEqual({ x: 300, y: 90, width: 200, height: 100 });
  });

  it('그만둔 끌기는 판본도 되돌리기 칸도 남기지 않는다', async () => {
    const version = server.version;
    for (let i = 1; i <= 10; i += 1) act(() => layout.preview('card', { x: 100 + i, y: 50 }));
    act(() => layout.preview('card', null));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(server.version).toBe(version);
    expect(edits.canUndo).toBe(false);
  });
});
