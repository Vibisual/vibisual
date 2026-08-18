import { describe, expect, it } from 'vitest';

import { describeSelection, selectRenderBackend, type BackendProbe } from './backend.js';

const ok = (id: BackendProbe['id']): BackendProbe => ({ id, available: true });
const no = (id: BackendProbe['id'], reason: string): BackendProbe => ({ id, available: false, reason });

describe('selectRenderBackend — 자동 선택', () => {
  it('전부 쓸 수 있으면 가장 좋은 것을 고른다', () => {
    const s = selectRenderBackend([ok('html-in-canvas'), ok('offscreen-capture'), ok('canvas2d')]);
    expect(s?.chosen).toBe('html-in-canvas');
    expect(s?.downgraded).toBe(false);
  });

  it('실험 API 가 막히면 확실한 폴백으로 내려간다', () => {
    const s = selectRenderBackend([
      no('html-in-canvas', '플래그가 꺼져 있습니다.'),
      ok('offscreen-capture'),
      ok('canvas2d'),
    ]);
    expect(s?.chosen).toBe('offscreen-capture');
    expect(s?.downgraded).toBe(true);
    expect(s?.skipped[0]?.reason).toBe('플래그가 꺼져 있습니다.');
  });

  it('둘이 막히면 마지막 자리까지 내려간다', () => {
    const s = selectRenderBackend([
      no('html-in-canvas', 'a'),
      no('offscreen-capture', 'b'),
      ok('canvas2d'),
    ]);
    expect(s?.chosen).toBe('canvas2d');
    expect(s?.skipped.map((x) => x.id)).toEqual(['html-in-canvas', 'offscreen-capture']);
  });

  it('하나도 못 쓰면 null — 반쯤 된 영상을 내놓지 않는다', () => {
    const s = selectRenderBackend([no('html-in-canvas', 'a'), no('offscreen-capture', 'b'), no('canvas2d', 'c')]);
    expect(s).toBeNull();
  });

  it('탐지 결과가 아예 없어도 멈추지 않고 null 을 준다', () => {
    expect(selectRenderBackend([])).toBeNull();
  });
});

describe('selectRenderBackend — 사용자가 지정했을 때', () => {
  it('지정한 것을 쓸 수 있으면 순위를 무시하고 그것을 쓴다', () => {
    const s = selectRenderBackend([ok('html-in-canvas'), ok('canvas2d')], 'canvas2d');
    expect(s?.chosen).toBe('canvas2d');
    expect(s?.downgraded).toBe(false);
    expect(s?.requested).toBe('canvas2d');
  });

  it('지정한 것이 막히면 강등으로 표시한다 (조용히 바꾸지 않는다)', () => {
    const s = selectRenderBackend([no('html-in-canvas', '플래그 꺼짐'), ok('canvas2d')], 'html-in-canvas');
    expect(s?.chosen).toBe('canvas2d');
    expect(s?.downgraded).toBe(true);
    expect(s?.requested).toBe('html-in-canvas');
  });

  it('지정한 것을 두 번 세지 않는다', () => {
    const s = selectRenderBackend(
      [no('html-in-canvas', 'x'), no('offscreen-capture', 'y'), ok('canvas2d')],
      'html-in-canvas',
    );
    expect(s?.skipped.filter((x) => x.id === 'html-in-canvas')).toHaveLength(1);
  });
});

describe('describeSelection', () => {
  it('강등이 아니면 방식만 알린다', () => {
    const s = selectRenderBackend([ok('html-in-canvas')]);
    expect(s && describeSelection(s)).toContain('html-in-canvas');
  });

  it('강등이면 못 쓴 이유를 함께 알린다', () => {
    const s = selectRenderBackend([no('html-in-canvas', '플래그 꺼짐'), ok('canvas2d')]);
    const text = s ? describeSelection(s) : '';
    expect(text).toContain('내렸습니다');
    expect(text).toContain('플래그 꺼짐');
  });
});
