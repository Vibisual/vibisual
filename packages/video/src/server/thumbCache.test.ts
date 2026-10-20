import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decodeThumbDataUrl, pruneThumbs, readThumbs, removeThumbsDir, writeThumb } from './thumbCache.js';

const PNG = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;
const WEBP = `data:image/webp;base64,${Buffer.from('webp-bytes').toString('base64')}`;
const KEY_A = '0123456789abcdef';
const KEY_B = 'fedcba9876543210';
const KEY_C = 'aaaaaaaaaaaaaaaa';

let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-thumbs-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('§5.13 (X) 39-4 대표 프레임 디스크 기억', () => {
  it('쓴 그림을 같은 열쇠로 그대로 읽는다(형식 머리까지)', async () => {
    expect(await writeThumb(dir, KEY_A, WEBP)).toBe(true);
    expect(await writeThumb(dir, KEY_B, PNG)).toBe(true);
    const found = await readThumbs(dir, [KEY_A, KEY_B, KEY_C]);
    expect(found.get(KEY_A)).toBe(WEBP);
    expect(found.get(KEY_B)).toBe(PNG);
    expect(found.has(KEY_C)).toBe(false);
  });

  it('같은 열쇠를 다른 형식으로 다시 쓰면 옛 형식은 걷힌다', async () => {
    await writeThumb(dir, KEY_A, PNG);
    await writeThumb(dir, KEY_A, WEBP);
    expect(fs.readdirSync(dir).sort()).toEqual([`${KEY_A}.webp`]);
  });

  it('열쇠 모양이 아니거나·받지 않는 형식이면 남기지 않는다', async () => {
    expect(await writeThumb(dir, '../escape', WEBP)).toBe(false);
    expect(await writeThumb(dir, KEY_A, 'data:text/html;base64,PGh0bWw+')).toBe(false);
    expect(decodeThumbDataUrl('not a data url')).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('상한을 넘으면 지금 쓰는 것은 남기고 오래된 것부터 지운다 · 쓰다 멈춘 임시 파일도 치운다', async () => {
    await writeThumb(dir, KEY_A, WEBP);
    await writeThumb(dir, KEY_B, WEBP);
    await writeThumb(dir, KEY_C, WEBP);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(dir, `${KEY_B}.webp`), old, old);
    fs.writeFileSync(path.join(dir, `${KEY_C}.webp.1.x.tmp`), 'partial');
    const removed = await pruneThumbs(dir, new Set([KEY_A]), 2);
    expect(removed).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual([`${KEY_A}.webp`, `${KEY_C}.webp`]);
  });

  it('문서를 지우면 그 자리를 통째로 걷는다(없어도 조용하다)', async () => {
    await writeThumb(dir, KEY_A, WEBP);
    await removeThumbsDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
    await expect(removeThumbsDir(dir)).resolves.toBeUndefined();
  });
});
