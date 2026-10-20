import type { AudioDoc, AudioTrack } from '@vibisual/audio';
import { describe, expect, it } from 'vitest';

import { soundLaneLevels, soundWaveLevels, SOUND_LANE_VIEW, type SoundInspectContext } from './soundInspect.js';

/**
 * §5.4 #15 (C) — 소리 앱의 파형(캔버스)·트랙 줄(SVG)을 Alt 인스펙터로 집으면 그 자리의 시각·클립을 답한다. 종전에는 파형이
 * 통째로, 트랙 줄은 어느 클립인지 모르는 `<rect>` 로 집혔다.
 */

const labels = { track: '트랙', range: (start: string, end: string) => `구간 ${start}–${end}` };

function soundDoc(tracks: readonly AudioTrack[]): AudioDoc {
  return {
    schemaVersion: 1, id: 'snd-1', title: 'Theme', version: 7, sampleRate: 48000, channels: 2, createdAt: 0, updatedAt: 0,
    assets: {
      a1: { id: 'a1', path: '.vibisual/audio/assets/drum.wav', name: 'drum.wav', duration: 10, sampleRate: 48000, channels: 2 },
      a2: { id: 'a2', path: '.vibisual/audio/assets/bass.wav', name: 'bass.wav', duration: 10, sampleRate: 48000, channels: 2 },
    },
    tracks,
  };
}

const kick = { id: 'c1', assetId: 'a1', at: 0, sourceStart: 1, duration: 4, label: 'Kick' };
const bass = { id: 'c2', assetId: 'a2', at: 2, sourceStart: 0, duration: 6 };
const tracks: AudioTrack[] = [{ id: 't1', label: 'Drums', clips: [kick] }, { id: 't2', clips: [bass] }];
const ctx = (over: Partial<SoundInspectContext> = {}, list: readonly AudioTrack[] = tracks): SoundInspectContext => ({
  projectId: 'My Project', doc: soundDoc(list), auditionClipId: null, ...over,
});
const wave = { width: 800, height: 200 };

