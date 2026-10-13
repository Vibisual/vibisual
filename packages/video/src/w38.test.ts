/**
 * §5.13 (W) 38 — AI 제작 품질 보강의 순수 층 시험: 키프레임 · 이펙트 · 자막 파일 · 정지 화면 문서 · 날 비트맵 · 병렬 캡처 ·
 * 창 맞춤 배율 · 자르기/파생이 키프레임을 데려가는지.
 */
import { describe, expect, it } from 'vitest';

import { buildDrawList } from './render/drawList.js';
import { effectsToFilter, vignetteStops } from './render/effects.js';
import { bitmapOrderOf, rawToStraightRgba, isRawFrame, type RawFrame } from './render/rawFrame.js';
import { PooledCaptureBackend, captureSessionCount, isPlannedBackend } from './render/capturePool.js';
import type { CapturedFrame, OffscreenCaptureBridge } from './render/offscreen.js';
import { fitScale } from './main/windowSize.js';
import { punchInKeyframes, rebaseKeyframes, sampleKeyframes, scaleKeyframes, slowPushKeyframes, easeValue } from './keyframes.js';
import { captionImportOps, cuesFromWords, looksLikeCaptionJson, parseCaptionText, parseSrt, parseVtt, parseWordsJson } from './captions.js';
import { CHAPTER_FRAME_ITEM_ID, chapterFrameDoc, chapterFrameTime } from './chapters.js';
import { resolveTimeline } from './resolveTimeline.js';
import { buildCutOps } from './transcript.js';
import { deriveFormatDoc } from './derive.js';
import { validateDoc } from './validateDoc.js';
import { hashItem } from './hashItem.js';
import { PUNCH_IN_SCALE, SLOW_PUSH_SCALE, VIDEO_SCHEMA_VERSION } from './constants.js';
import type { VideoDoc, VideoItem, VideoKeyframe } from './types.js';

