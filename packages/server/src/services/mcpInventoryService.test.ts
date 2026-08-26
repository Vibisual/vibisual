/**
 * §5.5 #17-31 — MCP 인벤토리 층 테스트.
 *
 * 이 층이 지켜야 하는 것: ① 네 범위를 빠짐없이 세운다, ② 꺼짐과 **승인 대기**를 구분한다,
 * ③ 켜기까지 남은 일을 읽어서 적는다(값이 아니라 **변수 이름**만), ④ 쓰는 곳은
 * `~/.claude.json` 의 그 프로젝트 엔트리 하나뿐 — 레포의 `.mcp.json` 은 한 바이트도 안 건드린다,
 * ⑤ 같은 폴더가 `C:/…`·`C:\…` 두 표기로 들어 있어도 **전부** 갱신한다.
 *
 * ⚠ `os.homedir()` 를 반드시 가짜 홈으로 갈아 끼운다 — 안 그러면 테스트가 **사용자의 진짜
 *   `~/.claude.json`** 을 고쳐 쓴다(같은 사고를 app-state 에서 이미 한 번 겪었다).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let fakeHome = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  // 서비스는 `import os from 'node:os'` 라 **default 쪽**을 갈아 끼워야 한다(named 만 바꾸면 진짜 홈을 본다).
  return { ...actual, homedir: (): string => fakeHome, default: { ...actual, homedir: (): string => fakeHome } };
});

const { scanMcpInventory, setMcpServerEnabled } = await import('./mcpInventoryService.js');
const { CASE_INSENSITIVE_FS } = await import('./pathKey.js');

let projectPath = '';

/** 가짜 홈의 `~/.claude.json` 을 통째로 쓴다(테스트가 만든 세계의 전부). */
function writeClaudeJson(body: unknown): void {
  fs.writeFileSync(path.join(fakeHome, '.claude.json'), JSON.stringify(body, null, 2), 'utf8');
}

function readClaudeJson(): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude.json'), 'utf8')) as Record<string, any>;
}

function find(inv: ReturnType<typeof scanMcpInventory>, id: string) {
  return inv.servers.find((s) => s.id === id);
}

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-mcp-'));
  fakeHome = path.join(base, 'home');
  projectPath = path.join(base, 'proj');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(fakeHome), { recursive: true, force: true });
  } catch {
    /* 임시 폴더 정리 실패는 테스트 결과와 무관 */
  }
});

