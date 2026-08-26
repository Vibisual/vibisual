/**
 * 포트 점유자 조회의 **멀티플랫폼 회귀 고정**.
 *
 * 배경 — `killByPort` 의 POSIX 분기는 오랫동안 `lsof` 하나에만 의존했고 exec 에러를 통째로 삼켜
 * `false` 를 돌려줬다. `lsof` 는 macOS 엔 항상 있지만 최소구성 Linux(컨테이너·서버 배포판)엔 없는
 * 경우가 있어, 그런 환경의 사용자는 "포트 킬이 그냥 안 먹는다"만 겪고 이유를 알 길이 없었다.
 * 이제 lsof → ss → fuser → /proc/net/tcp 로 내려가며, "도구가 없어서 못 봤다"(`no-tool`)와
 * "포트가 비어 있다"(`not-listening`)를 구분해 돌려준다.
 *
 * ⚠ 실제로 포트를 조회하거나 프로세스를 죽이는 테스트는 만들지 않는다 — 출력 파서(순수 함수)와
 *   외부 명령을 전혀 실행하지 않는 입력 검증 경로만 고정한다.
 */
import { describe, it, expect } from 'vitest';
import {
  parseNetstatListeningPids,
  parseLsofPids,
  parseSsPids,
  parseFuserPids,
  parseProcNetTcpListenInodes,
  killByPortDetailed,
} from './processChecker.js';

describe('parseNetstatListeningPids (Windows)', () => {
  const SAMPLE = [
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:4800           0.0.0.0:0              LISTENING       12345',
    '  TCP    0.0.0.0:48000          0.0.0.0:0              LISTENING       6789',
    '  TCP    127.0.0.1:4800         127.0.0.1:52000        ESTABLISHED     4242',
    '  TCP    [::]:4800              [::]:0                 LISTENING       12345',
  ].join('\r\n');

  it('해당 포트의 LISTENING PID 만 뽑고 중복은 접는다', () => {
    expect(parseNetstatListeningPids(SAMPLE, 4800)).toEqual([12345]);
  });

  it('접두 일치(4800 vs 48000)를 섞지 않는다 — 예전 `findstr :4800` 이 48000 도 잡았다', () => {
    expect(parseNetstatListeningPids(SAMPLE, 4800)).not.toContain(6789);
    expect(parseNetstatListeningPids(SAMPLE, 48000)).toEqual([6789]);
  });

  it('ESTABLISHED 연결은 점유자가 아니다', () => {
    expect(parseNetstatListeningPids(SAMPLE, 4800)).not.toContain(4242);
  });

  it('빈 출력은 빈 배열', () => {
    expect(parseNetstatListeningPids('', 4800)).toEqual([]);
  });
});

describe('parseLsofPids (macOS/Linux)', () => {
  it('-t 출력은 PID 한 줄에 하나', () => {
    expect(parseLsofPids('1234\n5678\n')).toEqual([1234, 5678]);
  });

  it('빈 출력·공백만 있는 출력은 빈 배열', () => {
    expect(parseLsofPids('')).toEqual([]);
    expect(parseLsofPids('\n  \n')).toEqual([]);
  });
});

describe('parseSsPids (iproute2)', () => {
  it('users:((...,pid=N,...)) 에서 PID 를 뽑는다', () => {
    const out = 'LISTEN 0      511                *:4800             *:*    users:(("node",pid=1234,fd=23))';
    expect(parseSsPids(out)).toEqual([1234]);
  });

  it('한 소켓을 여러 프로세스가 공유하면 전부 뽑는다', () => {
    const out = 'LISTEN 0 511 *:4800 *:* users:(("node",pid=1234,fd=23),("node",pid=1240,fd=23))';
    expect(parseSsPids(out)).toEqual([1234, 1240]);
  });

  it('-p 권한이 없어 users:(...) 가 없으면 빈 배열', () => {
    expect(parseSsPids('LISTEN 0 511 *:4800 *:*')).toEqual([]);
  });
});

describe('parseFuserPids (psmisc)', () => {
  it('`4800/tcp:` 머리표를 걷어내고 PID 만 뽑는다 — 포트 번호를 PID 로 오독하면 안 된다', () => {
    expect(parseFuserPids('4800/tcp:             1234  5678\n')).toEqual([1234, 5678]);
  });

  it('머리표가 stderr 로 간 구버전 형태(숫자만)도 그대로 처리', () => {
    expect(parseFuserPids(' 1234  5678\n')).toEqual([1234, 5678]);
  });

  it('빈 출력은 빈 배열', () => {
    expect(parseFuserPids('')).toEqual([]);
  });
});

describe('parseProcNetTcpListenInodes (도구 0개인 최소 Linux 컨테이너)', () => {
  // 4800 = 0x12C0, 8080 = 0x1F90. st: 0A=LISTEN, 01=ESTABLISHED.
  const SAMPLE = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 0100007F:12C0 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5551212 1 0000 100 0 0 10 0',
    '   1: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 777 1 0000 100 0 0 10 0',
    '   2: 0100007F:12C0 0100007F:C0FE 01 00000000:00000000 00:00000000 00000000  1000        0 999 1 0000 100 0 0 10 0',
  ].join('\n');

  it('요청한 포트의 LISTEN 소켓 inode 만 뽑는다', () => {
    expect(parseProcNetTcpListenInodes(SAMPLE, 4800)).toEqual(['5551212']);
  });

  it('다른 포트(8080)는 자기 inode 만', () => {
    expect(parseProcNetTcpListenInodes(SAMPLE, 8080)).toEqual(['777']);
  });

  it('LISTEN 이 아닌 소켓(st=01)은 점유자가 아니다', () => {
    expect(parseProcNetTcpListenInodes(SAMPLE, 4800)).not.toContain('999');
  });

  it('헤더 줄과 빈 내용은 무시한다', () => {
    expect(parseProcNetTcpListenInodes('', 4800)).toEqual([]);
    expect(parseProcNetTcpListenInodes(SAMPLE.split('\n')[0] ?? '', 4800)).toEqual([]);
  });
});

describe('killByPortDetailed — 입력 검증은 외부 명령을 전혀 실행하지 않는다', () => {
  // 셸 인젝션 차단 겸, 잘못된 입력이 조용히 "포트가 비었다"로 보이지 않게 하는 구분.
  it.each([0, -1, 70000, 1.5, Number.NaN])('%s 는 invalid-port', async (port) => {
    const r = await killByPortDetailed(port as number);
    expect(r).toEqual({ killed: false, outcome: 'invalid-port', pids: [] });
  });
});