function docWith(items: VideoItem[], extra: Partial<VideoDoc> = {}): VideoDoc {
  return {
    schemaVersion: VIDEO_SCHEMA_VERSION,
    id: 'd',
    title: 't',
    version: 1,
    size: { width: 1920, height: 1080 },
    fps: 30,
    tracks: [{ id: 'v', kind: 'visual', items }],
    assets: {},
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

describe('§5.13 (W) 38-4 키프레임', () => {
  const punch: VideoKeyframe[] = [
    { t: 0, scale: 1 },
    { t: 1, scale: 1.2, ease: 'linear' },
    { t: 2, dx: 100 },
  ];

  it('속성마다 그 속성을 적은 키프레임끼리만 보간하고, 밖은 가장 가까운 값을 유지한다', () => {
    expect(sampleKeyframes(punch, 0.5).scale).toBeCloseTo(1.1, 6);
    expect(sampleKeyframes(punch, 5).scale).toBeCloseTo(1.2, 6);
    expect(sampleKeyframes(punch, -1).scale).toBe(1);
    // dx 는 2초에만 적혀 있다 — 그 앞도 뒤도 100 이다(하나뿐인 점).
    expect(sampleKeyframes(punch, 0).dx).toBe(100);
    // 아무도 적지 않은 속성은 그대로(회전 0 · 투명도 1).
    expect(sampleKeyframes(punch, 1).rotation).toBe(0);
    expect(sampleKeyframes(punch, 1).opacity).toBe(1);
    expect(sampleKeyframes(undefined, 3)).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 });
  });

  it('곡선은 들어오는 쪽 키프레임의 ease — hold 는 그 시각까지 앞 값을 유지한다', () => {
    const keys: VideoKeyframe[] = [{ t: 0, scale: 1 }, { t: 1, scale: 2, ease: 'hold' }];
    expect(sampleKeyframes(keys, 0.99).scale).toBe(1);
    expect(sampleKeyframes(keys, 1).scale).toBe(2);
    expect(easeValue('out', 0.5)).toBeGreaterThan(0.5);
    expect(easeValue('in', 0.5)).toBeLessThan(0.5);
    expect(easeValue(undefined, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('그리기 목록이 상자에 상대값으로 얹는다 — 옮기고, 곱하고, 더한다', () => {
    const item: VideoItem = {
      id: 'f', kind: 'shape', at: 0, duration: 4,
      transform: { x: 10, y: 20, width: 100, height: 50, scale: 2, opacity: 0.8 },
      keyframes: [{ t: 0, dx: 0, scale: 1, opacity: 1 }, { t: 2, dx: 40, scale: 1.5, opacity: 0.5, ease: 'linear' }],
    };
    const doc = docWith([item]);
    const [op] = buildDrawList(doc, resolveTimeline(doc), 1);
    expect(op?.transform.x).toBeCloseTo(30, 6);
    expect(op?.transform.y).toBe(20);
    expect(op?.transform.scale).toBeCloseTo(2 * 1.25, 6);
    expect(op?.transform.opacity).toBeCloseTo(0.8 * 0.75, 6);
  });

  it('[강조 줌]은 그 시각에서 배율을 올렸다 내린다 — 아이템 길이 안으로', () => {
    const keys = punchInKeyframes(undefined, 1, 10);
    expect(sampleKeyframes(keys, 0.5).scale).toBe(1);
    expect(sampleKeyframes(keys, 1.4).scale).toBeCloseTo(PUNCH_IN_SCALE, 6);
    expect(sampleKeyframes(keys, 9).scale).toBeCloseTo(1, 6);
    const tight = punchInKeyframes(undefined, 9.9, 10);
    expect(Math.max(...tight.map((k) => k.t))).toBeLessThanOrEqual(10);
  });

  it('[천천히 밀기]는 처음부터 끝까지 배율을 올리고, 다른 속성 키는 남긴다', () => {
    const keys = slowPushKeyframes([{ t: 1, dx: 30 }], 8);
    expect(sampleKeyframes(keys, 0).scale).toBe(1);
    expect(sampleKeyframes(keys, 8).scale).toBeCloseTo(SLOW_PUSH_SCALE, 6);
    expect(sampleKeyframes(keys, 8).dx).toBe(30);
  });

  it('앞을 잘라 낸 조각은 시각을 당기고, 잘린 지점의 값에서 시작한다', () => {
    const keys: VideoKeyframe[] = [{ t: 0, scale: 1 }, { t: 2, scale: 2, ease: 'linear' }];
    const rebased = rebaseKeyframes(keys, 1)!;
    expect(rebased[0]).toMatchObject({ t: 0, scale: 1.5 });
    expect(sampleKeyframes(rebased, 1).scale).toBeCloseTo(2, 6);
    // 앞으로 늘리면(음수) 뒤로 민다.
    expect(rebaseKeyframes(keys, -0.5)![0]!.t).toBe(0.5);
    expect(rebaseKeyframes(undefined, 2)).toBeUndefined();
  });

  it('판형 파생은 이동만 짧은 변 비율로 옮긴다', () => {
    expect(scaleKeyframes([{ t: 0, dx: 100, dy: -50, scale: 1.2 }], 0.5)).toEqual([{ t: 0, dx: 50, dy: -25, scale: 1.2 }]);
    const doc = docWith([{ id: 'i', kind: 'shape', at: 0, duration: 2, transform: { x: 0, y: 0, width: 200, height: 200 }, keyframes: [{ t: 0, dx: 100 }] }]);
    const portrait = deriveFormatDoc(doc, 'portrait', 1);
    const kept = portrait.tracks[0]!.items[0]!.keyframes!;
    expect(kept[0]!.dx).toBeCloseTo(100, 6); // 1080/1080 = 1 (짧은 변 그대로)
    const square = deriveFormatDoc(docWith([{ id: 'i', kind: 'shape', at: 0, duration: 2, keyframes: [{ t: 0, dx: 100 }] }], { size: { width: 3840, height: 2160 } }), 'square', 1);
    expect(square.tracks[0]!.items[0]!.keyframes![0]!.dx).toBeCloseTo(50, 6); // 1080/2160
  });

  it('대본 컷이 앞을 자르면 키프레임도 당겨진다(뒤 조각까지)', () => {
    const item: VideoItem = { id: 'clip', kind: 'footage', at: 0, duration: 6, keyframes: [{ t: 0, scale: 1 }, { t: 6, scale: 1.6, ease: 'linear' }] };
    const doc = docWith([item]);
    const plan = buildCutOps(doc, resolveTimeline(doc), [{ start: 0, end: 1 }, { start: 3, end: 4 }]);
    const patch = plan.ops.find((o) => o.op === 'updateItem' && o.itemId === 'clip');
    expect(patch && patch.op === 'updateItem' ? patch.patch.keyframes?.[0] : undefined).toMatchObject({ t: 0, scale: 1.1 });
    const added = plan.ops.find((o) => o.op === 'addItem');
    expect(added && added.op === 'addItem' ? added.item.keyframes?.[0] : undefined).toMatchObject({ t: 0, scale: 1.4 });
  });

  it('선언 해시에 키프레임이 든다(고치면 그 구간이 다시 그려진다)', () => {
    const a: VideoItem = { id: 'x', kind: 'shape', at: 0, duration: 1 };
    const b: VideoItem = { ...a, keyframes: [{ t: 0, scale: 2 }] };
    expect(hashItem(a, {}, 1)).not.toBe(hashItem(b, {}, 1));
  });

  it('검증이 키프레임·이펙트의 틀린 모양을 알린다', () => {
    const bad = docWith([{ id: 'x', kind: 'shape', at: 0, duration: 1, keyframes: [{ t: 'soon' } as unknown as VideoKeyframe], effects: [{ id: 'e' } as never] }]);
    const result = validateDoc(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('키프레임');
      expect(result.errors.join(' ')).toContain('이펙트');
    }
    const easeBad = docWith([{ id: 'x', kind: 'shape', at: 0, duration: 1, keyframes: [{ t: 0, ease: 'bounce' as never }] }]);
    expect(validateDoc(easeBad).ok).toBe(false);
    expect(validateDoc(docWith([{ id: 'x', kind: 'shape', at: 0, duration: 1, keyframes: [{ t: 0, scale: 1 }], effects: [{ id: 'e', kind: 'look', params: { name: 'warm' } }] }])).ok).toBe(true);
  });
});

describe('§5.13 (W) 38-5 이펙트', () => {
  it('룩과 손 보정이 겹치고, 고정된 순서의 CSS 필터 하나가 된다', () => {
    const fx = effectsToFilter([
      { id: 'a', kind: 'look', params: { name: 'mono' } },
      { id: 'b', kind: 'color', params: { brightness: 1.2 } },
      { id: 'c', kind: 'blur', params: { radius: 4 } },
    ]);
    expect(fx.filter).toBe('brightness(1.2) contrast(1.12) saturate(0) blur(4px)');
    expect(fx.vignette).toBe(0);
  });

  it('색온도는 따뜻하면 세피아 + 노랑 쪽, 차가우면 파랑 쪽(근사) — 비네트는 가장 센 값', () => {
    expect(effectsToFilter([{ id: 'w', kind: 'color', params: { temperature: 1 } }]).filter).toContain('sepia(0.3)');
    expect(effectsToFilter([{ id: 'c', kind: 'color', params: { temperature: -1 } }]).filter).toContain('hue-rotate(14deg)');
    expect(effectsToFilter([{ id: 'v', kind: 'vignette', params: { amount: 0.4 } }, { id: 'l', kind: 'look', params: { name: 'cinematic' } }]).vignette).toBe(0.4);
  });

  it('모르는 종류·없는 룩은 건너뛴다(문서에는 남는다)', () => {
    expect(effectsToFilter([{ id: 'x', kind: 'glitch', params: { amount: 1 } }, { id: 'l', kind: 'look', params: { name: 'nope' } }])).toEqual({ filter: '', vignette: 0 });
    expect(effectsToFilter(undefined)).toEqual({ filter: '', vignette: 0 });
  });

  it('그리기 목록이 아이템의 필터·비네트를 싣는다(세 백엔드가 같은 값을 쓴다)', () => {
    const doc = docWith([{ id: 'f', kind: 'shape', at: 0, duration: 2, effects: [{ id: 'v', kind: 'vignette', params: { amount: 0.5 } }, { id: 'b', kind: 'blur', params: { radius: 2 } }] }]);
    const [op] = buildDrawList(doc, resolveTimeline(doc), 1);
    expect(op?.filter).toBe('blur(2px)');
    expect(op?.vignette).toBe(0.5);
    expect(vignetteStops(1).at(-1)?.alpha).toBe(0.85);
  });
});

describe('§5.13 (W) 38-6 자막 파일', () => {
  it('SRT 는 엄격하다 — 깨진 블록은 통째로 거절한다', () => {
    expect(parseSrt('1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld')).toEqual([
      { start: 1, end: 2.5, text: 'Hello' },
      { start: 3, end: 4, text: 'World' },
    ]);
    expect(() => parseSrt('1\nnot a time\nHello')).toThrow();
  });

  it('VTT — 머리·NOTE 를 건너뛰고, 큐 안 낱말 시각을 낱말 단위로 옮긴다', () => {
    const vtt = 'WEBVTT\nKind: captions\n\nNOTE made by a tool\n\ncue-1\n00:01.000 --> 00:03.000 align:start\n<v Ann>Hi <00:01.500><c>there</c> <00:02.000><c>friend</c>\n';
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ start: 1, end: 3, text: 'Hi there friend' });
    expect(cues[0]!.words?.map((w) => [w.t, w.text])).toEqual([[1, 'Hi'], [1.5, 'there'], [2, 'friend']]);
  });

  it('낱말 JSON 세 모양(words · segments[].words · 배열)과 밀리초 오프셋 목록을 읽는다', () => {
    const words = [{ word: ' Hello', start: 0, end: 0.4 }, { word: ' world.', start: 0.45, end: 0.9 }, { word: ' Next', start: 2, end: 2.3 }];
    const a = parseWordsJson({ words })!;
    expect(a.map((c) => c.text)).toEqual(['Hello world.', 'Next']);
    expect(a[0]!.words).toEqual([{ t: 0, text: 'Hello' }, { t: 0.45, text: 'world.' }]);
    expect(parseWordsJson({ segments: [{ start: 0, end: 1, text: 'x', words }] })!.length).toBe(2);
    expect(parseWordsJson(words)!.length).toBe(2);
    const offsets = parseWordsJson({ transcription: [{ offsets: { from: 0, to: 400 }, text: ' Hi' }, { offsets: { from: 500, to: 900 }, text: ' there' }] })!;
    expect(offsets[0]).toMatchObject({ start: 0, end: 0.9, text: 'Hi there' });
    expect(parseWordsJson({ rows: [1, 2, 3] })).toBeNull();
    expect(looksLikeCaptionJson({ rows: [1] })).toBe(false);
    expect(looksLikeCaptionJson({ words })).toBe(true);
  });

  it('낱말 묶기 — 긴 문장은 글자 수에서 끊는다', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ text: `word${i}`, start: i * 0.2, end: i * 0.2 + 0.18 }));
    const cues = cuesFromWords(many);
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(48);
  });

  it('형식은 확장자로 고르고, 모르는 형식·깨진 JSON 은 이유와 함께 던진다', () => {
    expect(parseCaptionText('a.srt', '1\n00:00:00,000 --> 00:00:01,000\nA').cues).toHaveLength(1);
    expect(parseCaptionText('a.json', JSON.stringify({ words: [{ word: 'A', start: 0, end: 1 }] })).words).toBe(true);
    expect(() => parseCaptionText('a.txt', 'x')).toThrow();
    expect(() => parseCaptionText('a.json', '{nope')).toThrow();
    expect(() => parseCaptionText('a.json', '{"rows":[]}')).toThrow();
  });

  it('자막 아이템 연산 — 자막 트랙이 있으면 거기, 없으면 트랙을 만든다(아이템·트랙 id 를 가른다)', () => {
    const cues = [{ start: 1, end: 2, text: 'A' }];
    const withTrack = docWith([], { tracks: [{ id: 'v', kind: 'visual', items: [] }, { id: 'cap', kind: 'caption', items: [] }] });
    expect(captionImportOps(withTrack, cues, 'a.srt')).toEqual([{ op: 'addItem', trackId: 'cap', item: { id: 'caption-1', kind: 'caption', at: 1, duration: 1, label: 'a.srt', cues } }]);
    const none = docWith([]);
    const ops = captionImportOps(none, cues, 'a.srt');
    expect(ops[0]?.op).toBe('addTrack');
    if (ops[0]?.op === 'addTrack') {
      expect(ops[0].track.id).toBe('captions-1');
      expect(ops[0].track.items[0]?.id).toBe('caption-1');
    }
    expect(captionImportOps(none, [{ start: 2, end: 1, text: 'bad' }], 'x')).toEqual([]);
  });
});

