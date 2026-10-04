import { describe, it, expect } from 'vitest';
import {
  EMPTY_PROMPT_RAIL_PLACE,
  nearestPromptMarker,
  placePromptRailPopup,
  probePromptPlace,
  promptMarkerRatio,
  promptPreviewText,
  resolvePromptRailPlace,
  samePromptOutline,
  samePromptRailPlace,
  type PromptRailEntry,
} from './promptRail.js';

// §5.5 #17-48 — 내 입력 레일의 판정·배치·생략. DOM 측정은 실제 화면 대신 ViewportItems 로 재현한다.

const items = [
  { id: 'system-0' },
  { id: 'cmd-A' },
  { id: 'text-a1' },
  { id: 'tool-a2' },
  { id: 'cmd-B' },
  { id: 'text-b1' },
  { id: 'cmd-C' },
  { id: 'text-c1' },
];
const isPrompt = (it: { id: string }): boolean => it.id.startsWith('cmd-');
const idOf = (it: { id: string }): string => it.id;

describe('probePromptPlace — 화면 맨 위 항목이 속한 입력', () => {
  it('입력 말풍선 자체가 맨 위면 그 입력에 서 있다', () => {
    expect(probePromptPlace(items, isPrompt, { topId: 'cmd-B', lastVisibleId: 'text-b1', atBottom: false }, idOf))
      .toEqual({ ownerId: 'cmd-B', anchored: true, lastVisibleId: null, atBottom: false });
  });

  it('응답 한복판이 맨 위면 그 턴의 입력이고 서 있지는 않다', () => {
    expect(probePromptPlace(items, isPrompt, { topId: 'tool-a2', lastVisibleId: 'tool-a2', atBottom: false }, idOf))
      .toEqual({ ownerId: 'cmd-A', anchored: false, lastVisibleId: null, atBottom: false });
  });

  it('첫 입력보다 위(세션 서두)면 입력이 없다 — 첫 입력으로 뭉개지 않는다', () => {
    expect(probePromptPlace(items, isPrompt, { topId: 'system-0', lastVisibleId: 'text-a1', atBottom: false }, idOf))
      .toEqual({ ownerId: null, anchored: false, lastVisibleId: 'cmd-A', atBottom: false });
  });

  it('맨 위보다 아래로 화면 안에 들어온 마지막 입력을 함께 준다', () => {
    expect(probePromptPlace(items, isPrompt, { topId: 'text-a1', lastVisibleId: 'text-c1', atBottom: true }, idOf))
      .toEqual({ ownerId: 'cmd-A', anchored: false, lastVisibleId: 'cmd-C', atBottom: true });
  });

  it('맨 위 항목 자신은 "더 뒤에 보이는 입력"으로 세지 않는다', () => {
    expect(probePromptPlace(items, isPrompt, { topId: 'cmd-C', lastVisibleId: 'cmd-C', atBottom: true }, idOf)?.lastVisibleId)
      .toBeNull();
  });

  it('측정과 데이터가 어긋난 프레임(맨 위 항목이 배열에 없음)은 null — 앞 판정을 유지하게', () => {
    expect(probePromptPlace(items, isPrompt, { topId: 'text-gone', lastVisibleId: null, atBottom: false }, idOf)).toBeNull();
    expect(probePromptPlace(items, isPrompt, { topId: null, lastVisibleId: null, atBottom: false }, idOf)).toBeNull();
  });
});

