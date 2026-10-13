/**
 * §5.13 (W) 38-6 — 자막 파일 읽기와 자막 아이템 만들기(순수).
 *
 * 화면(가져오기·끌어 놓기)과 서버(`POST /doc/:id/captions/import` — 에이전트)가 **같은 파서**를 쓴다(두 벌 ❌ — 종전 SRT 파서는
 * 화면에만 있었다). 앱은 음성 모델을 품지 않으므로((H)) 받아쓰기는 바깥 도구가 하고, 여기서는 그 결과를 읽는다:
 *
 * - **SRT** — 엄격하게. 깨진 블록이 있으면 통째로 거절한다(조용히 자막을 잃지 않게).
 * - **VTT** — 큐 안 낱말 시각(`<00:00:01.500>`)이 있으면 낱말 단위 시각으로 옮긴다. 꾸밈 태그(`<c>`·`<v 이름>`·`<b>`)는 걷는다.
 * - **낱말 JSON** — `{ words:[{word|text,start,end}] }` · `{ segments:[{start,end,text,words?}] }` · 낱말 배열 그대로 ·
 *   `{ transcription:[{ offsets:{from,to}, text }] }`(밀리초). 낱말만 있으면 쉼·문장 부호·길이로 큐를 묶는다.
 */

import { CAPTION_GROUP_MAX_CHARS, CAPTION_GROUP_MAX_SECONDS, CAPTION_GROUP_PAUSE_SECONDS } from './constants.js';
import type { CaptionCue, CaptionWord, VideoDoc, VideoDocOp, VideoItem, VideoTrackKind } from './types.js';

const SRT_TIMESTAMP = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000 || 0;
}

function parseSrtTimestamp(value: string): number | undefined {
  const match = SRT_TIMESTAMP.exec(value.trim());
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000 : undefined;
}

/** Strict SRT parsing: a malformed nonempty block rejects the import instead of silently losing subtitles. */
export function parseSrt(text: string): CaptionCue[] {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const cues = normalized.split(/\n[\t ]*\n/).map((block, index): CaptionCue => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0]?.trim() ?? '')) lines.shift();
    const timing = lines.shift()?.match(/^\s*(\S+)\s+-->\s+(\S+)\s*$/);
    const start = timing ? parseSrtTimestamp(timing[1] ?? '') : undefined;
    const end = timing ? parseSrtTimestamp(timing[2] ?? '') : undefined;
    const body = lines.join('\n').trim();
    if (start === undefined || end === undefined || end <= start || !body) throw new Error(`Invalid SRT cue ${index + 1}`);
    return { start, end, text: body };
  });
  return cues.sort((a, b) => a.start - b.start);
}

