import { describe, expect, it } from 'vitest';
import { createEmptyDoc, type VideoAsset, type VideoChapter, type VideoDoc } from '@vibisual/video';
import { activeFocusOf, projectRelativeAssetPath, videoDocLinkedItems } from './videoLinkedItems.js';

/**
 * §5.4 #36 (H) ③ — 영상 노드의 "연결된 것": 장면(시간 순 번호 · 단계 · AI 가 만지는 것) → 소재(코드가 먼저).
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

describe('§5.4 #36 (H) ③ 영상 — 장면', () => {
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

  it('AI 가 지금 만지는 장면만 숨 쉰다', () => {
    const items = videoDocLinkedItems(doc([chapter('a'), chapter('b')], []), 'b');
    expect(items.map((i) => i.active === true)).toEqual([false, true]);
  });
});

describe('§5.4 #36 (H) ③ 영상 — 소재', () => {
  it('코드(컴포지션)가 먼저, 그다음 그림·영상·소리·글꼴', () => {
    const items = videoDocLinkedItems(doc([], [
      asset('f', 'font', 'fonts/a.ttf'),
      asset('s', 'audio', 'audio/bgm.mp3'),
      asset('i', 'image', 'img/logo.png'),
      asset('c', 'composition', 'compositions/intro/index.html'),
      asset('v', 'video', 'clips/a.mp4'),
    ]));
    expect(items.map((i) => i.kind)).toEqual(['code', 'image', 'video', 'audio', 'font']);
    expect(items.every((i) => i.group === 'part')).toBe(true);
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
