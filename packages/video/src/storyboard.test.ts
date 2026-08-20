import { describe, expect, it } from 'vitest';
import type { ContiFrame } from '@vibisual/shared';
import { STORYBOARD_PRESETS } from '@vibisual/shared';
import { buildStoryboardDoc, buildStoryboardOps, storyboardDuration, storyboardLayout } from './storyboard.js';
import { resolveTimeline } from './resolveTimeline.js';
import { buildDrawList } from './render/drawList.js';
import { validateDoc } from './validateDoc.js';

/** 컷 두 장 — 도형·스탬프·글자·선·원이 한 번씩 나오게. */
function frames(): ContiFrame[] {
  return [
    {
      id: 'frame-a',
      title: '1. 문이 열린다',
      action: '주인공이 복도로 들어선다.',
      elements: [
        { id: 'el-bg', type: 'rect', x: 0, y: 0, w: 320, h: 180, fill: '#242833', stroke: 'none' },
        { id: 'el-win', type: 'stamp', stampName: 'app-window', x: 20, y: 14, w: 240, h: 140, label: 'hall' },
        { id: 'el-dot', type: 'circle', x: 160, y: 90, w: 12, stroke: '#A78BFA' },
        { id: 'el-cap', type: 'text', x: 24, y: 168, label: 'open', fontSize: 12, fill: '#9CA3AF' },
      ],
      badges: [{ kind: 'evt', text: 'enter' }],
    },
    {
      id: 'frame-b',
      title: '2. 마주 본다',
      action: '둘의 시선이 부딪힌다.',
      elements: [
        { id: 'el-line', type: 'line', x: 40, y: 90, w: 240, h: 0, stroke: '#00E5A0' },
        { id: 'el-stampless', type: 'stamp', x: 10, y: 10, label: '이름 없는 스탬프' },
      ],
    },
  ];
}

