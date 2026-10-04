/**
 * §7.11 — iframe 위성 **생성** 경로의 프로젝트 격리 문.
 *
 * 이 테스트가 지키는 것은 사용자 신고 한 줄이다: "이거 다른 프로젝트에서 연 건데 왜 우리
 * vibisual 프로젝트에 열려 있는 거야". 실측으로 옆 프로젝트의 vite(8080) 가 vibisual 그래프의
 * 위성(`special-1620649350`)으로 등록돼 있었고, 정작 그 프로젝트 체크포인트의 iframe 위성은 0개였다.
 *
 * 판정은 세 OS 를 **한 기기에서** 지나간다 — `platform` 을 인자로 받게 만든 이유가 이것이다
 * (실기가 없는 우리에겐 이게 규칙을 지켰는지 확인하는 유일한 방법이다).
 *
 * 2026-10-01 — 판정 단위가 (포트)에서 **(위성 주소 → 그 주소가 실제로 닿는 리스너)** 로 바뀌었다.
 * 실측: 한 포트에 두 프로젝트 서버가 공존했다(A 의 serve.js 가 ::, B 의 vite 가 [::1]). localhost 는
 * B 에, 127.0.0.1 은 A 에 닿았다. 아래 judgeIframeSatellite 시험이 그 사고를 그대로 재현한다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  admitsServer,
  classifyServerOrigin,
  clearPortOriginCache,
  combineServerOrigins,
  createPortOwnershipReader,
  judgeIframeSatellite,
  judgeIframeTab,
  launchEvidenceHolds,
  originForHost,
  resolvePortOrigin,
  shouldAttachServer,
  singleProcessOwnership,
  PORT_LISTENER_TTL_MS,
  PROCESS_START_MISS_TTL_MS,
  PROCESS_START_TTL_MS,
  type IframeVerdict,
  type PortOwnership,
  type ProcessStartInfo,
  type ServerEvidence,
} from './serverOrigin.js';
import type { PortListener } from './processChecker.js';

const VIBISUAL = 'C:/work/vibisual';
const GAME = 'C:/work/Game2D';

/** 실측한 그 명령줄 — 백슬래시·중복 백슬래시·따옴표가 섞인 원본 그대로. */
const REAL_WIN_CMD =
  '"node"   "C:\\work\\Game2D\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js"';

beforeEach(() => { clearPortOriginCache(); });

describe('classifyServerOrigin — cwd 를 읽은 경우(linux/darwin)', () => {
  const cases: Array<'linux' | 'darwin'> = ['linux', 'darwin'];

  for (const platform of cases) {
    it(`${platform}: 남의 프로젝트 안에서 도는 서버는 foreign`, () => {
      const start: ProcessStartInfo = { command: 'node vite.js', cwd: `${GAME}/src` };
      expect(classifyServerOrigin(start, [VIBISUAL], [GAME], platform)).toBe('foreign');
    });

    it(`${platform}: 우리 프로젝트 안에서 도는 서버는 ours`, () => {
      const start: ProcessStartInfo = { command: 'node vite.js', cwd: `${VIBISUAL}/packages/client` };
      expect(classifyServerOrigin(start, [VIBISUAL], [GAME], platform)).toBe('ours');
    });

    it(`${platform}: 아는 프로젝트 어디에도 없으면 unknown(막지 않는다)`, () => {
      const start: ProcessStartInfo = { command: 'python -m http.server', cwd: '/tmp/scratch' };
      expect(classifyServerOrigin(start, [VIBISUAL], [GAME], platform)).toBe('unknown');
    });

    it(`${platform}: cwd 가 명령줄보다 강한 증거다`, () => {
      // 우리 폴더의 스크립트로 남의 폴더에서 띄운 서버 — 도는 곳이 남의 프로젝트면 남의 것이다.
      const start: ProcessStartInfo = { command: `node ${VIBISUAL}/scripts/serve.mjs`, cwd: GAME };
      expect(classifyServerOrigin(start, [VIBISUAL], [GAME], platform)).toBe('foreign');
    });
  }

  it('linux 는 케이스가 다르면 다른 폴더다', () => {
    const start: ProcessStartInfo = { command: 'node vite.js', cwd: '/srv/proj/Game2D/src' };
    expect(classifyServerOrigin(start, [], ['/srv/proj/game2d'], 'linux')).toBe('unknown');
    expect(classifyServerOrigin(start, [], ['/srv/proj/Game2D'], 'linux')).toBe('foreign');
  });

  it('darwin 은 케이스를 무시하는 파일시스템이라 접는다', () => {
    const start: ProcessStartInfo = { command: 'node vite.js', cwd: '/Volumes/proj/Game2D/src' };
    expect(classifyServerOrigin(start, [], ['/Volumes/proj/game2d'], 'darwin')).toBe('foreign');
  });
});

