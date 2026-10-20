import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDoc,
  estimateTextMeasure,
  hitTest,
  resolveTimeline,
  sceneLayout,
  scenePartAt,
  type VideoDoc,
  type VideoItem,
} from '@vibisual/video';
import type { StagePick } from '@vibisual/video/render';

import { previewInspectPicker, type PreviewInspectLevels } from './previewInspect.js';
import { asksInside, previewHitOptions, previewInspectLevels, usePreviewInteraction, type PreviewInteraction } from './usePreviewInteraction.js';

/**
 * §5.4 #15 (C) · §5.13 (V) 37-6 — Alt 인스펙터로 영상 미리보기 안을 집으면 "화면 전체" 가 아니라 그 자리의 글자(값)가 집힌다.
 * 사용자 문서(`데모 — 에이전트가 만든 영상`)와 같은 모양 — 단색 배경 위 제목 씬, 그 뒤 목록 씬.
 */
const SIZE = { width: 1920, height: 1080 };
const items: VideoItem[] = [
  { id: 'bg', kind: 'scene', sceneId: 'solid', at: 0, duration: 16, label: '배경' },
  { id: 'intro', kind: 'scene', sceneId: 'title', at: 0, duration: 4, label: '제목', props: { title: 'See your AI agents think.', subtitle: 'Vibisual · Vibistudio' } },
  { id: 'points', kind: 'scene', sceneId: 'bulletList', at: 4, duration: 6, label: '목록', props: { heading: '이 앱이 하는 일', items: ['하나', '둘', '셋'] } },
];
const doc: VideoDoc = { ...createEmptyDoc('demo', '데모 — 에이전트가 만든 영상'), size: SIZE, tracks: [{ id: 'visual', kind: 'visual', items }] };
const timeline = resolveTimeline(doc);
const env = { doc, size: SIZE };

