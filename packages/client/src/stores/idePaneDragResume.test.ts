import { describe, it, expect, beforeEach } from 'vitest';
import {
  PANE_DRAG_RESUME_TTL_MS,
  clearPaneDragResume,
  putPaneDragResume,
  takePaneDragResume,
} from './idePaneDragResume.js';

// SCENARIO.md §5.5 #17-6 (H-4) ③ — 밖에서 끌던 창이 앱 안으로 돌아올 때 **드래그를 이어받는**
// 짐. 창을 띄우지 않고 확인해야 하는 규칙 넷: 비율로 접기 · 한 번만 꺼내기 · 남의 것은 안 건드리기 ·
// 시한 지나면 걷기.

describe('idePaneDragResume — 오가는 드래그를 잇는 짐', () => {
  beforeEach(() => clearPaneDragResume());

  it('잡은 지점을 **비율**로 접는다 — 창 크기가 달라져도 손 아래 그대로 있게', () => {
    const r = putPaneDragResume({ agentId: 'a1', grabX: 200, grabY: 20, width: 800, height: 600 }, 1000);
    expect(r.grabRatioX).toBeCloseTo(0.25);
    expect(r.grabRatioY).toBeCloseTo(20 / 600);
  });

  it('크기가 0 이면 비율을 낼 수 없다 — 위쪽 가운데로 둔다(NaN 자리 ❌)', () => {
    const r = putPaneDragResume({ agentId: 'a1', grabX: 10, grabY: 10, width: 0, height: 0 }, 1000);
    expect(r.grabRatioX).toBe(0.5);
    expect(r.grabRatioY).toBe(0);
    expect(Number.isFinite(r.grabRatioX)).toBe(true);
  });

  it('창 밖을 가리키는 값은 0~1 안으로 접는다', () => {
    const r = putPaneDragResume({ agentId: 'a1', grabX: 9999, grabY: -50, width: 800, height: 600 }, 1000);
    expect(r.grabRatioX).toBe(1);
    expect(r.grabRatioY).toBe(0);
  });

  it('한 번 꺼내면 사라진다 — 같은 짐을 두 창이 나눠 쓰면 둘 다 커서를 따라다닌다', () => {
    putPaneDragResume({ agentId: 'a1', grabX: 100, grabY: 10, width: 400, height: 300 }, 1000);
    expect(takePaneDragResume('a1', 1000)?.agentId).toBe('a1');
    expect(takePaneDragResume('a1', 1000)).toBeNull();
  });

  it('남의 짐은 건드리지 않는다 — 주인이 오면 그대로 받는다', () => {
    putPaneDragResume({ agentId: 'a1', grabX: 100, grabY: 10, width: 400, height: 300 }, 1000);
    expect(takePaneDragResume('a2', 1000)).toBeNull();
    expect(takePaneDragResume('a1', 1000)?.width).toBe(400);
  });

  it('시한이 지나면 걷는다 — 한참 뒤에 연 창이 누르지도 않은 드래그를 이어받지 않게', () => {
    putPaneDragResume({ agentId: 'a1', grabX: 100, grabY: 10, width: 400, height: 300 }, 1000);
    expect(takePaneDragResume('a1', 1000 + PANE_DRAG_RESUME_TTL_MS + 1)).toBeNull();
    // 걷은 뒤에는 시각을 되돌려도 남아 있지 않다.
    expect(takePaneDragResume('a1', 1000)).toBeNull();
  });

  it('시한 안이면 그대로 받는다', () => {
    putPaneDragResume({ agentId: 'a1', grabX: 100, grabY: 10, width: 400, height: 300 }, 1000);
    expect(takePaneDragResume('a1', 1000 + PANE_DRAG_RESUME_TTL_MS)).not.toBeNull();
  });

  it('커서 화면 좌표를 함께 싣는다 — 돌아온 창이 첫 이동을 기다리지 않고 손 아래에 앉게', () => {
    const r = putPaneDragResume(
      { agentId: 'a1', grabX: 100, grabY: 10, width: 400, height: 300, cursor: { x: 1520, y: 640 } },
      1000,
    );
    expect(r.cursor).toEqual({ x: 1520, y: 640 });
  });

  it('커서를 못 받았거나 숫자가 아니면 null — 그때는 첫 이동이 자리를 잡는다', () => {
    expect(putPaneDragResume({ agentId: 'a1', grabX: 0, grabY: 0, width: 400, height: 300 }, 1000).cursor).toBeNull();
    expect(
      putPaneDragResume(
        { agentId: 'a1', grabX: 0, grabY: 0, width: 400, height: 300, cursor: { x: Number.NaN, y: 3 } },
        1000,
      ).cursor,
    ).toBeNull();
  });

  it('맡긴 적 없으면 null — 아무 일도 일어나지 않는다', () => {
    expect(takePaneDragResume('a1', 1000)).toBeNull();
  });
});
