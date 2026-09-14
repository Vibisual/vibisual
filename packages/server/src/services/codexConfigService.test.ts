/**
 * §5.25 (G-2) — 코덱스 설정 파일 겹 읽기 고정 시험.
 *
 * 설정 창이 빈 칸에 "지금 적용되는 값"을 적으려면 코덱스와 **같은 파일을 같은 순서로** 봐야 한다.
 * 한 겹이라도 틀리면 화면이 사용자에게 틀린 값을 단정하게 된다 — 비어 있을 때보다 나쁘다.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { readCodexEffectiveConfig, scanCodexConfigToml, stripExtendedPathPrefix } from './codexConfigService.js';

function memFs(files: Record<string, string>, dirs: string[] = []) {
  const existing = new Set([...Object.keys(files), ...dirs]);
  return {
    readFile: (file: string) => (file in files ? files[file]! : null),
    exists: (file: string) => existing.has(file),
  };
}

describe('scanCodexConfigToml — 필요한 키만 훑는다', () => {
  it('루트 키와 샌드박스 표를 읽는다', () => {
    const scan = scanCodexConfigToml([
      'model = "gpt-5.1-codex"',
      'model_reasoning_effort = "xhigh" # 주석',
      "model_verbosity = 'low'",
      'web_search = "live"',
      '',
      '[sandbox_workspace_write]',
      'network_access = true',
    ].join('\n'));
    expect(scan.values).toEqual({ reasoningEffort: 'xhigh', modelVerbosity: 'low', webSearch: 'live', networkAccess: true });
  });

  it('점 키와 인라인 표로 적어도 같다', () => {
    expect(scanCodexConfigToml('sandbox_workspace_write.network_access = false').values).toEqual({ networkAccess: false });
    expect(scanCodexConfigToml('sandbox_workspace_write = { network_access = true, writable_roots = ["/a"] }').values)
      .toEqual({ networkAccess: true });
  });

  it('다른 표 안의 같은 이름 키는 루트 값이 아니다', () => {
    const scan = scanCodexConfigToml([
      '[mcp_servers.x]',
      'model_reasoning_effort = "low"',
      '[[hooks]]',
      'web_search = "disabled"',
    ].join('\n'));
    expect(scan.values).toEqual({});
  });

  it('프로필 표·고른 프로필·신뢰 목록·루트 표식을 읽는다', () => {
    const scan = scanCodexConfigToml([
      'profile = "deep"',
      'project_root_markers = [',
      '  ".git", # 주석',
      '  ".hg",',
      ']',
      '[profiles.deep]',
      'model_reasoning_effort = "high"',
      'sandbox_workspace_write.network_access = true',
      "[projects.'c:\\fixtures\\repo']",
      'trust_level = "trusted"',
      '[projects."/fixtures/Repo"]',
      'trust_level = "untrusted"',
    ].join('\n'));
    expect(scan.profile).toBe('deep');
    expect(scan.projectRootMarkers).toEqual(['.git', '.hg']);
    expect(scan.profiles.get('deep')).toEqual({ reasoningEffort: 'high', networkAccess: true });
    expect(scan.trust).toEqual([
      { path: 'c:\\fixtures\\repo', level: 'trusted' },
      { path: '/fixtures/Repo', level: 'untrusted' },
    ]);
  });

  it('여러 줄 문자열과 못 알아본 줄을 건너뛰고 뒤를 계속 읽는다', () => {
    const scan = scanCodexConfigToml([
      'developer_instructions = """',
      'model_reasoning_effort = "low"',
      '"""',
      'broken = [1, 2',
      '= nope',
      'model_reasoning_effort = "medium"',
    ].join('\n'));
    expect(scan.values).toEqual({ reasoningEffort: 'medium' });
  });

  it('CRLF·BOM 파일도 같다', () => {
    expect(scanCodexConfigToml('\uFEFFweb_search = "cached"\r\n[sandbox_workspace_write]\r\nnetwork_access = false\r\n').values)
      .toEqual({ webSearch: 'cached', networkAccess: false });
  });

  it('빈 문자열 값·모르는 모양은 없는 것으로 본다', () => {
    expect(scanCodexConfigToml('model_reasoning_effort = ""\nweb_search = 3\nnetwork_access = true').values).toEqual({});
  });
});

describe('readCodexEffectiveConfig — 코덱스와 같은 순서', () => {
  it('win32 — 신뢰한 저장소는 작업 폴더에서 루트까지 가까운 쪽부터, 그다음 사용자 파일', () => {
    const w = path.win32;
    const home = 'C:\\Users\\u\\.codex'; // privacy-ok — 테스트 픽스처
    const cwd = 'C:\\Work\\Repo\\pkg';
    const fs = memFs({
      [w.join(home, 'config.toml')]: "model_reasoning_effort = \"xhigh\"\n[projects.'c:\\work\\repo']\ntrust_level = \"trusted\"\n",
      [w.join(cwd, '.codex', 'config.toml')]: 'web_search = "live"\n',
      [w.join('C:\\Work\\Repo', '.codex', 'config.toml')]: 'web_search = "disabled"\nmodel_verbosity = "high"\n',
      // 루트 밖의 파일은 읽지 않는다.
      [w.join('C:\\Work', '.codex', 'config.toml')]: 'model_verbosity = "low"\n',
    }, ['C:\\Work\\Repo\\.git']);
    const out = readCodexEffectiveConfig({ cwd, codexHomeDir: home, platform: 'win32', now: 1, ...fs });
    expect(out.layers.map((l) => [l.source, l.path, l.values])).toEqual([
      ['project', w.join(cwd, '.codex', 'config.toml'), { webSearch: 'live' }],
      ['project', w.join('C:\\Work\\Repo', '.codex', 'config.toml'), { webSearch: 'disabled', modelVerbosity: 'high' }],
      ['user', w.join(home, 'config.toml'), { reasoningEffort: 'xhigh' }],
    ]);
    expect(out.checkedAt).toBe(1);
  });

  it('신뢰하지 않았거나 목록에 없으면 프로젝트 파일을 건너뛴다', () => {
    const w = path.win32;
    const home = 'C:\\h\\.codex';
    const cwd = 'C:\\p';
    const project = { [w.join(cwd, '.codex', 'config.toml')]: 'web_search = "live"\n' };
    const untrusted = memFs({ ...project, [w.join(home, 'config.toml')]: "[projects.'c:\\p']\ntrust_level = \"untrusted\"\n" });
    const unlisted = memFs({ ...project, [w.join(home, 'config.toml')]: '' });
    for (const fs of [untrusted, unlisted]) {
      const out = readCodexEffectiveConfig({ cwd, codexHomeDir: home, platform: 'win32', ...fs });
      expect(out.layers.map((l) => l.source)).toEqual(['user']);
    }
  });

  it('작업 폴더 항목이 루트 항목보다 먼저다', () => {
    const w = path.win32;
    const home = 'C:\\h\\.codex';
    const fs = memFs({
      [w.join(home, 'config.toml')]: "[projects.'c:\\r']\ntrust_level = \"trusted\"\n[projects.'c:\\r\\sub']\ntrust_level = \"untrusted\"\n",
      [w.join('C:\\r\\sub', '.codex', 'config.toml')]: 'web_search = "live"\n',
    }, ['C:\\r\\.git']);
    const out = readCodexEffectiveConfig({ cwd: 'C:\\r\\sub', codexHomeDir: home, platform: 'win32', ...fs });
    expect(out.layers.map((l) => l.source)).toEqual(['user']);
  });

  it('linux — 대소문자가 다른 신뢰 항목은 다른 폴더다, 시스템 파일을 마지막에 읽는다', () => {
    const x = path.posix;
    const home = '/fixtures/.codex';
    const files = {
      [x.join('/fixtures/Proj', '.codex', 'config.toml')]: 'web_search = "live"\n',
      '/etc/codex/config.toml': 'model_reasoning_effort = "low"\n',
    };
    const wrongCase = memFs({ ...files, [x.join(home, 'config.toml')]: '[projects."/fixtures/proj"]\ntrust_level = "trusted"\n' });
    expect(readCodexEffectiveConfig({ cwd: '/fixtures/Proj', codexHomeDir: home, platform: 'linux', ...wrongCase }).layers
      .map((l) => l.source)).toEqual(['user', 'system']);
    const rightCase = memFs({ ...files, [x.join(home, 'config.toml')]: '[projects."/fixtures/Proj"]\ntrust_level = "trusted"\n' });
    expect(readCodexEffectiveConfig({ cwd: '/fixtures/Proj', codexHomeDir: home, platform: 'linux', ...rightCase }).layers
      .map((l) => [l.source, l.values])).toEqual([
      ['project', { webSearch: 'live' }],
      ['user', {}],
      ['system', { reasoningEffort: 'low' }],
    ]);
  });

  it('darwin — 대소문자를 접어 신뢰 항목을 맞추고, 시스템 파일도 읽는다', () => {
    const x = path.posix;
    const home = '/Fixtures/.codex';
    const fs = memFs({
      [x.join(home, 'config.toml')]: '[projects."/fixtures/proj"]\ntrust_level = "trusted"\n',
      [x.join('/Fixtures/Proj', '.codex', 'config.toml')]: 'model_verbosity = "medium"\n',
      '/etc/codex/config.toml': '',
    });
    expect(readCodexEffectiveConfig({ cwd: '/Fixtures/Proj', codexHomeDir: home, platform: 'darwin', ...fs }).layers
      .map((l) => l.source)).toEqual(['project', 'user', 'system']);
  });

  it('win32 에는 시스템 파일 자리가 없다', () => {
    const fs = memFs({ '/etc/codex/config.toml': 'web_search = "live"\n' });
    expect(readCodexEffectiveConfig({ cwd: 'C:\\p', codexHomeDir: 'C:\\h\\.codex', platform: 'win32', ...fs }).layers).toEqual([]);
  });

  it('사용자 파일의 project_root_markers 로 루트를 찾고, 빈 배열이면 작업 폴더만 본다', () => {
    const x = path.posix;
    const home = '/h/.codex';
    const base = {
      [x.join('/r/a/b', '.codex', 'config.toml')]: 'web_search = "live"\n',
      [x.join('/r', '.codex', 'config.toml')]: 'model_verbosity = "low"\n',
    };
    const trust = '[projects."/r/a/b"]\ntrust_level = "trusted"\n';
    const custom = memFs({ ...base, [x.join(home, 'config.toml')]: `project_root_markers = ["package.json"]\n${trust}` }, ['/r/package.json', '/r/a/.git']);
    expect(readCodexEffectiveConfig({ cwd: '/r/a/b', codexHomeDir: home, platform: 'linux', ...custom }).layers
      .filter((l) => l.source === 'project').map((l) => l.path)).toEqual([
      x.join('/r/a/b', '.codex', 'config.toml'),
      x.join('/r', '.codex', 'config.toml'),
    ]);
    const none = memFs({ ...base, [x.join(home, 'config.toml')]: `project_root_markers = []\n${trust}` }, ['/r/package.json', '/r/.git']);
    expect(readCodexEffectiveConfig({ cwd: '/r/a/b', codexHomeDir: home, platform: 'linux', ...none }).layers
      .filter((l) => l.source === 'project').map((l) => l.path)).toEqual([x.join('/r/a/b', '.codex', 'config.toml')]);
  });

  it('고른 프로필의 값이 맨 앞에 선다', () => {
    const x = path.posix;
    const home = '/h/.codex';
    const fs = memFs({
      [x.join(home, 'config.toml')]: 'profile = "fast"\nmodel_reasoning_effort = "high"\n[profiles.fast]\nmodel_reasoning_effort = "low"\n[profiles.slow]\nweb_search = "live"\n',
    });
    const out = readCodexEffectiveConfig({ cwd: '/p', codexHomeDir: home, platform: 'linux', ...fs });
    expect(out.layers.map((l) => [l.source, l.profile, l.values])).toEqual([
      ['profile', 'fast', { reasoningEffort: 'low' }],
      ['user', undefined, { reasoningEffort: 'high' }],
    ]);
  });

  it('작업 폴더가 코덱스 홈의 부모여도 사용자 파일을 두 번 세지 않는다', () => {
    const x = path.posix;
    const fs = memFs({ '/h/.codex/config.toml': '[projects."/h"]\ntrust_level = "trusted"\nweb_search = "live"\n' });
    expect(readCodexEffectiveConfig({ cwd: '/h', codexHomeDir: x.join('/h', '.codex'), platform: 'linux', ...fs }).layers
      .map((l) => l.source)).toEqual(['user']);
  });

  it('확장 경로 접두사를 떼고 맞춘다', () => {
    expect(stripExtendedPathPrefix('\\\\?\\C:\\p')).toBe('C:\\p');
    expect(stripExtendedPathPrefix('\\\\?\\UNC\\srv\\share')).toBe('\\\\srv\\share');
    expect(stripExtendedPathPrefix('/plain')).toBe('/plain');
    const w = path.win32;
    const fs = memFs({
      [w.join('C:\\h\\.codex', 'config.toml')]: "[projects.'c:\\p']\ntrust_level = \"trusted\"\n",
      [w.join('C:\\p', '.codex', 'config.toml')]: 'web_search = "live"\n',
    });
    const out = readCodexEffectiveConfig({ cwd: '\\\\?\\C:\\p', codexHomeDir: 'C:\\h\\.codex', platform: 'win32', ...fs });
    expect(out.cwd).toBe('C:\\p');
    expect(out.layers.map((l) => l.source)).toEqual(['project', 'user']);
  });
});
