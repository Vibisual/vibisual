/**
 * §5.5 #17-9 ⑭(e) — **누구를 죽여도 되는지**를 고정한다.
 *
 * 이 파일이 지키는 것은 정확성이 아니라 **폭발 반경**이다. 판정이 틀리면 항목 하나가 잘못 닫히지만,
 * 매칭이 틀리면 **남의 프로세스가 죽는다.** 그래서 여기 테스트는 대부분 "이건 걸리면 안 된다" 쪽이다.
 *
 * 실측(2026-09-01)에서 나온 두 사실이 설계의 뼈대이고, 둘 다 아래에 그대로 굳어 있다.
 *  ① msys2 의 fork 흉내는 중간 셸이 먼저 사라져 손자의 PPID 가 **없는 번호**를 가리킨다 —
 *    `taskkill /T` 도 PPID 사슬 타기도 그들에게 영영 닿지 못한다(고아 7건).
 *  ② 고아의 명령줄에는 **절대 실행본 경로**가 붙어 온다(`"C:\…\tail.exe" -f …`) — 원문과 통째로
 *    비교하면 절대 안 맞는다. 인자 부분만 남겨야 원문의 부분 문자열이 된다.
 *
 * 파서·판정이 전부 순수 함수라 세 OS 를 개발기 한 대에서 돌린다(멀티플랫폼 규칙).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 실제로 프로세스를 죽이지 않고 **순서만** 본다 — 순서가 이 함수의 유일한 계약이다.
const killed: number[] = [];
vi.mock('./processTree.js', () => ({
  killTree: (pid: number) => { killed.push(pid); },
}));

import {
  ORPHAN_MIN_MATCH,
  descendantsOf,
  killMatchedProcesses,
  matchTaskProcesses,
  normalizeForMatch,
  parsePosixPsLines,
  parseWindowsProcessLines,
  processListCommand,
  stripProgramPath,
  type ProcessRow,
} from './processDescendants.js';

/** 실측에서 가져온 전형 — 이 길이라야 `ORPHAN_MIN_MATCH` 하한을 넘는다. */
const TASK_CMD = 'tail -f "C:/work/pkg.log" | grep --line-buffered -E "done|error"';

const row = (pid: number, ppid: number, command: string): ProcessRow => ({ pid, ppid, command });

describe('normalizeForMatch', () => {
  it('공백·따옴표·역슬래시를 지우고 소문자로 접는다 — 하니스가 eval 로 감싸며 바꾸는 것들이다', () => {
    expect(normalizeForMatch('tail -f "C:/a b.log"')).toBe('tail-fc:/ab.log');
    expect(normalizeForMatch("tail  -f  \\\"C:/a b.log\\\"")).toBe('tail-fc:/ab.log');
  });
});

describe('stripProgramPath', () => {
  it('따옴표로 감싼 절대 실행본 경로를 떼고 인자만 남긴다 (고아 매칭의 전제)', () => {
    expect(stripProgramPath('"C:\\Program Files\\Git\\usr\\bin\\tail.exe" -f C:/work/pkg.log'))
      .toBe('-f C:/work/pkg.log');
  });

  it('따옴표 없는 경로도 첫 공백까지 떼어 낸다', () => {
    expect(stripProgramPath('/usr/bin/grep --line-buffered ERROR')).toBe('--line-buffered ERROR');
  });

  it('인자가 없으면 빈 문자열 — 하한에 걸려 아무것도 매칭되지 않는다', () => {
    expect(stripProgramPath('/usr/bin/tail')).toBe('');
    expect(stripProgramPath('"C:\\bin\\tail.exe"')).toBe('');
    expect(stripProgramPath('')).toBe('');
  });
});

