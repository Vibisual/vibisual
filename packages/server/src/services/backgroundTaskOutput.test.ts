import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseTaskEndMarker,
  readTaskOutputState,
  resolveSessionTasksDir,
  resetBackgroundTaskOutputCache,
} from './backgroundTaskOutput.js';

/**
 * §5.5 #17-9 ⑬ — "끝났다고 적힌 것만 걷는다"의 판정부.
 *
 * 이 테스트가 지키는 것은 **한쪽으로만 틀린다**는 성질이다: 표식이 있으면 끝난 것, 없으면 모름.
 * 도는 작업을 끝난 것으로 만드는 오탐이 나면 사용자는 살아 있는 작업을 목록에서 잃는다 —
 * 그래서 아래 "가짜 표식" 묶음이 이 파일의 핵심이다.
 */
describe('parseTaskEndMarker — 마지막 줄에 적힌 종료만 인정한다', () => {
  it('실제 파일 꼬리 모양(빈 줄 + 표식)에서 종료 코드를 읽는다', () => {
    expect(
      parseTaskEndMarker(`PKG_DONE exit=0

[exited with code 0]
`),
    ).toEqual({ kind: 'exited', exitCode: 0 });
  });

  it('0 이 아닌 종료 코드도 그대로 싣는다 (실측 UAT_EXIT=25)', () => {
    expect(parseTaskEndMarker('[exited with code 25]')).toEqual({ kind: 'exited', exitCode: 25 });
  });

  it('음수 종료 코드(신호로 죽은 POSIX 자식)도 읽는다', () => {
    expect(parseTaskEndMarker('[exited with code -1]')).toEqual({ kind: 'exited', exitCode: -1 });
  });

  it('[killed] 은 스스로 끝난 것이 아니므로 종료 코드가 없다', () => {
    expect(parseTaskEndMarker('중단 지점\n[killed]\n')).toEqual({ kind: 'killed' });
  });

  it('CRLF 로 적힌 파일도 같은 답을 낸다 (윈도우 리다이렉트)', () => {
    expect(parseTaskEndMarker('done\r\n[exited with code 0]\r\n')).toEqual({
      kind: 'exited',
      exitCode: 0,
    });
  });

  it('표식이 없으면 null — "아직 도는 중"이 아니라 **모름**이라 종전 동작을 유지한다', () => {
    expect(parseTaskEndMarker('[2026-09-01 16:31] Build 34%\n')).toBeNull();
    expect(parseTaskEndMarker('')).toBeNull();
  });

  it('작업 자신이 찍은 대괄호 낱말을 표식으로 오인하지 않는다 (실측 오탐 후보)', () => {
    for (const line of ['[reinstall]', '[release]', '[failure]', '[try-linux]', '[pull]', '[app/info]']) {
      expect(parseTaskEndMarker(`${line} 진행 중\n`)).toBeNull();
      expect(parseTaskEndMarker(`앞줄\n${line}\n`)).toBeNull();
    }
  });

  it('표식 뒤로 출력이 더 있으면 인정하지 않는다 — 그건 로그 본문이지 파일의 끝이 아니다', () => {
    expect(parseTaskEndMarker('[exited with code 0]\n다음 단계 시작\n')).toBeNull();
  });

  it('같은 줄에 군더더기가 붙으면 표식이 아니다', () => {
    expect(parseTaskEndMarker('child [exited with code 0]')).toBeNull();
    expect(parseTaskEndMarker('[exited with code 0] retrying')).toBeNull();
    expect(parseTaskEndMarker('[exited with code ?]')).toBeNull();
  });
});

