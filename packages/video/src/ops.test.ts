import { describe, expect, it } from 'vitest';

import { applyPatch, createEmptyDoc } from './ops.js';
import type { VideoDoc, VideoDocOp, VideoItem } from './types.js';

const base = (): VideoDoc => createEmptyDoc('d1', '테스트', 1000);

function patch(d: VideoDoc, ops: VideoDocOp[], now = 2000) {
  return applyPatch(d, { baseVersion: d.version, ops }, now);
}

const item = (id: string, at: VideoItem['at'] = 0, duration: VideoItem['duration'] = 1): VideoItem => ({
  id,
  kind: 'scene',
  at,
  duration,
});

describe('applyPatch — 낙관적 잠금', () => {
  it('baseVersion 이 맞으면 적용하고 버전을 올린다', () => {
    const d = base();
    const r = patch(d, [{ op: 'addItem', trackId: 'visual', item: item('a') }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.version).toBe(d.version + 1);
    expect(r.doc.updatedAt).toBe(2000);
    expect(r.applied).toBe(1);
  });

  it('그 사이 문서가 바뀌었으면 거절한다 — 조용히 덮어쓰지 않는다', () => {
    const d = base();
    const first = patch(d, [{ op: 'addItem', trackId: 'visual', item: item('a') }]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // 낡은 버전을 들고 온 두 번째 에이전트.
    const stale = applyPatch(first.doc, { baseVersion: d.version, ops: [] });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.reason).toBe('version-conflict');
    expect(stale.currentVersion).toBe(first.doc.version);
  });

  it('원본 문서를 변형하지 않는다', () => {
    const d = base();
    const before = JSON.stringify(d);
    patch(d, [{ op: 'addItem', trackId: 'visual', item: item('a') }]);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('applyPatch — 전부 적용하거나 아무것도 적용하지 않는다', () => {
  it('중간 연산이 실패하면 앞선 연산도 반영되지 않는다', () => {
    const d = base();
    const r = patch(d, [
      { op: 'addItem', trackId: 'visual', item: item('a') },
      { op: 'removeItem', itemId: 'does-not-exist' },
      { op: 'addItem', trackId: 'visual', item: item('c') },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-op');
    expect(r.opIndex).toBe(1);
    // 원본은 그대로 — 'a' 가 새어 들어가지 않았다.
    expect(d.tracks.find((t) => t.id === 'visual')?.items).toHaveLength(0);
  });
});

describe('applyPatch — 아이템 연산', () => {
  it('addItem 은 중복 id 를 거절한다', () => {
    const d = base();
    const first = patch(d, [{ op: 'addItem', trackId: 'visual', item: item('a') }]);
    if (!first.ok) throw new Error('setup failed');
    const r = patch(first.doc, [{ op: 'addItem', trackId: 'audio', item: item('a') }]);
    expect(r.ok).toBe(false);
  });

  it('beforeItemId 로 순서를 지정한다', () => {
    const d = base();
    const r = patch(d, [
      { op: 'addItem', trackId: 'visual', item: item('a') },
      { op: 'addItem', trackId: 'visual', item: item('b') },
      { op: 'addItem', trackId: 'visual', item: item('mid'), beforeItemId: 'b' },
    ]);
    if (!r.ok) throw new Error('failed');
    expect(r.doc.tracks.find((t) => t.id === 'visual')?.items.map((i) => i.id)).toEqual(['a', 'mid', 'b']);
  });

  it('updateItem 은 id 를 바꾸지 못한다 (참조가 끊기지 않게)', () => {
    const d = base();
    const added = patch(d, [{ op: 'addItem', trackId: 'visual', item: item('a') }]);
    if (!added.ok) throw new Error('setup failed');
    const r = patch(added.doc, [
      { op: 'updateItem', itemId: 'a', patch: { duration: 9, label: '고침' } as Partial<VideoItem> },
    ]);
    if (!r.ok) throw new Error('failed');
    const updated = r.doc.tracks.find((t) => t.id === 'visual')?.items[0];
    expect(updated?.id).toBe('a');
    expect(updated?.duration).toBe(9);
    expect(updated?.label).toBe('고침');
  });

  it('moveItem 은 트랙을 옮기고 순서를 지킨다', () => {
    const d = base();
    const setup = patch(d, [
      { op: 'addItem', trackId: 'visual', item: item('a') },
      { op: 'addItem', trackId: 'audio', item: item('x') },
      { op: 'addItem', trackId: 'audio', item: item('y') },
    ]);
    if (!setup.ok) throw new Error('setup failed');

    const r = patch(setup.doc, [{ op: 'moveItem', itemId: 'a', toTrackId: 'audio', beforeItemId: 'y' }]);
    if (!r.ok) throw new Error('failed');
    expect(r.doc.tracks.find((t) => t.id === 'visual')?.items).toHaveLength(0);
    expect(r.doc.tracks.find((t) => t.id === 'audio')?.items.map((i) => i.id)).toEqual(['x', 'a', 'y']);
  });

  it('removeItem 은 그 아이템만 지운다', () => {
    const d = base();
    const setup = patch(d, [
      { op: 'addItem', trackId: 'visual', item: item('a') },
      { op: 'addItem', trackId: 'visual', item: item('b') },
    ]);
    if (!setup.ok) throw new Error('setup failed');
    const r = patch(setup.doc, [{ op: 'removeItem', itemId: 'a' }]);
    if (!r.ok) throw new Error('failed');
    expect(r.doc.tracks.find((t) => t.id === 'visual')?.items.map((i) => i.id)).toEqual(['b']);
  });
});

describe('applyPatch — 트랙과 소재', () => {
  it('addTrack 은 중복 트랙 id 를 거절한다', () => {
    const d = base();
    const r = patch(d, [{ op: 'addTrack', track: { id: 'visual', kind: 'visual', items: [] } }]);
    expect(r.ok).toBe(false);
  });

  it('addTrack 이 실어 오는 아이템 id 가 기존과 겹치면 거절한다', () => {
    const d = base();
    const setup = patch(d, [{ op: 'addItem', trackId: 'visual', item: item('a') }]);
    if (!setup.ok) throw new Error('setup failed');
    const r = patch(setup.doc, [
      { op: 'addTrack', track: { id: 'extra', kind: 'visual', items: [item('a')] } },
    ]);
    expect(r.ok).toBe(false);
  });

  it('setAsset 은 추가와 교체를 모두 한다', () => {
    const d = base();
    const r = patch(d, [
      { op: 'setAsset', asset: { id: 'v1', kind: 'audio', source: { kind: 'file', path: 'a.wav' } } },
      { op: 'setAsset', asset: { id: 'v1', kind: 'audio', source: { kind: 'file', path: 'a.wav' }, duration: 3 } },
    ]);
    if (!r.ok) throw new Error('failed');
    expect(r.doc.assets['v1']?.duration).toBe(3);
  });

  it('removeAsset 은 없는 것을 거절한다', () => {
    const r = patch(base(), [{ op: 'removeAsset', assetId: 'nope' }]);
    expect(r.ok).toBe(false);
  });

  it('setDoc 은 제목과 크기를 바꾼다', () => {
    const r = patch(base(), [{ op: 'setDoc', patch: { title: '새 제목', fps: 60 } }]);
    if (!r.ok) throw new Error('failed');
    expect(r.doc.title).toBe('새 제목');
    expect(r.doc.fps).toBe(60);
  });
});

describe('createEmptyDoc', () => {
  it('영상·음성·자막 세 트랙으로 시작한다', () => {
    const d = createEmptyDoc('x', 'y', 5);
    expect(d.tracks.map((t) => t.kind)).toEqual(['visual', 'audio', 'caption']);
    expect(d.version).toBe(1);
    expect(d.createdAt).toBe(5);
  });
});