describe('parseWindowsProcessLines', () => {
  it('pid\\tppid\\t명령줄 세 칸을 읽고, 명령줄 안의 탭은 이미 접혀 온 것으로 본다', () => {
    const text = '1234\t900\tC:\\Windows\\System32\\cmd.exe /c foo\r\n5678\t1234\ttail.exe -f a.log\r\n';
    expect(parseWindowsProcessLines(text)).toEqual([
      row(1234, 900, 'C:\\Windows\\System32\\cmd.exe /c foo'),
      row(5678, 1234, 'tail.exe -f a.log'),
    ]);
  });

  it('명령줄을 못 읽은 줄(빈 칸)도 pid/ppid 는 살린다 — 자손 걷기에 필요하다', () => {
    expect(parseWindowsProcessLines('4\t0\t\n')).toEqual([row(4, 0, '')]);
  });

  it('칸이 모자라거나 숫자가 아닌 줄은 버린다', () => {
    expect(parseWindowsProcessLines('쓰레기\n1234\t900\n\n')).toEqual([]);
  });
});

describe('parsePosixPsLines', () => {
  it('ps -eo pid=,ppid=,args= 출력을 읽는다 (앞 공백 패딩 포함)', () => {
    const text = '  501     1 /bin/zsh -l\n  502   501 tail -f /var/log/app.log\n';
    expect(parsePosixPsLines(text)).toEqual([
      row(501, 1, '/bin/zsh -l'),
      row(502, 501, 'tail -f /var/log/app.log'),
    ]);
  });

  it('명령줄에 공백이 여럿 있어도 통째로 남긴다', () => {
    expect(parsePosixPsLines('7 1 sh -c "a  b" | c')[0]?.command).toBe('sh -c "a  b" | c');
  });
});

describe('processListCommand', () => {
  it('윈도우는 PowerShell Win32_Process, POSIX 는 ps 를 쓴다', () => {
    const win = processListCommand('win32');
    expect(win.file).toBe('powershell.exe');
    expect(win.args.join(' ')).toContain('Win32_Process');
    // 프로필을 타면 사용자 스크립트가 끼어들고 느려진다 — 목록 하나 뜨는 데 그럴 이유가 없다.
    expect(win.args).toContain('-NoProfile');

    for (const p of ['darwin', 'linux'] as const) {
      expect(processListCommand(p)).toEqual({ file: 'ps', args: ['-eo', 'pid=,ppid=,args='] });
    }
  });
});

describe('descendantsOf', () => {
  const rows = [
    row(100, 1, 'claude'),
    row(200, 100, 'bash -c task'),
    row(300, 200, 'tail -f a.log'),
    row(400, 300, 'grep x'),
    row(999, 1, '남의 프로세스'),
  ];

  it('손자·증손자까지 전부 걷되 자기 자신은 빼고, 나무 밖은 건드리지 않는다', () => {
    expect(descendantsOf(rows, 100).map((r) => r.pid).sort()).toEqual([200, 300, 400]);
    expect(descendantsOf(rows, 100).some((r) => r.pid === 999)).toBe(false);
  });

  it('자식이 없으면 빈 배열', () => {
    expect(descendantsOf(rows, 400)).toEqual([]);
    expect(descendantsOf(rows, 12345)).toEqual([]);
  });

  it('PPID 재사용으로 고리가 생겨도 멈춘다 — OS 는 PID 를 돌려 쓴다', () => {
    const cyclic = [row(10, 20, 'a'), row(20, 10, 'b')];
    expect(descendantsOf(cyclic, 10).map((r) => r.pid)).toEqual([20]);
  });
});

