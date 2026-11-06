import { describe, expect, it } from 'vitest';
import { createEmptyDoc, type VideoAsset, type VideoChapter, type VideoDoc } from '@vibisual/video';
import { activeFocusOf, projectRelativeAssetPath, videoDocLinkedItems } from './videoLinkedItems.js';

/**
 * §5.4 #36 (J) ⑤ — 영상 노드의 "연결된 것": 장면 알약(시간 순 · 단계 · 대표 프레임 · 바뀐 장면 · AI 가 만지는 것 · 한 번 누르면 화면에)
 * → 소재(눈에 보이는 것이 먼저, 움직임 코드는 맨 뒤).
 */

function chapter(id: string, extra: Partial<VideoChapter> = {}): VideoChapter {
  return { id, title: id.toUpperCase(), duration: 3, status: 'plan', ...extra };
}

function asset(id: string, kind: VideoAsset['kind'], path?: string): VideoAsset {
  return path === undefined
    ? { id, kind, source: { kind: 'external', command: 'tts', output: 'tts/out.wav' } }
    : { id, kind, source: { kind: 'file', path } };
}

function doc(chapters: VideoChapter[], assets: VideoAsset[]): VideoDoc {
  const base = createEmptyDoc('d1', 'Doc', 1);
  return { ...base, chapters, assets: Object.fromEntries(assets.map((a) => [a.id, a])) };
}

describe('§5.4 #36 (J) ⑤ 영상 — 장면 알약', () => {
  it('문서 순서가 곧 번호이고, 단계는 테의 말로 옮긴다', () => {
    const items = videoDocLinkedItems(doc([
      chapter('intro', { status: 'done' }),
      chapter('problem', { status: 'building' }),
      chapter('fix', { status: 'approved' }),
      chapter('end'),
    ], []));
    expect(items.map((i) => [i.id, i.index, i.stage])).toEqual([
      ['scene:intro', 1, 'done'],
      ['scene:problem', 2, 'building'],
      ['scene:fix', 3, 'ready'],
      ['scene:end', 4, 'plan'],
    ]);
    expect(items.every((i) => i.group === 'scene' && i.kind === 'scene')).toBe(true);
    expect(items[0]?.durationSec).toBe(3);
  });

  it('장면은 알약이고 한 번 누르면 노드 화면에 간다', () => {
    const [item] = videoDocLinkedItems(doc([chapter('a')], []));
    expect(item).toMatchObject({ pill: true, stageFocus: true });
  });

  it('AI 가 지금 만지는 장면만 숨 쉬고, 마지막 바퀴가 바꾼 장면만 점이 찍힌다', () => {
    const items = videoDocLinkedItems(doc([chapter('a'), chapter('b'), chapter('c')], []), { focus: 'b', changed: new Set(['c']) });
    expect(items.map((i) => i.active === true)).toEqual([false, true, false]);
    expect(items.map((i) => i.changed === true)).toEqual([false, false, true]);
  });

  it('대표 프레임은 기억에 있는 것만, 보이는 알약 수까지만 싣는다', () => {
    const items = videoDocLinkedItems(
      doc([chapter('a'), chapter('b'), chapter('c')], []),
      { thumbs: { a: 'data:image/webp;base64,AAA', b: null, c: 'data:image/webp;base64,CCC' }, imageLimit: 2 },
    );
    expect(items.map((i) => i.image)).toEqual(['data:image/webp;base64,AAA', undefined, undefined]);
  });
});

describe('§5.4 #36 (J) ⑤ 영상 — 소재', () => {
  it('눈에 보이는 것이 먼저, 그다음 소리·글꼴, 움직임 코드는 맨 뒤', () => {
    const items = videoDocLinkedItems(doc([], [
      asset('c', 'composition', 'compositions/intro/index.html'),
      asset('f', 'font', 'fonts/a.ttf'),
      asset('s', 'audio', 'audio/bgm.mp3'),
      asset('i', 'image', 'img/logo.png'),
      asset('v', 'video', 'clips/a.mp4'),
    ]));
    expect(items.map((i) => i.kind)).toEqual(['image', 'video', 'audio', 'font', 'code']);
    expect(items.every((i) => i.group === 'part' && i.pill !== true && i.stageFocus !== true)).toBe(true);
  });

  it('이름은 파일 이름, 미리보기 경로는 프로젝트 안 상대 경로일 때만', () => {
    const items = videoDocLinkedItems(doc([], [
      asset('i', 'image', 'img\\logo.png'),
      asset('j', 'image', 'C:/Users/x/pic.png'), // privacy-ok: synthetic absolute path fixture
      asset('k', 'image', '../outside.png'),
      asset('t', 'audio'),
    ]));
    expect(items.map((i) => [i.label, i.file])).toEqual([
      ['logo.png', 'img/logo.png'],
      ['pic.png', undefined],
      ['outside.png', undefined],
      ['t', undefined],
    ]);
  });
});

describe('§5.4 #36 (H) ③ 영상 — 도우미', () => {
  it('상대 경로만 받는다(절대·드라이브·..·빈 값 ❌)', () => {
    expect(projectRelativeAssetPath('./a/b.png')).toBe('a/b.png');
    expect(projectRelativeAssetPath('/abs/b.png')).toBeNull();
    expect(projectRelativeAssetPath('D:\\x.png')).toBeNull();
    expect(projectRelativeAssetPath('a/../b.png')).toBeNull();
    expect(projectRelativeAssetPath('  ')).toBeNull();
  });

  it('열린 바퀴의 초점만 "지금 만지는 것"이다', () => {
    expect(activeFocusOf({ passId: 'p', focus: 'b', at: 1, status: 'open' })).toBe('b');
    expect(activeFocusOf({ passId: 'p', focus: 'b', at: 1, status: 'done' })).toBeUndefined();
    expect(activeFocusOf({ passId: 'p', at: 1, status: 'open' })).toBeUndefined();
    expect(activeFocusOf(null)).toBeUndefined();
  });
});