describe('readTaskOutputState — 출력 파일 하나의 지금 상태', () => {
  let root: string;
  let tasks: string;

  beforeEach(() => {
    resetBackgroundTaskOutputCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-bgtask-'));
    tasks = path.join(root, 'slug-a', 'sess-1111', 'tasks');
    fs.mkdirSync(tasks, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    resetBackgroundTaskOutputCache();
  });

  const write = (id: string, body: string) =>
    fs.writeFileSync(path.join(tasks, `${id}.output`), body, 'utf8');

  it('파일이 없으면 null — 힌트 없음이지 "끝났음"이 아니다', () => {
    expect(readTaskOutputState(tasks, 'nope')).toBeNull();
  });

  it('끝난 작업은 종료 코드와 마지막 출력 시각을 함께 준다', () => {
    write('done1', 'ok\n[exited with code 0]\n');
    const st = readTaskOutputState(tasks, 'done1');
    expect(st?.end).toEqual({ kind: 'exited', exitCode: 0 });
    expect(st?.lastOutputAtMs).toBeGreaterThan(0);
  });

  it('아직 도는 작업(tail -f)은 end 가 null 이고 시각만 온다', () => {
    write('live1', '[16:24:41] watching...\n');
    const st = readTaskOutputState(tasks, 'live1');
    expect(st).not.toBeNull();
    expect(st?.end).toBeNull();
  });

  it('512바이트보다 큰 파일도 꼬리만 읽어 표식을 찾는다', () => {
    write('big1', `${'로그 한 줄\n'.repeat(400)}[exited with code 3]\n`);
    expect(readTaskOutputState(tasks, 'big1')?.end).toEqual({ kind: 'exited', exitCode: 3 });
  });

  it('꼬리 밖(앞부분)에 있는 표식 모양은 읽지 않는다 — 자식이 찍은 남의 로그다', () => {
    write('big2', `[exited with code 0]\n${'빌드 진행\n'.repeat(400)}`);
    expect(readTaskOutputState(tasks, 'big2')?.end).toBeNull();
  });

  it('파일이 자라면 다시 읽어 표식을 잡는다 (크기·mtime 캐시가 갇히지 않는다)', () => {
    write('grow1', 'step 1\n');
    expect(readTaskOutputState(tasks, 'grow1')?.end).toBeNull();
    write('grow1', 'step 1\nstep 2 완료\n[exited with code 0]\n');
    expect(readTaskOutputState(tasks, 'grow1')?.end).toEqual({ kind: 'exited', exitCode: 0 });
  });
});

describe('resolveSessionTasksDir — 슬러그 규칙을 재현하지 않고 세션 UUID 로 찾는다', () => {
  let root: string;

  beforeEach(() => {
    resetBackgroundTaskOutputCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-bgdir-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    resetBackgroundTaskOutputCache();
  });

  it('<tmp>/<슬러그>/<sessionId>/tasks 를 한 겹 훑어 찾는다', () => {
    fs.mkdirSync(path.join(root, 'C--Users-aa-Other', 'sess-aaa', 'tasks'), { recursive: true });
    const want = path.join(root, 'C--Users-aa-Proj', 'sess-bbb', 'tasks');
    fs.mkdirSync(want, { recursive: true });
    expect(resolveSessionTasksDir('sess-bbb', root)).toBe(want);
  });

  it('없으면 null — 힌트 없이 종전 동작으로 떨어진다', () => {
    expect(resolveSessionTasksDir('sess-none', root)).toBeNull();
    expect(resolveSessionTasksDir('', root)).toBeNull();
  });

  it('tmp 폴더 자체가 없어도 던지지 않는다 (작업을 한 번도 안 띄운 사용자)', () => {
    expect(resolveSessionTasksDir('sess-x', path.join(root, 'absent'))).toBeNull();
  });

  it('못 찾은 것은 곧바로 다시 훑지 않는다 — 5초 리컨사일이 매번 readdir 하지 않게', () => {
    const t0 = 1_000_000;
    expect(resolveSessionTasksDir('sess-late', root, t0)).toBeNull();
    const late = path.join(root, 'slug', 'sess-late', 'tasks');
    fs.mkdirSync(late, { recursive: true });
    expect(resolveSessionTasksDir('sess-late', root, t0 + 5_000)).toBeNull();
    expect(resolveSessionTasksDir('sess-late', root, t0 + 31_000)).toBe(late);
  });

  it('한 번 찾은 폴더는 캐시로 답한다 (디스크를 다시 훑지 않는다)', () => {
    const dir = path.join(root, 'slug', 'sess-keep', 'tasks');
    fs.mkdirSync(dir, { recursive: true });
    expect(resolveSessionTasksDir('sess-keep', root)).toBe(dir);
    fs.rmSync(path.join(root, 'slug'), { recursive: true, force: true });
    expect(resolveSessionTasksDir('sess-keep', root)).toBe(dir);
  });
});
