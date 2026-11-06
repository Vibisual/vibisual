import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSONL_SCAN_CHUNK_BYTES } from '@vibisual/shared';
import { LiveFollowUpTranscriptWatch, liveFollowUpEvidenceAt, liveFollowUpEvidenceTarget } from './liveFollowUpEvidence.js';

/** §5.5 #17-18 ⑬ — 확인 불가로 잠긴 [작업에 반영]을 클로드 대화록의 기록으로 확정한다(모양은 CLI 2.1.318 실측). */

const SENT = Date.parse('2026-01-02T03:04:05.000Z');
const MESSAGE_ID = '3f0c2a54-8d1e-4b7a-9c61-2f5d8e7a1b90';
const OTHER_ID = '9a8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d';
const TEXT = '두 번째 방식으로 바꿔 주세요';

const iso = (offsetMs: number): string => new Date(SENT + offsetMs).toISOString();
const line = (record: Record<string, unknown>): string => JSON.stringify(record);
const absorbed = (patch: Record<string, unknown> = {}): string => line({
  type: 'queue-operation', operation: 'remove', timestamp: iso(107_000), sessionId: 'session-1',
  content: TEXT, reason: 'absorbed_mid_turn', commandUuid: MESSAGE_ID, deliveryId: 'delivery-1', ...patch,
});

const keyed = liveFollowUpEvidenceTarget({ text: TEXT, timestamp: SENT, liveTarget: { commandId: 'turn-1', messageId: MESSAGE_ID } });
const legacy = liveFollowUpEvidenceTarget({ text: TEXT, timestamp: SENT });

describe('liveFollowUpEvidenceAt', () => {
  it('accepts the engine absorbing our input at a step boundary, at the time it was absorbed', () => {
    expect(liveFollowUpEvidenceAt(absorbed(), keyed)).toBe(SENT + 107_000);
  });

  it('matches by id when both sides carry one — the same words from another input do not count', () => {
    expect(liveFollowUpEvidenceAt(absorbed({ commandUuid: OTHER_ID }), keyed)).toBeNull();
    // A removal without an id (older CLI) still matches by the exact text.
    expect(liveFollowUpEvidenceAt(absorbed({ commandUuid: undefined }), keyed)).toBe(SENT + 107_000);
  });

  it('falls back to the exact text for legacy records stored without a key', () => {
    expect(liveFollowUpEvidenceAt(absorbed(), legacy)).toBe(SENT + 107_000);
    expect(liveFollowUpEvidenceAt(absorbed({ content: `  ${TEXT}\r\n` }), legacy)).toBe(SENT + 107_000);
    expect(liveFollowUpEvidenceAt(absorbed({ content: '다른 지시입니다' }), legacy)).toBeNull();
  });

  it('matches the form actually sent when attachments were appended', () => {
    const target = liveFollowUpEvidenceTarget({ text: TEXT, timestamp: SENT, attachments: ['C:/shots/a.png'] });
    expect(liveFollowUpEvidenceAt(absorbed({ content: `${TEXT}\n\nC:/shots/a.png` }), target)).toBe(SENT + 107_000);
  });

  it('rejects removals that are not absorption, the enqueue record and the queued attachment', () => {
    expect(liveFollowUpEvidenceAt(absorbed({ reason: 'cancelled_by_user' }), keyed)).toBeNull();
    expect(liveFollowUpEvidenceAt(absorbed({ reason: undefined }), legacy)).toBeNull();
    expect(liveFollowUpEvidenceAt(line({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(2_000), content: TEXT }), legacy)).toBeNull();
    expect(liveFollowUpEvidenceAt(line({
      type: 'attachment', timestamp: iso(2_000), uuid: OTHER_ID,
      attachment: { type: 'queued_command', prompt: [{ type: 'text', text: TEXT }], source_uuid: MESSAGE_ID },
    }), keyed)).toBeNull();
  });

  it('rejects records written before the input', () => {
    expect(liveFollowUpEvidenceAt(absorbed({ timestamp: iso(-60_000) }), keyed)).toBeNull();
  });

  it('accepts a user line written with our id, but not meta lines or lines without a time', () => {
    const user = (patch: Record<string, unknown> = {}): string => line({
      type: 'user', uuid: MESSAGE_ID, timestamp: iso(4_000), message: { role: 'user', content: [{ type: 'text', text: TEXT }] }, ...patch,
    });
    expect(liveFollowUpEvidenceAt(user(), keyed)).toBe(SENT + 4_000);
    expect(liveFollowUpEvidenceAt(user({ isMeta: true }), keyed)).toBeNull();
    expect(liveFollowUpEvidenceAt(user({ timestamp: undefined }), keyed)).toBeNull();
    // Without a key there is nothing to tie a user line to this input.
    expect(liveFollowUpEvidenceAt(user(), legacy)).toBeNull();
  });

  it('ignores malformed and unrelated lines without throwing', () => {
    expect(liveFollowUpEvidenceAt('{"type":"queue-operation", broken', keyed)).toBeNull();
    expect(liveFollowUpEvidenceAt(line({ type: 'assistant', timestamp: iso(5_000) }), keyed)).toBeNull();
    expect(liveFollowUpEvidenceAt('', keyed)).toBeNull();
  });
});

