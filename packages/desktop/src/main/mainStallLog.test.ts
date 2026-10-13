/**
 * §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ④ — **메인 스레드 멈춤을 늘 기록한다.**
 *
 * 사용자 보고: "앱이 켜지면 드래그해도 우리 앱만 안 움직인다 — 계속 반복이야". 서버가 창의 메인 스레드에서 함께
 * 돌아 그 스레드가 멈추면 제목줄로도 덮개로도 창이 따라오지 않는데, 멈춤을 재는 장치가 한 곳도 없어 매번 추측으로
 * 고쳤다. 판정·줄 모양은 순수 함수로, 시계와 배선은 가짜 타이머·원문으로 고정한다.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 기록 파일은 사용자 userData 에 쓴다 — 시험에서는 막는다(이 모듈은 electron 도 함께 끌고 온다).
vi.mock('./crashLog', () => ({ appendLogText: vi.fn() }));

import {
  __resetMainStallLogForTest,
  formatStallLine,
  MAIN_STALL_LOG_MS,
  MAIN_STALL_PROBE_MS,
  markMainWindowShown,
  stallLagMs,
  startMainStallLog,
} from './mainStallLog';

afterEach(() => {
  __resetMainStallLogForTest();
  vi.useRealTimers();
});

describe('멈춤 판정', () => {
  it('제때 깬 시계는 멈춤이 아니다', () => {
    expect(stallLagMs(1000, 1000 + MAIN_STALL_PROBE_MS)).toBe(0);
    expect(stallLagMs(1000, 1000 + MAIN_STALL_PROBE_MS - 5)).toBe(0);
  });

  it('간격을 넘겨 늦은 만큼이 멈춘 시간이다', () => {
    expect(stallLagMs(1000, 1000 + MAIN_STALL_PROBE_MS + 850)).toBe(850);
  });

  it('문턱은 창이 손을 놓치기 시작하는 길이 — 간격보다 길다', () => {
    expect(MAIN_STALL_LOG_MS).toBeGreaterThan(MAIN_STALL_PROBE_MS);
  });
});

describe('기록 한 줄', () => {
  const at = Date.UTC(2026, 9, 12, 9, 0, 1, 500);

  it('창이 뜨기 전의 멈춤(부팅 동기 구간)은 before-window 로 적고, 멈춤이 시작된 시각을 앞에 둔다', () => {
    expect(formatStallLine({ at, stallMs: 1500, uptimeMs: 4200.4, windowShownAt: null }))
      .toBe('[2026-10-12T09:00:00.000Z] main-thread stall 1500ms (before-window, uptime 4200ms)\n');
  });

  it('창이 뜬 뒤면 뜬 때부터 몇 ms 지나 멈췄는지 적는다', () => {
    const shown = at - 2500;
    expect(formatStallLine({ at, stallMs: 400, uptimeMs: 9000, windowShownAt: shown }))
      .toBe('[2026-10-12T09:00:01.100Z] main-thread stall 400ms (window+2100ms, uptime 9000ms)\n');
  });
});

describe('시계', () => {
  it('문턱을 넘는 멈춤만 적는다 — 창이 뜬 뒤면 그 기준으로', () => {
    // 단조 시계는 손으로 돌린다 — 가짜 타이머는 콜백을 제시각에 부르므로 "늦게 깬 시계"를 만들지 못한다.
    let monotonic = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const lines: string[] = [];
    startMainStallLog((line) => { lines.push(line); });
    for (let i = 0; i < 5; i += 1) {
      monotonic += MAIN_STALL_PROBE_MS;
      vi.advanceTimersByTime(MAIN_STALL_PROBE_MS);
    }
    expect(lines).toEqual([]);

    // 문턱 아래로 늦은 것은 적지 않는다.
    monotonic += MAIN_STALL_PROBE_MS + MAIN_STALL_LOG_MS - 1;
    vi.advanceTimersByTime(MAIN_STALL_PROBE_MS);
    expect(lines).toEqual([]);

    markMainWindowShown();
    // 메인 스레드가 0.9초 막힌 것과 같다 — 시계는 그만큼 늦게 한 번 깬다.
    monotonic += MAIN_STALL_PROBE_MS + 900;
    vi.advanceTimersByTime(MAIN_STALL_PROBE_MS);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/main-thread stall 900ms \(window\+\d+ms, uptime \d+ms\)\n$/);
    now.mockRestore();
  });

  it('두 번 걸어도 시계는 하나다', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    startMainStallLog(() => {});
    startMainStallLog(() => {});
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('desktop main 배선', () => {
  const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('백엔드를 띄우기 전에 시계를 건다 — 부팅의 동기 구간도 한 줄로 남게', () => {
    const start = main.indexOf('startMainStallLog();');
    expect(start, '시계를 거는 자리가 없다').toBeGreaterThan(-1);
    expect(start).toBeLessThan(main.indexOf('await startBackendBeforeWindow({'));
  });

  it('본체 창이 처음 보일 때 멈춤 기록의 기준점을 찍고, 줄에 선 시작 확인을 푼다', () => {
    const at = main.indexOf("mainWindow.once('show', () => {");
    expect(at, '첫 show 배선이 없다').toBeGreaterThan(-1);
    const body = main.slice(at, main.indexOf('});', at));
    expect(body).toContain('markMainWindowShown();');
    expect(body).toContain('releaseStartupJobs();');
  });
});
