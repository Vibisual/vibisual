/**
 * §5.5 #17-17 ⑪(i) — **무대 세 칸의 규약**을 못 박는 시험.
 *
 * 여기서 지키는 것은 두 가지다. ⓐ 에이전트가 보낸 값이 화면 속성으로 그대로 새어 들어가지 않는다
 * (글리프와 같은 규율을 장면 그림·골격·한 줄에도 그대로 적용한다). ⓑ **우리가 심는 카드의 그림이
 * 실제로 그려진다** — 씨앗·시작 카드의 path 에 오타가 하나 있으면 그 카드만 조용히 빈 칸이 되고,
 * 화면으로는 "왜 이 종류만 아이콘이 없지"로만 보인다.
 */
import { describe, it, expect } from 'vitest';
import {
  VISUAL_KIND_SEEDS,
  VISUAL_KIND_STARTERS,
  VISUAL_KIND_SURFACES,
  VISUAL_SCENE_PATHS_MAX,
  VISUAL_KIND_BLURB_MAX,
  sanitizeGlyphPath,
  sanitizeScenePaths,
  normalizeKindSurface,
  sanitizeKindBlurb,
} from '@vibisual/shared';

describe('⑪(i) 우리가 심는 카드는 실제로 그려진다', () => {
  const all = [...VISUAL_KIND_SEEDS, ...VISUAL_KIND_STARTERS];

  it('씨앗·시작 카드의 글리프가 전부 검증을 통과한다', () => {
    for (const card of all) {
      expect(sanitizeGlyphPath(card.glyph), `${card.key} 의 glyph`).toBe(card.glyph);
    }
  });

  it('장면 그림 path 도 전부 통과하고 상한을 넘지 않는다', () => {
    for (const card of all) {
      if (!card.scene) continue;
      expect(card.scene.length, `${card.key} 의 scene 개수`).toBeLessThanOrEqual(VISUAL_SCENE_PATHS_MAX);
      expect(sanitizeScenePaths(card.scene), `${card.key} 의 scene`).toEqual(card.scene);
    }
  });

  it('고른 화면 골격이 전부 아는 값이다', () => {
    for (const card of all) {
      if (!card.surface || card.surface === 'none') continue;
      expect(VISUAL_KIND_SURFACES, `${card.key} 의 surface`).toContain(card.surface);
    }
  });

  it('뿌리 씨앗은 셋이고, 시작 카드와 키가 겹치지 않는다', () => {
    expect(VISUAL_KIND_SEEDS.map((s) => s.key)).toEqual(['locate', 'change', 'verify']);
    const seedKeys = new Set(VISUAL_KIND_SEEDS.map((s) => s.key));
    for (const starter of VISUAL_KIND_STARTERS) {
      expect(seedKeys.has(starter.key), `${starter.key} 가 씨앗과 겹친다`).toBe(false);
    }
  });

  it('사용자가 예로 든 git·github 이 시작 카드에 있다', () => {
    const keys = VISUAL_KIND_STARTERS.map((s) => s.key);
    expect(keys).toContain('git');
    expect(keys).toContain('github');
  });
});

describe('⑪(i) sanitizeScenePaths — 깨진 것만 버리고 카드는 남는다', () => {
  it('배열이 아니면 없는 것으로 본다', () => {
    expect(sanitizeScenePaths('M0 0L1 1')).toBeUndefined();
    expect(sanitizeScenePaths(undefined)).toBeUndefined();
    expect(sanitizeScenePaths({})).toBeUndefined();
  });

  it('문법을 벗어난 path 만 버리고 나머지는 살린다', () => {
    const out = sanitizeScenePaths(['M0 0L10 10', 'url(javascript:alert(1))', 'M5 5h10']);
    expect(out).toEqual(['M0 0L10 10', 'M5 5h10']);
  });

  it('전부 깨졌으면 undefined — 그래도 카드를 만드는 것은 호출부의 몫이다', () => {
    expect(sanitizeScenePaths(['<script>', '../../etc/passwd'])).toBeUndefined();
  });

  it('개수 상한을 넘으면 앞에서부터 상한까지만 남긴다', () => {
    const many = Array.from({ length: VISUAL_SCENE_PATHS_MAX + 5 }, (_, i) => `M0 0L${i + 1} 1`);
    const out = sanitizeScenePaths(many);
    expect(out).toHaveLength(VISUAL_SCENE_PATHS_MAX);
    expect(out?.[0]).toBe('M0 0L1 1');
  });

  it('명령 문자가 없는 숫자 나열은 path 가 아니다', () => {
    expect(sanitizeScenePaths(['12 34 56'])).toBeUndefined();
  });
});

describe('⑪(i) normalizeKindSurface — 아는 골격만 통과한다', () => {
  it('아는 값은 그대로', () => {
    expect(normalizeKindSurface('diff')).toBe('diff');
    expect(normalizeKindSurface('log')).toBe('log');
  });

  it("'none' 과 모르는 값은 똑같이 없는 것으로 접힌다", () => {
    expect(normalizeKindSurface('none')).toBeUndefined();
    expect(normalizeKindSurface('unreal')).toBeUndefined();
    expect(normalizeKindSurface(42)).toBeUndefined();
    expect(normalizeKindSurface(undefined)).toBeUndefined();
  });
});

describe('⑪(i) sanitizeKindBlurb — 한 줄로 접고 자른다', () => {
  it('줄바꿈·연속 공백을 한 칸으로 접는다', () => {
    expect(sanitizeKindBlurb('변경분을\n\n  살펴봅니다')).toBe('변경분을 살펴봅니다');
  });

  it('빈 문자열·공백뿐이면 없는 것으로 본다', () => {
    expect(sanitizeKindBlurb('   \n ')).toBeUndefined();
    expect(sanitizeKindBlurb(123)).toBeUndefined();
  });

  it('상한을 넘으면 자른다', () => {
    const long = 'a'.repeat(VISUAL_KIND_BLURB_MAX + 50);
    expect(sanitizeKindBlurb(long)).toHaveLength(VISUAL_KIND_BLURB_MAX);
  });
});
