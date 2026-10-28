import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyDoc } from '../index.js';
import type { VideoDoc } from '../types.js';
import { VersionBook } from './versionBook.js';
import { compositionFingerprint, compositionFingerprintAsync } from './composition.js';

/** §5.13 (Y) 40-7 ② — 판 기억: 파일이 그대로면 다시 읽지 않는지, 서버가 적으면 판이 바뀌고 지켜보는 창에 알리는지, 지문의 동기·비동기 판이 같은지. */

let dir: string;
let now = 1_000;

function file(docId: string): string {
  return path.join(dir, `${docId}.json`);
}

/** 판을 정한 빈 문서(`createEmptyDoc` 의 셋째 인자는 시각이다). */
function docAt(id: string, title: string, version: number): VideoDoc {
  return { ...createEmptyDoc(id, title, 1), version };
}

function writeDocFile(doc: VideoDoc): void {
  fs.writeFileSync(file(doc.id), JSON.stringify(doc));
}

function book(notify = vi.fn(), parse = vi.fn((text: string) => JSON.parse(text) as VideoDoc)) {
  return { notify, parse, book: new VersionBook({ fileOf: (_p, id) => file(id), parse, notify, now: () => now }) };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-version-'));
  now = 1_000;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('§5.13 (Y) 40-7 ② — VersionBook', () => {
  it('answers from memory while the file is unchanged (one async stat, no re-read or re-parse)', async () => {
    const doc = docAt('d1', 'Title', 3);
    writeDocFile(doc);
    const { book: b, parse } = book();
    expect(await b.version(dir, 'd1', 'Project')).toMatchObject({ id: 'd1', title: 'Title', version: 3, duration: 0 });
    expect(await b.version(dir, 'd1', 'Project')).toMatchObject({ version: 3 });
    expect(await b.doc(dir, 'd1')).toMatchObject({ id: 'd1' });
    expect(parse).toHaveBeenCalledOnce();
  });

  it('shares one read between simultaneous askers', async () => {
    writeDocFile(docAt('d1', 'T', 1));
    const { book: b, parse } = book();
    await Promise.all([b.version(dir, 'd1', 'P'), b.version(dir, 'd1', 'P'), b.doc(dir, 'd1')]);
    expect(parse).toHaveBeenCalledOnce();
  });

  it('is null for a missing or unreadable doc', async () => {
    const { book: b } = book(vi.fn(), vi.fn(() => null));
    expect(await b.version(dir, 'nope', 'P')).toBeNull();
    fs.writeFileSync(file('bad'), '{');
    expect(await b.version(dir, 'bad', 'P')).toBeNull();
  });

  it('a write by this server replaces the memory and tells the windows watching that doc (once per project name)', async () => {
    writeDocFile(docAt('d1', 'T', 1));
    const { book: b, notify } = book();
    await b.version(dir, 'd1', 'Name A');
    await b.version(dir, 'd1', 'Name B');
    const next = docAt('d1', 'T2', 2);
    writeDocFile(next);
    b.noteWrite(dir, next);
    expect(notify.mock.calls.map((c) => c[0])).toEqual([
      { project: 'Name A', kind: 'doc-version', key: 'd1', version: 2 },
      { project: 'Name B', kind: 'doc-version', key: 'd1', version: 2 },
    ]);
    expect(await b.version(dir, 'd1', 'Name A')).toMatchObject({ version: 2, title: 'T2' });
  });

  it('does not notify for docs nobody watches, nor for a write that keeps the same version', async () => {
    writeDocFile(docAt('d1', 'T', 1));
    const { book: b, notify } = book();
    await b.doc(dir, 'd1'); // `/content` 만 — 지켜보는 창이 아니다.
    b.noteWrite(dir, docAt('d1', 'T', 2));
    expect(notify).not.toHaveBeenCalled();
    await b.version(dir, 'd1', 'P');
    b.noteWrite(dir, docAt('d1', 'T', 2));
    expect(notify).not.toHaveBeenCalled();
  });

  it('notices an outside change of the file on the next ask and tells the other watchers', async () => {
    writeDocFile(docAt('d1', 'T', 1));
    const { book: b, notify } = book();
    await b.version(dir, 'd1', 'P');
    // 밖에서 바뀐 파일(크기가 달라진다).
    writeDocFile(docAt('d1', 'A much longer title', 5));
    expect(await b.version(dir, 'd1', 'P')).toMatchObject({ version: 5 });
    expect(notify).toHaveBeenCalledWith({ project: 'P', kind: 'doc-version', key: 'd1', version: 5 });
  });

  it('activity changes notify watchers; watched() is the recent askers; prune() forgets idle entries', async () => {
    writeDocFile(docAt('d1', 'T', 1));
    writeDocFile(docAt('d2', 'T', 1));
    const { book: b, notify } = book();
    await b.version(dir, 'd1', 'P');
    await b.doc(dir, 'd2');
    b.noteActivity(dir, 'd1');
    expect(notify).toHaveBeenCalledWith({ project: 'P', kind: 'activity', key: 'd1' });
    expect(b.watched(10_000).map((e) => e.docId)).toEqual(['d1']);
    now += 20_000;
    expect(b.watched(10_000)).toEqual([]);
    expect(b.size()).toBe(2);
    b.prune(15_000);
    expect(b.size()).toBe(0);
  });
});

describe('§5.13 (Y) 40-7 ② — compositionFingerprintAsync = compositionFingerprint', () => {
  it('gives the same value as the sync scan, and both change when a file changes', async () => {
    const folder = path.join(dir, '.vibisual', 'video', 'compositions', 'intro');
    fs.mkdirSync(path.join(folder, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(folder, 'app.js'), 'console.log(1)');
    fs.writeFileSync(path.join(folder, 'lib', 'x.css'), 'a{}');
    fs.mkdirSync(path.join(folder, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'node_modules', 'skip.js'), 'skip');
    const rel = '.vibisual/video/compositions/intro/index.html';
    const syncValue = compositionFingerprint(dir, rel);
    expect(syncValue).not.toBeNull();
    expect(await compositionFingerprintAsync(dir, rel)).toBe(syncValue);
    fs.writeFileSync(path.join(folder, 'app.js'), 'console.log(22)');
    const changed = compositionFingerprint(dir, rel);
    expect(changed).not.toBe(syncValue);
    expect(await compositionFingerprintAsync(dir, rel)).toBe(changed);
  });

  it('refuses paths outside the project or at its root (like the sync scan)', async () => {
    expect(await compositionFingerprintAsync(dir, '../outside/index.html')).toBeNull();
    expect(await compositionFingerprintAsync(dir, 'index.html')).toBeNull();
    expect(compositionFingerprint(dir, 'index.html')).toBeNull();
  });
});