describe('scanMcpInventory', () => {
  it('네 범위를 모두 세운다 — 글로벌·로컬·프로젝트 + 프리셋', () => {
    writeClaudeJson({
      mcpServers: { globalOne: { type: 'stdio', command: 'node', args: ['g.js'] } },
      projects: { [projectPath]: { mcpServers: { localOne: { command: 'node', args: ['l.js'] } } } },
    });
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { projOne: { command: 'node', args: ['p.js'] } } }),
      'utf8',
    );

    const inv = scanMcpInventory(projectPath);
    expect(find(inv, 'global:globalOne')?.scope).toBe('global');
    expect(find(inv, 'local:localOne')?.scope).toBe('local');
    expect(find(inv, 'project:projOne')?.scope).toBe('project');
    // 프리셋은 파일과 무관하게 늘 선다(#17-20 ⑥).
    expect(inv.servers.some((s) => s.scope === 'preset')).toBe(true);
  });

  it('`.mcp.json` 서버는 승인 전이면 꺼짐이 아니라 **승인 대기** 다', () => {
    writeClaudeJson({ projects: { [projectPath]: {} } });
    fs.writeFileSync(
      path.join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { projOne: { command: 'node' } } }),
      'utf8',
    );

    const pending = find(scanMcpInventory(projectPath), 'project:projOne');
    expect(pending?.state).toBe('pending');
    expect(pending?.requirements.some((r) => r.kind === 'approval')).toBe(true);
  });

  it('`disabledMcpServers` 는 범위를 가리지 않는다 — 글로벌 서버도 이 프로젝트에서 꺼진다', () => {
    writeClaudeJson({
      mcpServers: { globalOne: { command: 'node' } },
      projects: { [projectPath]: { disabledMcpServers: ['globalOne'] } },
    });
    expect(find(scanMcpInventory(projectPath), 'global:globalOne')?.state).toBe('disabled');
  });

  it('정책 차단(deniedMcpServers)은 꺼짐 + **토글 불가** 로 적는다', () => {
    writeClaudeJson({ mcpServers: { blocked: { command: 'node' } }, projects: {} });
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.json'),
      JSON.stringify({ deniedMcpServers: [{ serverName: 'blocked' }] }),
      'utf8',
    );

    const entry = find(scanMcpInventory(projectPath), 'global:blocked');
    expect(entry?.state).toBe('disabled');
    expect(entry?.toggleable).toBe(false);
    expect(entry?.requirements.some((r) => r.kind === 'policy')).toBe(true);
  });

  it('환경변수는 **이름만** 내보낸다 — 값(비밀)은 응답에 없다', () => {
    writeClaudeJson({
      mcpServers: { needsKey: { command: 'node', env: { API_KEY: '', TOKEN: 'super-secret-value' } } },
      projects: {},
    });

    const entry = find(scanMcpInventory(projectPath), 'global:needsKey');
    expect(entry?.envKeys).toEqual(['API_KEY', 'TOKEN']);
    const missing = entry?.requirements.find((r) => r.kind === 'missing-env');
    expect(missing?.detail).toBe('API_KEY');
    expect(JSON.stringify(entry)).not.toContain('super-secret-value');
  });

  it('없는 실행 파일은 "먼저 설치" 로 짚어 준다', () => {
    writeClaudeJson({
      mcpServers: { ghost: { command: 'definitely-not-installed-xyz', args: [] } },
      projects: {},
    });
    const req = find(scanMcpInventory(projectPath), 'global:ghost')?.requirements;
    expect(req?.some((r) => r.kind === 'missing-command' && r.detail === 'definitely-not-installed-xyz')).toBe(true);
  });

  it('원격(http) 서버는 로그인이 필요할 수 있다고 적는다', () => {
    writeClaudeJson({ mcpServers: { remote: { type: 'http', url: 'https://example.com/mcp' } }, projects: {} });
    const entry = find(scanMcpInventory(projectPath), 'global:remote');
    expect(entry?.transport).toBe('http');
    expect(entry?.requirements.some((r) => r.kind === 'auth')).toBe(true);
  });

  it('프리셋의 켜짐은 파일이 아니라 이 에이전트의 설정이 진실이다', () => {
    writeClaudeJson({ projects: {} });
    const off = scanMcpInventory(projectPath).servers.filter((s) => s.scope === 'preset');
    expect(off.every((s) => s.state === 'disabled')).toBe(true);

    const on = scanMcpInventory(projectPath, ['debugger']).servers.find((s) => s.id === 'preset:debugger');
    expect(on?.state).toBe('enabled');
  });
});

