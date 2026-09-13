import { describe, it, expect } from 'vitest';
import {
  buildTakeoverProbes,
  isUnusableTakeoverCommand,
  parseLsofCwd,
  parseProcCmdline,
  parsePsArgs,
  parseWinCommandLine,
  shellJoinArgv,
  takeoverProbeTimeoutMs,
} from './portTakeover.js';
import { PROCESS_LIST_TIMEOUT_MS } from './processDescendants.js';

/**
 * §7.11 포트 인계 — 포트 인계의 **조회 계획과 파서**를 세 OS 모두에 대해 고정한다.
 * 실기(mac/linux)가 없는 Windows 개발기에서 플랫폼 분기를 검증할 수 있는 유일한 방법이라
 * `platform` 을 인자로 받게 설계했다(docs/rules/multiplatform.md).
 */
describe('§7.11 포트 인계 — 플랫폼별 조회 계획', () => {
  it('win32 은 Win32_Process 의 CommandLine 하나만 묻는다 (cwd 는 공개 API 가 없다)', () => {
    const probes = buildTakeoverProbes('win32', 4242);
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({ kind: 'exec', field: 'command', parse: 'win-cmdline' });
    expect(probes[0]).toHaveProperty('command', expect.stringContaining('ProcessId=4242') as unknown as string);
    expect(probes.some((p) => p.field === 'cwd')).toBe(false);
  });

  it('linux 는 /proc 을 먼저 보고 ps 로 폴백한다 (무손실 argv + 실제 cwd)', () => {
    const probes = buildTakeoverProbes('linux', 77);
    expect(probes[0]).toEqual({ kind: 'file', path: '/proc/77/cmdline', field: 'command', parse: 'proc-cmdline' });
    expect(probes[1]).toEqual({ kind: 'link', path: '/proc/77/cwd', field: 'cwd' });
    // 컨테이너처럼 /proc 이 잘린 환경을 위한 폴백이 뒤에 남아 있어야 한다.
    expect(probes.some((p) => p.kind === 'exec' && p.parse === 'ps-args')).toBe(true);
    expect(probes.some((p) => p.kind === 'exec' && p.parse === 'lsof-cwd')).toBe(true);
  });

  it('darwin 은 /proc 이 없으므로 ps + lsof 만 쓴다', () => {
    const probes = buildTakeoverProbes('darwin', 77);
    expect(probes.some((p) => p.kind === 'file' || p.kind === 'link')).toBe(false);
    expect(probes.map((p) => (p.kind === 'exec' ? p.parse : p.kind))).toEqual(['ps-args', 'lsof-cwd']);
  });

  it('잘못된 pid 에는 조회 계획을 세우지 않는다', () => {
    expect(buildTakeoverProbes('linux', 0)).toEqual([]);
    expect(buildTakeoverProbes('win32', -1)).toEqual([]);
    expect(buildTakeoverProbes('darwin', 1.5)).toEqual([]);
  });

  it('win32 조회는 PowerShell 기동을 기다려 준다 (바쁜 기기에서 4초에 잘려 명령을 못 읽었다)', () => {
    // 같은 Win32_Process 질의로 프로세스 목록을 뜨는 쪽보다 짧으면 인계만 먼저 포기한다.
    expect(takeoverProbeTimeoutMs('win32')).toBeGreaterThanOrEqual(PROCESS_LIST_TIMEOUT_MS);
    // ps·lsof 는 가벼운 도구다 — POSIX 에서 기다림을 늘릴 이유는 없다.
    expect(takeoverProbeTimeoutMs('linux')).toBe(4_000);
    expect(takeoverProbeTimeoutMs('darwin')).toBe(4_000);
  });
});

describe('§7.11 포트 인계 — 출력 파서', () => {
  it('/proc/<pid>/cmdline 은 NUL 로 갈려 공백이 든 인자가 살아남는다', () => {
    const NUL = '\x00';
    expect(parseProcCmdline(`node${NUL}/My Project/server.js${NUL}--port${NUL}808 0${NUL}`)).toEqual([
      'node', '/My Project/server.js', '--port', '808 0',
    ]);
  });

  it('ps -o args= 는 첫 비어 있지 않은 줄을 쓴다', () => {
    expect(parsePsArgs('\n  node /srv/app.js --port 3000  \n')).toBe('node /srv/app.js --port 3000');
    expect(parsePsArgs('\n \n')).toBeNull();
  });

  it('PowerShell 명령줄은 접힌 줄을 한 줄로 되돌린다', () => {
    expect(parseWinCommandLine('"C:\\node.exe" "C:\\a.js"\r\n')).toBe('"C:\\node.exe" "C:\\a.js"');
    expect(parseWinCommandLine('  \r\n ')).toBeNull();
  });

  it('lsof -F n 은 n 접두 줄에서 cwd 를 뽑는다', () => {
    expect(parseLsofCwd('p1234\nn/srv/proj\n')).toBe('/srv/proj');
    expect(parseLsofCwd('p1234\n')).toBeNull();
  });
});

describe('§7.11 포트 인계 — 셸 한 줄 복원', () => {
  it('공백이 든 인자를 감싼다 — 안 감싸면 respawn 이 인자를 쪼개 서버가 즉시 죽는다', () => {
    expect(shellJoinArgv(['node', '/My Project/server.js'], 'linux')).toBe(`node '/My Project/server.js'`);
    expect(shellJoinArgv(['node', 'C:\\My Project\\a.js'], 'win32')).toBe(`node "C:\\My Project\\a.js"`);
  });

  it('평범한 인자는 그대로 둔다 (읽기 좋은 명령이 목록에도 그대로 뜬다)', () => {
    expect(shellJoinArgv(['pnpm', 'dev', '--port=5173'], 'linux')).toBe('pnpm dev --port=5173');
  });

  it('작은따옴표가 든 인자도 POSIX 규칙으로 안전하게 감싼다', () => {
    expect(shellJoinArgv(['sh', '-c', `echo 'hi'`], 'linux')).toBe(`sh -c 'echo '\\''hi'\\'''`);
  });

  it('다시 띄울 수 없는 명령은 인계하지 않는다', () => {
    expect(isUnusableTakeoverCommand('')).toBe(true);
    expect(isUnusableTakeoverCommand('   ')).toBe(true);
    expect(isUnusableTakeoverCommand('[kworker/0:1]')).toBe(true); // 리눅스 커널 스레드
    expect(isUnusableTakeoverCommand('pnpm dev')).toBe(false);
  });
});
