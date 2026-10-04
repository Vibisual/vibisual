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
  parseNetstatListeners,
  parseLsofPids,
  parseLsofListeners,
  parseSsPids,
  parseSsListeners,
  parseFuserPids,
  parseProcNetTcpListenInodes,
  parseProcNetTcpListeners,
  decodeProcNetAddress,
  normalizeListenAddress,
  listenerPids,
  listenerTiersForHost,
  reachableListeners,
  urlHostname,
  killByPortDetailed,
  type PortListener,
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

  it('호스트를 줘도 입력 검증이 먼저다', async () => {
    const r = await killByPortDetailed(70000, { host: '127.0.0.1' });
    expect(r).toEqual({ killed: false, outcome: 'invalid-port', pids: [] });
  });
});

// ─── 2026-10-01: 리스너마다 주소를 읽고, "그 주소가 실제로 닿는 리스너"로 가른다 ───

/**
 * 실측(2026-10-01, Windows 11 `netstat -ano`) — 한 포트 두 주인. 한 프로젝트의 `node serve.js` 가 `::` 에
 * 묶여 `0.0.0.0` · `[::]` 두 줄로, 옆 프로젝트의 vite 가 `[::1]` 에 같은 8080 으로 보였다.
 */
const DUAL_BIND_NETSTAT = [
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       41200',
  '  TCP    127.0.0.1:8080         127.0.0.1:61234        ESTABLISHED     41200',
  '  TCP    127.0.0.1:61234        127.0.0.1:8080         ESTABLISHED     9876',
  '  TCP    [::]:8080              [::]:0                 LISTENING       41200',
  '  TCP    [::1]:8080             [::]:0                 LISTENING       19752',
  '  TCP    [::1]:8080             [::1]:61240            ESTABLISHED     19752',
  '  UDP    0.0.0.0:8080           *:*                                    5555',
].join('\r\n');

describe('parseNetstatListeners (Windows) — IPv6 표와 주소', () => {
  it('실측 한 포트 두 주인: 세 리스너를 주소와 함께 뽑는다', () => {
    expect(parseNetstatListeners(DUAL_BIND_NETSTAT, 8080)).toEqual([
      { pid: 41200, address: '0.0.0.0' },
      { pid: 41200, address: '::' },
      { pid: 19752, address: '::1' },
    ]);
  });

  it('종전 `-p TCP`(IPv4 표만) 출력으로는 [::1] 의 vite 가 영영 안 보였다 — 사고의 첫 구멍', () => {
    const ipv4Only = DUAL_BIND_NETSTAT.split('\r\n').filter((l) => !l.includes('[')).join('\r\n');
    expect(parseNetstatListeningPids(ipv4Only, 8080)).toEqual([41200]);
    expect(parseNetstatListeningPids(DUAL_BIND_NETSTAT, 8080)).toEqual([41200, 19752]);
  });

  it('상태 단어가 번역돼도(독일어 ABHÖREN) 와일드카드 상대 주소로 LISTEN 을 가린다', () => {
    const de = [
      'Aktive Verbindungen',
      '',
      '  Proto  Lokale Adresse         Remoteadresse          Status           PID',
      '  TCP    0.0.0.0:8080           0.0.0.0:0              ABHÖREN          41200',
      '  TCP    [::1]:8080             [::]:0                 ABHÖREN          19752',
      '  TCP    127.0.0.1:8080         127.0.0.1:61234        HERGESTELLT      41200',
    ].join('\r\n');
    expect(parseNetstatListeners(de, 8080)).toEqual([
      { pid: 41200, address: '0.0.0.0' },
      { pid: 19752, address: '::1' },
    ]);
  });

  it('존 접미(%12)가 붙은 링크 로컬 주소도 접는다', () => {
    const out = '  TCP    [fe80::1%12]:8080      [::]:0                 LISTENING       777';
    expect(parseNetstatListeners(out, 8080)).toEqual([{ pid: 777, address: 'fe80::1' }]);
  });
});

describe('normalizeListenAddress — 주소를 한 모양으로', () => {
  it.each([
    ['[::1]', '::1'],
    ['[::]', '::'],
    ['[FE80::1%12]', 'fe80::1'],
    ['fe80::1%eth0', 'fe80::1'],
    ['::ffff:127.0.0.1', '127.0.0.1'],
    ['[::ffff:127.0.0.1]', '127.0.0.1'],
    [' 0.0.0.0 ', '0.0.0.0'],
    ['*', '*'],
  ])('%s → %s', (raw, want) => {
    expect(normalizeListenAddress(raw)).toBe(want);
  });
});