describe('classifyServerOrigin — cwd 가 없는 경우(win32: 명령줄이 유일한 단서)', () => {
  it('실측 명령줄에서 남의 프로젝트를 가려낸다', () => {
    const start: ProcessStartInfo = { command: REAL_WIN_CMD };
    expect(classifyServerOrigin(start, [VIBISUAL], [GAME], 'win32')).toBe('foreign');
  });

  it('우리 프로젝트 경로가 박힌 명령줄은 ours', () => {
    const start: ProcessStartInfo = { command: `"node" "${VIBISUAL}\\node_modules\\vite\\bin\\vite.js"` };
    expect(classifyServerOrigin(start, [VIBISUAL], [GAME], 'win32')).toBe('ours');
  });

  it('경로가 하나도 안 박힌 명령줄은 unknown — 읽었는데 모르는 것이라 붙이지 않는다', () => {
    const start: ProcessStartInfo = { command: 'node dist/server.js' };
    const origin = classifyServerOrigin(start, [VIBISUAL], [GAME], 'win32');
    expect(origin).toBe('unknown');
    expect(shouldAttachServer(origin)).toBe(false);
  });

  it('접두사가 겹치는 남의 폴더를 오판하지 않는다', () => {
    // `…/Game2D` 로 `…/Game2D_backup` 을 잡으면 안 된다(그 반대도).
    const start: ProcessStartInfo = { command: `"node" "${GAME}_backup\\server.js"` };
    expect(classifyServerOrigin(start, [VIBISUAL], [GAME], 'win32')).toBe('unknown');
    expect(classifyServerOrigin(start, [VIBISUAL], [`${GAME}_backup`], 'win32')).toBe('foreign');
  });

  it('루트 자체로 끝나는 명령줄도 잡는다', () => {
    const start: ProcessStartInfo = { command: `cmd /c cd ${GAME} && npm run dev` };
    expect(classifyServerOrigin(start, [VIBISUAL], [GAME], 'win32')).toBe('foreign');
  });

  it('우리 것이 먼저다 — 우리 세션이 남의 폴더를 가리키며 띄웠으면 우리 서버다', () => {
    const start: ProcessStartInfo = { command: `node ${VIBISUAL}/scripts/serve.mjs --root ${GAME}` };
    expect(classifyServerOrigin(start, [VIBISUAL], [GAME], 'win32')).toBe('ours');
  });

  it('프로세스를 못 읽었으면 unresolved — 이건 서버가 아니라 우리 조회에 대한 진술이다', () => {
    const origin = classifyServerOrigin(null, [VIBISUAL], [GAME], 'win32');
    expect(origin).toBe('unresolved');
    expect(shouldAttachServer(origin)).toBe(true);
  });
});

describe('shouldAttachServer — 판정 불가는 붙이지 않는다(사용자 결정 2026-09-11)', () => {
  it('우리 것만 붙이고, 남의 것과 모르는 것은 붙이지 않는다', () => {
    expect(shouldAttachServer('ours')).toBe(true);
    expect(shouldAttachServer('foreign')).toBe(false);
    expect(shouldAttachServer('unknown')).toBe(false);
    // 못 읽은 것은 막지 않는다 — 조회가 흔들릴 때마다 멀쩡한 프리뷰가 사라지면 안 된다.
    expect(shouldAttachServer('unresolved')).toBe(true);
  });

  /**
   * 실측 회귀 — 옆 프로젝트의 백엔드(3456)가 vibisual 캔버스에 박혀 있던 그 명령줄 그대로.
   * win32 는 프로세스 cwd 를 읽을 수 없고 이 명령줄에는 절대경로가 없다. 종전 규약은
   * 이걸 `unknown` → 통과로 흘려 남의 서버를 우리 탭에 붙였다(§3.5 누수).
   */
  it('실측: 상대경로로 띄운 남의 서버(`node src/server.js`)를 붙이지 않는다', () => {
    const start: ProcessStartInfo = { command: 'node  src/server.js' };
    const origin = classifyServerOrigin(start, [VIBISUAL], ['C:/work/trade-app'], 'win32');
    expect(origin).toBe('unknown');
    expect(shouldAttachServer(origin)).toBe(false);
  });
});