describe('파형 — 그 시각 → 그 시각에 들리는 클립 → 고른 구간', () => {
  it('gives the moment under the cursor first, then every clip sounding there, with the document route', () => {
    const levels = soundWaveLevels(ctx(), { start: 0, span: 8 }, null, labels, { x: 300, y: 50, ...wave });
    expect(levels.map((l) => l.label)).toEqual(['00:03.00', 'Kick · Drums', 'bass.wav · 트랙']);
    expect(levels[0]!.rect).toEqual({ x: 297, y: 0, width: 6, height: 200 });
    expect(levels[0]!.text).toBe('Kick, bass.wav');
    expect(levels[1]!.rect).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(levels[2]!.rect).toEqual({ x: 200, y: 0, width: 600, height: 200 });
    const copied = levels[0]!.clipboard;
    expect(copied).toContain('[Sound] document "snd-1" ("Theme", version 7, 8.000s) in project "My Project"');
    expect(copied).toContain('[Pointed] 3.000s on the mix — sounding: clip "Kick" id "c1" on track "Drums" id "t1" (project 0.000s–4.000s, from 1.000s of asset "drum.wav" id "a1")');
    expect(copied).toContain('GET $VIBISUAL_BASE/api/app/vibisound/doc/snd-1?project=My%20Project');
    expect(copied).toContain('POST $VIBISUAL_BASE/api/app/vibisound/doc/snd-1/patch');
    expect(levels[1]!.clipboard).toContain('[Pointed] clip "Kick" id "c1"');
  });

  it('follows the mix rules — muted tracks, solo and disabled clips do not sound', () => {
    const at = { x: 300, y: 50, ...wave };
    const muted = soundWaveLevels(ctx({}, [tracks[0]!, { ...tracks[1]!, muted: true }]), { start: 0, span: 8 }, null, labels, at);
    expect(muted.map((l) => l.label)).toEqual(['00:03.00', 'Kick · Drums']);
    const solo = soundWaveLevels(ctx({}, [tracks[0]!, { ...tracks[1]!, solo: true }]), { start: 0, span: 8 }, null, labels, at);
    expect(solo.map((l) => l.label)).toEqual(['00:03.00', 'bass.wav · 트랙']);
    const off = soundWaveLevels(ctx({}, [{ ...tracks[0]!, clips: [{ ...kick, enabled: false }] }, tracks[1]!]), { start: 0, span: 8 }, null, labels, at);
    expect(off.map((l) => l.label)).toEqual(['00:03.00', 'bass.wav · 트랙']);
  });

  it('while auditioning an original, only that clip sounds (even on a muted track)', () => {
    const list = [tracks[0]!, { ...tracks[1]!, muted: true }];
    const levels = soundWaveLevels(ctx({ auditionClipId: 'c2' }, list), { start: 0, span: 8 }, null, labels, { x: 300, y: 0, ...wave });
    expect(levels.map((l) => l.label)).toEqual(['00:03.00', 'bass.wav · 트랙']);
    expect(levels[0]!.clipboard).toContain('on the original of the auditioned clip');
  });

  it('adds the selected range as the outer level when the moment is inside it, and maps a zoomed view', () => {
    const levels = soundWaveLevels(ctx(), { start: 2, span: 4 }, { start: 2.5, end: 3.5 }, labels, { x: 200, y: 0, ...wave });
    expect(levels[0]!.label).toBe('00:03.00');
    const range = levels.at(-1)!;
    expect(range.label).toBe('구간 00:02.50–00:03.50');
    expect(range.rect).toEqual({ x: 100, y: 0, width: 200, height: 200 });
    expect(range.clipboard).toContain('[Pointed] selected range 2.500s–3.500s (pointed at 3.000s)');
    // 보이는 창 밖으로 나간 클립 상자는 판 안에서 자른다.
    expect(levels[1]!.rect).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it('says silence where nothing sounds, and answers nothing for an empty view', () => {
    const levels = soundWaveLevels(ctx(), { start: 0, span: 10 }, null, labels, { x: 790, y: 0, ...wave });
    expect(levels).toHaveLength(1);
    expect(levels[0]!.clipboard).toContain('silence (no clip sounds here)');
    expect(soundWaveLevels(ctx(), { start: 0, span: 0 }, null, labels, { x: 10, y: 0, ...wave })).toEqual([]);
  });
});

describe('트랙 줄 — 커서 아래 클립 상자, 없으면 그 트랙의 그 시각', () => {
  const lane = { width: 1000, height: 48 };
  const sy = lane.height / SOUND_LANE_VIEW.height;

  it('picks the clip box under the cursor (same geometry as the drawn rect)', () => {
    const levels = soundLaneLevels(ctx(), 't1', 8, labels, { x: 100, y: 24, ...lane });
    expect(levels).toHaveLength(1);
    expect(levels[0]!.label).toBe('Kick · Drums');
    expect(levels[0]!.text).toBe('00:00.00–00:04.00');
    expect(levels[0]!.rect).toEqual({ x: 0, y: SOUND_LANE_VIEW.clipTop * sy, width: 500, height: SOUND_LANE_VIEW.clipHeight * sy });
    expect(levels[0]!.clipboard).toContain('clip "Kick" id "c1" on track "Drums" id "t1"');
  });

  it('keeps a tiny clip pickable at its minimum drawn width', () => {
    const blip = { id: 'c3', assetId: 'a1', at: 4, sourceStart: 0, duration: 0.001 };
    const levels = soundLaneLevels(ctx({}, [{ id: 't1', clips: [blip] }]), 't1', 8, labels, { x: 502, y: 24, ...lane });
    expect(levels[0]!.clipboard).toContain('id "c3"');
    expect(levels[0]!.rect.width).toBe(SOUND_LANE_VIEW.clipMinWidth);
  });

  it('answers the moment on that track above/below the clip boxes or in a gap', () => {
    const above = soundLaneLevels(ctx(), 't1', 8, labels, { x: 100, y: 2, ...lane });
    expect(above[0]!.label).toBe('00:00.80 · Drums');
    expect(above[0]!.clipboard).toContain('[Pointed] 0.800s on track "Drums" id "t1" — empty (no clip here)');
    const gap = soundLaneLevels(ctx(), 't2', 8, labels, { x: 100, y: 24, ...lane });
    expect(gap[0]!.label).toBe('00:00.80 · 트랙');
    expect(soundLaneLevels(ctx(), 'missing', 8, labels, { x: 100, y: 24, ...lane })).toEqual([]);
  });
});