describe('resolvePromptRailPlace — 지금 자리와 [이전]·[다음]의 행선지', () => {
  const base = { count: 5, owner: 2, anchored: false, lastVisible: -1, atBottom: false, held: -1 };

  it('응답 중간이면 [이전]은 지금 턴의 입력, [다음]은 다음 입력 (미디어 플레이어의 "이전")', () => {
    expect(resolvePromptRailPlace(base)).toEqual({ current: 2, anchored: false, prev: 2, next: 3 });
  });

  it('입력에 서 있으면 [이전]은 앞 입력', () => {
    expect(resolvePromptRailPlace({ ...base, anchored: true })).toEqual({ current: 2, anchored: true, prev: 1, next: 3 });
  });

  it('첫 입력보다 위면 [이전]은 없고 [다음]은 첫 입력', () => {
    expect(resolvePromptRailPlace({ ...base, owner: -1 })).toEqual({ current: -1, anchored: false, prev: null, next: 0 });
  });

  it('첫 입력에 서 있으면 [이전]은 없다 · 마지막 입력이면 [다음]은 없다', () => {
    expect(resolvePromptRailPlace({ ...base, owner: 0, anchored: true }).prev).toBeNull();
    expect(resolvePromptRailPlace({ ...base, owner: 4 }).next).toBeNull();
  });

  it('바닥에 닿았는데 더 뒤의 입력이 보이면 그 입력이 지금 자리 — [다음]이 헛돌지 않는다', () => {
    expect(resolvePromptRailPlace({ ...base, owner: 2, lastVisible: 4, atBottom: true }))
      .toEqual({ current: 4, anchored: true, prev: 3, next: null });
  });

  it('바닥이 아니면 화면 안의 뒤 입력은 자리를 바꾸지 않는다(그 입력은 맨 위로 올라올 수 있다)', () => {
    expect(resolvePromptRailPlace({ ...base, owner: 2, lastVisible: 4, atBottom: false }))
      .toEqual({ current: 2, anchored: false, prev: 2, next: 3 });
  });

  it('레일로 옮겨 붙든 자리가 측정보다 먼저다 — 바닥 가까운 입력에서 [다음]이 같은 입력으로 되돌아가지 않는다', () => {
    // 3 번으로 옮겼지만 바닥이라 맨 위까지 못 올라와, 재 보면 2 번 턴의 응답이 맨 위에 있다.
    expect(resolvePromptRailPlace({ ...base, owner: 2, held: 3, lastVisible: 4, atBottom: true }))
      .toEqual({ current: 3, anchored: true, prev: 2, next: 4 });
  });

  it('붙든 자리가 목록 밖이면(입력이 사라짐) 무시한다', () => {
    expect(resolvePromptRailPlace({ ...base, held: 9 })).toEqual({ current: 2, anchored: false, prev: 2, next: 3 });
  });

  it('입력이 없으면 빈 자리', () => {
    expect(resolvePromptRailPlace({ ...base, count: 0 })).toBe(EMPTY_PROMPT_RAIL_PLACE);
  });

  it('측정이 목록보다 크게 나와도 마지막 입력으로 접는다', () => {
    expect(resolvePromptRailPlace({ ...base, owner: 7 }).current).toBe(4);
  });
});

describe('samePromptRailPlace · samePromptOutline — 같으면 다시 그리지 않는다', () => {
  it('자리 비교', () => {
    expect(samePromptRailPlace({ current: 1, anchored: true, prev: 0, next: 2 }, { current: 1, anchored: true, prev: 0, next: 2 })).toBe(true);
    expect(samePromptRailPlace({ current: 1, anchored: true, prev: 0, next: 2 }, { current: 1, anchored: false, prev: 1, next: 2 })).toBe(false);
  });

  it('입력 목록 비교 — id · 글 · 시각이 모두 같아야 같다', () => {
    const a: PromptRailEntry[] = [{ id: 'cmd-A', text: 'hi', at: 1 }];
    expect(samePromptOutline(a, [{ id: 'cmd-A', text: 'hi', at: 1 }])).toBe(true);
    expect(samePromptOutline(a, [{ id: 'cmd-A', text: 'hi!', at: 1 }])).toBe(false);
    expect(samePromptOutline(a, [{ id: 'cmd-A', text: 'hi', at: 2 }])).toBe(false);
    expect(samePromptOutline(a, [])).toBe(false);
  });
});