/** VTT 시각 — `hh:mm:ss.ttt` 또는 `mm:ss.ttt`. */
function parseVttTimestamp(value: string): number | undefined {
  const m = /^(?:(\d{1,}):)?([0-5]?\d):([0-5]\d)[.,](\d{3})$/.exec(value.trim());
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** 큐 본문의 꾸밈 태그를 걷는다(낱말 시각 태그는 따로 읽은 뒤). HTML 엔티티 몇 개를 푼다. */
function stripVttTags(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** 한 큐 본문에서 낱말 시각을 뽑는다. 낱말 시각 태그가 없으면 빈 배열. */
function vttWords(payload: string, start: number, end: number): CaptionWord[] {
  const marks = [...payload.matchAll(/<((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})>/g)];
  if (marks.length === 0) return [];
  // 조각: [시작 시각, 글] — 첫 조각은 큐 시작부터.
  const pieces: Array<{ t: number; text: string }> = [];
  let cursor = 0;
  let t = start;
  for (const m of marks) {
    const at = m.index ?? 0;
    pieces.push({ t, text: payload.slice(cursor, at) });
    const next = parseVttTimestamp(m[1] ?? '');
    t = next !== undefined ? next : t;
    cursor = at + m[0].length;
  }
  pieces.push({ t, text: payload.slice(cursor) });
  const words: CaptionWord[] = [];
  pieces.forEach((piece, i) => {
    const tokens = stripVttTags(piece.text).split(/\s+/).filter((w) => w !== '');
    if (tokens.length === 0) return;
    const until = pieces[i + 1]?.t ?? end;
    const span = Math.max(0, until - piece.t);
    tokens.forEach((token, k) => words.push({ t: round3(piece.t + (span * k) / tokens.length), text: token }));
  });
  return words;
}

/** WebVTT — 머리(`WEBVTT`)·NOTE·STYLE·REGION 블록은 건너뛴다. 깨진 큐 블록이 있으면 통째로 거절한다. */
export function parseVtt(text: string): CaptionCue[] {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n[\t ]*\n/);
  const cues: CaptionCue[] = [];
  blocks.forEach((block, index) => {
    const lines = block.split('\n');
    const head = lines[0]?.trim() ?? '';
    if (index === 0 && /^WEBVTT\b/.test(head) && !lines.some((l) => l.includes('-->'))) return;
    if (/^(?:NOTE|STYLE|REGION)\b/.test(head)) return;
    if (index === 0 && /^WEBVTT\b/.test(head)) lines.shift();
    // 큐 이름 줄(시각 줄 앞)은 건너뛴다.
    if (lines.length > 0 && !(lines[0] ?? '').includes('-->')) lines.shift();
    const timing = lines.shift()?.match(/^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    const start = timing ? parseVttTimestamp(timing[1] ?? '') : undefined;
    const end = timing ? parseVttTimestamp(timing[2] ?? '') : undefined;
    const payload = lines.join('\n');
    const body = stripVttTags(payload).replace(/[ \t]+/g, ' ').trim();
    if (start === undefined || end === undefined || end <= start || !body) throw new Error(`Invalid VTT cue ${index + 1}`);
    const words = vttWords(payload, start, end);
    cues.push({ start, end, text: body, ...(words.length > 0 ? { words } : {}) });
  });
  return cues.sort((a, b) => a.start - b.start);
}

/** 받아쓰기 낱말 한 개(정규화 전 — 앞 공백을 보존해 띄어쓰기를 되살린다). */
export interface TimedWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function wordOf(raw: unknown): TimedWord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r['word'] === 'string' ? r['word'] : typeof r['text'] === 'string' ? r['text'] : null;
  const start = finite(r['start']) ?? finite(r['startTime']);
  const end = finite(r['end']) ?? finite(r['endTime']);
  if (text === null || start === undefined || end === undefined || end < start) return null;
  return { text, start, end };
}

const SENTENCE_END = /[.?!。？！…]["'”’)\]]?$/;

/** 이 낱말들을 한 줄로 — 낱말이 앞 공백을 품고 오면(받아쓰기 출력 관례) 그대로 잇고, 아니면 공백으로 잇는다. */
function joinWords(words: readonly TimedWord[]): string {
  const raw = words.some((w) => /^\s/.test(w.text));
  return (raw ? words.map((w) => w.text).join('') : words.map((w) => w.text.trim()).join(' ')).replace(/\s+/g, ' ').trim();
}

/**
 * 낱말 → 자막 큐. 쉼(`CAPTION_GROUP_PAUSE_SECONDS` 이상)·문장 끝·글자 수(`CAPTION_GROUP_MAX_CHARS`)·길이
 * (`CAPTION_GROUP_MAX_SECONDS`)에서 끊는다. 큐마다 낱말 시각을 싣는다(단어 강조 자막이 그대로 쓴다).
 */
export function cuesFromWords(input: readonly TimedWord[]): CaptionCue[] {
  const words = input.filter((w) => w.text.trim() !== '').slice().sort((a, b) => a.start - b.start);
  const cues: CaptionCue[] = [];
  let group: TimedWord[] = [];
  const flush = (): void => {
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) return;
    const text = joinWords(group);
    if (text !== '') {
      cues.push({
        start: round3(first.start),
        end: round3(Math.max(last.end, first.start + 0.05)),
        text,
        words: group.map((w) => ({ t: round3(w.start), text: w.text.trim() })),
      });
    }
    group = [];
  };
  for (const w of words) {
    const prev = group[group.length - 1];
    const first = group[0];
    if (prev && first) {
      const pause = w.start - prev.end;
      const length = joinWords([...group, w]).length;
      if (pause >= CAPTION_GROUP_PAUSE_SECONDS || SENTENCE_END.test(prev.text.trim()) || length > CAPTION_GROUP_MAX_CHARS || w.end - first.start > CAPTION_GROUP_MAX_SECONDS) flush();
    }
    group.push(w);
  }
  flush();
  return cues;
}

function msTimestamp(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v / 1000;
  return undefined;
}

/** 받아쓰기 JSON → 큐. 모르는 모양이면 null(자막이 아니다). */
export function parseWordsJson(value: unknown): CaptionCue[] | null {
  // 낱말 배열 그대로.
  if (Array.isArray(value)) {
    const words = value.map(wordOf).filter((w): w is TimedWord => w !== null);
    return words.length > 0 && words.length >= value.length / 2 ? cuesFromWords(words) : null;
  }
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  // 문단(segments) — 낱말이 있으면 문단을 큐로, 낱말 시각을 싣는다.
  if (Array.isArray(r['segments'])) {
    const segs = r['segments'] as unknown[];
    const cues: CaptionCue[] = [];
    const loose: TimedWord[] = [];
    for (const seg of segs) {
      if (!seg || typeof seg !== 'object') continue;
      const s = seg as Record<string, unknown>;
      const words = Array.isArray(s['words']) ? (s['words'] as unknown[]).map(wordOf).filter((w): w is TimedWord => w !== null) : [];
      const start = finite(s['start']);
      const end = finite(s['end']);
      const text = typeof s['text'] === 'string' ? s['text'].replace(/\s+/g, ' ').trim() : '';
      if (words.length > 0) { loose.push(...words); continue; }
      if (start !== undefined && end !== undefined && end > start && text !== '') cues.push({ start: round3(start), end: round3(end), text });
    }
    if (loose.length > 0) return [...cues, ...cuesFromWords(loose)].sort((a, b) => a.start - b.start);
    return cues.length > 0 ? cues : null;
  }
  // 낱말 목록.
  if (Array.isArray(r['words'])) {
    const words = (r['words'] as unknown[]).map(wordOf).filter((w): w is TimedWord => w !== null);
    return words.length > 0 ? cuesFromWords(words) : null;
  }
  // 밀리초 오프셋 목록(`transcription:[{ offsets:{from,to}, text }]`) — 조각이 짧으면 낱말로 묶는다.
  if (Array.isArray(r['transcription'])) {
    const parts: TimedWord[] = [];
    for (const p of r['transcription'] as unknown[]) {
      if (!p || typeof p !== 'object') continue;
      const o = (p as Record<string, unknown>)['offsets'];
      const text = (p as Record<string, unknown>)['text'];
      if (!o || typeof o !== 'object' || typeof text !== 'string') continue;
      const start = msTimestamp((o as Record<string, unknown>)['from']);
      const end = msTimestamp((o as Record<string, unknown>)['to']);
      if (start === undefined || end === undefined || end < start || text.trim() === '') continue;
      parts.push({ text, start, end });
    }
    if (parts.length === 0) return null;
    const short = parts.every((p) => p.text.trim().split(/\s+/).length <= 2);
    return short ? cuesFromWords(parts) : parts.map((p) => ({ start: round3(p.start), end: round3(p.end), text: p.text.replace(/\s+/g, ' ').trim() }));
  }
  return null;
}

/** 이 JSON 이 받아쓰기(자막) 모양인가 — 시작 화면이 자막과 재료(데이터)를 가른다. */
export function looksLikeCaptionJson(value: unknown): boolean {
  try {
    const cues = parseWordsJson(value);
    return cues !== null && cues.length > 0;
  } catch {
    return false;
  }
}

export type CaptionFileFormat = 'srt' | 'vtt' | 'json';

/** 파일 이름의 확장자로 형식을 고른다. 자막 형식이 아니면 null. */
export function captionFormatOf(fileName: string): CaptionFileFormat | null {
  const m = /\.(srt|vtt|json)$/i.exec(fileName.trim());
  return m ? (m[1]!.toLowerCase() as CaptionFileFormat) : null;
}

/** 자막 파일 본문 → 큐. 형식이 틀리면 이유와 함께 던진다(조용히 빈 자막 ❌). */
export function parseCaptionText(fileName: string, text: string): { cues: CaptionCue[]; words: boolean } {
  const format = captionFormatOf(fileName);
  let cues: CaptionCue[];
  if (format === 'srt') cues = parseSrt(text);
  else if (format === 'vtt') cues = parseVtt(text);
  else if (format === 'json') {
    let parsed: unknown;
    try { parsed = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new Error(`${fileName}: not valid JSON`); }
    const got = parseWordsJson(parsed);
    if (!got) throw new Error(`${fileName}: no word timestamps (expected words[{word,start,end}] or segments[])`);
    cues = got;
  } else {
    throw new Error(`${fileName}: captions must be .srt, .vtt or word-timestamp .json`);
  }
  return { cues, words: cues.some((c) => (c.words?.length ?? 0) > 0) };
}

/** 문서의 트랙·아이템·소재 id 와 겹치지 않는 `prefix-n`. */
export function nextDocId(doc: VideoDoc, prefix: string): string {
  const ids = new Set([...doc.tracks.map((t) => t.id), ...doc.tracks.flatMap((t) => t.items.map((i) => i.id)), ...Object.keys(doc.assets)]);
  let suffix = 1;
  while (ids.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

/**
 * 큐들을 자막 아이템 하나로 얹는 연산(순수). 숨기거나 끄지 않은 마지막 자막 트랙에 얹고, 없으면 자막 트랙을 만든다.
 * 큐 시각은 문서 전체 기준(절대 초)이다. 쓸 수 없는 큐가 섞여 있으면 빈 목록(얹지 않는다).
 */
export function captionImportOps(doc: VideoDoc, cues: readonly CaptionCue[], label: string): VideoDocOp[] {
  if (!cues.length || cues.some((c) => !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || !c.text.trim())) return [];
  const start = Math.min(...cues.map((c) => c.start));
  const end = Math.max(...cues.map((c) => c.end));
  const item: VideoItem = { id: nextDocId(doc, 'caption'), kind: 'caption', at: start, duration: end - start, label, cues: cues.map((c) => ({ ...c, ...(c.words ? { words: c.words.map((w) => ({ ...w })) } : {}) })) };
  const kind: VideoTrackKind = 'caption';
  const track = [...doc.tracks].reverse().find((t) => t.kind === kind && !t.hidden && !t.muted);
  if (track) return [{ op: 'addItem', trackId: track.id, item }];
  // 트랙 id 는 아이템 id(`caption-n`)와 갈라 둔다 — 같은 이름이면 사람이 읽을 때 헷갈린다.
  return [{ op: 'addTrack', track: { id: nextDocId(doc, 'captions'), kind, items: [item] } }];
}
