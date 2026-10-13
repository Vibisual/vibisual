import { describe, expect, it } from 'vitest';

import { analyzeBeats, downmixToMono, nearestBeat } from './audio/beats.js';
import { DUCK_ATTACK_S, DUCK_RELEASE_S, dbToGain, duckEnvelope, duckGainAt, mergeDuckRanges } from './audio/duck.js';
import { cueScanLength, settleCues } from './composition/cues.js';
import { coverBox, deriveFormatDoc, derivedDocId } from './derive.js';
import { applyPatch, createEmptyDoc } from './ops.js';
import { captionWordSpans, splitCaptionWords } from './render/captionWords.js';
import { resolveTimeline } from './resolveTimeline.js';
import { buildSrt, srtTime, withoutCaptions } from './srt.js';
import { buildCutOps, buildTranscript, keptSegments, mapCutTime, mergeCutRanges, sentenceCutRanges } from './transcript.js';
import type { VideoDoc, VideoDocOp, VideoItem } from './types.js';

/** §5.13 (V) 4라운드 순수 함수들 — 표지 다듬기 · 비트 · 덕킹 · 단어 강조 · 대본 자르기 · 판형 파생 · SRT. */

function docWith(ops: VideoDocOp[]): VideoDoc {
  const d = createEmptyDoc('d1', '시험', 1000);
  const r = applyPatch(d, { baseVersion: d.version, ops }, 2000);
  if (!r.ok) throw new Error(`setup failed: ${r.reason}`);
  return r.doc;
}

describe('settleCues — (T-8) 표지 다듬기', () => {
  it('모양이 틀린 것은 버리고, 같은 (이름, 시각)은 접고, 시각 순으로 세운다', () => {
    const r = settleCues([
      { name: 'b', t: 2 }, { name: 'a', t: 1 }, { name: 'a', t: 1 }, { name: '', t: 3 }, { name: 'x', t: -1 }, { t: 1 }, null, 'cue',
    ]);
    expect(r.cues).toEqual([{ name: 'a', t: 1 }, { name: 'b', t: 2 }]);
    expect(r.issues).toEqual([]);
  });

  it('같은 이름이 여러 번이면 전부 남기고 진단을 단다 — 묶이는 것은 시각이 가장 이른 첫 번째', () => {
    const r = settleCues([{ name: 'hit', t: 3 }, { name: 'hit', t: 1.5 }]);
    expect(r.cues.map((c) => c.t)).toEqual([1.5, 3]);
    expect(r.issues).toEqual([{ code: 'cue-duplicate', name: 'hit', count: 2 }]);
  });

  it('상한을 넘으면 앞에서부터만 남기고 진단을 단다', () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({ name: `p${i}`, t: i }));
    const r = settleCues(raw, [], 3);
    expect(r.cues.map((c) => c.name)).toEqual(['p0', 'p1', 'p2']);
    expect(r.issues).toContainEqual({ code: 'cues-truncated', count: 3 });
  });

  it('흘리는 도중 오류는 그 시각과 함께 남는다', () => {
    const r = settleCues([], [{ t: 34.25, message: 'boom' }, { message: 'no time' }]);
    expect(r.issues).toEqual([{ code: 'cue-error', t: 34.25, message: 'boom' }, { code: 'cue-error', message: 'no time' }]);
  });

  it('흘릴 길이 — 선언 길이 > 가장 긴 구간 > 기본값', () => {
    expect(cueScanLength(6, [10], 4)).toBe(6);
    expect(cueScanLength(undefined, [2, 7.5], 4)).toBe(7.5);
    expect(cueScanLength(undefined, [], 4)).toBe(4);
  });
});

describe('표지 이상 → 해소기 경고', () => {
  it('cueIssues 가 있는 컴포지션 아이템에 경고 진단이 붙고 아이템은 그대로 선다', () => {
    const doc = docWith([
      { op: 'setAsset', asset: { id: 'c1', kind: 'composition', source: { kind: 'file', path: '.vibisual/video/compositions/a/index.html' }, duration: 4,
        cues: [{ name: 'hit', t: 1 }], cueIssues: [{ code: 'cue-duplicate', name: 'hit', count: 2 }] } },
      { op: 'addItem', trackId: 'visual', item: { id: 'comp', kind: 'composition', at: 0, duration: 'auto', assetId: 'c1' } },
    ]);
    const tl = resolveTimeline(doc);
    expect(tl.items.map((i) => i.id)).toContain('comp');
    expect(tl.diagnostics.some((d) => d.code === 'cue-duplicate' && d.level === 'warn' && d.itemId === 'comp')).toBe(true);
  });
});