// ─── 2026-10-01: "그 주소가 실제로 닿는 리스너"로 가른다 ───

const PROJ_A = 'C:/work/app-a';
const PROJ_B = 'C:/work/game-b';

/** 실측 명령줄 모양 그대로 — 절대경로로 띄운 우리 서버 / 상대경로로 띄운 우리 서버 / 옆 프로젝트 vite. */
const PROJ_A_SERVE_CMD = '"C:\\Program Files\\nodejs\\node.exe" C:\\work\\app-a\\serve.js';
const PROJ_A_SERVE_RELATIVE = '"C:\\Program Files\\nodejs\\node.exe" serve.js';
const PROJ_B_VITE_CMD = '"node" "C:\\work\\game-b\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js"';

/** 리스너 + 기동 정보로 소유 사실을 만든다(`command: null` = 그 pid 를 못 읽음). */
function ownershipOf(
  entries: Array<{ pid: number; address?: string; command?: string | null; cwd?: string }>,
): PortOwnership {
  const listeners = entries.map(({ pid, address }) => (address ? { pid, address } : { pid }));
  const starts = new Map<number, ProcessStartInfo | null>();
  for (const e of entries) {
    if (starts.has(e.pid)) continue;
    starts.set(e.pid, e.command == null ? null : { command: e.command, ...(e.cwd ? { cwd: e.cwd } : {}) });
  }
  return { listeners, starts };
}

/**
 * 실측(2026-10-01, Windows 11) — 한 포트 두 주인. app-a 의 `node serve.js` 가 `::` 에 묶여
 * netstat 에 `0.0.0.0` · `[::]` 두 줄로 보이고, game-b 의 vite 가 `[::1]` 에 같은 8080 으로 공존했다.
 * `localhost`·`[::1]` 접속은 vite 로, `127.0.0.1` 은 serve.js 로 갔다.
 */
const DUAL_BIND = ownershipOf([
  { pid: 41200, address: '0.0.0.0', command: PROJ_A_SERVE_CMD },
  { pid: 41200, address: '::', command: PROJ_A_SERVE_CMD },
  { pid: 19752, address: '::1', command: PROJ_B_VITE_CMD },
]);

function judge(
  url: string,
  ownership: PortOwnership | null,
  opts: { evidence?: ServerEvidence; own?: string[]; foreign?: string[]; bound?: number[]; platform?: 'win32' | 'linux' | 'darwin' } = {},
): IframeVerdict {
  return judgeIframeSatellite({
    url,
    ownership,
    evidence: opts.evidence ?? 'observed',
    ...(opts.bound ? { boundPids: opts.bound } : {}),
    ownRoots: opts.own ?? [PROJ_A],
    foreignRoots: opts.foreign ?? [PROJ_B, VIBISUAL],
    platform: opts.platform ?? 'win32',
  });
}

describe('resolvePortOrigin', () => {
  it('다른 프로젝트가 하나도 안 열려 있으면 조회조차 하지 않는다', async () => {
    let calls = 0;
    const origin = await resolvePortOrigin(8080, [VIBISUAL], [], 'win32', async () => {
      calls += 1;
      return singleProcessOwnership({ command: REAL_WIN_CMD });
    });
    // 가를 대상이 없다 — 판정을 내린 것이 아니라 묻지 않은 것이라 통과다.
    expect(origin).toBe('unresolved');
    expect(shouldAttachServer(origin)).toBe(true);
    expect(calls).toBe(0);
  });

  it('남의 프로젝트 서버를 foreign 으로 가른다', async () => {
    const origin = await resolvePortOrigin(8080, [VIBISUAL], [GAME], 'win32', async () =>
      singleProcessOwnership({ command: REAL_WIN_CMD }));
    expect(origin).toBe('foreign');
  });

  it('조회가 던져도 막지 않는다', async () => {
    const origin = await resolvePortOrigin(8080, [VIBISUAL], [GAME], 'win32', () => {
      throw new Error('EACCES');
    });
    expect(origin).toBe('unresolved');
    expect(shouldAttachServer(origin)).toBe(true);
  });

  it('같은 포트라도 **부르는 호스트**에 따라 답이 갈린다(한 포트 두 주인)', async () => {
    const lookup = async (): Promise<PortOwnership> => DUAL_BIND;
    expect(await resolvePortOrigin(8080, [PROJ_A], [PROJ_B], 'win32', lookup, 'localhost')).toBe('foreign');
    expect(await resolvePortOrigin(8080, [PROJ_A], [PROJ_B], 'win32', lookup, '::1')).toBe('foreign');
    expect(await resolvePortOrigin(8080, [PROJ_A], [PROJ_B], 'win32', lookup, '127.0.0.1')).toBe('ours');
  });
});

