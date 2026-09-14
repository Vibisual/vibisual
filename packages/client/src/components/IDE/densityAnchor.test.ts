import { describe, expect, it } from 'vitest';

import {
  DENSITY_ANCHOR_MAX,
  densityAnchorAliases,
  pickDensityAnchorEntries,
  resolveDensityAnchor,
  sessionSnapshotKey,
} from './densityAnchor.js';

/**
 * §5.5 #17-12 — 표시 밀도(간결/표준/원문)를 오가도 **보던 자리**가 남는지 못 박는다.
 * 종전엔 위로 올려 읽던 화면에서 밀도를 바꾸면 화면이 튀고, 튄 자리가 바닥 가까이면 추종이 다시 켜져
 * 최신으로 끌려 내려갔다 — 사용자에게는 읽던 과거 대화가 사라진 것으로 보였다.
 */
describe('densityAnchorAliases', () => {
  it('원문의 도구 id 는 표준의 묶음 id 를 함께 부른다', () => {
    expect(densityAnchorAliases('tool-1')).toEqual(['tool-1', 'toolgroup-tool-1']);
  });

  it('묶음 id 는 첫 도구 id 를 함께 부른다', () => {
    expect(densityAnchorAliases('toolgroup-tool-1')).toEqual(['toolgroup-tool-1', 'tool-1']);
  });
});

describe('resolveDensityAnchor', () => {
  it('새 목록에 없는 항목(간결이 뺀 도구)은 건너뛰고 다음 항목을 잡는다', () => {
    const present = new Map([['text-2', 7]]);
    const found = resolveDensityAnchor(
      [{ id: 'tool-1', offset: -40 }, { id: 'text-2', offset: 120 }],
      (id) => present.get(id),
    );
    expect(found).toEqual({ entry: { id: 'text-2', offset: 120 }, id: 'text-2', hit: 7 });
  });

  it('순번 0 도 찾은 것으로 친다', () => {
    const found = resolveDensityAnchor([{ id: 'a', offset: 0 }], (id) => (id === 'a' ? 0 : null));
    expect(found?.hit).toBe(0);
  });

  it('원문→표준: 도구가 묶음으로 접혀도 그 묶음에 붙는다', () => {
    const found = resolveDensityAnchor([{ id: 'tool-1', offset: 30 }], (id) => (id === 'toolgroup-tool-1' ? 3 : null));
    expect(found).toEqual({ entry: { id: 'tool-1', offset: 30 }, id: 'toolgroup-tool-1', hit: 3 });
  });

  it('표준→원문: 묶음이 풀려도 첫 도구에 붙는다', () => {
    const found = resolveDensityAnchor([{ id: 'toolgroup-tool-1', offset: 30 }], (id) => (id === 'tool-1' ? 5 : null));
    expect(found?.id).toBe('tool-1');
    expect(found?.hit).toBe(5);
  });

  it('하나도 없으면 null', () => {
    expect(resolveDensityAnchor([{ id: 'x', offset: 0 }], () => undefined)).toBeNull();
    expect(resolveDensityAnchor([], () => 1)).toBeNull();
  });
});

describe('pickDensityAnchorEntries', () => {
  it('윗변 위로 지나간 항목은 빼고, 걸쳐 있는 항목은 음수 위치로 적는다', () => {
    const entries = pickDensityAnchorEntries(
      [
        { id: 'gone', top: -300, bottom: -10 },
        { id: 'edge', top: -20, bottom: 0 },
        { id: 'half', top: -50, bottom: 40 },
        { id: 'in', top: 40, bottom: 200 },
      ],
      600,
    );
    expect(entries).toEqual([{ id: 'half', offset: -50 }, { id: 'in', offset: 40 }]);
  });

  it('화면 아래로 벗어나면 멈춘다', () => {
    const entries = pickDensityAnchorEntries(
      [
        { id: 'a', top: 0, bottom: 300 },
        { id: 'b', top: 300, bottom: 600 },
        { id: 'below', top: 600, bottom: 900 },
      ],
      600,
    );
    expect(entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('상한만큼만 적는다', () => {
    const rects = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, top: i, bottom: i + 1 }));
    expect(pickDensityAnchorEntries(rects, 1000)).toHaveLength(DENSITY_ANCHOR_MAX);
    expect(pickDensityAnchorEntries(rects, 1000, 3)).toHaveLength(3);
  });
});

describe('sessionSnapshotKey', () => {
  it('같은 세션도 밀도가 다르면 다른 스냅샷이다 — 남의 목록 좌표로 복원하지 않게', () => {
    expect(sessionSnapshotKey('agent/sub', 'compact')).not.toBe(sessionSnapshotKey('agent/sub', 'raw'));
    expect(sessionSnapshotKey('agent/sub', 'standard')).toBe(sessionSnapshotKey('agent/sub', 'standard'));
  });
});