describe('analyzeBeats — (V) 37-12', () => {
  const SR = 8000;
  /** 120 BPM 클릭 트랙(0.5초마다 짧은 소리). */
  function clicks(seconds: number, bpm: number, accentEvery = 4): Float32Array {
    const out = new Float32Array(Math.round(seconds * SR));
    const period = Math.round((60 / bpm) * SR);
    let n = 0;
    for (let start = Math.round(0.1 * SR); start < out.length; start += period, n += 1) {
      const amp = n % accentEvery === 0 ? 1 : 0.5;
      for (let i = 0; i < 200 && start + i < out.length; i += 1) out[start + i] = amp * Math.sin(i / 3) * (1 - i / 200);
    }
    return out;
  }

  it('일정한 클릭에서 템포와 비트를 찾는다', () => {
    const r = analyzeBeats(clicks(12, 120), SR);
    expect(r.bpm).toBeGreaterThan(110);
    expect(r.bpm).toBeLessThan(130);
    expect(r.beats.length).toBeGreaterThan(18);
    // 비트 사이 간격은 약 0.5초.
    const gaps = r.beats.slice(1).map((b, i) => b - (r.beats[i] ?? 0));
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
    expect(median).toBeGreaterThan(0.45);
    expect(median).toBeLessThan(0.55);
  });

  it('강한 비트는 4박마다 하나', () => {
    const r = analyzeBeats(clicks(12, 120), SR);
    expect(r.strong.length).toBeGreaterThan(3);
    expect(r.strong.length).toBeLessThanOrEqual(Math.ceil(r.beats.length / 4));
  });

  it('조용하거나 짧은 소리는 비트를 내지 않는다', () => {
    expect(analyzeBeats(new Float32Array(SR * 10), SR)).toEqual({ beats: [], strong: [], bpm: 0 });
    expect(analyzeBeats(clicks(2, 120), SR).beats).toEqual([]);
  });

  it('여러 갈래는 평균으로 한 갈래가 된다', () => {
    const m = downmixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(m)).toEqual([0.5, 0.5]);
  });

  it('가까운 비트 — 문턱 밖이면 null', () => {
    expect(nearestBeat([1, 2, 3], 2.1, 0.2)).toBe(2);
    expect(nearestBeat([1, 2, 3], 2.5, 0.2)).toBeNull();
  });
});

describe('duckEnvelope — (V) 37-12 덕킹', () => {
  it('목소리 앞 attack 초부터 내려가 목소리 동안 머물고 release 초에 걸쳐 돌아온다', () => {
    const pts = duckEnvelope([{ start: 2, end: 4 }]);
    const low = dbToGain(-10);
    expect(pts).toEqual([
      { t: 2 - DUCK_ATTACK_S, gain: 1 },
      { t: 2, gain: low },
      { t: 4, gain: low },
      { t: 4 + DUCK_RELEASE_S, gain: 1 },
    ]);
    expect(duckGainAt(pts, 3)).toBeCloseTo(low);
    expect(duckGainAt(pts, 10)).toBe(1);
  });

  it('가까운 두 목소리는 한 구간으로 잇는다(출렁이지 않게)', () => {
    expect(mergeDuckRanges([{ start: 1, end: 2 }, { start: 2.3, end: 3 }])).toEqual([{ start: 1, end: 3 }]);
    expect(mergeDuckRanges([{ start: 1, end: 2 }, { start: 5, end: 6 }])).toHaveLength(2);
  });

  it('깊이가 0 이상이거나 목소리가 없으면 곡선이 없다', () => {
    expect(duckEnvelope([{ start: 1, end: 2 }], { depthDb: 0 })).toEqual([]);
    expect(duckEnvelope([])).toEqual([]);
  });
});

