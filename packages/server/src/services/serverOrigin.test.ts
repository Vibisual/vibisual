/**
 * §7.11 — iframe 위성 **생성** 경로의 프로젝트 격리 문.
 *
 * 이 테스트가 지키는 것은 사용자 신고 한 줄이다: "이거 다른 프로젝트에서 연 건데 왜 우리
 * vibisual 프로젝트에 열려 있는 거야". 실측으로 옆 프로젝트의 vite(8080) 가 vibisual 그래프의
 * 위성(`special-1620649350`)으로 등록돼 있었고, 정작 그 프로젝트 체크포인트의 iframe 위성은 0개였다.
 *
 * 판정은 세 OS 를 **한 기기에서** 지나간다 — `platform` 을 인자로 받게 만든 이유가 이것이다
 * (실기가 없는 우리에겐 이게 규칙을 지켰는지 확인하는 유일한 방법이다).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyServerOrigin,
  clearPortOriginCache,
  resolvePortOrigin,
  shouldAttachServer,
  PORT_ORIGIN_LOOKUP_TTL_MS,
  type ProcessStartInfo,
} from './serverOrigin.js';

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

describe('resolvePortOrigin', () => {
  it('다른 프로젝트가 하나도 안 열려 있으면 조회조차 하지 않는다', async () => {
    let calls = 0;
    const origin = await resolvePortOrigin(8080, [VIBISUAL], [], 'win32', async () => {
      calls += 1;
      return { command: REAL_WIN_CMD };
    });
    // 가를 대상이 없다 — 판정을 내린 것이 아니라 묻지 않은 것이라 통과다.
    expect(origin).toBe('unresolved');
    expect(shouldAttachServer(origin)).toBe(true);
    expect(calls).toBe(0);
  });

  it('남의 프로젝트 서버를 foreign 으로 가른다', async () => {
    const origin = await resolvePortOrigin(8080, [VIBISUAL], [GAME], 'win32', async () => ({
      command: REAL_WIN_CMD,
    }));
    expect(origin).toBe('foreign');
  });

  it('TTL 안에서는 프로세스를 다시 읽지 않는다', async () => {
    let calls = 0;
    const lookup = async (): Promise<ProcessStartInfo> => { calls += 1; return { command: REAL_WIN_CMD }; };
    const t0 = 1_000_000;
    await resolvePortOrigin(8080, [VIBISUAL], [GAME], 'win32', lookup, t0);
    await resolvePortOrigin(8080, [VIBISUAL], [GAME], 'win32', lookup, t0 + PORT_ORIGIN_LOOKUP_TTL_MS - 1);
    expect(calls).toBe(1);
    // TTL 을 넘기면 다시 읽는다 — 서버가 죽고 다른 프로젝트가 같은 포트를 잡을 수 있다.
    await resolvePortOrigin(8080, [VIBISUAL], [GAME], 'win32', lookup, t0 + PORT_ORIGIN_LOOKUP_TTL_MS + 1);
    expect(calls).toBe(2);
  });

  it('조회가 던져도 막지 않는다', async () => {
    const origin = await resolvePortOrigin(8080, [VIBISUAL], [GAME], 'win32', () => {
      throw new Error('EACCES');
    });
    expect(origin).toBe('unresolved');
    expect(shouldAttachServer(origin)).toBe(true);
  });
});
