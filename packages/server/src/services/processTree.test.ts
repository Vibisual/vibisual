/**
 * 프로세스 트리 종료의 **멀티플랫폼 회귀 고정**.
 *
 * 배경 — POSIX 의 트리 킬(`killTree`)은 `process.kill(-pid)` 로 프로세스 **그룹**을 죽인다.
 * 그런데 그룹 킬이 성립하려면 자식이 `detached: true` 로 떠서 그룹 리더여야 한다. claude 스폰 경로에
 * `detached` 가 하나도 없던 시절, mac/linux 에서는 `-pid` 가 **항상** ESRCH 로 떨어져 단일 pid 킬로
 * 강등됐고 claude 가 띄운 MCP 서버·worker(손자)가 조용히 살아남았다. 예외도 로그도 안 남는 결함이라
 * 눈으로는 절대 못 잡는다 — 그래서 스폰 옵션 조립을 순수 함수로 빼고 세 플랫폼을 여기서 고정한다.
 *
 * ⚠ 실제로 프로세스를 띄우거나 죽이는 테스트는 만들지 않는다(순수 함수 + 소스 검사만).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processGroupSpawnOptions } from './processTree.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readService(file: string): string {
  const full = path.join(HERE, file);
  const src = fs.readFileSync(full, 'utf8');
  // 빈 문자열을 조용히 통과시키면 "검사했다"는 착각만 남는다 — 못 읽으면 실패해야 한다.
  expect(src.length, `${file} source should be readable`).toBeGreaterThan(0);
  return src;
}

describe('processGroupSpawnOptions — 플랫폼별 spawn 옵션 조립', () => {
  it('POSIX 는 detached:true (프로세스 그룹 리더)로 띄운다', () => {
    expect(processGroupSpawnOptions('darwin')).toEqual({ detached: true });
    expect(processGroupSpawnOptions('linux')).toEqual({ detached: true });
    expect(processGroupSpawnOptions('freebsd')).toEqual({ detached: true });
  });

  it('Windows 에는 detached 를 넣지 않는다 (새 콘솔 창이 뜨고, 트리 킬은 taskkill /T 담당)', () => {
    const opts = processGroupSpawnOptions('win32');
    expect(opts).toEqual({});
    expect('detached' in opts).toBe(false);
  });

  it('다른 spawn 옵션에 스프레드해도 나머지를 덮지 않는다', () => {
    const posix = { cwd: '/tmp', shell: false, stdio: ['pipe', 'pipe', 'pipe'], ...processGroupSpawnOptions('linux') };
    expect(posix).toEqual({ cwd: '/tmp', shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: true });

    const win = { cwd: 'C:/tmp', shell: false, ...processGroupSpawnOptions('win32') };
    expect(win).toEqual({ cwd: 'C:/tmp', shell: false });
    expect((win as { detached?: boolean }).detached).toBeUndefined();
  });
});

describe('killTree — POSIX 그룹 킬 유지', () => {
  it('POSIX 경로가 -pid(프로세스 그룹) 킬을 그대로 들고 있다', () => {
    // 이 줄이 사라지면 detached 스폰이 아무 의미가 없어지고 손자가 다시 살아남는다.
    expect(readService('processTree.ts')).toContain("process.kill(-pid, 'SIGKILL')");
  });
});

describe('장수명 claude 자식 스폰은 전부 processGroupSpawnOptions 를 통과한다', () => {
  // "detached 는 필요 없어 보인다"며 되돌리면 mac/linux 고아 프로세스 버그가 그대로 부활한다.
  const LONG_LIVED_SPAWNS: { file: string; sites: number; why: string }[] = [
    { file: 'subAgentManager.ts', sites: 2, why: 'claude 본체 execute + summarizeSession(--resume)' },
    { file: 'contiManager.ts', sites: 2, why: 'callClaude + runPatchAgent' },
    { file: 'claudeAgentViewService.ts', sites: 1, why: 'claude --bg 워커' },
    { file: 'claudeSetupService.ts', sites: 1, why: '네이티브 인스톨러(shell 파이프라인)' },
    { file: 'claudeVersionService.ts', sites: 1, why: 'claude update / npm install -g' },
    { file: 'feedbackDistillService.ts', sites: 1, why: 'haiku one-shot 증류' },
  ];

  for (const { file, sites, why } of LONG_LIVED_SPAWNS) {
    it(`${file} — ${why} (${sites}곳)`, () => {
      const src = readService(file);
      const spread = src.match(/\.\.\.processGroupSpawnOptions\(\)/g) ?? [];
      expect(spread.length, `${file} 의 장수명 spawn 에 ...processGroupSpawnOptions() 가 빠졌다`).toBeGreaterThanOrEqual(sites);
      expect(src).toContain("from './processTree.js'");
    });
  }

  it('짧은 probe 스폰(--version / --help / auth status / stop·rm)은 일부러 빼 두고 이유를 남긴다', () => {
    // 왜 안 붙였는지가 코드에 없으면 다음 사람이 "빠뜨렸다"고 보고 무의미하게 넓힌다.
    expect(readService('claudeVersionService.ts')).toMatch(/일부러 안 붙인다[\s\S]{0,200}--version/);
    expect(readService('modelRegistryService.ts')).toMatch(/일부러 안 붙인다/);
    // auth 의 spawn 은 claudeCliRun.ts 로 옮겨졌다(사용량 probe 와 공용) — 이유도 함께 옮겼다.
    expect(readService('claudeCliRun.ts')).toMatch(/일부러 안 붙인다/);
    expect(readService('claudeAuthService.ts')).toContain("from './claudeCliRun.js'");
    expect(readService('claudeAgentViewService.ts')).toMatch(/일부러 안 붙인다/);
  });

  it('feedbackDistillService 는 taskkill 을 재구현하지 않고 killTree 로 위임한다', () => {
    const src = readService('feedbackDistillService.ts');
    expect(src).toContain('killTree(child.pid)');
    // 중복 구현이 되살아나면 POSIX 쪽이 다시 트리 킬을 안 하게 된다.
    expect(src).not.toMatch(/spawn\(\s*'taskkill'/);
  });
});