describe('parseLsofListeners (macOS/Linux, `-F ptn`)', () => {
  const SAMPLE = [
    'p41200',
    'f23',
    'tIPv4',
    'n*:8080',
    'f24',
    'tIPv6',
    'n*:8080',
    'p19752',
    'f30',
    'tIPv6',
    'n[::1]:8080',
    'p777',
    'f5',
    'tIPv4',
    'n127.0.0.1:18080',
  ].join('\n');

  it('`*` 는 t 필드로 패밀리를 가른다(IPv4 → 0.0.0.0, IPv6 → ::)', () => {
    expect(parseLsofListeners(SAMPLE, 8080)).toEqual([
      { pid: 41200, address: '0.0.0.0' },
      { pid: 41200, address: '::' },
      { pid: 19752, address: '::1' },
    ]);
  });

  it('포트는 끝자리까지 맞춘다(8080 ≠ 18080)', () => {
    expect(parseLsofListeners(SAMPLE, 18080)).toEqual([{ pid: 777, address: '127.0.0.1' }]);
  });

  it('t 필드가 없으면 패밀리 미상 와일드카드(*)로 둔다', () => {
    expect(parseLsofListeners('p5\nf3\nn*:8080\n', 8080)).toEqual([{ pid: 5, address: '*' }]);
  });

  it('빈 출력은 빈 배열', () => {
    expect(parseLsofListeners('', 8080)).toEqual([]);
  });
});

describe('parseSsListeners (iproute2, `-lptnH`)', () => {
  const SAMPLE = [
    'LISTEN 0      511          127.0.0.1:8080       0.0.0.0:*    users:(("node",pid=1234,fd=23))',
    'LISTEN 0      511              [::1]:8080          [::]:*    users:(("node",pid=5678,fd=24))',
    'LISTEN 0      511                  *:18080             *:*    users:(("node",pid=9999,fd=25))',
  ].join('\n');

  it('로컬 주소 칸에서 주소를, users 칸에서 pid 를 뽑는다', () => {
    expect(parseSsListeners(SAMPLE, 8080)).toEqual([
      { pid: 1234, address: '127.0.0.1' },
      { pid: 5678, address: '::1' },
    ]);
  });

  it('`*` 는 이중 스택 와일드카드 그대로 둔다', () => {
    expect(parseSsListeners(SAMPLE, 18080)).toEqual([{ pid: 9999, address: '*' }]);
  });

  it('한 소켓을 여러 프로세스가 공유하면 같은 주소로 전부', () => {
    const out = 'LISTEN 0 511 0.0.0.0:8080 0.0.0.0:* users:(("node",pid=1234,fd=23),("node",pid=1240,fd=23))';
    expect(parseSsListeners(out, 8080)).toEqual([
      { pid: 1234, address: '0.0.0.0' },
      { pid: 1240, address: '0.0.0.0' },
    ]);
  });

  it('-p 권한이 없어 pid 가 빠진 줄은 리스너를 만들지 않는다(다음 도구로 넘어가게)', () => {
    expect(parseSsListeners('LISTEN 0 511 *:8080 *:*', 8080)).toEqual([]);
  });

  it('구버전 ss 의 대괄호 없는 IPv6(`:::8080`)도 읽는다', () => {
    expect(parseSsListeners('LISTEN 0 128 :::8080 :::* users:(("node",pid=42,fd=3))', 8080))
      .toEqual([{ pid: 42, address: '::' }]);
  });
});

describe('decodeProcNetAddress / parseProcNetTcpListeners (Linux 커널 표)', () => {
  it('IPv4 는 낱말 바이트를 뒤집는다(리틀엔디언)', () => {
    expect(decodeProcNetAddress('0100007F')).toBe('127.0.0.1');
    expect(decodeProcNetAddress('00000000')).toBe('0.0.0.0');
    expect(decodeProcNetAddress('7F000001', false)).toBe('127.0.0.1');
  });

  it('IPv6 는 우리가 쓰는 모양으로 접는다(::, ::1, IPv4 사상)', () => {
    expect(decodeProcNetAddress('00000000000000000000000000000000')).toBe('::');
    expect(decodeProcNetAddress('00000000000000000000000001000000')).toBe('::1');
    expect(decodeProcNetAddress('0000000000000000FFFF00000100007F')).toBe('127.0.0.1');
  });

  it('모양이 아니면 null', () => {
    expect(decodeProcNetAddress('XYZ')).toBeNull();
    expect(decodeProcNetAddress('0100007')).toBeNull();
  });

  it('tcp 표의 리스너를 주소와 함께 뽑는다', () => {
    const tcp = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5551212 1 0000 100 0 0 10 0',
      '   1: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 777 1 0000 100 0 0 10 0',
    ].join('\n');
    expect(parseProcNetTcpListeners(tcp, 8080)).toEqual([
      { inode: '5551212', address: '127.0.0.1' },
      { inode: '777', address: '0.0.0.0' },
    ]);
  });

  it('tcp6 표의 ::1 · :: 리스너도 주소와 함께', () => {
    const tcp6 = [
      '  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 8888 1 0000 100 0 0 10 0',
      '   1: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 9999 1 0000 100 0 0 10 0',
    ].join('\n');
    expect(parseProcNetTcpListeners(tcp6, 8080)).toEqual([
      { inode: '8888', address: '::1' },
      { inode: '9999', address: '::' },
    ]);
  });
});