describe('admitsServer — 증거별 해석은 한 곳이다', () => {
  it('남의 것은 증거와 무관하게 거절한다', () => {
    expect(admitsServer('foreign', 'observed')).toBe(false);
    expect(admitsServer('foreign', 'launch')).toBe(false);
  });

  it('읽고도 모르는 것은 우리 셸이 띄웠을 때만 둔다(관찰만으로는 붙이지 않는다 — 2026-09-11 결정 유지)', () => {
    expect(admitsServer('unknown', 'observed')).toBe(false);
    expect(admitsServer('unknown', 'launch')).toBe(true);
  });

  it('우리 것·못 읽은 것은 둔다', () => {
    for (const evidence of ['observed', 'launch'] as const) {
      expect(admitsServer('ours', evidence)).toBe(true);
      expect(admitsServer('unresolved', evidence)).toBe(true);
    }
  });

  it('shouldAttachServer 는 관찰 쪽 해석이다', () => {
    for (const origin of ['ours', 'foreign', 'unknown', 'unresolved'] as const) {
      expect(shouldAttachServer(origin)).toBe(admitsServer(origin, 'observed'));
    }
  });
});

describe('combineServerOrigins — 하나라도 남의 것이면 남의 것', () => {
  it('우선순위: foreign > ours > unknown > unresolved', () => {
    expect(combineServerOrigins(['ours', 'foreign'])).toBe('foreign');
    expect(combineServerOrigins(['unknown', 'ours'])).toBe('ours');
    expect(combineServerOrigins(['unresolved', 'unknown'])).toBe('unknown');
    expect(combineServerOrigins(['unresolved'])).toBe('unresolved');
    expect(combineServerOrigins([])).toBe('unresolved');
  });
});

describe('originForHost — 그 호스트로 접속하면 닿는 서버의 판정', () => {
  it('실측 한 포트 두 주인: localhost 는 옆 프로젝트 vite, 127.0.0.1 은 우리 serve.js', () => {
    expect(originForHost(DUAL_BIND, 'localhost', [PROJ_A], [PROJ_B], 'win32')).toBe('foreign');
    expect(originForHost(DUAL_BIND, '127.0.0.1', [PROJ_A], [PROJ_B], 'win32')).toBe('ours');
  });

  it('닿는 리스너가 없으면 판정 불가 — 같은 포트의 다른 리스너는 이 주소와 무관하다', () => {
    const v6Only = ownershipOf([{ pid: 19752, address: '::1', command: PROJ_B_VITE_CMD }]);
    expect(originForHost(v6Only, '127.0.0.1', [PROJ_A], [PROJ_B], 'win32')).toBe('unresolved');
  });

  it('조회가 없으면 판정 불가', () => {
    expect(originForHost(null, 'localhost', [PROJ_A], [PROJ_B], 'win32')).toBe('unresolved');
  });
});

