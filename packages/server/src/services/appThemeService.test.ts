/**
 * §4 앱 테마 — `scanAppThemesDir`·`createFromTheme`: 폴더 없음 = 빈 목록 · 파일마다 따로 실패(`.json` 아닌 파일은 건너뜀) · 같은 id 는 뒤의 것이 `duplicateId` ·
 * 남의 파일을 덮지 않는다(`-2`) · 내용이 같으면 알리지 않는다. 임시 폴더와 가짜 설정 저장소를 쓴다(진짜 `userDefaultsService` 는 import 순간 사용자 파일을 읽는다).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_THEME_LIMITS } from '@vibisual/shared';
import { AppThemeService, scanAppThemesDir } from './appThemeService.js';

// vi.mock 은 import 보다 먼저 올라간다 — 위 import 가 진짜 설정 저장소를 열지 않는다.
vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} },
}));

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-themes-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, body: unknown): void => {
  fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
};

describe('scanAppThemesDir', () => {
  it('폴더가 없으면 빈 목록이고 문제도 없다', () => {
    const c = scanAppThemesDir(path.join(dir, 'missing'));
    expect(c.themes).toEqual([]);
    expect(c.issues).toEqual([]);
  });

  it('파일마다 따로 실패하고, 나머지 테마는 쓴다', () => {
    write('good.json', { name: 'Good', extends: 'midnight' });
    write('broken.json', '{ "name": ');
    write('notes.txt', 'not a theme');
    write('huge.json', `{"name":"Huge","description":"${'x'.repeat(APP_THEME_LIMITS.maxFileBytes)}"}`);
    write('bom.json', `﻿${JSON.stringify({ name: 'With BOM' })}`);
    const c = scanAppThemesDir(dir);
    expect(c.themes.map((t) => t.id).sort()).toEqual(['custom:bom', 'custom:good']);
    const byFile = Object.fromEntries(c.issues.map((i) => [i.file, i.code]));
    expect(byFile['broken.json']).toBe('invalidJson');
    expect(byFile['huge.json']).toBe('tooLarge');
    expect(byFile['notes.txt']).toBeUndefined();
  });

  it('같은 id 가 둘이면 뒤의 파일을 건너뛰고 알린다', () => {
    write('a.json', { id: 'same', name: 'A' });
    write('b.json', { id: 'same', name: 'B' });
    const c = scanAppThemesDir(dir);
    expect(c.themes).toHaveLength(1);
    expect(c.themes[0]?.file).toBe('a.json');
    expect(c.issues.find((i) => i.code === 'duplicateId')?.file).toBe('b.json');
  });

  it('해석해야 드러나는 문제(없는 출발점)도 같은 목록에 싣는다', () => {
    write('orphan.json', { name: 'Orphan', extends: 'nowhere' });
    const c = scanAppThemesDir(dir);
    expect(c.issues.map((i) => i.code)).toContain('unknownBase');
  });
});

describe('AppThemeService', () => {
  it('[새로 만들기]는 견본 파일을 쓰고, 곧바로 목록에 올린다', () => {
    const svc = new AppThemeService(dir);
    const created = svc.createFromTheme('midnight', 'My Night');
    expect(created).toEqual({ id: 'custom:my-night', file: 'my-night.json' });
    expect(fs.existsSync(path.join(dir, 'my-night.json'))).toBe(true);
    expect(svc.list().themes.map((t) => t.id)).toContain('custom:my-night');
    expect(svc.list().issues).toEqual([]);
  });

  it('이름이 겹치면 -2 를 붙인다(남의 파일을 덮지 않는다)', () => {
    const svc = new AppThemeService(dir);
    svc.createFromTheme(undefined, 'Copy');
    const second = svc.createFromTheme(undefined, 'Copy');
    expect(second).toEqual({ id: 'custom:copy-2', file: 'copy-2.json' });
  });

  it('폴더가 없어도 만들 때 폴더를 만든다', () => {
    const nested = path.join(dir, 'nested', 'themes');
    const svc = new AppThemeService(nested);
    svc.createFromTheme(undefined, 'First');
    expect(fs.existsSync(path.join(nested, 'first.json'))).toBe(true);
  });

  it('다시 읽어 내용이 같으면 알리지 않고, 달라졌을 때만 알린다', () => {
    const svc = new AppThemeService(dir);
    const seen: number[] = [];
    svc.subscribe((c) => seen.push(c.themes.length));
    svc.list();
    svc.rescan();
    expect(seen).toEqual([]);
    write('new.json', { name: 'New' });
    svc.rescan();
    expect(seen).toEqual([1]);
  });
});
