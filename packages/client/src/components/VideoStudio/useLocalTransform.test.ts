import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPatch, createEmptyDoc, type VideoDoc, type VideoDocOp, type VideoItem } from '@vibisual/video';

import { useLocalProps, type LocalProps } from './useLocalProps.js';
import { useLocalTransform, type LocalTransform } from './useLocalTransform.js';

/**
 * §5.13 (V) 37-21 (C) — 끄는 동안에는 문서에 쓰지 않고, 놓을 때 `updateItem{transform}` 한 번(판본 하나 = 되돌리기 한 칸).
 */
const item = (extra: Partial<VideoItem> = {}): VideoItem => ({ id: 'card', kind: 'shape', at: 0, duration: 4, transform: { x: 100, y: 50, width: 200, height: 100, opacity: 0.5 }, ...extra });
function fixture(items: VideoItem[] = [item()]): VideoDoc {
  return { ...createEmptyDoc('vid', 'Demo', 100), tracks: [{ id: 'visual', kind: 'visual', items }] };
}
const transformOf = (doc: VideoDoc | null, id = 'card') => doc?.tracks.flatMap((t) => t.items).find((i) => i.id === id)?.transform;

let view: ReactTestRenderer | undefined;
let layout: LocalTransform;
let saved: VideoDoc;
let sent: VideoDocOp[][];
let answer: (ops: readonly VideoDocOp[]) => Promise<boolean>;

function Harness({ doc }: { doc: VideoDoc }): null {
  layout = useLocalTransform(doc, (ops) => answer(ops));
  return null;
}
const render = (): void => { act(() => { if (view) view.update(createElement(Harness, { doc: saved })); else view = create(createElement(Harness, { doc: saved })); }); };
/** 서버가 받아 적고 새 문서가 화면에 돌아온다(평소 편집 경로의 흉내). */
const accept = async (ops: readonly VideoDocOp[]): Promise<boolean> => {
  sent.push([...ops]);
  const result = applyPatch(saved, { baseVersion: saved.version, ops: [...ops] }, 200);
  if (!result.ok) return false;
  saved = result.doc;
  return true;
};

beforeEach(() => { vi.useFakeTimers(); saved = fixture(); sent = []; answer = accept; });
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); });

describe('끄는 동안 — 화면만 먼저', () => {
  it('배치 사본만 바뀌고 문서에는 아무것도 보내지 않는다', () => {
    render();
    for (let i = 1; i <= 30; i += 1) act(() => layout.preview('card', { x: 100 + i, y: 50 }));
    expect(sent).toEqual([]);
    expect(transformOf(layout.previewDoc)).toEqual({ x: 130, y: 50, width: 200, height: 100, opacity: 0.5 });
    expect(transformOf(saved)).toEqual({ x: 100, y: 50, width: 200, height: 100, opacity: 0.5 });
    expect(layout.pending).toBe(true);
  });

  it('덮어쓰기가 없으면 받은 문서 그대로다(다시 그릴 것이 없다)', () => {
    render();
    expect(layout.previewDoc).toBe(saved);
    act(() => layout.preview('card', { x: 1, y: 2 }));
    act(() => layout.preview('card', null));
    expect(layout.previewDoc).toBe(saved);
    expect(layout.pending).toBe(false);
  });

  it('고치지 않는 트랙·아이템은 같은 객체로 남는다', () => {
    saved = { ...fixture(), tracks: [{ id: 'visual', kind: 'visual', items: [item()] }, { id: 'other', kind: 'visual', items: [item({ id: 'bg' })] }] };
    render();
    act(() => layout.preview('card', { x: 5, y: 5 }));
    expect(layout.previewDoc!.tracks[1]).toBe(saved.tracks[1]);
  });
});

