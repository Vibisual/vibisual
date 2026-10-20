/**
 * §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ② — **부팅 한 번짜리 확인은 창이 보인 뒤 한 칸씩 돈다.**
 *
 * 사용자 보고: "앱이 켜지면 커버든 탭이든 드래그하면 이동해야 하는데 우리 앱만 안 된다". 서버가 창의 메인
 * 스레드에서 함께 돌아, 부팅 시작 기준 1.2~4초에 걸린 확인들(저마다 CLI 프로세스를 띄우고 스냅샷을 다시 민다)이
 * 부팅이 느리면 창이 뜨는 그 순간 한꺼번에 터졌다. 줄의 규칙과 `runServer` 배선을 함께 고정한다.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STARTUP_JOB_GAP_MS,
  STARTUP_JOB_RELEASE_CAP_MS,
  STARTUP_JOB_SETTLE_MS,
  STARTUP_JOB_SPLASH_GAP_MS,
  STARTUP_JOB_SPLASH_SETTLE_MS,
} from '@vibisual/shared';
import {
  __resetStartupJobsForTest,
  deferStartupJob,
  pendingStartupJobCount,
  planStartupJobDelays,
  releaseStartupJobs,
} from './startupJobs.js';
import { reportBootProgress, setBootProgressSink } from './bootProgress.js';

describe('줄의 계획 — 원래 순서 그대로 한 칸씩', () => {
  it('종전 지연 순서를 지키고, 첫 작업은 settle 뒤 · 그다음은 gap 씩 띄운다', () => {
    // runServer 의 실제 등록 순서: 사용량(2s) · 로그인(1.5s) · 훅 전송(4s) · 설치(1.2s) · 코덱스(2s)
    expect(planStartupJobDelays([2000, 1500, 4000, 1200, 2000], 1500, 750)).toEqual([
      1500 + 2 * 750, // 사용량 — 같은 2초인 코덱스보다 먼저 등록됐다
      1500 + 750, // 로그인
      1500 + 4 * 750, // 훅 전송
      1500, // 설치 — 로그인보다 앞서야 한다
      1500 + 3 * 750, // 코덱스
    ]);
  });

  it('빈 줄은 빈 계획이다', () => {
    expect(planStartupJobDelays([])).toEqual([]);
  });
});

describe('줄의 수명', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetStartupJobsForTest();
  });
  afterEach(() => {
    __resetStartupJobsForTest();
    vi.useRealTimers();
  });

  it('창이 보이기 전에는 하나도 돌지 않는다 — 부팅 시작 기준 시각이 지나도', () => {
    const ran: string[] = [];
    deferStartupJob('claude-setup', 1200, () => ran.push('claude-setup'));
    vi.advanceTimersByTime(5000);
    expect(ran).toEqual([]);
  });

  it('창이 보이면 settle 뒤부터 원래 순서대로 한 칸씩 돈다', () => {
    const ran: string[] = [];
    deferStartupJob('claude-usage', 2000, () => ran.push('claude-usage'));
    deferStartupJob('claude-auth', 1500, () => ran.push('claude-auth'));
    deferStartupJob('claude-setup', 1200, () => ran.push('claude-setup'));
    releaseStartupJobs();
    vi.advanceTimersByTime(STARTUP_JOB_SETTLE_MS - 1);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(['claude-setup']);
    vi.advanceTimersByTime(STARTUP_JOB_GAP_MS);
    expect(ran).toEqual(['claude-setup', 'claude-auth']);
    vi.advanceTimersByTime(STARTUP_JOB_GAP_MS);
    expect(ran).toEqual(['claude-setup', 'claude-auth', 'claude-usage']);
  });

  it('창 소식이 끝내 없으면(창 없는 실행·시험) 상한 뒤 스스로 풀린다', () => {
    const ran: string[] = [];
    deferStartupJob('claude-setup', 1200, () => ran.push('claude-setup'));
    vi.advanceTimersByTime(STARTUP_JOB_RELEASE_CAP_MS);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(STARTUP_JOB_SETTLE_MS);
    expect(ran).toEqual(['claude-setup']);
  });

  it('두 번 풀어도 한 번만 돈다(mac 에서 창을 다시 만들어도)', () => {
    const run = vi.fn();
    deferStartupJob('claude-setup', 1200, run);
    releaseStartupJobs();
    releaseStartupJobs();
    vi.advanceTimersByTime(STARTUP_JOB_SETTLE_MS + 10 * STARTUP_JOB_GAP_MS);
    expect(run).toHaveBeenCalledOnce();
  });

  it('풀린 뒤에 들어온 작업은 종전처럼 자기 지연 뒤에 돈다', () => {
    releaseStartupJobs();
    const run = vi.fn();
    deferStartupJob('late', 400, run);
    vi.advanceTimersByTime(399);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledOnce();
  });

  it('한 작업이 던져도 다음 작업은 돈다', () => {
    const after = vi.fn();
    deferStartupJob('broken', 1000, () => { throw new Error('boom'); });
    deferStartupJob('after', 2000, after);
    releaseStartupJobs();
    vi.advanceTimersByTime(STARTUP_JOB_SETTLE_MS + STARTUP_JOB_GAP_MS);
    expect(after).toHaveBeenCalledOnce();
  });
});

// §3.7 · §9 「시작 화면(스플래시)」 — 스플래시가 떠 있으면 본체 창이 보이기 전에 줄을 풀고, desktop main 은 남은 수가
// 0 이 된 뒤에야 본체 창을 보인다. 창이 보인 뒤 +1.5s·+2.1s·+2.6s 에 찍히던 CLI 기동 멈춤을 사용자가 만지기 전으로 옮긴다.
describe('스플래시 뒤에서 먼저 푼다', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetStartupJobsForTest();
  });
  afterEach(() => {
    __resetStartupJobsForTest();
    vi.useRealTimers();
  });

  it('좁은 간격으로 원래 순서 그대로 돈다', () => {
    const ran: string[] = [];
    deferStartupJob('claude-usage', 2000, () => ran.push('claude-usage'));
    deferStartupJob('claude-auth', 1500, () => ran.push('claude-auth'));
    deferStartupJob('claude-setup', 1200, () => ran.push('claude-setup'));
    releaseStartupJobs('splash');
    vi.advanceTimersByTime(STARTUP_JOB_SPLASH_SETTLE_MS - 1);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(['claude-setup']);
    vi.advanceTimersByTime(STARTUP_JOB_SPLASH_GAP_MS);
    expect(ran).toEqual(['claude-setup', 'claude-auth']);
    vi.advanceTimersByTime(STARTUP_JOB_SPLASH_GAP_MS);
    expect(ran).toEqual(['claude-setup', 'claude-auth', 'claude-usage']);
  });

  it('간격은 종전 부팅 기준 지연의 가장 가까운 두 칸(0.3초)보다 좁지 않고, 창이 보인 뒤의 간격보다 짧다', () => {
    expect(STARTUP_JOB_SPLASH_GAP_MS).toBeGreaterThanOrEqual(300);
    expect(STARTUP_JOB_SPLASH_GAP_MS).toBeLessThan(STARTUP_JOB_GAP_MS);
    expect(STARTUP_JOB_SPLASH_SETTLE_MS).toBeLessThan(STARTUP_JOB_SETTLE_MS);
  });

  it('남은 수 — 풀리기 전엔 줄에 선 수, 풀린 뒤엔 아직 시작하지 않은 수, 다 돌면 0', () => {
    expect(pendingStartupJobCount()).toBe(0);
    deferStartupJob('claude-setup', 1200, () => {});
    deferStartupJob('claude-auth', 1500, () => {});
    expect(pendingStartupJobCount()).toBe(2);
    releaseStartupJobs('splash');
    expect(pendingStartupJobCount()).toBe(2);
    vi.advanceTimersByTime(STARTUP_JOB_SPLASH_SETTLE_MS);
    expect(pendingStartupJobCount()).toBe(1);
    vi.advanceTimersByTime(STARTUP_JOB_SPLASH_GAP_MS);
    expect(pendingStartupJobCount()).toBe(0);
  });

  it('던지는 작업도 셈에서 빠진다 — 남은 수가 0 에 못 닿아 스플래시가 상한까지 버티는 일이 없게', () => {
    deferStartupJob('broken', 1000, () => { throw new Error('boom'); });
    releaseStartupJobs('splash');
    vi.advanceTimersByTime(STARTUP_JOB_SPLASH_SETTLE_MS);
    expect(pendingStartupJobCount()).toBe(0);
  });

  it('스플래시가 먼저 풀었으면 본체 창의 첫 show 는 아무것도 다시 돌리지 않는다', () => {
    const run = vi.fn();
    deferStartupJob('claude-setup', 1200, run);
    releaseStartupJobs('splash');
    releaseStartupJobs('window-shown');
    vi.advanceTimersByTime(STARTUP_JOB_SETTLE_MS + 10 * STARTUP_JOB_GAP_MS);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('부팅 진척 — 표시 전용 창구', () => {
  afterEach(() => setBootProgressSink(null));

  it('받는 쪽이 없으면 아무 일도 없다', () => {
    expect(() => reportBootProgress({ phase: 'services' })).not.toThrow();
  });

  it('받는 쪽에 그대로 넘기고, 받는 쪽이 던져도 부팅 쪽으로 새지 않는다', () => {
    const seen: unknown[] = [];
    setBootProgressSink((p) => { seen.push(p); throw new Error('splash gone'); });
    expect(() => reportBootProgress({ phase: 'projects', done: 1, total: 3, label: 'vibisual' })).not.toThrow();
    expect(seen).toEqual([{ phase: 'projects', done: 1, total: 3, label: 'vibisual' }]);
  });
});

describe('runServer 배선', () => {
  const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('부팅 한 번짜리 확인 다섯이 줄에 선다', () => {
    for (const label of ['claude-setup', 'claude-auth', 'claude-usage', 'codex-setup', 'hook-transport']) {
      expect(src, `${label} 이 줄에 서지 않았다`).toContain(`deferStartupJob('${label}'`);
    }
  });

  it('부팅 시작 기준으로 바로 거는 한 번짜리 확인이 남아 있지 않다', () => {
    // 문장 맨 앞의 `setTimeout(…)` 만 본다 — 부팅 때 걸던 것은 그런 홀로 선 문장이었다. 사용량 **리셋 시각** 예약
    //   (`claudeUsageResetTimer = setTimeout(…)` — 조회 결과를 받은 뒤 다음 리셋에 맞춰 거는 것)은 부팅 확인이 아닌데,
    //   종전 정규식은 그것까지 잡아 이 시험이 늘 빨갰다.
    expect(src).not.toMatch(
      /^\s*setTimeout\(\(\) => \{ void (refreshClaudeAuth|probeAndRefreshClaudeUsage|refreshHookTransport|claudeSetupService\.refresh)\(/m,
    );
    expect(src).not.toMatch(/^\s*setTimeout\(\(\) => \{\n\s*void codexSetupService\.refresh\(\)/m);
  });

  it('desktop main 이 풀 수 있게 패키지 입구에서 내보낸다', () => {
    expect(src).toContain("export { releaseStartupJobs } from './services/startupJobs.js';");
  });

  // §9 「시작 화면(스플래시)」 — 스플래시가 남은 수와 진척을 읽을 수 있게.
  it('스플래시용 남은 수·부팅 진척 창구를 패키지 입구에서 내보낸다', () => {
    expect(src).toContain("export { pendingStartupJobCount, type StartupJobRelease } from './services/startupJobs.js';");
    expect(src).toContain("export { setBootProgressSink } from './services/bootProgress.js';");
  });

  it('프로젝트 복원 반복이 한 칸마다 진척을 알리고, 끝나면 다 됐다고 · 나머지 기동으로 넘어간다고 알린다', () => {
    const loop = src.indexOf('for (const [bootIndex, meta] of filtered.entries()) {');
    expect(loop, '복원 반복이 진척을 세지 않는다').toBeGreaterThan(-1);
    const head = src.slice(loop, src.indexOf('graphManager.hydrateProject(meta.project.path)', loop));
    expect(head).toContain("reportBootProgress({ phase: 'projects', done: bootIndex, total: filtered.length, label: meta.project.name });");
    const after = src.indexOf("reportBootProgress({ phase: 'projects', done: filtered.length, total: filtered.length });", loop);
    expect(after, '복원이 끝났다는 마지막 칸이 없다').toBeGreaterThan(loop);
    const services = src.indexOf("reportBootProgress({ phase: 'services' });", after);
    expect(services, '나머지 기동으로 넘어간다는 칸이 없다').toBeGreaterThan(after);
    expect(services).toBeLessThan(src.indexOf('graphManager.rehydrateAllBackgroundShells();', after));
  });

  // §9 「창이 뜬 직후의 메인 스레드」 ③ — 걷은 세션마다 하던 체크포인트 통째 저장을 주기 끝 한 번으로.
  it('끝난 세션 정리는 세션마다가 아니라 주기 끝에서 한 번 저장한다', () => {
    const at = src.indexOf('const lifecycle = new SessionLifecycleManager({');
    expect(at, '생존 폴링 배선을 못 찾음').toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf('listAgentSessionIds:', at));
    const onDead = block.slice(block.indexOf('onDead:'), block.indexOf('onDeadSettled:'));
    expect(onDead, '세션마다 저장하고 있다').not.toContain('saveCheckpoint(');
    expect(block.slice(block.indexOf('onDeadSettled:'))).toContain('saveCheckpoint();');
  });

  // §9 「창이 뜬 직후의 메인 스레드」 ① — 부팅 구간의 스냅샷은 마지막으로 보던 프로젝트만.
  it('부팅 구간 범위를 마지막으로 보던 프로젝트로 건다', () => {
    expect(src).toContain('graphManager.setBootViewProject(loadAppState().lastActiveProject);');
  });
});