describe('matchTaskProcesses', () => {
  /** 세션 나무: claude(100) → 셸(200) → tail(300) → grep(400). */
  const tree = [
    row(1, 0, 'init'),
    row(100, 1, 'claude --resume'),
    row(200, 100, `bash -c "${TASK_CMD}"`),
    row(300, 200, `"C:\\Program Files\\Git\\usr\\bin\\tail.exe" -f "C:/work/pkg.log"`),
  ];

  it('① 세션 나무 안에서 명령을 통째로 담은 것과 그 아래 자손을 잡는다', () => {
    const hit = matchTaskProcesses(tree, 100, TASK_CMD).map((r) => r.pid).sort();
    expect(hit).toEqual([200, 300]);
  });

  it('세션 나무 밖의 같은 명령은 절대 잡지 않는다 — 남의 창에서 돌던 것일 수 있다', () => {
    const withStranger = [...tree, row(700, 1, `bash -c "${TASK_CMD}"`)];
    expect(matchTaskProcesses(withStranger, 100, TASK_CMD).map((r) => r.pid)).not.toContain(700);
  });

  it('② 부모가 죽은 고아는 인자 부분이 명령의 일부이면 잡는다 (msys2 손자 — 사슬로는 못 닿는다)', () => {
    const orphan = row(555, 4242, `"C:\\Program Files\\Git\\usr\\bin\\grep.exe" --line-buffered -E "done|error"`);
    const rows = [...tree, orphan]; // ppid 4242 는 목록에 없다 = 고아
    expect(matchTaskProcesses(rows, 100, TASK_CMD).map((r) => r.pid)).toContain(555);
  });

  it('고아라도 인자가 짧으면 잡지 않는다 — 우연한 일치로 남의 프로세스가 죽는다', () => {
    const shortOrphan = row(556, 4242, '"C:\\bin\\tail.exe" -f');
    expect(stripProgramPath(shortOrphan.command).length).toBeLessThan(ORPHAN_MIN_MATCH);
    expect(matchTaskProcesses([...tree, shortOrphan], 100, TASK_CMD).map((r) => r.pid)).not.toContain(556);
  });

  it('부모가 살아 있으면 고아 갈래로 잡지 않는다 — 그건 ① 이 볼 자리다', () => {
    const child = row(557, 999, `"C:\\bin\\grep.exe" --line-buffered -E "done|error"`);
    const rows = [...tree, row(999, 1, '남의 셸'), child];
    expect(matchTaskProcesses(rows, 100, TASK_CMD).map((r) => r.pid)).not.toContain(557);
  });

  it('맞는 것이 없으면 빈 배열 — 없는 것과 못 찾은 것을 같은 값으로 답하지 않게 호출부가 구분한다', () => {
    expect(matchTaskProcesses(tree, 100, 'node scripts/전혀-다른-명령을-오래-돌린다.mjs')).toEqual([]);
  });

  it('명령이 너무 짧으면 아예 매칭하지 않는다 — `ls` 하나로 온 시스템이 걸린다', () => {
    expect(matchTaskProcesses(tree, 100, 'ls')).toEqual([]);
    expect(matchTaskProcesses(tree, 100, '')).toEqual([]);
  });

  it('따옴표 이스케이프 차이(하니스가 eval 로 감싼 형태)를 넘어 같은 것으로 본다', () => {
    const escaped = [...tree, row(210, 100, `sh -c 'eval \\"${TASK_CMD}\\"'`)];
    expect(matchTaskProcesses(escaped, 100, TASK_CMD).map((r) => r.pid)).toContain(210);
  });

  it('POSIX 나무에서도 같은 판정을 낸다 — 파서만 다르고 규칙은 하나다', () => {
    const posix = parsePosixPsLines([
      '  1     0 /sbin/init',
      '100     1 claude --resume',
      `200   100 bash -c ${TASK_CMD}`,
      '300   200 tail -f /work/pkg.log',
    ].join('\n'));
    expect(matchTaskProcesses(posix, 100, TASK_CMD).map((r) => r.pid).sort()).toEqual([200, 300]);
  });
});

describe('killMatchedProcesses', () => {
  beforeEach(() => { killed.length = 0; });

  it('깊은 것부터 끊는다 — 부모를 먼저 죽이면 그 순간 자식이 고아가 되어 다음 회차에 못 찾는다', () => {
    const rows = [
      row(100, 1, 'claude'),
      row(200, 100, 'bash'),
      row(300, 200, 'tail'),
      row(400, 300, 'grep'),
    ];
    const n = killMatchedProcesses(rows, [rows[1]!, rows[3]!, rows[2]!]);
    expect(n).toBe(3);
    expect(killed).toEqual([400, 300, 200]);
  });

  it('부모가 목록에 없는 고아는 깊이 0 이라 마지막에 온다 — 사슬이 끊겨 딸려 죽을 일이 없다', () => {
    const rows = [row(100, 1, 'claude'), row(200, 100, 'bash'), row(555, 4242, '고아')];
    killMatchedProcesses(rows, [rows[2]!, rows[1]!]);
    expect(killed).toEqual([200, 555]);
  });

  it('빈 목록이면 아무것도 하지 않는다', () => {
    expect(killMatchedProcesses([], [])).toBe(0);
    expect(killed).toEqual([]);
  });
});