describe('judgeIframeSatellite — 실측 사고(2026-10-01): A 의 프리뷰에 B 의 화면', () => {
  it('A(app-a) 의 localhost 위성은 B 의 vite 에 닿는다 → 우리 서버에 닿는 127.0.0.1 로 교정한다', () => {
    const v = judge('http://localhost:8080/index.html', DUAL_BIND);
    expect(v.action).toBe('repoint');
    if (v.action === 'repoint') {
      expect(v.url).toBe('http://127.0.0.1:8080/index.html');
      expect(v.origin).toBe('ours');
    }
  });

  it('B(game-b) 쪽에서 보면 같은 localhost 위성은 제 vite 라 그대로 둔다', () => {
    const v = judge('http://localhost:8080/', DUAL_BIND, { own: [PROJ_B], foreign: [PROJ_A] });
    expect(v).toMatchObject({ action: 'keep', origin: 'ours' });
  });

  it('B 쪽의 127.0.0.1 위성은 A 의 serve.js 에 닿는다 → B 의 vite 에 닿는 localhost 로 교정한다', () => {
    const v = judge('http://127.0.0.1:8080/', DUAL_BIND, { own: [PROJ_B], foreign: [PROJ_A] });
    expect(v).toMatchObject({ action: 'repoint', url: 'http://localhost:8080/', origin: 'ours' });
  });

  it('A 의 서버가 이미 죽었으면(남은 건 B 의 vite 뿐) 걷는다', () => {
    const onlyVite = ownershipOf([{ pid: 19752, address: '::1', command: PROJ_B_VITE_CMD }]);
    expect(judge('http://localhost:8080/', onlyVite)).toEqual({ action: 'reject', origin: 'foreign' });
  });

  it('A 가 상대경로로 띄운 서버(unknown)로는 관찰 위성을 옮기지 않는다 — 긍정 증거가 없다', () => {
    const relative = ownershipOf([
      { pid: 41200, address: '0.0.0.0', command: PROJ_A_SERVE_RELATIVE },
      { pid: 41200, address: '::', command: PROJ_A_SERVE_RELATIVE },
      { pid: 19752, address: '::1', command: PROJ_B_VITE_CMD },
    ]);
    expect(judge('http://localhost:8080/', relative)).toEqual({ action: 'reject', origin: 'foreign' });
    // 우리 셸이 띄웠다는 증거가 있으면 그 서버에 닿는 별칭으로 옮긴다.
    const v = judge('http://localhost:8080/', relative, { evidence: 'launch' });
    expect(v).toMatchObject({ action: 'repoint', url: 'http://127.0.0.1:8080/', origin: 'unknown' });
  });

  it('원래 주소가 이미 우리 서버에 닿으면 손대지 않는다(정규화 차이로 교정하지 않는다)', () => {
    expect(judge('http://127.0.0.1:8080', DUAL_BIND)).toMatchObject({ action: 'keep', origin: 'ours' });
  });
});

describe('judgeIframeSatellite — 판정 불가로는 지우지 않는다', () => {
  it('조회 자체가 없으면 그대로 둔다', () => {
    expect(judge('http://localhost:8080/', null)).toEqual({ action: 'keep', origin: 'unresolved' });
  });

  it('리스너가 하나도 안 보이면(부팅 중) 그대로 둔다', () => {
    expect(judge('http://localhost:8080/', ownershipOf([]))).toEqual({ action: 'keep', origin: 'unresolved' });
  });

  it('닿는 리스너의 명령줄을 못 읽었으면 그대로 둔다', () => {
    const unreadable = ownershipOf([{ pid: 7, address: '::1', command: null }]);
    expect(judge('http://localhost:8080/', unreadable)).toEqual({ action: 'keep', origin: 'unresolved' });
  });

  it('원래 주소는 아무 데도 안 닿고 별칭만 못 읽은 서버에 닿으면 — 옮기지도 지우지도 않는다', () => {
    const unreadable = ownershipOf([{ pid: 7, address: '::1', command: null }]);
    expect(judge('http://127.0.0.1:8080/', unreadable)).toEqual({ action: 'keep', origin: 'unresolved' });
  });
});