describe('눈금 배치 — 순번으로 고르게, 포인터는 가장 가까운 눈금', () => {
  it('눈금은 칸 한가운데에 선다', () => {
    expect(promptMarkerRatio(0, 1)).toBe(0.5);
    expect(promptMarkerRatio(0, 4)).toBe(0.125);
    expect(promptMarkerRatio(3, 4)).toBe(0.875);
  });

  it('포인터 높이에서 가장 가까운 눈금 — 양 끝 밖은 끝 눈금으로 접는다', () => {
    expect(nearestPromptMarker(0, 4)).toBe(0);
    expect(nearestPromptMarker(0.26, 4)).toBe(1);
    expect(nearestPromptMarker(0.99, 4)).toBe(3);
    expect(nearestPromptMarker(1.5, 4)).toBe(3);
    expect(nearestPromptMarker(-0.2, 4)).toBe(0);
  });

  it('눈금이 수백 개여도 칸으로 고른다 — 1px 눈금을 겨눌 필요가 없다', () => {
    for (let i = 0; i < 500; i += 37) expect(nearestPromptMarker(promptMarkerRatio(i, 500), 500)).toBe(i);
  });

  it('눈금이 없으면 -1', () => {
    expect(nearestPromptMarker(0.5, 0)).toBe(-1);
  });
});

describe('promptPreviewText — 길면 일부 생략', () => {
  it('짧은 글은 그대로', () => {
    expect(promptPreviewText('로그인 버튼 고쳐줘')).toEqual({ text: '로그인 버튼 고쳐줘', clipped: false });
  });

  it('글자 상한을 넘으면 잘라 … 을 붙인다', () => {
    const r = promptPreviewText('가'.repeat(400), 320, 8);
    expect(r.clipped).toBe(true);
    expect(r.text).toBe(`${'가'.repeat(320)}…`);
  });

  it('줄 상한을 넘으면 그 뒤 줄을 버린다 — 줄바꿈은 살린다', () => {
    const r = promptPreviewText(['1', '2', '3', '4'].join('\n'), 320, 2);
    expect(r).toEqual({ text: '1\n2…', clipped: true });
  });

  it('CRLF·줄 끝 공백·긴 빈 줄을 접는다', () => {
    expect(promptPreviewText('a  \r\n\r\n\r\n\r\nb\t').text).toBe('a\n\nb');
  });

  it('서로게이트 쌍 한가운데서 자르지 않는다', () => {
    const r = promptPreviewText('ab😀cd', 3, 8);
    expect(r.text).toBe('ab…');
  });
});

describe('placePromptRailPopup — 레일 왼쪽, 화면 안으로', () => {
  const viewport = { width: 1200, height: 800 };

  it('기준점 왼쪽에 서고 세로 가운데를 맞춘다', () => {
    expect(placePromptRailPopup({ left: 1100, centerY: 400 }, { width: 300, height: 100 }, viewport, 10, 8))
      .toEqual({ left: 790, top: 350 });
  });

  it('위·아래로 넘치면 화면 안으로 당긴다', () => {
    expect(placePromptRailPopup({ left: 1100, centerY: 10 }, { width: 300, height: 100 }, viewport, 10, 8).top).toBe(8);
    expect(placePromptRailPopup({ left: 1100, centerY: 790 }, { width: 300, height: 100 }, viewport, 10, 8).top).toBe(692);
  });

  it('왼쪽이 모자라면 화면 왼쪽 여백에 붙인다', () => {
    expect(placePromptRailPopup({ left: 120, centerY: 400 }, { width: 300, height: 100 }, viewport, 10, 8).left).toBe(8);
  });

  it('상자가 화면보다 크면 왼쪽·위 여백에 붙인다', () => {
    expect(placePromptRailPopup({ left: 100, centerY: 400 }, { width: 2000, height: 2000 }, viewport, 10, 8))
      .toEqual({ left: 8, top: 8 });
  });
});
