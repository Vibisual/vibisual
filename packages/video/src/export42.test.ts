import { describe, expect, it } from 'vitest';

import { encodeWav } from './audio/wav.js';
import { EXPORT_BATCH_MAX, EXPORT_FILE_NAME_MAX_BYTES } from './constants.js';
import { buildRenderFileName, firstFreeName, numberedName, sanitizeFileName, utf8Bytes } from './exportNames.js';
import { audibleTracks, batchFileName, planExportJobs, renderFramePlan, renderTiming, withMutedTracks } from './exportPlan.js';
import { DEFAULT_EXPORT_SETTINGS, normalizeExportSettings, normalizeExportSettingsFile } from './exportSettings.js';
import { normalizeRange, normalizeRenderOutput, normalizeRenderSpec, renderExtension, scaledSize, specFromSettings } from './renderSpec.js';
import { applyPatch, createEmptyDoc } from './ops.js';
import { resolveTimeline } from './resolveTimeline.js';
import { buildSrt } from './srt.js';
import type { VideoDoc, VideoDocOp } from './types.js';

/** §5.13 (AA) 42 — 내보내기 편의의 순수 판정(설정 거르개 · 파일 이름 · 계획 · 구간 · WAV · SRT 구간). */

function docWith(ops: VideoDocOp[]): VideoDoc {
  const d = createEmptyDoc('d1', '시험', 1000);
  const r = applyPatch(d, { baseVersion: d.version, ops }, 2000);
  if (!r.ok) throw new Error(`setup failed: ${r.reason}`);
  return r.doc;
}

const at = new Date(2026, 9, 17, 9, 5, 7);

describe('normalizeExportSettings — 42-1 거르개', () => {
  it('비어 있으면 기본값, 모르는 값은 기본값으로 바꾼다(버리지 않는다)', () => {
    expect(normalizeExportSettings(undefined)).toEqual(DEFAULT_EXPORT_SETTINGS);
    const s = normalizeExportSettings({ format: 'gif', quality: 'ultra', scale: 0.33, fps: 61.5, captions: 'karaoke', conflict: 'merge', outputDir: 42 });
    expect(s.format).toBe('mp4');
    expect(s.quality).toBe('high');
    expect(s.scale).toBe(1);
    expect(s.fps).toBeNull();
    expect(s.captions).toBe('burn');
    expect(s.conflict).toBe('number');
    expect(s.outputDir).toBeNull();
  });

  it('허용 값은 그대로 지킨다 — 끝난 뒤 칸도 하나씩', () => {
    const s = normalizeExportSettings({
      format: 'wav', quality: 'very-high', scale: 0.5, fps: 60, audio: false, captions: 'separate', outputDir: '  D:/Exports  ',
      fileName: '{title} - {scene}', conflict: 'overwrite', after: { reveal: true, notify: false }, keepAwake: false,
    });
    expect(s).toMatchObject({ format: 'wav', quality: 'very-high', scale: 0.5, fps: 60, audio: false, captions: 'separate', outputDir: 'D:/Exports', fileName: '{title} - {scene}', conflict: 'overwrite', keepAwake: false });
    expect(s.after).toEqual({ reveal: true, notify: false, deliver: true });
  });

  it('프리셋은 안전한 id·이름만, 같은 id 는 한 번만', () => {
    const f = normalizeExportSettingsFile({ last: { fps: 24 }, presets: [{ id: 'a', name: '쇼츠', settings: {} }, { id: 'a', name: '중복' }, { id: '../x', name: '나쁨' }, { id: 'b', name: '' }] });
    expect(f.last.fps).toBe(24);
    expect(f.presets.map((p) => p.id)).toEqual(['a']);
  });
});