describe('judgeIframeSatellite — launch 증거는 처음 본 리스너 pid 에 묶인다', () => {
  // 둘 다 상대경로(unknown) — 명령줄로는 가를 수 없고 pid 묶음만이 가른다.
  const ours = { pid: 100, command: PROJ_A_SERVE_RELATIVE };
  const theirs = { pid: 200, command: 'node  server.js' };

  it('처음 보면 지금 닿는 pid 에 묶는다', () => {
    const one = ownershipOf([{ ...ours, address: '::' }]);
    expect(judge('http://localhost:8080/', one, { evidence: 'launch' })).toEqual({
      action: 'keep', origin: 'unknown', bindPids: [100],
    });
  });

  it('묶인 pid 가 살아 있는데 남이 [::1] 로 겹쳐 묶으면 — 그건 남의 서버다 → 우리 pid 에 닿는 별칭으로', () => {
    const dual = ownershipOf([
      { ...ours, address: '0.0.0.0' },
      { ...ours, address: '::' },
      { ...theirs, address: '::1' },
    ]);
    expect(judge('http://localhost:8080/', dual, { evidence: 'launch', bound: [100] })).toEqual({
      action: 'repoint', url: 'http://127.0.0.1:8080/', origin: 'unknown', bindPids: [100],
    });
  });

  it('묶인 pid 가 사라지고 새 pid 가 받으면 — 우리 서버가 재기동한 것이다(nodemon 등) → 다시 묶는다', () => {
    const restarted = ownershipOf([{ pid: 300, address: '::', command: PROJ_A_SERVE_RELATIVE }]);
    expect(judge('http://localhost:8080/', restarted, { evidence: 'launch', bound: [100] })).toEqual({
      action: 'keep', origin: 'unknown', bindPids: [300],
    });
  });

  it('launchEvidenceHolds — 세 경우', () => {
    expect(launchEvidenceHolds([200], [100, 200], undefined)).toBe(true);
    expect(launchEvidenceHolds([100], [100, 200], [100])).toBe(true);
    expect(launchEvidenceHolds([200], [100, 200], [100])).toBe(false);
    expect(launchEvidenceHolds([300], [300], [100])).toBe(true);
  });
});

describe('judgeIframeSatellite — 세 OS(작업 폴더를 읽는 linux·darwin)', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    it(`${platform}: 127.0.0.1 의 우리 서버와 ::1 의 남의 서버 — localhost 위성은 우리 쪽으로 옮긴다`, () => {
      const dual = ownershipOf([
        { pid: 11, address: '127.0.0.1', command: 'node serve.js', cwd: '/srv/a/web' },
        { pid: 22, address: '::1', command: 'node vite.js', cwd: '/srv/b' },
      ]);
      const v = judge('http://localhost:8080/', dual, { own: ['/srv/a'], foreign: ['/srv/b'], platform });
      expect(v).toMatchObject({ action: 'repoint', url: 'http://127.0.0.1:8080/', origin: 'ours' });
    });

    it(`${platform}: 이중 스택 와일드카드(ss 의 \`*\`)는 두 주소 모두에서 닿는다`, () => {
      const star = ownershipOf([{ pid: 33, address: '*', command: 'node vite.js', cwd: '/srv/b' }]);
      expect(judge('http://127.0.0.1:8080/', star, { own: ['/srv/a'], foreign: ['/srv/b'], platform }))
        .toEqual({ action: 'reject', origin: 'foreign' });
      expect(judge('http://localhost:8080/', star, { own: ['/srv/b'], foreign: ['/srv/a'], platform }))
        .toMatchObject({ action: 'keep', origin: 'ours' });
    });
  }

  it('주소를 모르는 도구(fuser)의 결과는 모든 주소의 후보다', () => {
    const noAddr = ownershipOf([{ pid: 44, command: 'node vite.js', cwd: '/srv/b' }]);
    expect(judge('http://localhost:8080/', noAddr, { own: ['/srv/a'], foreign: ['/srv/b'], platform: 'linux' }))
      .toEqual({ action: 'reject', origin: 'foreign' });
  });
});