describe('LiveFollowUpTranscriptWatch', () => {
  let dir = '';
  let file = '';
  const size = (): number => fs.statSync(file).size;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-follow-up-evidence-'));
    file = path.join(dir, 'session.jsonl');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads only what was appended and finds evidence written after an earlier miss', async () => {
    fs.writeFileSync(file, `${line({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(1_000), content: TEXT })}\n`);
    const watch = new LiveFollowUpTranscriptWatch();
    expect(await watch.check('cmd-1', file, size(), keyed)).toBeNull();
    // Half a line first — it must wait for the rest instead of misreading a fragment.
    const evidence = `${absorbed()}\n`;
    fs.appendFileSync(file, evidence.slice(0, 40));
    expect(await watch.check('cmd-1', file, size(), keyed)).toBeNull();
    fs.appendFileSync(file, evidence.slice(40));
    expect(await watch.check('cmd-1', file, size(), keyed)).toBe(SENT + 107_000);
  });

  it('does not open the transcript when it has not grown, and re-reads from the start after retain drops it', async () => {
    fs.writeFileSync(file, `${line({ type: 'assistant', timestamp: iso(1_000) })}\n`);
    const watch = new LiveFollowUpTranscriptWatch();
    const open = vi.spyOn(fsp, 'open');
    await watch.check('cmd-1', file, size(), keyed);
    expect(open).toHaveBeenCalledTimes(1);
    await watch.check('cmd-1', file, size(), keyed);
    expect(open).toHaveBeenCalledTimes(1);
    watch.retain(new Set());
    await watch.check('cmd-1', file, size(), keyed);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('decodes text whose multi-byte character straddles a read chunk boundary', async () => {
    const evidence = absorbed();
    const textStart = Buffer.byteLength(evidence.slice(0, evidence.indexOf(TEXT)));
    const fillerBase = Buffer.byteLength(`${line({ type: 'progress', pad: '' })}\n`);
    // The first chunk ends one byte into the first (3-byte) character of the text.
    const pad = JSONL_SCAN_CHUNK_BYTES - 1 - textStart - fillerBase;
    fs.writeFileSync(file, `${line({ type: 'progress', pad: 'a'.repeat(pad) })}\n${evidence}\n`);
    const watch = new LiveFollowUpTranscriptWatch();
    // Text match only (legacy) — an id match would pass even if the text were garbled.
    expect(await watch.check('cmd-1', file, size(), legacy)).toBe(SENT + 107_000);
  });

  it('starts over when the transcript is replaced by a shorter file', async () => {
    fs.writeFileSync(file, `${line({ type: 'assistant', timestamp: iso(1_000), pad: 'x'.repeat(500) })}\n`);
    const watch = new LiveFollowUpTranscriptWatch();
    expect(await watch.check('cmd-1', file, size(), keyed)).toBeNull();
    fs.writeFileSync(file, `${absorbed()}\n`);
    expect(await watch.check('cmd-1', file, size(), keyed)).toBe(SENT + 107_000);
  });
});
