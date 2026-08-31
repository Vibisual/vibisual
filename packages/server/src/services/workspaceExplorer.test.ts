import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isExecutableWorkspacePath, listWorkspaceDir, resolveWorkspacePath, statExternalPath, statWorkspacePath } from './workspaceExplorer.js';

/**
 * §5.5 #17-19 v4.71 — 탐색기 디렉터리 조회 테스트.
 *
 * 두 가지를 지킨다 — (a) **루트 밖으로 새지 않는다**(`..`·절대경로 주입), (b) 위성용
 * `listFolderFiles` 와 달리 **숨김 항목을 감추지 않고 대소문자를 뭉개지 않는다**.
 */

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-explorer-'));
  fs.mkdirSync(path.join(root, 'packages', 'Client'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'empty'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), '# hi\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(root, 'packages', 'Client', 'App.tsx'), 'export {}\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveWorkspacePath', () => {
  it('루트 안 상대 경로를 절대 경로로 푼다', () => {
    const resolved = resolveWorkspacePath(root, 'packages/Client');
    expect(resolved?.abs).toBe(path.resolve(root, 'packages/Client'));
    expect(resolved?.rel).toBe('packages/Client');
  });

  it('빈 경로 = 루트 자신', () => {
    expect(resolveWorkspacePath(root, '')?.rel).toBe('');
  });

  it('[보안] 루트 밖으로 올라가는 경로는 거부', () => {
    expect(resolveWorkspacePath(root, '..')).toBeNull();
    expect(resolveWorkspacePath(root, 'packages/../../etc')).toBeNull();
  });

  it('[보안] 앞의 구분자로 절대 경로처럼 주입해도 루트 안으로 갇힌다', () => {
    expect(resolveWorkspacePath(root, '/packages')?.rel).toBe('packages');
  });
});

/**
 * §5.5 #17-27 ⑬ — 본문에 적힌 경로를 **파일이면 편집창 · 폴더면 탐색기** 로 가르는 유일한 판정.
 * 잘못 가르면 폴더를 편집창에서 열려다 실패하거나 파일의 상위 폴더가 대신 열린다.
 */
describe('statWorkspacePath', () => {
  it('파일과 폴더를 갈라 답한다', () => {
    expect(statWorkspacePath(root, 'README.md')?.kind).toBe('file');
    expect(statWorkspacePath(root, 'packages/Client')?.kind).toBe('directory');
  });

  it('끝 구분자가 붙어 있어도 같은 폴더로 읽는다', () => {
    const info = statWorkspacePath(root, 'packages/Client/');
    expect(info?.kind).toBe('directory');
    expect(info?.path).toBe('packages/Client');
    expect(info?.absPath).toBe(path.resolve(root, 'packages/Client'));
  });

  it('빈 경로 = 루트 자신도 폴더다', () => {
    expect(statWorkspacePath(root, '')?.kind).toBe('directory');
  });

  it('실행 여부를 함께 실어 보낸다 — 평범한 텍스트 파일은 실행이 아니다', () => {
    expect(statWorkspacePath(root, 'README.md')?.executable).toBe(false);
    expect(statWorkspacePath(root, 'packages/Client')?.executable).toBe(false);
  });

  it('없는 경로는 null — 화면은 그 조각을 평문으로 둔다', () => {
    expect(statWorkspacePath(root, 'nope/missing.ts')).toBeNull();
  });

  it('[보안] 루트 밖은 거부(디렉터리 조회와 같은 가드)', () => {
    expect(statWorkspacePath(root, '../..')).toBeNull();
    expect(statWorkspacePath(root, 'packages/../../etc/hosts')).toBeNull();
  });
});