function partCenter(itemId: string, t: number, prop: string): { x: number; y: number } {
  const op = timeline.items.find((r) => r.item.id === itemId);
  if (!op) throw new Error(itemId);
  const hit = hitTest(doc, timeline, t, SIZE.width / 2, SIZE.height / 2);
  const drawOp = hit && hit.op.itemId === itemId ? hit.op : undefined;
  const layout = sceneLayout(drawOp!, env, estimateTextMeasure)!;
  const r = layout.parts.find((p) => p.prop === prop)!.rect;
  // 기본 상자(화면 전체·배율 1) — 씬 상자 안 좌표가 곧 문서 좌표다.
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** 셸의 캔버스 `pickAt` 과 같은 길 — 칠한 자리로 고르고 그 안의 글자를 그리기와 같은 계산으로 답한다. */
async function canvasPickAt(t: number, x: number, y: number): Promise<StagePick | null> {
  const hit = hitTest(doc, timeline, t, x, y, { measure: estimateTextMeasure });
  if (!hit) return null;
  const part = hit.op.kind === 'scene' ? scenePartAt(hit.op, env, x, y, estimateTextMeasure) : null;
  return part ? { op: hit.op, element: part, rect: part.rect } : { op: hit.op, rect: hit.rect };
}

describe('§5.4 #15 (C) Alt 인스펙터 — 영상 미리보기 안의 답', () => {
  it('부제 위는 그 글자 칸이 먼저, 그 씬 아이템이 다음 — 복사 글은 가리키기와 같은 말에 문서·파일 자리를 얹는다', async () => {
    const at = partCenter('intro', 2, 'subtitle');
    const hit = hitTest(doc, timeline, 2, at.x, at.y, { measure: estimateTextMeasure })!;
    const levels = previewInspectLevels({ projectName: 'vibisual', duration: timeline.duration, t: 2 }, doc, hit, await canvasPickAt(2, at.x, at.y));
    expect(levels.map((l) => l.label)).toEqual(['intro › subtitle', 'intro (scene:title)']);
    expect(levels[0]!.text).toBe('Vibisual · Vibistudio');
    expect(levels[0]!.rect.width).toBeLessThan(SIZE.width / 2);
    const clip = levels[0]!.clipboard;
    expect(clip).toContain('[Video] document "demo" ("데모 — 에이전트가 만든 영상", version');
    expect(clip).toContain('in project "vibisual" — file .vibisual/video/demo.json');
    expect(clip).toContain('[Pointed] item "intro" (scene "title") at 2.00s');
    expect(clip).toContain('element "props.subtitle"');
    expect(clip).toContain('bound to prop "subtitle", text "Vibisual · Vibistudio"');
    expect(clip).toContain('[Hint] This is video document data, not app code.');
    expect(levels[1]!.clipboard).not.toContain('bound to prop');
    expect(levels[1]!.clipboard).toContain('text "제목"');
  });

  it('목록 씬의 둘째 줄은 배열 칸 자리로 집힌다', async () => {
    const at = partCenter('points', 9, 'items[1]');
    const hit = hitTest(doc, timeline, 9, at.x, at.y, { measure: estimateTextMeasure })!;
    const levels = previewInspectLevels({ projectName: 'vibisual', duration: timeline.duration, t: 9 }, doc, hit, await canvasPickAt(9, at.x, at.y));
    expect(levels[0]).toMatchObject({ label: 'points › items[1]', text: '둘' });
    expect(levels[0]!.clipboard).toContain('bound to prop "items[1]"');
  });

  it('글자가 없는 빈 곳은 씬이 아니라 그 아래 배경 아이템 — 화면 전체 씬이 통째로 잡히지 않는다', async () => {
    const hit = hitTest(doc, timeline, 2, 20, 20, { measure: estimateTextMeasure })!;
    expect(hit.op.itemId).toBe('bg');
    const levels = previewInspectLevels({ projectName: 'vibisual', duration: timeline.duration, t: 2 }, doc, hit, await canvasPickAt(2, 20, 20));
    expect(levels.map((l) => l.label)).toEqual(['bg (scene:solid)']);
  });

  it('기본 씬은 두 미리보기 모두 안쪽을 묻고, 칠한 자리 판정은 캔버스에서만 켠다(무대는 CSS 배치)', () => {
    expect(asksInside('scene', 'canvas')).toBe(true);
    expect(asksInside('scene', 'stage')).toBe(true);
    expect(previewHitOptions('stage')).toBeUndefined();
    expect(typeof previewHitOptions('canvas')?.measure).toBe('function');
  });
});

describe('§5.4 #15 (C) 판 안의 보이는 픽셀 ↔ 문서 픽셀', () => {
  const level = { rect: { x: 100, y: 200, width: 300, height: 50 }, label: 'intro › title', text: 'T', clipboard: 'C' };

  it('판의 보이는 크기 대 문서 크기의 비로 묻고, 답한 상자를 판 안 픽셀로 돌려준다', () => {
    const inspect = vi.fn((): PreviewInspectLevels => [level]);
    const picker = previewInspectPicker(SIZE, inspect);
    const answer = picker({ x: 96, y: 54, width: 192, height: 108 });
    expect(inspect).toHaveBeenCalledWith(960, 540);
    expect(answer).toEqual([{ rect: { x: 10, y: 20, width: 30, height: 5 }, label: 'intro › title', text: 'T', clipboard: 'C' }]);
  });

  it('약속으로 답해도 같은 변환을 거친다 · 판이 아직 크기가 없으면 묻지 않는다', async () => {
    const inspect = vi.fn(async (): Promise<PreviewInspectLevels> => [level]);
    const picker = previewInspectPicker(SIZE, inspect);
    await expect(picker({ x: 192, y: 108, width: 384, height: 216 })).resolves.toEqual([{ rect: { x: 20, y: 40, width: 60, height: 10 }, label: 'intro › title', text: 'T', clipboard: 'C' }]);
    expect(previewInspectPicker(SIZE, inspect)({ x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
    expect(inspect).toHaveBeenCalledOnce();
  });
});

describe('§5.13 (V) 37-6 제자리 고치기 — 누른 그 글자 자리에서 그 값을', () => {
  let renderer: ReactTestRenderer | null = null;
  let result: PreviewInteraction;
  // 셸처럼 같은 참조를 넘긴다 — 렌더마다 새 배열이면 `[pointed]` 효과가 매번 상태를 바꿔 끝없이 다시 그린다.
  const pointed: never[] = [];
  const notes: never[] = [];
  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = null; });

  function mount(t: number, onSetProp: (itemId: string, key: string, value: unknown) => void): void {
    function Probe(): null {
      result = usePreviewInteraction({
        projectName: 'vibisual', doc, timeline, playhead: t, mode: 'canvas', interaction: 'none', selectedItemId: null,
        setSelectedItemId: () => undefined, pickAt: (x, y) => canvasPickAt(t, x, y), addPointed: () => undefined, pointed,
        notes, addNote: async () => null, onSetProp, onNoteAdded: () => undefined,
      });
      return null;
    }
    act(() => { renderer = create(createElement(Probe)); });
  }

  it('목록 둘째 줄을 두 번 누르면 그 줄 상자에 그 줄 값이 서고, 고치면 배열의 그 칸만 바뀐다', async () => {
    const onSetProp = vi.fn();
    mount(9, onSetProp);
    const at = partCenter('points', 9, 'items[1]');
    await act(async () => { result.onDoublePress(at.x, at.y); });
    expect(result.edit?.value).toBe('둘');
    expect(result.edit?.rect.width).toBeLessThan(SIZE.width / 2);
    act(() => { result.edit!.onCommit('둘 — 고침'); });
    expect(onSetProp).toHaveBeenCalledExactlyOnceWith('points', 'items', ['하나', '둘 — 고침', '셋']);
  });

  it('부제를 두 번 누르면 제목이 아니라 부제를 고친다', async () => {
    const onSetProp = vi.fn();
    mount(2, onSetProp);
    const at = partCenter('intro', 2, 'subtitle');
    await act(async () => { result.onDoublePress(at.x, at.y); });
    expect(result.edit?.value).toBe('Vibisual · Vibistudio');
    act(() => { result.edit!.onCommit('Vibistudio'); });
    expect(onSetProp).toHaveBeenCalledExactlyOnceWith('intro', 'subtitle', 'Vibistudio');
  });
});