describe('§5.13 (W) 38-7 장면 정지 화면', () => {
  const doc = docWith([], {
    assets: { comp: { id: 'comp', kind: 'composition', source: { kind: 'file', path: '.vibisual/video/compositions/a/index.html' }, duration: 3 } },
    chapters: [
      { id: 'c1', title: 'Hook', duration: 4, status: 'plan', frame: { assetId: 'comp', t: 1.2 } },
      { id: 'c2', title: 'Bad', duration: 4, status: 'plan', frame: { assetId: 'nope' } },
    ],
  });

  it('그 컴포지션 하나짜리 문서를 만든다(장면 없음 · 같은 크기·소재)', () => {
    const frameDoc = chapterFrameDoc(doc, 'c1')!;
    expect(frameDoc.chapters).toBeUndefined();
    expect(frameDoc.size).toEqual(doc.size);
    expect(frameDoc.tracks).toHaveLength(1);
    expect(frameDoc.tracks[0]!.items[0]).toMatchObject({ id: CHAPTER_FRAME_ITEM_ID, kind: 'composition', assetId: 'comp', at: 0 });
    expect(resolveTimeline(frameDoc).duration).toBeGreaterThanOrEqual(4);
    expect(chapterFrameTime(doc, 'c1')).toBe(1.2);
  });

  it('정지 화면이 없는 소재를 가리키면 null + 진단(문서는 그대로)', () => {
    expect(chapterFrameDoc(doc, 'c2')).toBeNull();
    expect(chapterFrameDoc(doc, 'zzz')).toBeNull();
    expect(resolveTimeline(doc).diagnostics.some((d) => d.code === 'chapter-frame-asset')).toBe(true);
    expect(validateDoc(doc).ok).toBe(true);
    expect(validateDoc({ ...doc, chapters: [{ id: 'x', title: 'x', duration: 1, status: 'plan', frame: { t: 1 } }] }).ok).toBe(false);
  });
});

