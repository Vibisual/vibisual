/**
 * 루트 패널(§7.5 `RootFileList`)의 **프로젝트 컨텍스트 보존**을 고정한다.
 *
 * 실제 사고: 프로젝트를 여러 개 열어 둔 상태에서 vibisual 루트 버블을 눌렀더니 패널에
 * **다른 프로젝트(P_2DGame)의 폴더 목록**(`_temp`, `app`, `sim2d`, `steam` …)이 그려졌다.
 * 그래서 ① 에이전트가 실제로 쓰는 폴더는 목록에 없어 체크가 안 되고 ② 체크하면 그 경로가
 * 이 프로젝트에는 없어 404 라 버블이 안 뜨고 ③ 파일도 남의 것이 나왔다 — 증상 셋이 한 뿌리.
 *
 * 뿌리는 둘이었다:
 *  ① `ProjectGraph.resolveAbsolutePath('__root__:<남의 프로젝트>')` 가 그 프로젝트를 모르면
 *     **자기 root 로 물러섰다** → 남의 루트 키에도 "내가 안다"고 답했다.
 *  ② `ProjectGraphManager` 가 "첫 non-null 인스턴스가 이긴다"로 훑었다 → ①과 만나 먼저 등록된
 *     프로젝트가 항상 이겼다.
 *
 * 노드 키는 프로젝트 루트 기준 **상대 경로**라(`docs`) 이름만으로는 소속을 알 수 없다는 것이
 * 이 계열 버그의 공통 원인이다 — 그래서 `absolutePath` 힌트가 라우팅의 정본이다
 * (`/api/open-node-file` 이 같은 규약을 먼저 쓰고 있었다).
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';
import { ProjectGraphManager } from './projectGraphManager.js';

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

/** 디스크에 프로젝트 한 벌을 만든다. `dirs` 는 루트 바로 아래 폴더 이름들. */
function makeProjectDir(tag: string, dirs: string[]): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vibi-rootpanel-${tag}-`)));
  tmpDirs.push(dir);
  for (const d of dirs) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, d, `${d}-marker.txt`), 'x\n', 'utf8');
  }
  return dir;
}

/** 두 프로젝트를 **등록 순서대로** 한 매니저에 올린다(먼저 등록된 쪽이 종전에는 항상 이겼다). */
function twoProjects(): { manager: ProjectGraphManager; first: string; second: string; firstName: string; secondName: string } {
  const first = makeProjectDir('first', ['docs', 'sim2d', 'steam']);
  const second = makeProjectDir('second', ['docs', 'packages', 'scripts']);
  const manager = new ProjectGraphManager();
  const firstName = manager.registerProject(first).name;
  const secondName = manager.registerProject(second).name;
  return { manager, first, second, firstName, secondName };
}

const names = (page: { entries: { name: string }[] } | null): string[] =>
  (page?.entries ?? []).map((e) => e.name).sort();

describe('루트 패널 — 노드 키가 어느 프로젝트 것인지 잃지 않는다', () => {
  it('루트 키로 목록을 물으면 **그 프로젝트**의 트리가 온다 (먼저 등록된 프로젝트가 가로채지 않는다)', () => {
    const { manager, secondName } = twoProjects();

    const tree = manager.listFolderFilePage(`__root__:${secondName}`);

    expect(names(tree)).toEqual(['docs', 'packages', 'scripts']);
    expect(names(tree)).not.toContain('sim2d');
  });

  it('첫 프로젝트의 루트 키도 여전히 자기 트리를 준다 (라우팅이 한쪽만 고치지 않았다)', () => {
    const { manager, firstName } = twoProjects();

    expect(names(manager.listFolderFilePage(`__root__:${firstName}`))).toEqual(['docs', 'sim2d', 'steam']);
  });

  it('남의 루트 키에는 "모른다"고 답한다 — 자기 root 로 물러서면 매니저 루프가 가로챈다', () => {
    const soloDir = makeProjectDir('solo', ['docs']);
    const graph = new ProjectGraph();
    const info = graph.registerProject(soloDir);

    expect(graph.resolveAbsolutePath(`__root__:${info.name}`)).not.toBeNull();
    expect(graph.resolveAbsolutePath('__root__:없는프로젝트')).toBeNull();
  });

  it('이름 없는 레거시 루트 키(`__root__`)는 종전대로 자기 루트로 해석된다', () => {
    const soloDir = makeProjectDir('legacy', ['docs']);
    const graph = new ProjectGraph();
    graph.registerProject(soloDir);

    expect(graph.resolveAbsolutePath('__root__')).not.toBeNull();
  });

  it('같은 이름의 폴더(`docs`)가 두 프로젝트에 있어도 absolutePath 를 주면 그 쪽 내용이 온다', () => {
    const { manager, second } = twoProjects();

    const tree = manager.listFolderFilePage('docs', path.join(second, 'docs'));

    expect(names(tree)).toEqual(['docs-marker.txt']);
    // 첫 프로젝트의 docs 를 가리키면 그쪽 내용이 온다 — 힌트가 실제로 갈림길을 결정한다.
    const other = manager.listFolderFilePage('docs', path.join(twoProjects().first, 'docs'));
    expect(other).not.toBeNull();
  });
});

describe('루트 패널 체크박스 — 켜면 그 프로젝트에 버블이 선다', () => {
  it('두 번째 프로젝트의 폴더를 체크하면 그 프로젝트의 최상위 버블로 뜬다', () => {
    const { manager, secondName } = twoProjects();

    // 목록이 주는 relativePath 그대로 토글한다(패널이 보내는 값과 같은 모양).
    const entry = (manager.listFolderFilePage(`__root__:${secondName}`)?.entries ?? []).find((e) => e.name === 'packages');
    expect(entry).toBeDefined();

    expect(manager.toggleRootChild(secondName, entry!.relativePath, true)).toBe(true);

    const top = manager.getSnapshot().topFolders.filter((f) => f.path === entry!.relativePath);
    expect(top).toHaveLength(1);
    expect(top[0]?.pinned).toBe(true);
  });

  it('체크한 폴더는 그 프로젝트 소속으로 기록된다 — 소속이 비면 캔버스 필터가 숨긴다', () => {
    const { manager, secondName } = twoProjects();

    expect(manager.toggleRootChild(secondName, 'scripts', true)).toBe(true);

    const snap = manager.getSnapshot();
    const node = snap.topFolders.find((f) => f.path === 'scripts');
    expect(node).toBeDefined();
    expect(snap.nodeProjects?.[node!.id]).toBe(secondName);
  });

  it('디스크에서 사라진 항목도 **체크 해제**는 된다 — 존재를 요구하면 영영 못 끈다', () => {
    const { manager, second, secondName } = twoProjects();

    expect(manager.toggleRootChild(secondName, 'scripts', true)).toBe(true);
    fs.rmSync(path.join(second, 'scripts'), { recursive: true, force: true });

    expect(manager.toggleRootChild(secondName, 'scripts', false)).toBe(true);
    expect(manager.getSnapshot().topFolders.some((f) => f.path === 'scripts')).toBe(false);
  });

  it('루트 밖을 가리키는 경로(`..`)는 켜지지 않는다', () => {
    const { manager, secondName } = twoProjects();

    expect(manager.toggleRootChild(secondName, '../escape', true)).toBe(false);
  });
});