describe('§5.13 (Q) 콘티 → 타임라인', () => {
  it('컷 하나가 프리셋의 길이만큼 차지하고 순서대로 이어진다', () => {
    const preset = STORYBOARD_PRESETS.landscape;
    const doc = buildStoryboardDoc({ docId: 'doc-1', title: '테스트', frames: frames(), preset });
    const timeline = resolveTimeline(doc);

    expect(timeline.duration).toBeCloseTo(storyboardDuration(2, preset), 3);
    const bgA = timeline.items.find((i) => i.id === 'sb-frame-a-bg');
    const bgB = timeline.items.find((i) => i.id === 'sb-frame-b-bg');
    expect(bgA?.start).toBe(0);
    expect(bgB?.start).toBeCloseTo(preset.secondsPerFrame, 3);
  });

  it('문서 크기·fps 가 프리셋에서 온다', () => {
    for (const preset of [STORYBOARD_PRESETS.landscape, STORYBOARD_PRESETS.portrait, STORYBOARD_PRESETS.webtoon]) {
      const doc = buildStoryboardDoc({ docId: 'doc-1', title: 't', frames: frames(), preset });
      expect(doc.size).toEqual(preset.output);
      expect(doc.fps).toBe(preset.fps);
    }
  });

  it('만들어진 문서는 진단 없이 통과한다', () => {
    for (const preset of [STORYBOARD_PRESETS.landscape, STORYBOARD_PRESETS.portrait, STORYBOARD_PRESETS.webtoon]) {
      const doc = buildStoryboardDoc({ docId: 'doc-1', title: 't', frames: frames(), preset });
      expect(validateDoc(doc).ok).toBe(true);
      expect(resolveTimeline(doc).diagnostics).toEqual([]);
    }
  });

  it('행동은 세로/가로에선 자막으로, 웹툰에선 판넬 아래 글로 간다', () => {
    const wide = buildStoryboardDoc({ docId: 'd', title: 't', frames: frames(), preset: STORYBOARD_PRESETS.landscape });
    const captionTrack = wide.tracks.find((t) => t.id === 'caption');
    expect(captionTrack?.items.length).toBe(2);
    expect(captionTrack?.items[0]?.cues?.[0]?.text).toBe('주인공이 복도로 들어선다.');

    const toon = buildStoryboardDoc({ docId: 'd', title: 't', frames: frames(), preset: STORYBOARD_PRESETS.webtoon });
    expect(toon.tracks.find((t) => t.id === 'caption')?.items.length).toBe(0);
    const printed = toon.tracks
      .find((t) => t.id === 'visual')
      ?.items.find((i) => i.id === 'sb-frame-a-action');
    expect(printed?.props?.['text']).toBe('주인공이 복도로 들어선다.');
  });

  it('자막 큐 시각이 그 아이템의 구간과 같은 좌표계다', () => {
    const preset = STORYBOARD_PRESETS.portrait;
    const doc = buildStoryboardDoc({ docId: 'd', title: 't', frames: frames(), preset });
    const timeline = resolveTimeline(doc);
    for (const item of timeline.items) {
      const cue = item.item.cues?.[0];
      if (!cue) continue;
      expect(cue.start).toBeCloseTo(item.start, 3);
      expect(cue.end).toBeCloseTo(item.end, 3);
      // 그 구간 한가운데를 물어보면 자막이 실제로 잡힌다.
      const ops = buildDrawList(doc, timeline, (item.start + item.end) / 2);
      const drawn = ops.find((o) => o.itemId === item.id);
      expect(drawn?.cues.length).toBe(1);
    }
  });

  it('컷의 element 가 판넬 안쪽 좌표로 옮겨진다', () => {
    const preset = STORYBOARD_PRESETS.landscape;
    const layout = storyboardLayout(preset);
    const doc = buildStoryboardDoc({ docId: 'd', title: 't', frames: frames(), preset });
    const visual = doc.tracks.find((t) => t.id === 'visual');
    const win = visual?.items.find((i) => i.id === 'sb-frame-a-el-el-win');
    expect(win).toBeDefined();
    expect(win?.transform?.x).toBeCloseTo(layout.panel.x + 20 * layout.scale, 3);
    expect(win?.transform?.width).toBeCloseTo(240 * layout.scale, 3);
    // 라벨은 도형과 짝을 이룬 별도 아이템이다.
    expect(visual?.items.some((i) => i.id === 'sb-frame-a-el-el-win-label')).toBe(true);
  });

  it('원은 중심 좌표에서 좌상단 상자로 바뀐다', () => {
    const preset = STORYBOARD_PRESETS.landscape;
    const layout = storyboardLayout(preset);
    const doc = buildStoryboardDoc({ docId: 'd', title: 't', frames: frames(), preset });
    const dot = doc.tracks.find((t) => t.id === 'visual')?.items.find((i) => i.id === 'sb-frame-a-el-el-dot');
    expect(dot?.props?.['shape']).toBe('ellipse');
    expect(dot?.transform?.x).toBeCloseTo(layout.panel.x + (160 - 12) * layout.scale, 3);
    expect(dot?.transform?.width).toBeCloseTo(24 * layout.scale, 3);
  });

  it('가로 선은 선 도형, 세로 선은 얇은 막대가 된다', () => {
    const preset = STORYBOARD_PRESETS.landscape;
    const wide = buildStoryboardDoc({ docId: 'd', title: 't', frames: frames(), preset });
    expect(
      wide.tracks.find((t) => t.id === 'visual')?.items.find((i) => i.id === 'sb-frame-b-el-el-line')?.props?.['shape'],
    ).toBe('line');

    const vertical: ContiFrame[] = [
      { id: 'f', title: 't', action: 'a', elements: [{ id: 'e', type: 'line', x: 40, y: 20, w: 0, h: 120 }] },
    ];
    const doc = buildStoryboardDoc({ docId: 'd', title: 't', frames: vertical, preset });
    const bar = doc.tracks.find((t) => t.id === 'visual')?.items.find((i) => i.id === 'sb-f-el-e');
    expect(bar?.props?.['shape']).toBe('rect');
    expect(bar?.transform?.height).toBeGreaterThan(bar?.transform?.width ?? 0);
  });

  it('같은 element id 가 겹쳐도 아이템 id 는 갈라진다(패치가 통째로 거절되지 않게)', () => {
    const dup: ContiFrame[] = [
      {
        id: 'f',
        title: 't',
        action: 'a',
        elements: [
          { id: 'same', type: 'rect', x: 0, y: 0, w: 40, h: 20 },
          { id: 'same', type: 'rect', x: 40, y: 0, w: 40, h: 20 },
        ],
      },
    ];
    const doc = buildStoryboardDoc({ docId: 'd', title: 't', frames: dup, preset: STORYBOARD_PRESETS.landscape });
    const ids = doc.tracks.flatMap((t) => t.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('빈 콘티는 아이템 없이 문서만 세운다', () => {
    const ops = buildStoryboardOps({ frames: [], title: 't', preset: STORYBOARD_PRESETS.landscape });
    expect(ops.filter((o) => o.op === 'addItem')).toEqual([]);
    const doc = buildStoryboardDoc({ docId: 'd', title: 't', frames: [], preset: STORYBOARD_PRESETS.landscape });
    expect(resolveTimeline(doc).duration).toBe(0);
  });

  it('웹툰 판형은 판넬을 위에 두고 아래에 인쇄 자리를 남긴다', () => {
    const toon = storyboardLayout(STORYBOARD_PRESETS.webtoon);
    const tall = storyboardLayout(STORYBOARD_PRESETS.portrait);
    expect(toon.action).not.toBeNull();
    expect(tall.action).toBeNull();
    expect(toon.panel.y).toBeLessThan(STORYBOARD_PRESETS.webtoon.output.height / 2);
    expect((toon.action?.y ?? 0)).toBeGreaterThan(toon.panel.y + toon.panel.height);
  });

  it('판넬은 프리셋과 무관하게 320×180 비율을 지킨다', () => {
    for (const preset of [STORYBOARD_PRESETS.landscape, STORYBOARD_PRESETS.portrait, STORYBOARD_PRESETS.webtoon]) {
      const { panel } = storyboardLayout(preset);
      expect(panel.width / panel.height).toBeCloseTo(320 / 180, 1);
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(preset.output.width);
      expect(panel.y + panel.height).toBeLessThanOrEqual(preset.output.height);
    }
  });
});