describe('createPortOwnershipReader — 싼 것은 자주, 비싼 것은 pid 단위로', () => {
  function fakeReader(listenersByCall: PortListener[][], starts: Record<number, ProcessStartInfo | null>) {
    let t = 1_000_000;
    let listenerCalls = 0;
    const startCalls: number[] = [];
    const reader = createPortOwnershipReader({
      findListeners: async () => {
        const listeners = listenersByCall[Math.min(listenerCalls, listenersByCall.length - 1)] ?? [];
        listenerCalls += 1;
        return { listeners, anyToolWorked: true };
      },
      readStart: async (pid) => { startCalls.push(pid); return starts[pid] ?? null; },
      now: () => t,
      selfPids: [999],
    });
    return {
      reader,
      advance: (ms: number) => { t += ms; },
      listenerCalls: () => listenerCalls,
      startCalls,
    };
  }

  it('리스너는 짧게 캐시한다 — 남이 같은 포트를 잡으면 다음 sweep 에서 보인다', async () => {
    const f = fakeReader([[{ pid: 1, address: '::' }], [{ pid: 1, address: '::' }, { pid: 2, address: '::1' }]], {
      1: { command: PROJ_A_SERVE_CMD }, 2: { command: PROJ_B_VITE_CMD },
    });
    expect((await f.reader.read(8080))?.listeners).toHaveLength(1);
    f.advance(PORT_LISTENER_TTL_MS - 1);
    expect((await f.reader.read(8080))?.listeners).toHaveLength(1);
    expect(f.listenerCalls()).toBe(1);
    f.advance(2);
    expect((await f.reader.read(8080))?.listeners).toHaveLength(2);
    expect(f.listenerCalls()).toBe(2);
  });

  it('기동 정보(PowerShell)는 pid 단위로 길게 — 리스너를 다시 읽어도 같은 pid 는 다시 묻지 않는다', async () => {
    const f = fakeReader([[{ pid: 1, address: '::' }]], { 1: { command: PROJ_A_SERVE_CMD } });
    await f.reader.read(8080);
    f.advance(PORT_LISTENER_TTL_MS + 1);
    await f.reader.read(8080);
    expect(f.listenerCalls()).toBe(2);
    expect(f.startCalls).toEqual([1]);
    f.advance(PROCESS_START_TTL_MS);
    await f.reader.read(8080);
    expect(f.startCalls).toEqual([1, 1]);
  });

  it('못 읽은 결과는 짧게만 기억한다(바쁜 순간의 시간 초과를 10분 들고 있지 않는다)', async () => {
    const f = fakeReader([[{ pid: 5, address: '::1' }]], { 5: null });
    await f.reader.read(8080);
    f.advance(PROCESS_START_MISS_TTL_MS + 1);
    await f.reader.read(8080);
    expect(f.startCalls).toEqual([5, 5]);
  });

  it('리스너에서 빠진 pid 의 기동 정보는 버린다(pid 재사용 대비)', async () => {
    const f = fakeReader(
      [[{ pid: 1, address: '::' }], [], [{ pid: 1, address: '::1' }]],
      { 1: { command: PROJ_B_VITE_CMD } },
    );
    await f.reader.read(8080);
    f.advance(PORT_LISTENER_TTL_MS + 1);
    await f.reader.read(8080);
    f.advance(PORT_LISTENER_TTL_MS + 1);
    await f.reader.read(8080);
    expect(f.startCalls).toEqual([1, 1]);
  });

  it('동시에 들어온 같은 포트 조회는 하나로 합친다', async () => {
    const f = fakeReader([[{ pid: 1, address: '::' }]], { 1: { command: PROJ_A_SERVE_CMD } });
    await Promise.all([f.reader.read(8080), f.reader.read(8080), f.reader.read(8080)]);
    expect(f.listenerCalls()).toBe(1);
    expect(f.startCalls).toEqual([1]);
  });

  it('우리 자신이 쥔 소켓은 판정 대상이 아니다', async () => {
    const f = fakeReader([[{ pid: 999, address: '::' }, { pid: 1, address: '::1' }]], { 1: { command: PROJ_B_VITE_CMD } });
    const o = await f.reader.read(8080);
    expect(o?.listeners.map((l) => l.pid)).toEqual([1]);
    expect(f.startCalls).toEqual([1]);
  });

  it('볼 도구가 없으면 판정 불가(null) — "아무도 없다"와 다르다', async () => {
    const reader = createPortOwnershipReader({
      findListeners: async () => ({ listeners: [], anyToolWorked: false }),
      readStart: async () => null,
    });
    expect(await reader.read(8080)).toBeNull();
  });
});

