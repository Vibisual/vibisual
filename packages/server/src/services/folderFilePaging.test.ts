/**
 * §7.5 폴더 목록 지연 로딩 — **한 겹 · 한 페이지**를 고정한다.
 *
 * 실제 사고(2026-09-02): 사용자 홈이 `external_folder` 버블로 뜬 상태에서 그 버블을 고르자
 * 종전 `readDirTree` 가 홈 전체를 **깊이·개수·시간 제한 없이 동기 재귀**했다 — 실측 30초 예산으로도
 * 다 읽지 못했고(파일 433,569 · 디렉터리 183,210 · 깊이 18 · 응답 JSON 83.6MB · 압도적 기여자는
 * `AppData` 577,324), 서버가 Electron 메인 프로세스와 한 몸이라 그 사이 창이 통째로 멈춰 Windows 가
 * "응답하지 않습니다"를 띄웠다. 무시 목록(`node_modules`·`.git`·`dist`)은 프로젝트 안에서만 우연히
 * 막아 줬을 뿐, 외부 폴더에는 아무 방벽이 아니었다.
 *
 * 이 파일이 막는 회귀는 하나다 — **누가 다시 재귀를 넣는 것**. 그래서 첫 시험이 "하위 폴더의 파일이
 * 응답에 없다"이고, 나머지는 그 대신 들어온 페이지 규약(커서·total·상한·이탈 방지)이다.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FOLDER_FILES_PAGE_MAX, FOLDER_FILES_PAGE_SIZE } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 을 실제로 건드린다 — 쓰기만 막는다.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

/** 임시 트리를 만든다. `spec` 의 키는 루트 기준 상대경로, 값이 `null` 이면 폴더. */
function makeTree(tag: string, spec: Record<string, string | null>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vibi-folderpage-${tag}-`)));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(spec)) {
    const abs = path.join(dir, rel);
    if (body === null) { fs.mkdirSync(abs, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return dir;
}

/** 파일 n 개짜리 평평한 폴더 — 페이지 경계를 보는 시험용. */
function flatTree(tag: string, n: number): string {
  const spec: Record<string, string | null> = {};
  for (let i = 0; i < n; i++) spec[`f${String(i).padStart(4, '0')}.txt`] = 'x';
  return makeTree(tag, spec);
}

function graphFor(dir: string): { graph: ProjectGraph; rootKey: string } {
  const graph = new ProjectGraph();
  const info = graph.registerProject(dir);
  return { graph, rootKey: `__root__:${info.name}` };
}

describe('§7.5 폴더 목록 — 한 겹만 읽는다', () => {
  it('하위 폴더의 파일은 응답에 오지 않는다 (재귀 회귀 방지 — 이 시험이 이 파일의 이유다)', () => {
    const dir = makeTree('level', {
      'top.txt': 'x',
      'sub': null,
      'sub/inner.txt': 'x',
      'sub/deeper': null,
      'sub/deeper/deep.txt': 'x',
    });
    const { graph, rootKey } = graphFor(dir);

    const page = graph.listFolderFilePage(rootKey);

    expect(page).not.toBeNull();
    const names = page!.entries.map((e) => e.name);
    expect(names).toContain('sub');
    expect(names).toContain('top.txt');
    // 한 겹 아래는 한 항목도 실리지 않는다.
    expect(names).not.toContain('inner.txt');
    expect(names).not.toContain('deeper');
    expect(names).not.toContain('deep.txt');
    expect(page!.total).toBe(2);
    // 재귀 시절의 흔적이 남아 있지 않다 — `children` 이 다시 생기면 트리가 통째로 실린다.
    for (const entry of page!.entries) expect(entry).not.toHaveProperty('children');
  });

  it('하위 겹은 subPath 로 부르고, relativePath 는 루트 기준으로 이어진다', () => {
    const dir = makeTree('sub', {
      'sub': null,
      'sub/inner.txt': 'x',
      'sub/deeper': null,
      'sub/deeper/deep.txt': 'x',
    });
    const { graph, rootKey } = graphFor(dir);

    const page = graph.listFolderFilePage(rootKey, { subPath: 'sub' });

    expect(page).not.toBeNull();
    expect(page!.entries.map((e) => e.name).sort()).toEqual(['deeper', 'inner.txt']);
    const inner = page!.entries.find((e) => e.name === 'inner.txt');
    expect(inner?.relativePath).toBe('sub/inner.txt');
    // 두 겹 아래도 같은 방식으로 한 겹씩.
    const deeper = graph.listFolderFilePage(rootKey, { subPath: 'sub/deeper' });
    expect(deeper?.entries.map((e) => e.name)).toEqual(['deep.txt']);
    expect(deeper?.entries[0]?.relativePath).toBe('sub/deeper/deep.txt');
  });

  it('엔트리 이름은 원본 대소문자를 지킨다 — linux 에서 하위 겹을 여는 열쇠다', () => {
    const dir = makeTree('case', { 'Docs': null, 'Docs/readme.md': 'x' });
    const { graph, rootKey } = graphFor(dir);

    const entry = graph.listFolderFilePage(rootKey)!.entries.find((e) => e.isDirectory);

    // `name` 은 디스크 그대로, `relativePath`(노드 키)만 플랫폼 규칙으로 접힌다.
    expect(entry?.name).toBe('Docs');
    expect(entry?.relativePath.toLowerCase()).toBe('docs');

    // 화면은 **`name`** 으로 자식 겹을 연다(`childSubPathOf(subPath, entry.name)`).
    // 접힌 `relativePath` 로 열면 win/mac 은 우연히 통과하고 **linux 에서만 404** 가 난다 —
    // 그래서 이 시험은 Windows 개발기에서도 "접지 않은 이름이 오는가"를 지킨다.
    const sub = graph.listFolderFilePage(rootKey, { subPath: entry!.name });
    expect(sub?.entries.map((e) => e.name)).toEqual(['readme.md']);
  });

  it('폴더 밖을 가리키는 subPath 는 답하지 않는다 — 이 창구엔 루트 가드가 없어 스스로 막는다', () => {
    const dir = makeTree('escape', { 'sub': null, 'sub/inner.txt': 'x' });
    const { graph, rootKey } = graphFor(dir);

    expect(graph.listFolderFilePage(rootKey, { subPath: '..' })).toBeNull();
    expect(graph.listFolderFilePage(rootKey, { subPath: '../..' })).toBeNull();
    expect(graph.listFolderFilePage(rootKey, { subPath: 'sub/../../elsewhere' })).toBeNull();
    // 정상적인 하위는 그대로 통과한다(가드가 과하게 잡지 않는다).
    expect(graph.listFolderFilePage(rootKey, { subPath: 'sub' })).not.toBeNull();
  });

  it('폴더 먼저·이름순이고, 숨김 폴더와 무시 목록은 종전대로 빠진다', () => {
    const dir = makeTree('sort', {
      'b.txt': 'x',
      'a.txt': 'x',
      'zfolder': null,
      'afolder': null,
      '.hidden': null,        // 숨김 **폴더** 는 제외
      'node_modules': null,   // 무시 목록은 제외
      '.env': 'x',            // 숨김 **파일** 은 남는다 — 제외 규칙은 디렉터리에만 걸린다
    });
    const { graph, rootKey } = graphFor(dir);

    const entries = graph.listFolderFilePage(rootKey)!.entries;
    const names = entries.map((e) => e.name);

    expect(names).not.toContain('.hidden');
    expect(names).not.toContain('node_modules');
    expect(names).toContain('.env');
    // 폴더가 앞, 그 안에서 이름순.
    expect(entries.filter((e) => e.isDirectory).map((e) => e.name)).toEqual(['afolder', 'zfolder']);
    expect(names.indexOf('zfolder')).toBeLessThan(names.indexOf('a.txt'));
  });
});

describe('§7.5 폴더 목록 — 한 페이지씩 이어 받는다', () => {
  it('커서를 따라가면 빠짐·중복 없이 전부 모이고, 마지막 장의 nextCursor 는 null 이다', () => {
    const dir = flatTree('paging', 25);
    const { graph, rootKey } = graphFor(dir);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = graph.listFolderFilePage(rootKey, { cursor, limit: 10 });
      expect(page).not.toBeNull();
      expect(page!.total).toBe(25);
      seen.push(...page!.entries.map((e) => e.name));
      cursor = page!.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);           // 10 + 10 + 5
    expect(cursor).toBeNull();       // 끝은 끝이라고 말한다
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('limit 을 안 주면 기본 장 크기만큼 온다', () => {
    const dir = flatTree('default', FOLDER_FILES_PAGE_SIZE + 5);
    const { graph, rootKey } = graphFor(dir);

    const page = graph.listFolderFilePage(rootKey);

    expect(page!.entries).toHaveLength(FOLDER_FILES_PAGE_SIZE);
    expect(page!.total).toBe(FOLDER_FILES_PAGE_SIZE + 5);
    expect(page!.nextCursor).toBe(String(FOLDER_FILES_PAGE_SIZE));
  });

  it('limit 은 상한으로 잘린다 — 한 번에 통째로 받아 페이지를 무력화할 수 없다', () => {
    const total = FOLDER_FILES_PAGE_MAX + 20;
    const dir = flatTree('clamp', total);
    const { graph, rootKey } = graphFor(dir);

    const page = graph.listFolderFilePage(rootKey, { limit: 1_000_000 });

    expect(page!.entries).toHaveLength(FOLDER_FILES_PAGE_MAX);
    expect(page!.total).toBe(total);
    expect(page!.nextCursor).toBe(String(FOLDER_FILES_PAGE_MAX));
  });

  it('망가진 커서는 첫 장으로 되돌린다 (빈 화면 대신 첫 장)', () => {
    const dir = flatTree('cursor', 12);
    const { graph, rootKey } = graphFor(dir);

    for (const bad of ['', 'abc', '-5', 'NaN']) {
      const page = graph.listFolderFilePage(rootKey, { cursor: bad, limit: 5 });
      expect(page!.entries).toHaveLength(5);
      expect(page!.entries[0]?.name).toBe('f0000.txt');
    }
  });

  it('커서가 끝을 넘어가면 빈 장을 주고 더 없다고 말한다', () => {
    const dir = flatTree('past-end', 8);
    const { graph, rootKey } = graphFor(dir);

    const page = graph.listFolderFilePage(rootKey, { cursor: '999', limit: 10 });

    expect(page!.entries).toHaveLength(0);
    expect(page!.nextCursor).toBeNull();
    expect(page!.total).toBe(8);
  });
});