describe('captionWordSpans — (V) 37-12 단어 강조', () => {
  it('낱말 시각이 있으면 그 시각으로 지금 낱말을 고른다', () => {
    const r = captionWordSpans({ start: 0, end: 3, text: 'one two three', words: [{ t: 0, text: 'one' }, { t: 1, text: 'two' }, { t: 2, text: 'three' }] }, 1.5);
    expect(r.estimated).toBe(false);
    expect(r.words.map((w) => w.active)).toEqual([false, true, false]);
    expect(r.words.map((w) => w.spoken)).toEqual([true, false, false]);
  });

  it('없으면 글자 길이 비례로 추정하고 그 사실을 알린다', () => {
    const r = captionWordSpans({ start: 0, end: 4, text: 'aa bbbbbb' }, 1.5);
    expect(r.estimated).toBe(true);
    // 'aa'(2/8) 는 0~1초, 'bbbbbb' 는 1~4초.
    expect(r.words.map((w) => w.active)).toEqual([false, true]);
  });

  it('공백 없는 긴 한자·가나 글은 두 글자씩 나눈다', () => {
    expect(splitCaptionWords('今日はとても良い天気')).toEqual(['今日', 'はと', 'ても', '良い', '天気']);
    expect(splitCaptionWords('안녕 하세요')).toEqual(['안녕', '하세요']);
  });
});

describe('대본 자르기 — (V) 37-13', () => {
  const caption = (): VideoItem => ({
    id: 'cap', kind: 'caption', at: 0, duration: 9,
    cues: [{ start: 0, end: 3, text: 'first' }, { start: 3, end: 6, text: 'second' }, { start: 6, end: 9, text: 'third' }],
  });
  const footage = (): VideoItem => ({ id: 'vid', kind: 'footage', at: 0, duration: 9, assetId: 'v1' });
  const after = (): VideoItem => ({ id: 'title', kind: 'text', at: { after: 'vid' }, duration: 2, props: { text: 'end' } });
  const doc = (): VideoDoc => docWith([
    { op: 'setAsset', asset: { id: 'v1', kind: 'video', source: { kind: 'file', path: 'a.mp4' }, duration: 20 } },
    { op: 'addItem', trackId: 'visual', item: footage() },
    { op: 'addItem', trackId: 'visual', item: after() },
    { op: 'addItem', trackId: 'caption', item: caption() },
  ]);

  it('문장 목록 — 큐 하나가 문장 하나, 그 동안의 영상 아이템을 단다', () => {
    const d = doc();
    const s = buildTranscript(d, resolveTimeline(d));
    expect(s.map((x) => x.id)).toEqual(['cap#0', 'cap#1', 'cap#2']);
    expect(s[1]?.media).toEqual(['vid']);
  });

  it('이어서 지운 문장 사이 빈틈은 함께, 떨어진 것은 따로', () => {
    const d = doc();
    const s = buildTranscript(d, resolveTimeline(d));
    expect(sentenceCutRanges(s, new Set(['cap#1']))).toEqual([{ start: 3, end: 6 }]);
    expect(sentenceCutRanges(s, new Set(['cap#0', 'cap#2']))).toEqual([{ start: 0, end: 3 }, { start: 6, end: 9 }]);
  });

  it('시각 옮기기·남는 조각·구간 합치기', () => {
    const ranges = mergeCutRanges([{ start: 5, end: 6 }, { start: 3, end: 5.0005 }]);
    expect(ranges).toEqual([{ start: 3, end: 6 }]);
    expect(mapCutTime(ranges, 2)).toBe(2);
    expect(mapCutTime(ranges, 4)).toBe(3);
    expect(mapCutTime(ranges, 8)).toBe(5);
    expect(keptSegments(ranges, 0, 9)).toEqual([[0, 3], [6, 9]]);
  });

  it('가운데 문장을 자르면 영상은 둘로 나뉘고 뒤 아이템·자막이 당겨지며 길이가 준다', () => {
    const d = doc();
    const tl = resolveTimeline(d);
    const plan = buildCutOps(d, tl, sentenceCutRanges(buildTranscript(d, tl), new Set(['cap#1'])));
    expect(plan.removed).toBe(3);
    expect(plan.durationBefore).toBe(11);
    expect(plan.durationAfter).toBe(8);
    const r = applyPatch(d, { baseVersion: d.version, ops: plan.ops });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const items = r.doc.tracks.flatMap((t) => t.items);
    const vid = items.find((i) => i.id === 'vid');
    const piece = items.find((i) => i.id === 'vid-cut1');
    expect(vid?.duration).toBe(3);
    expect(piece).toMatchObject({ at: 3, duration: 3, trimStart: 6 });
    const cap = items.find((i) => i.id === 'cap');
    expect(cap?.cues?.map((c) => [c.start, c.end, c.text])).toEqual([[0, 3, 'first'], [3, 6, 'third']]);
    // 나뉜 영상을 'after' 로 가리키던 글자는 숫자 시각으로 풀린다(첫 조각 끝이 아니라 마지막 조각 끝).
    const title = items.find((i) => i.id === 'title');
    expect(title?.at).toBe(6);
  });
});