describe('setMcpServerEnabled', () => {
  it('끄면 그 프로젝트 엔트리의 `disabledMcpServers` 에 이름이 들어간다', () => {
    writeClaudeJson({ mcpServers: { globalOne: { command: 'node' } }, projects: { [projectPath]: {} } });

    expect(setMcpServerEnabled(projectPath, 'global', 'globalOne', false)).toEqual({ ok: true });
    expect(readClaudeJson().projects[projectPath].disabledMcpServers).toEqual(['globalOne']);
    expect(find(scanMcpInventory(projectPath), 'global:globalOne')?.state).toBe('disabled');
  });

  it('다시 켜면 그 이름만 빠지고, 배열이 비면 키 자체가 사라진다', () => {
    writeClaudeJson({
      mcpServers: { a: { command: 'node' }, b: { command: 'node' } },
      projects: { [projectPath]: { disabledMcpServers: ['a', 'b'] } },
    });

    setMcpServerEnabled(projectPath, 'global', 'a', true);
    expect(readClaudeJson().projects[projectPath].disabledMcpServers).toEqual(['b']);

    setMcpServerEnabled(projectPath, 'global', 'b', true);
    expect(readClaudeJson().projects[projectPath]).not.toHaveProperty('disabledMcpServers');
  });

  it('`.mcp.json` 서버는 켜기가 곧 승인이다 — 승인 대기 → 켜짐', () => {
    writeClaudeJson({ projects: { [projectPath]: {} } });
    const mcpJson = path.join(projectPath, '.mcp.json');
    const before = JSON.stringify({ mcpServers: { projOne: { command: 'node' } } });
    fs.writeFileSync(mcpJson, before, 'utf8');

    expect(find(scanMcpInventory(projectPath), 'project:projOne')?.state).toBe('pending');
    setMcpServerEnabled(projectPath, 'project', 'projOne', true);

    expect(readClaudeJson().projects[projectPath].enabledMcpjsonServers).toEqual(['projOne']);
    expect(find(scanMcpInventory(projectPath), 'project:projOne')?.state).toBe('enabled');
    // ④ 레포에 커밋되는 파일은 한 바이트도 안 건드린다.
    expect(fs.readFileSync(mcpJson, 'utf8')).toBe(before);
  });

  it('같은 폴더가 두 표기로 들어 있으면 **둘 다** 갱신한다(한쪽만 고치면 없던 일이 된다)', () => {
    const slash = projectPath.replace(/\\/g, '/');
    const backslash = projectPath.replace(/\//g, '\\');
    writeClaudeJson({
      mcpServers: { globalOne: { command: 'node' } },
      projects: { [slash]: {}, [backslash]: {} },
    });

    setMcpServerEnabled(projectPath, 'global', 'globalOne', false);
    const projects = readClaudeJson().projects;
    for (const key of Object.keys(projects)) {
      expect(projects[key].disabledMcpServers).toEqual(['globalOne']);
    }
  });

  it('엔트리가 하나도 없으면 그때만 새로 만든다', () => {
    writeClaudeJson({ mcpServers: { globalOne: { command: 'node' } } });
    expect(setMcpServerEnabled(projectPath, 'global', 'globalOne', false)).toEqual({ ok: true });
    expect(readClaudeJson().projects[path.resolve(projectPath)].disabledMcpServers).toEqual(['globalOne']);
  });

  it('프리셋은 이 통로로 받지 않는다 — 축이 다르다(AgentConfig)', () => {
    writeClaudeJson({ projects: {} });
    expect(setMcpServerEnabled(projectPath, 'preset', 'debugger', true).ok).toBe(false);
  });

  it('읽을 수 없는 상태 파일은 **쓰지 않는다**(망가진 위에 덮어쓰지 않는다)', () => {
    fs.writeFileSync(path.join(fakeHome, '.claude.json'), '{ this is not json', 'utf8');
    expect(setMcpServerEnabled(projectPath, 'global', 'x', false).ok).toBe(false);
    expect(fs.readFileSync(path.join(fakeHome, '.claude.json'), 'utf8')).toBe('{ this is not json');
  });
});

/**
 * 경로 키 정책 — 종전 `normalizePathKey` 는 **무조건 `.toLowerCase()`** 였다.
 *
 * Linux 는 대소문자를 가리는 파일시스템이라 `~/Work/App` 과 `~/work/app` 이 **실재하는 서로 다른
 * 폴더**다. 무조건 접으면 두 프로젝트의 MCP 설정이 한 키로 뭉개져, 한쪽을 끄면 남의 프로젝트
 * `disabledMcpServers` 가 함께 바뀐다. 이제 `pathKey`(플랫폼 정책 SSOT)를 쓴다.
 */
describe('프로젝트 키의 대소문자 — 플랫폼 정책을 따른다', () => {
  it('케이스만 다른 두 경로는 그 파일시스템이 실제로 무시할 때만 같은 칸으로 본다', () => {
    const upper = path.join(projectPath, 'Work');
    const lower = path.join(projectPath, 'work');
    writeClaudeJson({
      mcpServers: { globalOne: { command: 'node' } },
      projects: { [path.resolve(upper)]: { disabledMcpServers: ['globalOne'] } },
    });

    // 대문자 경로로 조회하면 언제나 그 엔트리를 본다.
    expect(find(scanMcpInventory(upper), 'global:globalOne')?.state).toBe('disabled');

    // 소문자 경로는 win/mac(대소문자 무시)에서만 같은 엔트리로 읽혀야 한다.
    const asLower = find(scanMcpInventory(lower), 'global:globalOne')?.state;
    expect(asLower).toBe(CASE_INSENSITIVE_FS ? 'disabled' : 'enabled');
  });
});
