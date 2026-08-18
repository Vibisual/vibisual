/**
 * §9 — `scanActiveBackgroundShells` 증분 스캔이 **전량 재스캔과 같은 결과**인지 고정한다.
 *
 * **배경**: 이 스캔은 `SESSION_SCAN_INTERVAL`(10초) sweep 이 등록된 모든 세션에 대해 돌린다.
 * 종전엔 매번 트랜스크립트를 `readFileSync` 로 통째로 읽고 전 줄을 파싱했고, 트랜스크립트가
 * 세션당 8~26MB 까지 자라 메인 프로세스 누적 읽기 537GB · CPU 상시 130~160% 의 주범이었다
 * (실측 2026-08-15). append-only 특성을 살려 새 줄만 먹이도록 바꿨으므로, 이 테스트가 지키는
 * 것은 하나다 — **최적화가 결과를 바꾸면 안 된다.**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scanActiveBackgroundShells,
  resetBackgroundShellScanCache,
} from './backgroundShellWatcher.js';

let dir: string;
let fp: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-bgshell-'));
  fp = path.join(dir, 'session.jsonl');
  resetBackgroundShellScanCache();
});

afterEach(() => {
  resetBackgroundShellScanCache();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ }
});

/** assistant → tool_use(Bash, run_in_background). */
function bashLine(toolUseId: string, command: string): string {
  return JSON.stringify({
    timestamp: '2026-08-15T00:00:00.000Z',
    message: { content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command, run_in_background: true } }] },
  });
}

/** user → tool_result(하니스가 돌려주는 background 안내 문구). */
function resultLine(toolUseId: string, shellId: string): string {
  const text = `Command running in background with ID: ${shellId}. Output is being written to: ${dir}/${shellId}.output. You will be notified when it completes.`;
  return JSON.stringify({
    timestamp: '2026-08-15T00:00:01.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
  });
}

/** assistant → tool_use(KillShell). */
function killLine(shellId: string): string {
  return JSON.stringify({
    timestamp: '2026-08-15T00:00:02.000Z',
    message: { content: [{ type: 'tool_use', id: `k-${shellId}`, name: 'KillShell', input: { shell_id: shellId } }] },
  });
}

function append(lines: string[]): void {
  fs.appendFileSync(fp, lines.join('\n') + '\n', 'utf8');
}

/** 캐시를 버리고 파일을 처음부터 다시 훑은 결과 — 비교 기준(= 종전 전량 재스캔). */
function fullRescan(): ReturnType<typeof scanActiveBackgroundShells> {
  resetBackgroundShellScanCache();
  return scanActiveBackgroundShells(fp);
}

describe('scanActiveBackgroundShells — 증분 == 전량 재스캔', () => {
  it('append 를 나눠 먹여도 전량 재스캔과 같다', () => {
    append([bashLine('tu1', 'npm run dev'), resultLine('tu1', 'sh1')]);
    const first = scanActiveBackgroundShells(fp);
    expect(first.map((s) => s.shellId)).toEqual(['sh1']);

    // 이어서 두 번째 셸이 붙는다 — 증분 경로만 탄다.
    append([bashLine('tu2', 'pnpm start'), resultLine('tu2', 'sh2')]);
    const incremental = scanActiveBackgroundShells(fp);
    expect(incremental.map((s) => s.shellId)).toEqual(['sh1', 'sh2']);
    expect(incremental).toEqual(fullRescan());

    // 첫 셸이 죽는다 — kill 은 누적 상태에 남아 이후 조회에서 계속 걸러져야 한다.
    resetBackgroundShellScanCache();
    scanActiveBackgroundShells(fp); // 캐시 워밍(증분 경로 재현)
    append([killLine('sh1')]);
    const afterKill = scanActiveBackgroundShells(fp);
    expect(afterKill.map((s) => s.shellId)).toEqual(['sh2']);
    expect(afterKill).toEqual(fullRescan());
  });

  it('명령·출력경로·toolUseId 가 전량 재스캔과 동일하다', () => {
    append([bashLine('tu1', 'npm run dev'), resultLine('tu1', 'sh1')]);
    scanActiveBackgroundShells(fp);
    append([bashLine('tu2', 'vite preview'), resultLine('tu2', 'sh2')]);
    const incremental = scanActiveBackgroundShells(fp);

    expect(incremental).toEqual(fullRescan());
    expect(incremental[1]).toMatchObject({
      shellId: 'sh2',
      command: 'vite preview',
      toolUseId: 'tu2',
      outputPath: `${dir}/sh2.output`,
    });
  });

  it('파일이 그대로면 같은 결과를 그대로 돌려준다(디스크 재독 없음)', () => {
    append([bashLine('tu1', 'npm run dev'), resultLine('tu1', 'sh1')]);
    const a = scanActiveBackgroundShells(fp);
    const b = scanActiveBackgroundShells(fp);
    const c = scanActiveBackgroundShells(fp);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('파일이 줄어들면(교체·잘림) 상태를 버리고 처음부터 다시 읽는다', () => {
    append([bashLine('tu1', 'npm run dev'), resultLine('tu1', 'sh1'), bashLine('tu2', 'pnpm start'), resultLine('tu2', 'sh2')]);
    expect(scanActiveBackgroundShells(fp).map((s) => s.shellId)).toEqual(['sh1', 'sh2']);

    // 완전히 다른(더 짧은) 내용으로 교체 — 이어 읽으면 엉뚱한 결과가 나온다.
    fs.writeFileSync(fp, [bashLine('tu9', 'python -m http.server'), resultLine('tu9', 'sh9')].join('\n') + '\n', 'utf8');
    const after = scanActiveBackgroundShells(fp);
    expect(after.map((s) => s.shellId)).toEqual(['sh9']);
    expect(after).toEqual(fullRescan());
  });

  it('개행 없이 끊긴 마지막 줄은 완결된 뒤에 한 번만 반영된다', () => {
    append([bashLine('tu1', 'npm run dev')]);
    // tool_result 줄이 반쪽만 기록된 상태(하니스가 쓰는 도중).
    const half = resultLine('tu1', 'sh1');
    fs.appendFileSync(fp, half.slice(0, Math.floor(half.length / 2)), 'utf8');
    expect(scanActiveBackgroundShells(fp)).toEqual([]); // 반쪽 줄은 먹지 않는다

    // 나머지가 붙어 줄이 완결된다.
    fs.appendFileSync(fp, half.slice(Math.floor(half.length / 2)) + '\n', 'utf8');
    const done = scanActiveBackgroundShells(fp);
    expect(done.map((s) => s.shellId)).toEqual(['sh1']);
    expect(done).toEqual(fullRescan());
  });

  it('없는 파일은 빈 배열', () => {
    expect(scanActiveBackgroundShells(path.join(dir, 'nope.jsonl'))).toEqual([]);
  });
});