describe('판형 파생 — (V) 37-15', () => {
  it('덮기 상자는 소재 비율 그대로 새 화면을 덮는다', () => {
    const box = coverBox(1920, 1080, 1080, 1920);
    expect(box.height).toBeCloseTo(1920, 1);
    expect(box.width).toBeCloseTo(3413.33, 1);
    expect(box.x).toBeCloseTo(-1166.67, 1);
    expect(Math.abs(box.y)).toBeLessThan(0.01);
    expect(coverBox(0, 0, 1080, 1920)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });

  it('파생 문서 — id·제목·크기·출처, 화면을 채우던 실사는 덮기 상자, 글자 크기는 짧은 변 비율', () => {
    const d = docWith([
      { op: 'setAsset', asset: { id: 'v1', kind: 'video', source: { kind: 'file', path: 'a.mp4' }, duration: 5, width: 1920, height: 1080 } },
      { op: 'addItem', trackId: 'visual', item: { id: 'vid', kind: 'footage', at: 0, duration: 5, assetId: 'v1' } },
      { op: 'addItem', trackId: 'visual', item: { id: 'txt', kind: 'text', at: 0, duration: 5, props: { text: 'hi', fontSize: 64 }, transform: { x: 100, y: 100, width: 400, height: 100 } } },
    ]);
    const p = deriveFormatDoc(d, 'portrait', 5000);
    expect(p.id).toBe('d1-portrait');
    expect(p.size).toEqual({ width: 1080, height: 1920 });
    expect(p.derivedFrom).toEqual({ docId: 'd1', format: 'portrait' });
    expect(p.version).toBe(1);
    const items = p.tracks.flatMap((t) => t.items);
    expect(items.find((i) => i.id === 'vid')?.transform?.height).toBeCloseTo(1920, 1);
    expect(items.find((i) => i.id === 'txt')?.props?.['fontSize']).toBe(64);
    expect(derivedDocId('d1-portrait', 'square')).toBe('d1-square');
  });
});

describe('SRT — (V) 37-15', () => {
  it('시각 표기와 번호', () => {
    expect(srtTime(3723.0456)).toBe('01:02:03,046');
    const d = docWith([
      { op: 'addItem', trackId: 'caption', item: { id: 'cap', kind: 'caption', at: 0, duration: 4, cues: [{ start: 0, end: 1.5, text: 'hello' }, { start: 2, end: 3, text: 'world' }] } },
    ]);
    expect(buildSrt(d, resolveTimeline(d))).toBe('1\n00:00:00,000 --> 00:00:01,500\nhello\n\n2\n00:00:02,000 --> 00:00:03,000\nworld\n');
  });

  it('숨긴 자막 트랙은 빠지고, 따로 내기 사본은 자막 트랙을 숨긴다', () => {
    const d = docWith([
      { op: 'addItem', trackId: 'caption', item: { id: 'cap', kind: 'caption', at: 0, duration: 4, cues: [{ start: 0, end: 1, text: 'x' }] } },
    ]);
    const hidden = withoutCaptions(d);
    expect(hidden.tracks.find((t) => t.kind === 'caption')?.hidden).toBe(true);
    expect(buildSrt(hidden, resolveTimeline(hidden))).toBe('');
    expect(d.tracks.find((t) => t.kind === 'caption')?.hidden).toBeUndefined();
  });
});