describe('렌더 일감 모양 — 42-4', () => {
  it('구간은 순서·음수를 바로잡고 너무 짧으면 버린다(= 전체)', () => {
    expect(normalizeRange({ start: 5, end: 2 })).toEqual({ start: 2, end: 5 });
    expect(normalizeRange({ start: -1, end: 3 }, 2)).toEqual({ start: 0, end: 2 });
    expect(normalizeRange({ start: 1, end: 1.01 })).toBeNull();
    expect(normalizeRange({ start: 'a', end: 1 })).toBeNull();
  });

  it('음소거 트랙은 id 모양만, 겹치면 한 번', () => {
    const spec = normalizeRenderSpec({ mutedTracks: ['audio', 'audio', '../x', 7], range: { start: 0, end: 2 } });
    expect(spec.mutedTracks).toEqual(['audio']);
    expect(spec.range).toEqual({ start: 0, end: 2 });
  });

  it('알림 글은 둘 다 있어야 싣고, 순번은 범위 안만', () => {
    expect(normalizeRenderOutput({ notice: { done: '끝' } }).notice).toBeNull();
    expect(normalizeRenderOutput({ notice: { done: '끝', failed: '실패' }, index: 3 })).toMatchObject({ notice: { done: '끝', failed: '실패' }, index: 3 });
    expect(normalizeRenderOutput({ index: -1 }).index).toBeNull();
    expect(normalizeRenderOutput({ dir: 'C:/Out' }).dir).toBe('C:/Out');
  });

  it('확장자 · 짝수 크기', () => {
    expect(renderExtension({ format: 'mp4' })).toBe('mp4');
    expect(renderExtension({ format: 'webm' })).toBe('webm');
    expect(renderExtension({ format: 'webm-alpha' })).toBe('webm');
    expect(renderExtension({ format: 'wav' })).toBe('wav');
    expect(scaledSize({ width: 1080, height: 1920 }, 0.75)).toEqual({ width: 810, height: 1440 });
    expect(scaledSize({ width: 1001, height: 999 }, 0.5)).toEqual({ width: 500, height: 500 });
    expect(scaledSize({ width: 1001, height: 999 }, 1)).toEqual({ width: 1001, height: 999 });
  });

  it('설정 + 그 렌더의 값 → 일감', () => {
    const spec = specFromSettings({ ...DEFAULT_EXPORT_SETTINGS, audio: false }, { mutedTracks: ['a'], range: { start: 1, end: 2 } });
    expect(spec).toMatchObject({ audio: false, mutedTracks: ['a'], range: { start: 1, end: 2 }, format: 'mp4' });
  });
});

describe('파일 이름 — 42-2', () => {
  const ctx = { title: '내 영상', docId: 'vid-1', format: 'portrait' as const, width: 1080, height: 1920, fps: 30, scene: null, index: null, at };

  it('자리를 풀고, 빈 자리는 앞의 구분자와 함께 걷는다', () => {
    expect(buildRenderFileName('{title} - {scene}', ctx)).toBe('내 영상');
    expect(buildRenderFileName('{title} - {scene}', { ...ctx, scene: '인트로' })).toBe('내 영상 - 인트로');
    expect(buildRenderFileName('{scene} - {title}', ctx)).toBe('내 영상');
    expect(buildRenderFileName('{title}_{format}_{w}x{h}_{fps}fps', ctx)).toBe('내 영상_9x16_1080x1920_30fps');
    expect(buildRenderFileName('{date} {time} {n}', { ...ctx, index: 0 })).toBe('2026-10-17 09-05-07 01');
    expect(buildRenderFileName('A--B {title}', ctx)).toBe('A--B 내 영상');
  });

  it('세 OS 공통 한 규칙 — 못 쓰는 글자·예약 이름·끝의 점', () => {
    expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j', 'x')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeFileName('CON', 'x')).toBe('CON_');
    expect(sanitizeFileName('com1.mp4', 'x')).toBe('com1.mp4_');
    expect(sanitizeFileName('제목...  ', 'x')).toBe('제목');
    expect(sanitizeFileName('   ', '대체')).toBe('대체');
    expect(sanitizeFileName('...', '')).toBe('video');
    expect(sanitizeFileName('줄\n바꿈', 'x')).toBe('줄_바꿈');
  });

  it('UTF-8 바이트 상한 — 글자를 쪼개지 않는다', () => {
    const long = '가'.repeat(200);
    const s = sanitizeFileName(long, 'x');
    expect(utf8Bytes(s)).toBeLessThanOrEqual(EXPORT_FILE_NAME_MAX_BYTES);
    expect(s).toBe('가'.repeat(Math.floor(EXPORT_FILE_NAME_MAX_BYTES / 3)));
    expect(utf8Bytes(numberedName(s, 12))).toBeLessThanOrEqual(EXPORT_FILE_NAME_MAX_BYTES);
    expect(numberedName(s, 12).endsWith(' (12)')).toBe(true);
  });

  it('비어 있는 첫 이름 — 번호를 붙인다', () => {
    const taken = new Set(['a.mp4', 'a (2).mp4']);
    expect(firstFreeName('a', 'mp4', (n) => taken.has(n))).toBe('a (3).mp4');
    expect(firstFreeName('b', 'mp4', (n) => taken.has(n))).toBe('b.mp4');
    expect(firstFreeName('c', 'mp4', () => true, 36)).toBe('c-10.mp4');
  });
});