describe('listWorkspaceDir', () => {
  it('폴더 먼저·이름순으로 한 겹만 준다(재귀 ❌)', () => {
    const listing = listWorkspaceDir(root, '');
    expect(listing).not.toBeNull();
    const names = listing!.entries.map((e) => e.name);
    // 폴더 4개(.github/empty/node_modules/packages)가 먼저, 그 뒤 파일 2개(.gitignore/README.md)
    expect(names.slice(0, 4)).toEqual(['.github', 'empty', 'node_modules', 'packages']);
    expect(names.slice(4)).toEqual(['.gitignore', 'README.md']);
    // 한 겹만 — 자식의 자식은 안 들어온다.
    expect(names).not.toContain('App.tsx');
  });

  it('숨김 항목과 node_modules 도 그대로 보여 준다(VS Code 탐색기와 같은 결)', () => {
    const names = listWorkspaceDir(root, '')!.entries.map((e) => e.name);
    expect(names).toContain('.github');
    expect(names).toContain('.gitignore');
    expect(names).toContain('node_modules');
  });

  it('경로는 원본 대소문자를 유지한다(위성 정규화와 다른 점)', () => {
    const listing = listWorkspaceDir(root, 'packages');
    expect(listing!.entries[0]!.relPath).toBe('packages/Client');
  });

  it('파일에는 크기·수정시각이 붙고 디렉터리에는 안 붙는다', () => {
    const entries = listWorkspaceDir(root, '')!.entries;
    const readme = entries.find((e) => e.name === 'README.md')!;
    const dir = entries.find((e) => e.name === 'packages')!;
    expect(readme.isDirectory).toBe(false);
    expect(readme.size).toBeGreaterThan(0);
    expect(readme.mtimeMs).toBeGreaterThan(0);
    expect(dir.isDirectory).toBe(true);
    expect(dir.size).toBeUndefined();
  });

  it('빈 폴더는 빈 배열(없는 폴더의 null 과 구분된다)', () => {
    expect(listWorkspaceDir(root, 'empty')!.entries).toEqual([]);
    expect(listWorkspaceDir(root, 'nope')).toBeNull();
  });

  it('파일을 가리키면 null — 디렉터리 조회 창구다', () => {
    expect(listWorkspaceDir(root, 'README.md')).toBeNull();
  });

  it('상한을 넘으면 앞에서 자르고 truncated 로 알린다', () => {
    const listing = listWorkspaceDir(root, '', 2);
    expect(listing!.entries).toHaveLength(2);
    expect(listing!.truncated).toBe(true);
    expect(listWorkspaceDir(root, '')!.truncated).toBe(false);
  });

  it('[보안] 루트를 벗어나는 요청은 null', () => {
    expect(listWorkspaceDir(root, '../..')).toBeNull();
  });
});

/**
 * §5.5 #17-27 ⑬ (h) — 본문에 적힌 위치가 **실행할 수 있는 것**인가.
 *
 * 이 판정이 헐거우면 두 방향으로 다 아프다 — 놓치면 `.exe` 가 빈 편집창으로 열리고(고치기 전 동작),
 * 너무 넓으면 소스 파일을 눌렀는데 프로그램이 도는 자리가 된다. 그래서 플랫폼을 인자로 받아
 * 세 OS 의 규칙을 **한 표로** 고정한다(테스트가 도는 OS 와 무관하게 같은 답이 나와야 한다).
 */