describe('§5.13 (W) 38-1 날 비트맵', () => {
  it('빨간 점 하나로 바이트 순서를 판정한다', () => {
    expect(bitmapOrderOf([0, 0, 255, 255])).toBe('bgra');
    expect(bitmapOrderOf([255, 0, 0, 255])).toBe('rgba');
    expect(bitmapOrderOf([10, 200, 30, 255])).toBeNull();
  });

  it('순서를 바꾸고 미리 곱한 알파를 푼다(두 순서 모두)', () => {
    // 반투명 빨강(미리 곱함): BGRA [0,0,128,128] → RGBA [255,0,0,128]
    expect(Array.from(rawToStraightRgba([0, 0, 128, 128], 'bgra', true))).toEqual([255, 0, 0, 128]);
    expect(Array.from(rawToStraightRgba([128, 0, 0, 128], 'rgba', true))).toEqual([255, 0, 0, 128]);
    // 알파 0 은 검은 투명, 불투명은 그대로.
    expect(Array.from(rawToStraightRgba([9, 9, 9, 0, 1, 2, 3, 255], 'bgra', true))).toEqual([0, 0, 0, 0, 3, 2, 1, 255]);
    expect(Array.from(rawToStraightRgba([1, 2, 3, 255], 'rgba', false))).toEqual([1, 2, 3, 255]);
  });

  it('날 프레임 모양을 알아본다', () => {
    const frame: RawFrame = { kind: 'raw', width: 1, height: 1, order: 'bgra', premultiplied: true, data: new ArrayBuffer(4) };
    expect(isRawFrame(frame)).toBe(true);
    expect(isRawFrame(new ArrayBuffer(4))).toBe(false);
  });
});