describe('계획 — 42-3·42-4·42-5', () => {
  it('소리를 내는 트랙 — 소리 트랙과 소리 있는 실사 화면 트랙만', () => {
    const doc = docWith([
      { op: 'setAsset', asset: { id: 'clip', kind: 'video', source: { kind: 'file', path: 'a.mp4' }, duration: 4, hasAudio: true } },
      { op: 'setAsset', asset: { id: 'mute', kind: 'video', source: { kind: 'file', path: 'b.mp4' }, duration: 4, hasAudio: false } },
      { op: 'addTrack', track: { id: 'v2', kind: 'visual', items: [{ id: 'm', kind: 'footage', at: 0, duration: 2, assetId: 'mute' }] } },
      { op: 'addItem', trackId: 'visual', item: { id: 'f', kind: 'footage', at: 0, duration: 2, assetId: 'clip' } },
      { op: 'updateTrack', trackId: 'audio', patch: { muted: true } },
    ]);
    const tracks = audibleTracks(doc);
    expect(tracks.map((t) => [t.id, t.kind, t.muted])).toEqual([['visual', 'visual', false], ['audio', 'audio', true]]);
  });

  it('그 렌더만 음소거한 사본 — 문서는 그대로', () => {
    const doc = createEmptyDoc('d', 't', 1);
    expect(withMutedTracks(doc, [])).toBe(doc);
    const muted = withMutedTracks(doc, ['audio']);
    expect(muted.tracks.find((t) => t.id === 'audio')?.muted).toBe(true);
    expect(doc.tracks.find((t) => t.id === 'audio')?.muted).toBeUndefined();
    expect(withMutedTracks(muted, ['audio'])).toBe(muted);
  });

  it('프레임 계획 — 구간·프레임 수, 부동소수 꼬리로 한 장 더 그리지 않는다', () => {
    expect(renderFramePlan(10, 30)).toEqual({ start: 0, end: 10, fps: 30, frames: 300 });
    expect(renderFramePlan(10, 30, { fps: 24, range: { start: 2, end: 4 } })).toEqual({ start: 2, end: 4, fps: 24, frames: 48 });
    expect(renderFramePlan(1.3, 30).frames).toBe(39);
    expect(renderFramePlan(10, 30, { range: { start: 9, end: 20 } })).toMatchObject({ start: 9, end: 10, frames: 30 });
    expect(renderFramePlan(0, 30).frames).toBe(0);
  });

  it('경과·남은 시간은 멈춘 시간을 뺀다', () => {
    const t = renderTiming({ status: 'running', progress: 0.5, startedAt: 0, pausedMs: 2000, frame: 150 }, 12_000);
    expect(t.elapsedMs).toBe(10_000);
    expect(t.etaMs).toBe(10_000);
    expect(t.fps).toBe(15);
    const paused = renderTiming({ status: 'running', progress: 0.5, startedAt: 0, pausedAt: 10_000 }, 15_000);
    expect(paused.elapsedMs).toBe(10_000);
    expect(renderTiming({ status: 'queued', progress: 0 }, 5).elapsedMs).toBeNull();
    expect(renderTiming({ status: 'done', progress: 1, startedAt: 0, finishedAt: 4000 }, 9_999).etaMs).toBeNull();
  });

  it('문서 × 판형 × 장면 — 다른 문서는 늘 전체, 상한을 넘은 사실을 알린다', () => {
    const docs = [{ id: 'a', title: 'A', format: 'landscape' as const }, { id: 'b', title: 'B', format: 'portrait' as const }];
    const plan = planExportJobs({
      docs, currentDocId: 'a', ownFormat: true, extraFormats: ['square'],
      pieces: [{ range: { start: 0, end: 1 }, scene: 'S1' }, { range: { start: 1, end: 2 }, scene: 'S2' }],
    });
    expect(plan.entries).toHaveLength(2 * 2 + 2 * 1);
    expect(plan.entries.filter((e) => e.doc.id === 'b').every((e) => e.range === null)).toBe(true);
    expect(plan.entries.filter((e) => e.derived).map((e) => e.format)).toEqual(['square', 'square', 'square']);
    expect(plan.entries.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.truncated).toBe(false);
    const many = planExportJobs({ docs: [docs[0]!], currentDocId: 'a', ownFormat: true, extraFormats: [], pieces: Array.from({ length: EXPORT_BATCH_MAX + 5 }, (_, i) => ({ range: { start: i, end: i + 1 }, scene: `s${i}` })) });
    expect(many.entries).toHaveLength(EXPORT_BATCH_MAX);
    expect(many.truncated).toBe(true);
    expect(planExportJobs({ docs, currentDocId: 'a', ownFormat: false, extraFormats: [], pieces: [] }).entries.map((e) => e.format)).toEqual(['landscape', 'portrait']);
  });

  it('여러 파일이면 이름 규칙에 차이를 넣는다', () => {
    const d = { id: 'a', title: 'A', format: 'landscape' as const };
    expect(batchFileName('{title}', [{ doc: d, format: 'landscape', derived: false, range: null, scene: 'S', index: 0 }])).toBe('{title} - {scene}');
    expect(batchFileName('{title}', [
      { doc: d, format: 'landscape', derived: false, range: null, scene: null, index: 0 },
      { doc: d, format: 'square', derived: true, range: null, scene: null, index: 1 },
    ])).toBe('{title} - {format}');
    expect(batchFileName('{title} {scene} {format}', [{ doc: d, format: 'square', derived: true, range: null, scene: 'S', index: 0 }])).toBe('{title} {scene} {format}');
  });
});

describe('WAV — 42-1 소리만', () => {
  it('머리 44바이트 + PCM 16비트 교차 표본, 넘는 값은 자른다', () => {
    const bytes = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, -2, 0])], 48_000);
    const view = new DataView(bytes.buffer);
    const text = (o: number): string => String.fromCharCode(...bytes.slice(o, o + 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(40, true)).toBe(3 * 2 * 2);
    expect(bytes.length).toBe(44 + 12);
    expect([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 16384, 32767, -32768, -32768, 0]);
  });
});

describe('SRT 구간 — 42-4', () => {
  it('구간 안 큐만, 구간 시작을 0 으로', () => {
    const doc = docWith([
      { op: 'addItem', trackId: 'caption', item: { id: 'c', kind: 'caption', at: 0, duration: 10, cues: [{ start: 1, end: 3, text: '하나' }, { start: 5, end: 7, text: '둘' }] } },
    ]);
    const srt = buildSrt(doc, resolveTimeline(doc), { start: 2, end: 6 });
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,000\n하나\n\n2\n00:00:03,000 --> 00:00:04,000\n둘\n');
  });
});
