import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findWorkspaceFiles } from './workspaceFind.js';

/** §5.5 #17-27 ⑱ — 판 쪽 파일 찾기: 화면과 한 벌 판정 · 폴더·링크 건너뛰기 · 최근 순 · 상한에 걸리면 `truncated` · 루트가 아니면 `null`. */

let root: string;

/** 파일을 쓰고 고친 시각을 박아 둔다(초 단위 — 파일 시스템마다 정밀도가 달라 초로 맞춘다). */
function write(rel: string, mtimeSec: number, body = 'x'): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  fs.utimesSync(abs, mtimeSec, mtimeSec);
}

const BASE = 1_700_000_000;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-find-'));
  write('index.html', BASE + 10);
  write('docs/report.html', BASE + 30);
  write('dist/app.html', BASE + 20);
  write('node_modules/pkg/readme.html', BASE + 99);
  write('.git/hooks/x.html', BASE + 98);
  write('.vibisual/save/view.html', BASE + 97);
  write('Intermediate/Build/y.html', BASE + 96);
  write('src/main.ts', BASE + 5);
  write('src/icon.svg', BASE + 6);
  write('img/shot.png', BASE + 7);
  write('doc/manual.pdf', BASE + 8);
  write('bin/tool.dll', BASE + 9);
  write('video/clip.mp4', BASE + 4);
  write('notes.md', BASE + 3);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const relPaths = (r: Awaited<ReturnType<typeof findWorkspaceFiles>>): string[] => (r?.entries ?? []).map((e) => e.relPath);

describe('findWorkspaceFiles — 갈래', () => {
  it('웹 페이지 — HTML 만, 들어가지 않는 폴더는 건너뛰고, 최근 고친 순', async () => {
    const r = await findWorkspaceFiles(root, 'html', []);
    expect(relPaths(r)).toEqual(['docs/report.html', 'dist/app.html', 'index.html']);
    expect(r?.truncated).toBe(false);
    expect(r?.total).toBe(3);
    expect(r?.kind).toBe('html');
    // 시각과 크기를 함께 싣는다(화면이 "고친 때"를 적는다).
    expect(r?.entries[0]?.mtimeMs).toBe((BASE + 30) * 1000);
    expect(r?.entries[0]?.size).toBe(1);
    expect(r?.entries.every((e) => !e.isDirectory)).toBe(true);
  });

  it('dist·build·out 은 들어간다 — 결과물이 놓이는 바로 그 자리다', async () => {
    expect(relPaths(await findWorkspaceFiles(root, 'html', []))).toContain('dist/app.html');
  });

  it('그림 — png 는 들고 svg 는 코드다(텍스트라 편집창이 코드로 연다)', async () => {
    expect(relPaths(await findWorkspaceFiles(root, 'image', []))).toEqual(['img/shot.png']);
  });

  it('PDF', async () => {
    expect(relPaths(await findWorkspaceFiles(root, 'pdf', []))).toEqual(['doc/manual.pdf']);
  });

  it('코드 — 텍스트·svg 는 들고, 컴파일 산출물(.dll)은 목록에서 뺀다', async () => {
    const got = relPaths(await findWorkspaceFiles(root, 'code', []));
    expect(got).toContain('src/main.ts');
    expect(got).toContain('src/icon.svg');
    expect(got).toContain('notes.md');
    expect(got).not.toContain('bin/tool.dll');
    expect(got).not.toContain('index.html');
    expect(got).not.toContain('img/shot.png');
  });

  it('앱이 받겠다고 선언한 확장자는 판에 오지 않는다 — 선언을 실어야 빠진다(한 벌 판정)', async () => {
    expect(relPaths(await findWorkspaceFiles(root, 'code', []))).toContain('video/clip.mp4');
    const claimed = relPaths(await findWorkspaceFiles(root, 'code', [{ appId: 'claimed', opens: ['.mp4'] }]));
    expect(claimed).not.toContain('video/clip.mp4');
  });
});

describe('findWorkspaceFiles — 상한은 말한다', () => {
  it('담는 수 상한 — 최근 것부터 남기고 truncated', async () => {
    const r = await findWorkspaceFiles(root, 'html', [], { resultMax: 2 });
    expect(relPaths(r)).toEqual(['docs/report.html', 'dist/app.html']);
    expect(r?.total).toBe(3);
    expect(r?.truncated).toBe(true);
  });

  it('훑는 수 상한 — 너비 우선이라 루트의 파일은 이미 잡혀 있다', async () => {
    const r = await findWorkspaceFiles(root, 'html', [], { scanMax: 1, concurrency: 1 });
    expect(r?.truncated).toBe(true);
    expect(relPaths(r)).toContain('index.html');
    expect(relPaths(r)).not.toContain('docs/report.html');
  });

  it('시간 상한 — 시계가 넘어가면 그 자리에서 멈춘다', async () => {
    let t = 0;
    // 걷기 시작 시각을 잰 다음부터는 늘 상한을 넘긴 시각을 돌려준다.
    const now = (): number => { t += 10_000; return t; };
    const r = await findWorkspaceFiles(root, 'html', [], { timeBudgetMs: 1, now });
    expect(r?.truncated).toBe(true);
  });
});

describe('findWorkspaceFiles — 경계', () => {
  it('없는 루트 · 파일 루트는 null', async () => {
    expect(await findWorkspaceFiles(path.join(root, 'nope'), 'html', [])).toBeNull();
    expect(await findWorkspaceFiles(path.join(root, 'index.html'), 'html', [])).toBeNull();
  });

  it('링크는 따라가지 않는다 — 루트 밖을 가리키는 링크로 새지 않는다', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-find-out-'));
    fs.writeFileSync(path.join(outside, 'secret.html'), 'x');
    const link = path.join(root, 'linked');
    try {
      fs.symlinkSync(outside, link, 'junction');
    } catch {
      // 링크를 만들 권한이 없는 환경(일부 Windows) — 판정할 대상이 없으니 건너뛴다.
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }
    try {
      const got = relPaths(await findWorkspaceFiles(root, 'html', []));
      expect(got.some((p) => p.startsWith('linked/'))).toBe(false);
    } finally {
      fs.rmSync(link, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('POSIX 실행 파일은 코드 목록에서 빠진다(탐색기에서 누르면 실행으로 간다)', async () => {
    write('tools/run.sh', BASE + 1, '#!/bin/sh\n');
    fs.chmodSync(path.join(root, 'tools/run.sh'), 0o755);
    const got = relPaths(await findWorkspaceFiles(root, 'code', [], { platform: 'linux' }));
    expect(got).not.toContain('tools/run.sh');
  });
});
