import type { CaptionCue, VideoDoc, VideoDocOp } from '@vibisual/video';
import { buildInsertItemOps, nextEditorId } from './videoEditor.js';

const TIMESTAMP = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/;

function parseTimestamp(value: string): number | undefined {
  const match = TIMESTAMP.exec(value.trim());
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000 : undefined;
}

/** Strict SRT parsing: a malformed nonempty block rejects the import instead of silently losing subtitles. */
export function parseSrt(text: string): CaptionCue[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const cues = normalized.split(/\n[\t ]*\n/).map((block, index): CaptionCue => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0]?.trim() ?? '')) lines.shift();
    const timing = lines.shift()?.match(/^\s*(\S+)\s+-->\s+(\S+)\s*$/);
    const start = timing ? parseTimestamp(timing[1] ?? '') : undefined;
    const end = timing ? parseTimestamp(timing[2] ?? '') : undefined;
    const body = lines.join('\n').trim();
    if (start === undefined || end === undefined || end <= start || !body) throw new Error(`Invalid SRT cue ${index + 1}`);
    return { start, end, text: body };
  });
  return cues.sort((a, b) => a.start - b.start);
}

export function buildCaptionOps(doc: VideoDoc, cues: readonly CaptionCue[], label: string): VideoDocOp[] {
  if (!cues.length || cues.some(c => !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || !c.text.trim())) return [];
  const start = Math.min(...cues.map(c => c.start));
  const end = Math.max(...cues.map(c => c.end));
  return buildInsertItemOps(doc, { id: nextEditorId(doc, 'caption'), kind: 'caption', at: start, duration: end - start,
    label, cues: structuredClone(cues) });
}
