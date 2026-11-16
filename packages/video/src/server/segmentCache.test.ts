import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RENDER_SEGMENT_MAX_BYTES, VIDEO_SEGMENT_CACHE_DIR } from '../constants.js';
import { SegmentPruneBook, listSegments, pruneSegments, readSegment, removeSegmentDir, segmentDirFor, segmentRootFor, writeSegment } from './segmentCache.js';

const key = (n: number): string => n.toString(16).padStart(64, '0');
const body = (size: number, fill = 7): Buffer => Buffer.alloc(size, fill);
const DAY = 24 * 60 * 60 * 1000;

let project: string;
beforeEach(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-seg-')); });
afterEach(() => { fs.rmSync(project, { recursive: true, force: true }); });

/** 파일의 수정 시각을 `ago` 밀리초 전으로 돌린다. */
function age(file: string, ago: number, now = Date.now()): void {
  const at = new Date(now - ago);
  fs.utimesSync(file, at, at);
}

describe('구간 조각 자리 — (E-6)', () => {
  it('프로젝트 안 캐시 자리의 문서 폴더에 둔다', () => {
    const dir = segmentDirFor(project, 'doc-1');
    expect(dir).toBe(path.join(project, '.vibisual', ...VIDEO_SEGMENT_CACHE_DIR.split('/'), 'doc-1'));
    expect(path.dirname(dir)).toBe(segmentRootFor(project));
  });

  it('쓴 조각을 그대로 읽는다(임시 파일은 남지 않는다)', async () => {
    const dir = segmentDirFor(project, 'd');
    expect(await writeSegment(dir, key(1), body(1000))).toBe(true);
    expect((await readSegment(dir, key(1)))?.equals(body(1000))).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([`${key(1)}.seg`]);
    expect(await listSegments(dir, [key(1), key(2), 'not-a-key'])).toEqual([key(1)]);
    expect(await listSegments(path.join(project, 'nowhere'), [key(1)])).toEqual([]);
  });

  it('열쇠 모양이 아니거나 비었거나 상한을 넘는 조각은 남기지 않는다', async () => {
    const dir = segmentDirFor(project, 'd');
    expect(await writeSegment(dir, '../escape', body(10))).toBe(false);
    expect(await writeSegment(dir, key(1).toUpperCase().replace(/0/g, 'A'), body(10))).toBe(false);
    expect(await writeSegment(dir, key(1), Buffer.alloc(0))).toBe(false);
    expect(await writeSegment(dir, key(1), Buffer.alloc(RENDER_SEGMENT_MAX_BYTES + 1))).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
    expect(await readSegment(dir, '../escape')).toBeNull();
  });

  it('본문이 한 바이트라도 바뀐 조각은 읽지 않고 지운다', async () => {
    const dir = segmentDirFor(project, 'd');
    await writeSegment(dir, key(1), body(500));
    const file = path.join(dir, `${key(1)}.seg`);
    const bytes = fs.readFileSync(file);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    fs.writeFileSync(file, bytes);
    expect(await readSegment(dir, key(1))).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('표식이 다르거나 잘린 파일도 지운다', async () => {
    const dir = segmentDirFor(project, 'd');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key(2)}.seg`), Buffer.from('not a segment at all, just some text that is long enough'));
    fs.writeFileSync(path.join(dir, `${key(3)}.seg`), Buffer.from('VIBISEG1'));
    expect(await readSegment(dir, key(2))).toBeNull();
    expect(await readSegment(dir, key(3))).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('읽으면 수정 시각이 오른다(오래 안 쓴 것부터 지우는 기준)', async () => {
    const dir = segmentDirFor(project, 'd');
    await writeSegment(dir, key(1), body(100));
    const file = path.join(dir, `${key(1)}.seg`);
    age(file, 10 * DAY);
    const now = Date.now();
    await readSegment(dir, key(1), now);
    expect(Math.abs(fs.statSync(file).mtimeMs - now)).toBeLessThan(2000);
  });

  it('문서를 지우면 그 문서의 자리를 통째로 걷는다', async () => {
    const dir = segmentDirFor(project, 'd');
    await writeSegment(dir, key(1), body(100));
    await removeSegmentDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
    await removeSegmentDir(dir);
  });
});

describe('pruneSegments — §3.2.3 상한·나이', () => {
  it('안 쓴 지 오래된 조각은 상한과 무관하게 지운다', async () => {
    const dir = segmentDirFor(project, 'd');
    await writeSegment(dir, key(1), body(100));
    await writeSegment(dir, key(2), body(100));
    age(path.join(dir, `${key(1)}.seg`), 31 * DAY);
    const result = await pruneSegments(segmentRootFor(project), { maxAgeMs: 30 * DAY });
    expect(result.removed).toBe(1);
    expect(await listSegments(dir, [key(1), key(2)])).toEqual([key(2)]);
  });

  it('합계 상한을 넘으면 마지막으로 쓴 지 오래된 것부터 상한의 비율까지 내린다(문서를 가리지 않는다)', async () => {
    const a = segmentDirFor(project, 'a');
    const b = segmentDirFor(project, 'b');
    for (let i = 1; i <= 5; i += 1) await writeSegment(i % 2 === 0 ? b : a, key(i), body(1000));
    // 1 이 가장 오래됐고 5 가 가장 새것.
    for (let i = 1; i <= 5; i += 1) age(path.join(i % 2 === 0 ? b : a, `${key(i)}.seg`), (6 - i) * 60_000);
    const file = fs.statSync(path.join(a, `${key(1)}.seg`)).size;
    const result = await pruneSegments(segmentRootFor(project), { maxBytes: file * 4, ratio: 0.5 });
    expect(result.removed).toBe(3);
    expect(result.bytes).toBe(file * 2);
    expect(await listSegments(a, [key(1), key(3), key(5)])).toEqual([key(5)]);
    expect(await listSegments(b, [key(2), key(4)])).toEqual([key(4)]);
  });

  it('상한 안쪽이면 아무것도 지우지 않는다', async () => {
    const dir = segmentDirFor(project, 'd');
    await writeSegment(dir, key(1), body(1000));
    await writeSegment(dir, key(2), body(1000));
    expect((await pruneSegments(segmentRootFor(project))).removed).toBe(0);
    expect(await listSegments(dir, [key(1), key(2)])).toEqual([key(1), key(2)]);
  });

  it('방금 읽은 조각은 오래된 조각보다 뒤에 지워진다', async () => {
    const dir = segmentDirFor(project, 'd');
    await writeSegment(dir, key(1), body(1000));
    await writeSegment(dir, key(2), body(1000));
    age(path.join(dir, `${key(1)}.seg`), 5 * DAY);
    age(path.join(dir, `${key(2)}.seg`), 2 * DAY);
    await readSegment(dir, key(1));
    const file = fs.statSync(path.join(dir, `${key(1)}.seg`)).size;
    await pruneSegments(segmentRootFor(project), { maxBytes: file, ratio: 1 });
    expect(await listSegments(dir, [key(1), key(2)])).toEqual([key(1)]);
  });

  it('쓰다 멈춘 임시 파일과 빈 문서 폴더를 걷는다 — 방금 쓰는 임시 파일은 둔다', async () => {
    const dir = segmentDirFor(project, 'd');
    const empty = segmentDirFor(project, 'gone');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(empty, { recursive: true });
    const stale = path.join(dir, `${key(1)}.seg.1.abc.tmp`);
    const fresh = path.join(dir, `${key(2)}.seg.1.abd.tmp`);
    fs.writeFileSync(stale, 'x');
    fs.writeFileSync(fresh, 'x');
    age(stale, 2 * 60 * 60 * 1000);
    const result = await pruneSegments(segmentRootFor(project));
    expect(result.removed).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(empty)).toBe(false);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('모르는 파일은 건드리지 않는다', async () => {
    const dir = segmentDirFor(project, 'd');
    fs.mkdirSync(dir, { recursive: true });
    const note = path.join(dir, 'readme.txt');
    fs.writeFileSync(note, 'keep');
    age(note, 400 * DAY);
    await pruneSegments(segmentRootFor(project), { maxBytes: 0 });
    expect(fs.existsSync(note)).toBe(true);
  });

  it('자리가 없으면 조용히 끝난다', async () => {
    expect(await pruneSegments(segmentRootFor(project))).toEqual({ removed: 0, bytes: 0 });
  });
});

describe('SegmentPruneBook — 정리를 거는 때', () => {
  it('쓴 바이트가 문턱을 넘으면 정리를 한 번 건다', async () => {
    const dir = segmentDirFor(project, 'd');
    for (let i = 1; i <= 4; i += 1) {
      await writeSegment(dir, key(i), body(1000));
      age(path.join(dir, `${key(i)}.seg`), (5 - i) * 60_000);
    }
    const book = new SegmentPruneBook(2500, { maxBytes: 2200, ratio: 1 });
    book.noteWrite(project, 1000);
    book.noteWrite(project, 1000);
    await book.flush(project);
    // 아직 문턱 전이었으면 flush 가 걸었다 — 어느 쪽이든 상한 안쪽으로 내려온다.
    expect((await listSegments(dir, [key(1), key(2), key(3), key(4)])).length).toBe(2);
  });

  it('문턱을 넘는 순간 스스로 건다(끝맺음을 기다리지 않는다)', async () => {
    const dir = segmentDirFor(project, 'd');
    for (let i = 1; i <= 3; i += 1) {
      await writeSegment(dir, key(i), body(1000));
      age(path.join(dir, `${key(i)}.seg`), (4 - i) * 60_000);
    }
    const book = new SegmentPruneBook(1500, { maxBytes: 1100, ratio: 1 });
    book.noteWrite(project, 1000);
    expect((await listSegments(dir, [key(1), key(2), key(3)])).length).toBe(3);
    book.noteWrite(project, 1000);
    // 쓴 것이 없는 flush 는 이미 걸린 정리를 기다리기만 한다.
    await book.flush(project);
    expect(await listSegments(dir, [key(1), key(2), key(3)])).toEqual([key(3)]);
  });

  it('쓴 조각이 없으면 정리를 걸지 않는다', async () => {
    const dir = segmentDirFor(project, 'd');
    await writeSegment(dir, key(1), body(1000));
    const book = new SegmentPruneBook(10, { maxBytes: 0 });
    await book.flush(project);
    expect(await listSegments(dir, [key(1)])).toEqual([key(1)]);
  });

  it('대소문자만 다른 같은 프로젝트 경로는 Windows·macOS 에서 한 줄로 센다(Linux 는 따로)', async () => {
    const upper = project.toUpperCase();
    for (const [platform, shared] of [['win32', true], ['darwin', true], ['linux', false]] as const) {
      const book = new SegmentPruneBook(1500, { maxBytes: Number.MAX_SAFE_INTEGER }, platform);
      const counts = book as unknown as { written: Map<string, number> };
      book.noteWrite(project, 1000);
      book.noteWrite(upper, 400);
      expect(counts.written.size).toBe(shared || upper === project ? 1 : 2);
    }
  });
});