describe('listenerTiersForHost / reachableListeners — 그 주소가 실제로 닿는 리스너', () => {
  const DUAL: PortListener[] = [
    { pid: 41200, address: '0.0.0.0' },
    { pid: 41200, address: '::' },
    { pid: 19752, address: '::1' },
  ];
  const pidsFor = (ls: PortListener[], host: string): number[] => listenerPids(reachableListeners(ls, host));

  it('실측 한 포트 두 주인: localhost·[::1] 은 vite(19752), 127.0.0.1 은 serve.js(41200)', () => {
    expect(pidsFor(DUAL, 'localhost')).toEqual([19752]);
    expect(pidsFor(DUAL, '::1')).toEqual([19752]);
    expect(pidsFor(DUAL, '[::1]')).toEqual([19752]);
    expect(pidsFor(DUAL, '127.0.0.1')).toEqual([41200]);
  });

  it('특정 주소에 묶인 소켓이 와일드카드보다 먼저다', () => {
    expect(pidsFor([{ pid: 1, address: '0.0.0.0' }, { pid: 2, address: '127.0.0.1' }], '127.0.0.1')).toEqual([2]);
  });

  it('이중 스택 `::` 하나만 있으면 127.0.0.1 도 그리로 간다(IPv4 사상)', () => {
    expect(pidsFor([{ pid: 7, address: '::' }], '127.0.0.1')).toEqual([7]);
  });

  it('localhost 는 [::1] 이 없으면 127.0.0.1 로 넘어간다(Node·Chromium 의 폴백)', () => {
    expect(pidsFor([{ pid: 5, address: '127.0.0.1' }], 'localhost')).toEqual([5]);
  });

  it('Linux ss 의 `*` 는 두 패밀리 모두에서 닿는다', () => {
    const star: PortListener[] = [{ pid: 33, address: '*' }];
    expect(pidsFor(star, '127.0.0.1')).toEqual([33]);
    expect(pidsFor(star, '::1')).toEqual([33]);
    expect(pidsFor(star, 'localhost')).toEqual([33]);
  });

  it('닿는 리스너가 없으면 빈 배열 — 같은 포트의 다른 리스너는 이 주소와 무관하다', () => {
    expect(reachableListeners([{ pid: 19752, address: '::1' }], '127.0.0.1')).toEqual([]);
  });

  it('주소를 모르는 리스너(fuser)가 섞이면 가른 척하지 않고 전부 돌려준다', () => {
    expect(pidsFor([{ pid: 44 }, { pid: 19752, address: '::1' }], '127.0.0.1')).toEqual([44, 19752]);
  });

  it('계층을 모르는 호스트(LAN 주소)도 전부', () => {
    expect(listenerTiersForHost('192.168.0.10')).toBeNull();
    expect(pidsFor(DUAL, '192.168.0.10')).toEqual([41200, 19752]);
  });

  it('localhost 변형(대소문자·*.localhost·0.0.0.0)은 localhost 계층, 127.x 는 그 주소부터', () => {
    const localhostTiers = listenerTiersForHost('localhost');
    expect(listenerTiersForHost('LOCALHOST')).toEqual(localhostTiers);
    expect(listenerTiersForHost('app.localhost')).toEqual(localhostTiers);
    expect(listenerTiersForHost('0.0.0.0')).toEqual(localhostTiers);
    expect(listenerTiersForHost('127.0.0.2')).toEqual([['127.0.0.2'], ['0.0.0.0', '*'], ['::']]);
  });

  it('빈 목록은 빈 배열', () => {
    expect(reachableListeners([], 'localhost')).toEqual([]);
  });
});

describe('urlHostname', () => {
  it('대괄호를 벗기고 소문자로', () => {
    expect(urlHostname('http://[::1]:8080/')).toBe('::1');
    expect(urlHostname('http://LOCALHOST:8080/x')).toBe('localhost');
    expect(urlHostname('http://127.0.0.1:8080')).toBe('127.0.0.1');
  });

  it('파싱이 안 되면 null', () => {
    expect(urlHostname(undefined)).toBeNull();
    expect(urlHostname('')).toBeNull();
    expect(urlHostname('not a url')).toBeNull();
  });
});