describe('isExecutableWorkspacePath', () => {
  const file = (mode = 0o644): { isDirectory: () => boolean; mode: number } => ({ isDirectory: () => false, mode });
  const dir = (mode = 0o755): { isDirectory: () => boolean; mode: number } => ({ isDirectory: () => true, mode });

  it('windows — 확장자로 가른다(대소문자 무시)', () => {
    expect(isExecutableWorkspacePath('C:/g/Saved/Windows/P_MPS_GPT.exe', file(), 'win32')).toBe(true);
    expect(isExecutableWorkspacePath('C:/g/build/Run.BAT', file(), 'win32')).toBe(true);
    expect(isExecutableWorkspacePath('C:/g/tools/setup.cmd', file(), 'win32')).toBe(true);
    expect(isExecutableWorkspacePath('C:/g/src/App.tsx', file(), 'win32')).toBe(false);
    // 설치 마법사·스크립트는 "눌렀을 때 벌어질 일"이 사용자 예상과 갈려 뺐다.
    expect(isExecutableWorkspacePath('C:/g/setup.msi', file(), 'win32')).toBe(false);
    expect(isExecutableWorkspacePath('C:/g/build.ps1', file(), 'win32')).toBe(false);
  });

  it('windows — 이름이 .exe 로 끝나는 폴더는 실행이 아니다', () => {
    expect(isExecutableWorkspacePath('C:/g/weird.exe', dir(), 'win32')).toBe(false);
  });

  it('macOS — .app 번들은 폴더지만 실행이다', () => {
    expect(isExecutableWorkspacePath('/g/Build/Mac/Game.app', dir(), 'darwin')).toBe(true);
    expect(isExecutableWorkspacePath('/g/Build/Mac/Game.app', dir(), 'linux')).toBe(false);
    expect(isExecutableWorkspacePath('/g/assets', dir(), 'darwin')).toBe(false);
  });

  it('posix — 실행 비트가 서 있어도 소스 확장자는 실행이 아니다', () => {
    // 트리 전체가 755 로 보이는 마운트에서 본문의 소스 경로가 실행 손잡이가 되는 것을 막는다.
    expect(isExecutableWorkspacePath('/g/src/App.tsx', file(0o755), 'linux')).toBe(false);
    expect(isExecutableWorkspacePath('/g/README.md', file(0o755), 'darwin')).toBe(false);
  });

  it('posix — 확장자 없는 실행 파일과 스크립트는 실행 비트가 있을 때만', () => {
    expect(isExecutableWorkspacePath('/g/build/game', file(0o755), 'linux')).toBe(true);
    expect(isExecutableWorkspacePath('/g/build/game', file(0o644), 'linux')).toBe(false);
    expect(isExecutableWorkspacePath('/g/scripts/run.sh', file(0o755), 'linux')).toBe(true);
    expect(isExecutableWorkspacePath('/g/dist/Game.AppImage', file(0o755), 'linux')).toBe(true);
    expect(isExecutableWorkspacePath('/g/scripts/run.sh', file(0o644), 'linux')).toBe(false);
  });
});

/**
 * §5.5 #17-27 ⑬ (d) — 루트 **밖** 절대 경로의 정체. 여기서 지키는 것은 둘이다 —
 * (a) 상대 경로를 받지 않는다(기준이 없는 값은 서버의 cwd 를 뿌리로 삼아 엉뚱한 곳을 가리킨다),
 * (b) 답에 실행 여부를 담지 않는다(담는 순간 루트 밖이 실행 갈래를 얻는다).
 */
describe('statExternalPath', () => {
  it('루트 밖이어도 파일과 폴더를 갈라 답한다', () => {
    expect(statExternalPath(path.join(root, 'README.md'))?.kind).toBe('file');
    expect(statExternalPath(root)?.kind).toBe('directory');
  });

  it('절대 경로를 정규화해 돌려준다 — 탐색기에 그대로 넘길 수 있게', () => {
    const info = statExternalPath(path.join(root, 'packages', '..', 'README.md'));
    expect(info?.absPath).toBe(path.resolve(root, 'README.md'));
  });

  it('없는 경로는 null — 호출부가 404 로 옮긴다', () => {
    expect(statExternalPath(path.join(root, 'nope.txt'))).toBeNull();
  });

  it('[보안] 상대 경로는 받지 않는다 — 기준 없는 값이 서버 cwd 를 뿌리로 삼는 것을 막는다', () => {
    expect(statExternalPath('README.md')).toBeNull();
    expect(statExternalPath('../etc/passwd')).toBeNull();
    expect(statExternalPath('')).toBeNull();
  });

  it('답에는 absPath 와 kind 뿐이다 — 실행 여부를 알려 주면 갈래가 늘어난다', () => {
    expect(Object.keys(statExternalPath(root) ?? {}).sort()).toEqual(['absPath', 'kind']);
  });
});