describe('§5.13 (W) 38-1 창 맞춤 배율', () => {
  it('넉넉하면 1, 줄었으면 작은 쪽 비율(반올림 한 픽셀은 맞춤으로 보지 않는다)', () => {
    expect(fitScale(1920, 1080, 1921, 1080)).toBe(1);
    expect(fitScale(1920, 1080, 1919, 1080)).toBe(1);
    expect(fitScale(1080, 1920, 1080, 912)).toBeCloseTo(0.475, 3);
    expect(fitScale(1920, 1080, 0, 0)).toBe(1);
  });
});

describe('§5.13 (W) 38-2 병렬 캡처', () => {
  function fakeBridge(name: string, log: string[], failAt?: number): OffscreenCaptureBridge {
    return {
      probe: async () => ({ available: true }),
      open: async () => undefined,
      captureAt: async (t: number) => {
        log.push(`${name}@${t}`);
        await new Promise((r) => setTimeout(r, 1));
        if (failAt !== undefined && Math.abs(t - failAt) < 1e-9) throw new Error(`boom at ${t}`);
        return { kind: 'raw', width: 2, height: 2, order: 'rgba', premultiplied: true, data: new ArrayBuffer(16) } as CapturedFrame;
      },
      close: async () => undefined,
    };
  }
  const fakeCanvas = (): HTMLCanvasElement => ({ width: 0, height: 0, getContext: () => ({}) }) as unknown as HTMLCanvasElement;

  it('프레임을 세션에 돌아가며 맡기고, 세션 안에서는 시각이 앞으로만 간다', async () => {
    const log: string[] = [];
    const drawn: number[] = [];
    const pool = new PooledCaptureBackend({
      bridges: [fakeBridge('a', log), fakeBridge('b', log), fakeBridge('c', log)],
      createCanvas: fakeCanvas,
      draw: async (_ctx, frame) => { drawn.push((frame as { width: number }).width); return 0.5; },
    });
    expect(isPlannedBackend(pool)).toBe(true);
    await pool.init({ width: 4, height: 4 });
    const times = Array.from({ length: 9 }, (_, i) => i / 30);
    pool.plan(times);
    for (const t of times) await pool.drawFrame(t);
    pool.dispose();
    for (const s of ['a', 'b', 'c']) {
      const ts = log.filter((l) => l.startsWith(`${s}@`)).map((l) => Number(l.slice(2)));
      expect(ts.length).toBe(3);
      expect([...ts].sort((x, y) => x - y)).toEqual(ts);
    }
    expect(drawn).toHaveLength(9);
    expect(pool.captureRatio()).toBe(0.5);
  });

  it('한 장이라도 실패하면 그 이유로 렌더가 실패한다(엄격)', async () => {
    const log: string[] = [];
    const pool = new PooledCaptureBackend({
      bridges: [fakeBridge('a', log), fakeBridge('b', log, 1 / 30)],
      createCanvas: fakeCanvas,
      draw: async () => 1,
    });
    await pool.init({ width: 4, height: 4 });
    const times = [0, 1 / 30, 2 / 30];
    pool.plan(times);
    await pool.drawFrame(0);
    await expect(pool.drawFrame(1 / 30)).rejects.toThrow('boom');
    pool.dispose();
  });

  it('세션 수는 상한과 논리 코어 절반 중 작은 것(최소 1)', () => {
    expect(captureSessionCount(3, 16)).toBe(3);
    expect(captureSessionCount(3, 4)).toBe(2);
    expect(captureSessionCount(3, 1)).toBe(1);
    expect(captureSessionCount(3, undefined)).toBe(1);
  });
});