describe('judgeIframeTab — 열어 둔 탭은 남의 것이라는 긍정 증거가 있을 때만 막는다', () => {
  const tab = (url: string, ownership: PortOwnership | null, platform: 'win32' | 'linux' | 'darwin' = 'win32') =>
    judgeIframeTab({ url, ownership, ownRoots: [PROJ_A], foreignRoots: [PROJ_B], platform });

  it('실측: 두 서버 공존 — localhost 탭은 우리 서버에 닿는 127.0.0.1 로 옮긴다(경로·쿼리 유지)', () => {
    expect(tab('http://localhost:8080/index.html?x=1', DUAL_BIND)).toEqual({
      action: 'follow',
      url: 'http://127.0.0.1:8080/index.html?x=1',
    });
  });

  it('A 의 서버가 내려가고 B 의 vite 만 [::1] 에 남았다 — localhost 탭은 불러오지 않는다', () => {
    const onlyB = ownershipOf([{ pid: 19752, address: '::1', command: PROJ_B_VITE_CMD }]);
    expect(tab('http://localhost:8080', onlyB)).toEqual({ action: 'block' });
    expect(tab('http://[::1]:8080/', onlyB)).toEqual({ action: 'block' });
  });

  it('이미 127.0.0.1 로 옮겨 둔 탭은 B 가 [::1] 에 있어도 닿지 않으니 그대로(접속 실패는 막을 일이 아니다)', () => {
    const onlyB = ownershipOf([{ pid: 19752, address: '::1', command: PROJ_B_VITE_CMD }]);
    expect(tab('http://127.0.0.1:8080/', onlyB)).toEqual({ action: 'show' });
    expect(tab('http://127.0.0.1:8080/', DUAL_BIND)).toEqual({ action: 'show' });
  });

  it('주인 미상(상대경로로 띄운 서버)·못 읽음은 막지 않는다', () => {
    const relative = ownershipOf([{ pid: 41200, address: '::', command: PROJ_A_SERVE_RELATIVE }]);
    expect(tab('http://localhost:8080', relative)).toEqual({ action: 'show' });
    const unreadable = ownershipOf([{ pid: 41200, address: '::', command: null }]);
    expect(tab('http://localhost:8080', unreadable)).toEqual({ action: 'show' });
    expect(tab('http://localhost:8080', null)).toEqual({ action: 'show' });
    expect(tab('http://localhost:8080', { listeners: [], starts: new Map() })).toEqual({ action: 'show' });
  });

  it('남의 것에 닿고 우리 서버라는 긍정 증거가 있는 별칭이 없으면 막는다(주인 미상 별칭으로는 옮기지 않는다)', () => {
    // 위성이 살아 있으면 서버가 더 많은 증거(살아 있는 셸)로 위성을 먼저 옮기고, 탭은 그 위성 주소를 따른다.
    const relativeOursForeignV6 = ownershipOf([
      { pid: 41200, address: '0.0.0.0', command: PROJ_A_SERVE_RELATIVE },
      { pid: 19752, address: '::1', command: PROJ_B_VITE_CMD },
    ]);
    expect(tab('http://localhost:8080', relativeOursForeignV6)).toEqual({ action: 'block' });
  });

  it('주소를 모르는 도구(fuser)로 본 포트에 남의 서버가 섞여 있으면 막는다(가를 수 없다)', () => {
    const mixed = ownershipOf([
      { pid: 41200, command: 'node serve.js', cwd: PROJ_A },
      { pid: 19752, command: 'node vite.js', cwd: `${PROJ_B}/web` },
    ]);
    expect(tab('http://localhost:8080', mixed, 'linux')).toEqual({ action: 'block' });
    const oursOnly = ownershipOf([{ pid: 41200, command: 'node serve.js', cwd: PROJ_A }]);
    expect(tab('http://localhost:8080', oursOnly, 'linux')).toEqual({ action: 'show' });
  });

  for (const platform of ['linux', 'darwin'] as const) {
    it(`${platform}: 작업 폴더로 가른다 — 옆 프로젝트에서 도는 서버만 남았으면 막고, 우리 것이 127.0.0.1 에 있으면 옮긴다`, () => {
      const onlyB = ownershipOf([{ pid: 19752, address: '::1', command: 'node vite.js', cwd: `${PROJ_B}/web` }]);
      expect(judgeIframeTab({
        url: 'http://localhost:8080/', ownership: onlyB, ownRoots: [PROJ_A], foreignRoots: [PROJ_B], platform,
      })).toEqual({ action: 'block' });
      const both = ownershipOf([
        { pid: 41200, address: '127.0.0.1', command: 'node serve.js', cwd: PROJ_A },
        { pid: 19752, address: '::1', command: 'node vite.js', cwd: `${PROJ_B}/web` },
      ]);
      expect(judgeIframeTab({
        url: 'http://localhost:8080/', ownership: both, ownRoots: [PROJ_A], foreignRoots: [PROJ_B], platform,
      })).toEqual({ action: 'follow', url: 'http://127.0.0.1:8080/' });
    });
  }
});
