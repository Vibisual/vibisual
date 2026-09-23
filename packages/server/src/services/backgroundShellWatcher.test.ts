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

// ─────────────────────────────────────────────────────────────────────────────
// §5.5 #17-9 ⑰ — 120초 타임아웃으로 **승격된** 셸
//
// 전경 Bash 가 120초를 넘기면 하니스가 말없이 백그라운드로 옮긴다. 그 tool_use 에는
// `run_in_background` 깃발이 **없다**(실측: `undefined`). 종전 스캔은 그 깃발을 요구해서
// 승격분을 통째로 놓쳤고, 그래서 그 셸은
//   · 명령 원문을 못 찾아 조용한 항목 조사(⑭)의 후보조차 못 되고
//   · `sort` 처럼 stdin 이 닫힐 때까지 한 글자도 안 찍는 명령이면 끝 표식(⑬)도 영영 안 와
// 세션 하나를 몇 시간씩 "실행 중"으로 붙들었다. 판정 근거를 **깃발에서 하니스의 답으로** 옮긴다.
// ─────────────────────────────────────────────────────────────────────────────

/** assistant → tool_use(Bash) — **깃발 없는 전경 호출**. */
function fgBashLine(toolUseId: string, command: string): string {
  return JSON.stringify({
    timestamp: '2026-09-23T00:00:00.000Z',
    message: { content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command } }] },
  });
}

/** user → tool_result — 승격 안내문(ID 가 **괄호 안**이고, 경로 뒤에 마침표가 붙는다). */
function promotedResultLine(toolUseId: string, shellId: string, outputPath?: string): string {
  const p = outputPath ?? `${dir}/${shellId}.output`;
  const text = `Command did not complete within its 120s timeout and was moved to the background `
    + `(ID: ${shellId}). Output is being written to: ${p}. You will be notified when it completes.`;
  return JSON.stringify({
    timestamp: '2026-09-23T00:00:01.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
  });
}

/** user → tool_result — 그냥 끝난 전경 명령의 평범한 답. */
function plainResultLine(toolUseId: string, text: string): string {
  return JSON.stringify({
    timestamp: '2026-09-23T00:00:01.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
  });
}

describe('타임아웃 승격 셸 — 깃발 ❌, 하니스의 답 ⭕ (§5.5 #17-9 ⑰)', () => {
  it('run_in_background 없이 승격된 셸도 잡는다 — 이걸 놓쳐 세션이 영원히 "실행 중"이었다', () => {
    append([fgBashLine('tu1', 'grep -rhoiE pattern . | sort -u'), promotedResultLine('tu1', 'bspe49nqf')]);
    const shells = scanActiveBackgroundShells(fp);
    expect(shells.map((s) => s.shellId)).toEqual(['bspe49nqf']);
    expect(shells[0]).toMatchObject({
      command: 'grep -rhoiE pattern . | sort -u',
      toolUseId: 'tu1',
      outputPath: `${dir}/bspe49nqf.output`,
    });
  });

  it('괄호 안 ID 에 닫는 괄호가 딸려 오지 않는다 — 그 id 로는 어떤 조회도 맞지 않는다', () => {
    append([fgBashLine('tu1', 'sleep 999'), promotedResultLine('tu1', 'bspe49nqf')]);
    const id = scanActiveBackgroundShells(fp)[0]?.shellId;
    expect(id).toBe('bspe49nqf');
    expect(id).not.toContain(')');
  });

  it('출력 파일명에서 id 를 얻는다 — 안내 문구가 또 바뀌어도 이쪽은 안 흔들린다', () => {
    // 윈도에서 실제로 오는 모양: 역슬래시 경로 + 문장 끝 마침표.
    const winPath = 'D:\\work\\.claude\\tasks\\bshx12ab.output';
    append([fgBashLine('tu1', 'sort big.txt'), promotedResultLine('tu1', 'bshx12ab', winPath)]);
    expect(scanActiveBackgroundShells(fp)[0]).toMatchObject({
      shellId: 'bshx12ab',
      outputPath: winPath,
    });
  });

  it('평범하게 끝난 전경 Bash 는 셸이 되지 않는다 — 모든 Bash 를 담되 답으로 가른다', () => {
    append([
      fgBashLine('tu1', 'echo hi'), plainResultLine('tu1', 'hi'),
      fgBashLine('tu2', 'ls'), plainResultLine('tu2', 'a\nb\nc'),
    ]);
    expect(scanActiveBackgroundShells(fp)).toEqual([]);
  });

  it('승격분도 KillShell 로 지워진다 — 사용자가 끊을 수 있어야 한다', () => {
    append([fgBashLine('tu1', 'sleep 999'), promotedResultLine('tu1', 'bspe49nqf')]);
    scanActiveBackgroundShells(fp); // 캐시 워밍(증분 경로 재현)
    append([killLine('bspe49nqf')]);
    const after = scanActiveBackgroundShells(fp);
    expect(after).toEqual([]);
    expect(after).toEqual(fullRescan());
  });

  it('깃발로 띄운 것과 승격된 것이 한 목록에 섞여도 증분 == 전량 재스캔', () => {
    append([bashLine('tu1', 'npm run dev'), resultLine('tu1', 'sh1')]);
    scanActiveBackgroundShells(fp);
    append([fgBashLine('tu2', 'grep -r x .'), promotedResultLine('tu2', 'sh2')]);
    const incremental = scanActiveBackgroundShells(fp);
    expect(incremental.map((s) => s.shellId)).toEqual(['sh1', 'sh2']);
    expect(incremental).toEqual(fullRescan());
  });
});