describe('놓으면 — 한 번 저장', () => {
  it('끌기 한 번은 updateItem{transform} 하나다 — 바꾼 칸만 지금 문서 값 위에 얹는다', async () => {
    render();
    const before = saved.version;
    for (let i = 1; i <= 20; i += 1) act(() => layout.preview('card', { x: 100 + i * 2, y: 50 + i }));
    await act(async () => { layout.commit('card', { x: 140, y: 70 }); });
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { transform: { x: 140, y: 70, width: 200, height: 100, opacity: 0.5 } } }]]);
    expect(saved.version).toBe(before + 1);
    render();
    // 문서가 그 값을 가지면 덮어쓰기를 걷는다.
    expect(layout.pending).toBe(false);
    expect(layout.previewDoc).toBe(saved);
  });

  it('그사이 다른 손이 고친 칸(투명도)은 덮지 않는다', async () => {
    render();
    act(() => layout.preview('card', { x: 120, y: 50 }));
    saved = { ...saved, version: saved.version + 1, tracks: [{ id: 'visual', kind: 'visual', items: [item({ transform: { x: 100, y: 50, width: 200, height: 100, opacity: 1, rotation: 15 } })] }] };
    render();
    await act(async () => { layout.commit('card', { x: 120, y: 50 }); });
    expect(sent[0]).toEqual([{ op: 'updateItem', itemId: 'card', patch: { transform: { x: 120, y: 50, width: 200, height: 100, opacity: 1, rotation: 15 } } }]);
  });

  it('제자리에 놓았으면 아무것도 보내지 않는다', async () => {
    render();
    act(() => layout.preview('card', { x: 130, y: 50 }));
    await act(async () => { layout.commit('card', { x: 100, y: 50 }); });
    expect(sent).toEqual([]);
    expect(layout.pending).toBe(false);
  });

  it('저장이 막히면 한 번만 다시 해 보고, 또 막히면 화면이 문서로 돌아간다', async () => {
    const tries: number[] = [];
    answer = async () => { tries.push(Date.now()); return false; };
    render();
    await act(async () => { layout.commit('card', { x: 140, y: 70 }); });
    expect(tries).toHaveLength(1);
    expect(layout.pending).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(tries).toHaveLength(2);
    expect(layout.pending).toBe(false);
    expect(layout.previewDoc).toBe(saved);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(tries).toHaveLength(2);
  });

  it('다시 해 본 저장이 되면 그 한 번만 적힌다', async () => {
    let calls = 0;
    answer = async (ops) => { calls += 1; return calls === 1 ? false : accept(ops); };
    render();
    await act(async () => { layout.commit('card', { x: 140, y: 70 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(sent).toHaveLength(1);
    expect(transformOf(saved)).toMatchObject({ x: 140, y: 70 });
  });

  it('지워진 아이템은 저장하지 않고 걷는다', async () => {
    render();
    act(() => layout.preview('card', { x: 140, y: 70 }));
    saved = { ...saved, version: saved.version + 1, tracks: [{ id: 'visual', kind: 'visual', items: [] }] };
    render();
    expect(layout.pending).toBe(false);
    await act(async () => { layout.commit('card', { x: 140, y: 70 }); });
    expect(sent).toEqual([]);
  });

  it('다른 문서로 가면 덮어쓰기를 버린다', () => {
    render();
    act(() => layout.preview('card', { x: 140, y: 70 }));
    saved = { ...fixture(), id: 'other' };
    render();
    expect(layout.pending).toBe(false);
  });
});

describe('화살표 키 — 연달아 누른 것은 한 번에', () => {
  it('누를 때마다 화면은 바로, 저장은 마지막 누름 뒤 450ms 잠잠할 때 한 번', async () => {
    render();
    for (let i = 0; i < 5; i += 1) {
      act(() => layout.nudge('card', 1, 0));
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    expect(transformOf(layout.previewDoc)).toMatchObject({ x: 105, y: 50 });
    expect(sent).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { transform: { x: 105, y: 50, width: 200, height: 100, opacity: 0.5 } } }]]);
  });

  it('배치를 적지 않은 아이템은 화면 전체의 왼쪽 위(0,0)에서 옮긴다', async () => {
    saved = fixture([{ id: 'card', kind: 'shape', at: 0, duration: 4 }]);
    render();
    act(() => layout.nudge('card', -10, 10));
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(transformOf(saved)).toEqual({ x: -10, y: 10 });
  });

  it('키로 옮긴 뒤 끌다 취소하면 키로 옮긴 자리로 돌아가 그것만 저장된다', async () => {
    render();
    act(() => layout.nudge('card', 3, 0));
    act(() => layout.preview('card', { x: 150, y: 60 }));
    act(() => layout.preview('card', null));
    expect(transformOf(layout.previewDoc)).toMatchObject({ x: 103, y: 50 });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { transform: { x: 103, y: 50, width: 200, height: 100, opacity: 0.5 } } }]]);
  });

  it('다른 아이템의 기다리던 키 저장은 끌기를 시작할 때 먼저 내보낸다(끌기를 취소해도 남는다)', async () => {
    saved = fixture([item(), item({ id: 'bg' })]);
    render();
    act(() => layout.nudge('bg', 5, 0));
    await act(async () => { layout.preview('card', { x: 150, y: 60 }); });
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'bg', patch: { transform: { x: 105, y: 50, width: 200, height: 100, opacity: 0.5 } } }]]);
    act(() => layout.preview('card', null));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(sent).toHaveLength(1);
  });

  it('끌지 않았으면(크기를 끄는 동안 틀만 따라간 반응형) 취소가 기다리던 키 저장을 걷지 않는다', async () => {
    render();
    act(() => layout.nudge('card', 2, 0));
    act(() => layout.preview('card', null));
    expect(transformOf(layout.previewDoc)).toMatchObject({ x: 102 });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(sent).toHaveLength(1);
  });

  it('끌기를 시작하면 기다리던 키 저장은 그 끌기가 품는다(따로 나가지 않는다)', async () => {
    render();
    act(() => layout.nudge('card', 3, 0));
    act(() => layout.preview('card', { x: 150, y: 60 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(sent).toEqual([]);
    await act(async () => { layout.commit('card', { x: 150, y: 60 }); });
    expect(sent).toHaveLength(1);
  });
});

describe('값 손잡이의 저장 붙들기 — 안쪽 요소를 끄는 동안', () => {
  let props: LocalProps;
  function PropsHarness({ doc }: { doc: VideoDoc }): null {
    props = useLocalProps(doc, (ops) => answer(ops));
    return null;
  }
  const mount = (): void => { act(() => { if (view) view.update(createElement(PropsHarness, { doc: saved })); else view = create(createElement(PropsHarness, { doc: saved })); }); };

  it('붙든 동안에는 멈춰 있어도 저장하지 않고, 놓으면 잠잠해진 뒤 한 번 저장한다', async () => {
    mount();
    act(() => props.hold(true));
    act(() => props.setProp('card', 'cardX', 10));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    act(() => props.setProp('card', 'cardX', 30));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(sent).toEqual([]);
    act(() => props.hold(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { props: { cardX: 30 } } }]]);
  });

  it('되돌린 열쇠는 저장되지 않는다(끌기 취소) — 다른 열쇠는 남는다', async () => {
    mount();
    act(() => props.hold(true));
    act(() => { props.setProp('card', 'cardX', 10); props.setProp('card', 'title', 'Hi'); });
    act(() => { props.revertProps('card', ['cardX']); props.hold(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { props: { title: 'Hi' } } }]]);
  });

  it('취소는 붙들기 시작 때의 값으로 되돌린다 — 그때 저장을 기다리던 값은 남아 저장된다', async () => {
    mount();
    act(() => props.setProp('card', 'cardX', 40));
    act(() => props.hold(true));
    act(() => { props.setProp('card', 'cardX', 90); props.setProp('card', 'cardY', 7); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(sent).toEqual([]);
    act(() => { props.revertProps('card', ['cardX', 'cardY']); props.hold(false); });
    expect(props.previewDoc?.tracks[0]?.items[0]?.props).toEqual({ cardX: 40 });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { props: { cardX: 40 } } }]]);
  });

  it('걷힌 뒤에는 붙들기를 풀어도 저장을 새로 걸지 않는다', async () => {
    mount();
    act(() => props.hold(true));
    act(() => props.setProp('card', 'cardX', 10));
    const hold = props.hold;
    act(() => view?.unmount());
    view = undefined;
    act(() => hold(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(sent).toEqual([]);
  });

  it('다 걷으면 덮어쓰기가 비고 아무것도 보내지 않는다', async () => {
    mount();
    act(() => props.setProp('card', 'cardX', 10));
    act(() => props.revertProps('card', ['cardX']));
    expect(props.pending).toBe(false);
    expect(props.previewDoc).toBe(saved);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(sent).toEqual([]);
  });
});
