import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type PassRecord, type VideoChapter, type VideoDoc } from '@vibisual/video';

import type { DocVersion } from './videoApi.js';

/** §5.4 #36 (J) — 노드 화면과 구슬 줄이 한 기억을 쓴다: 판본만 먼저 묻고, 바뀔 때만 문서·바퀴·시작 판을 다시 읽는다. */

const api = vi.hoisted(() => ({
  version: null as DocVersion | null,
  doc: null as VideoDoc | null,
  passes: [] as PassRecord[],
  start: null as VideoDoc | null,
  calls: { version: 0, doc: 0, passes: 0, start: 0 },
}));

vi.mock('./videoApi.js', () => ({
  readDocVersion: vi.fn(async () => { api.calls.version += 1; if (!api.version) throw new Error('gone'); return api.version; }),
  readDoc: vi.fn(async () => { api.calls.doc += 1; return { doc: api.doc }; }),
}));
vi.mock('./studioApi.js', () => ({
  readPasses: vi.fn(async () => { api.calls.passes += 1; return { passes: api.passes, activity: null }; }),
  readHistoryDoc: vi.fn(async () => { api.calls.start += 1; return api.start; }),
}));

const { __resetGlanceForTest, lastAiVersionOf, peekGlance, refreshGlance, subscribeGlance } = await import('./videoGlance.js');

function chapter(id: string, extra: Partial<VideoChapter> = {}): VideoChapter {
  return { id, title: id, duration: 4, status: 'done', ...extra };
}

function setDoc(version: number, chapters: VideoChapter[]): void {
  const base = createEmptyDoc('d1', 'Doc', 1);
  api.doc = { ...base, version, updatedAt: version * 10, chapters };
  api.version = { id: 'd1', title: 'Doc', version, updatedAt: version * 10, duration: 12, activity: null };
}

describe('§5.4 #36 (J) 훑어보기 공용 기억', () => {
  beforeEach(() => {
    __resetGlanceForTest();
    api.passes = [];
    api.start = null;
    api.calls = { version: 0, doc: 0, passes: 0, start: 0 };
  });
  afterEach(() => vi.clearAllMocks());

  it('판본이 같으면 문서·바퀴를 다시 읽지 않고 같은 결과를 돌려준다', async () => {
    setDoc(3, [chapter('a')]);
    const first = await refreshGlance('P', 'd1');
    const second = await refreshGlance('P', 'd1');
    expect(second).toBe(first);
    expect(api.calls).toMatchObject({ version: 2, doc: 1, passes: 1 });
  });

  it('동시에 두 번 물어도 한 번만 묻는다(노드 화면 + 구슬 줄)', async () => {
    setDoc(3, [chapter('a')]);
    const [a, b] = await Promise.all([refreshGlance('P', 'd1'), refreshGlance('P', 'd1')]);
    expect(a).toBe(b);
    expect(api.calls.version).toBe(1);
  });

  it('바퀴 시작 판과 비교해 바뀐 장면을 낸다 · 구독자를 깨운다', async () => {
    setDoc(2, [chapter('a'), chapter('b')]);
    api.start = { ...api.doc!, version: 1, chapters: [chapter('a'), chapter('b', { title: 'old' })] };
    api.passes = [{ id: 'p1', startedAt: 1, startRev: 'r1', startVersion: 1, status: 'done', versions: [2] }];
    const wake = vi.fn();
    const off = subscribeGlance('P', 'd1', wake);
    const glance = await refreshGlance('P', 'd1');
    off();
    expect(wake).toHaveBeenCalled();
    expect([...(glance?.targets.chapters ?? [])]).toEqual(['b']);
    expect(glance?.lines.length).toBeGreaterThan(0);
    expect(glance).toMatchObject({ byAi: true, lastAiVersion: 2 });
  });

  it('못 읽으면 앞 결과를 지우지 않고 실패만 켠다', async () => {
    setDoc(3, [chapter('a')]);
    const first = await refreshGlance('P', 'd1');
    api.version = null;
    const after = await refreshGlance('P', 'd1');
    expect(after).toBe(first);
    expect(peekGlance('P', 'd1')).toMatchObject({ glance: first, failed: true });
  });

  it('AI 가 낸 마지막 판본 — 사람이 그 뒤에 고친 판은 AI 것이 아니다', () => {
    const passes: PassRecord[] = [
      { id: 'p1', startedAt: 1, startVersion: 1, status: 'done', versions: [2, 3] },
      { id: 'p2', startedAt: 2, startVersion: 5, status: 'done', versions: [6] },
    ];
    expect(lastAiVersionOf(passes, 4)).toBe(3);
    expect(lastAiVersionOf(passes, 6)).toBe(6);
    expect(lastAiVersionOf([], 6)).toBeNull();
  });
});
