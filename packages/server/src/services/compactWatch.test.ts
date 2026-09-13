import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COMPACT_WATCH_THRESHOLDS,
  compactWatchRank,
  judgeAll,
  judgeCompactWatch,
  type CompactWatchInput,
} from './compactWatch.js';

// SCENARIO.md §5.26 (F) — 자동압축 미발동 감시.
//
// 이 판정에는 모델이 없다. 숫자 비교 셋뿐이고, **셋이 다 맞아야** 말을 꺼낸다 — 그래서 시험이
// 지켜야 할 것은 "언제 말하는가"가 아니라 **언제 입을 다무는가**다. 거짓 경보가 한 번 나면
// 사용자는 그 다음부터 이 칸을 안 본다.

const NOW = 1_700_000_000_000;
const T = DEFAULT_COMPACT_WATCH_THRESHOLDS;

function input(over: Partial<CompactWatchInput> = {}): CompactWatchInput {
  return {
    sessionId: 'sess-1',
    contextUsed: 96_000,
    contextMax: 100_000,
    lastCompactAt: NOW - T.overdueMs - 1,
    grownBytes: T.growthBytes + 1,
    canSendCompact: true,
    autoCompactOff: false,
    running: true,
    ...over,
  };
}

describe('§5.26 (F) judgeCompactWatch — 모르면 넘겨짚지 않는다', () => {
  it('창 크기를 모르면 ok — 비율을 지어내지 않는다', () => {
    expect(judgeCompactWatch(input({ contextMax: undefined }), NOW).level).toBe('ok');
    expect(judgeCompactWatch(input({ contextUsed: undefined }), NOW).level).toBe('ok');
    expect(judgeCompactWatch(input({ contextMax: 0 }), NOW).level).toBe('ok');
  });

  it('창 크기가 음수·NaN 이면 ok', () => {
    expect(judgeCompactWatch(input({ contextMax: -1 }), NOW).level).toBe('ok');
    expect(judgeCompactWatch(input({ contextMax: Number.NaN }), NOW).level).toBe('ok');
  });
});

describe('§5.26 (F) stalled — 창이 찼다는 사실은 설정보다 세다', () => {
  it('비율이 stallRatio 이상이면 stalled', () => {
    const s = judgeCompactWatch(input({ contextUsed: 99_500 }), NOW);
    expect(s.level).toBe('stalled');
  });

  it('자동압축을 꺼 뒀어도 stalled 는 말한다 — 창이 찬 것은 설정과 무관한 사실이다', () => {
    const s = judgeCompactWatch(input({ contextUsed: 99_500, autoCompactOff: true }), NOW);
    expect(s.level).toBe('stalled');
  });

  it('비율이 1 을 넘어도 1 로 눌러 적는다', () => {
    const s = judgeCompactWatch(input({ contextUsed: 200_000 }), NOW);
    expect(s.level).toBe('stalled');
    expect(s.ratio).toBeLessThanOrEqual(1);
  });
});

describe('§5.26 (F) overdue — 셋이 다 맞아야 한다', () => {
  it('셋이 다 맞으면 overdue', () => {
    expect(judgeCompactWatch(input(), NOW).level).toBe('overdue');
  });

  it('비율이 낮으면 ok', () => {
    expect(judgeCompactWatch(input({ contextUsed: 50_000 }), NOW).level).toBe('ok');
  });

  it('더 자라지 않으면 ok — 멈춘 세션을 재촉하지 않는다', () => {
    expect(judgeCompactWatch(input({ grownBytes: 0 }), NOW).level).toBe('ok');
  });

  it('방금 압축했으면 ok — 창이 아직 안 닫혔을 뿐이다', () => {
    expect(judgeCompactWatch(input({ lastCompactAt: NOW - 1000 }), NOW).level).toBe('ok');
  });

  it('자동압축을 꺼 뒀으면 overdue 를 말하지 않는다 — 사용자가 그렇게 정한 것이다', () => {
    expect(judgeCompactWatch(input({ autoCompactOff: true }), NOW).level).toBe('ok');
  });

  it('돌고 있지 않으면 말하지 않는다', () => {
    expect(judgeCompactWatch(input({ running: false }), NOW).level).toBe('ok');
  });

  it('압축을 한 번도 안 했어도 (lastCompactAt 없음) 나머지가 맞으면 overdue', () => {
    expect(judgeCompactWatch(input({ lastCompactAt: undefined }), NOW).level).toBe('overdue');
  });
});

describe('§5.26 (F) judgeAll — ok 는 목록에 서지 않는다', () => {
  it('ok 인 세션은 걸러진다', () => {
    const list = judgeAll([
      input({ sessionId: 'quiet', contextUsed: 10_000 }),
      input({ sessionId: 'late' }),
    ], NOW);
    expect(list.map((s) => s.sessionId)).toEqual(['late']);
  });

  it('등급 순위는 stalled > overdue > ok', () => {
    expect(compactWatchRank('stalled')).toBeGreaterThan(compactWatchRank('overdue'));
    expect(compactWatchRank('overdue')).toBeGreaterThan(compactWatchRank('ok'));
  });

  it('보낼 수 있는지(canSendCompact)는 판정이 아니라 사실 그대로 실린다', () => {
    const [s] = judgeAll([input({ canSendCompact: false })], NOW);
    expect(s?.canSendCompact).toBe(false);
  });
});

// ─── §5.26 (F)(a)(b) — 2026-09-09 추가분 ───
//
// (a) `overdue` 의 분모가 모델 창이 아니라 **사용자가 접기로 한 선**이라는 것,
// (b) 보냈는데 안 온 압축은 예측이 아니라 **이미 일어난 실패**라는 것.
// 둘 다 실제 사고에서 나왔다: 1M 창에 400k 를 걸어 둔 세션이 24시간 동안 한 번도 안 접혔는데
// 창 대비로는 32% 라 보험이 침묵했고, 우리가 쏜 `/compact` 는 거절됐는데 로그만 남았다.

describe('§5.26 (F)(a) overdue 의 분모는 "접기로 한 선"이다', () => {
  it('창 대비 39% 라도 정한 선(400k) 대비 97% 면 overdue', () => {
    const s = judgeCompactWatch(input({
      contextUsed: 390_000,
      contextMax: 1_000_000,
      autoCompactTokens: 400_000,
    }), NOW);
    expect(s.level).toBe('overdue');
  });

  it('선이 없으면 종전대로 창으로 잰다 — 같은 수치가 침묵한다(무보험이던 구간)', () => {
    const s = judgeCompactWatch(input({
      contextUsed: 390_000,
      contextMax: 1_000_000,
    }), NOW);
    expect(s.level).toBe('ok');
  });

  it('stalled 의 분모는 그대로 창이다 — CLI 가 멈추는 자리는 우리 선과 무관하다', () => {
    const s = judgeCompactWatch(input({
      contextUsed: 995_000,
      contextMax: 1_000_000,
      autoCompactTokens: 400_000,
    }), NOW);
    expect(s.level).toBe('stalled');
  });
});

describe('§5.26 (F)(b) rejected — 보냈는데 PreCompact 가 안 왔다', () => {
  const sent = NOW - T.sendTimeoutMs - 1;

  it('보낸 뒤 도착이 없고 시간이 지났으면 rejected', () => {
    const s = judgeCompactWatch(input({
      contextUsed: 322_168, contextMax: 1_000_000, autoCompactTokens: 400_000,
      compactSentAt: sent, lastCompactAt: undefined,
    }), NOW);
    expect(s.level).toBe('rejected');
  });

  it('비율·성장·실행 여부를 묻지 않는다 — 예측이 아니라 이미 일어난 실패다', () => {
    const s = judgeCompactWatch(input({
      contextUsed: 10_000, contextMax: 1_000_000, autoCompactTokens: 400_000,
      compactSentAt: sent, lastCompactAt: undefined,
      grownBytes: 0, running: false,
    }), NOW);
    expect(s.level).toBe('rejected');
  });

  it('자동압축을 꺼 뒀어도 rejected — 손수 보낸 것이 안 먹었다는 뜻이다', () => {
    const s = judgeCompactWatch(input({
      contextUsed: 10_000, contextMax: 1_000_000,
      compactSentAt: sent, lastCompactAt: undefined, autoCompactOff: true,
    }), NOW);
    expect(s.level).toBe('rejected');
  });

  it('보낸 뒤 도착했으면 침묵한다 — 우리 명령이 실제로 돌았다', () => {
    const s = judgeCompactWatch(input({
      contextUsed: 10_000, contextMax: 1_000_000,
      compactSentAt: sent, lastCompactAt: sent + 1_000,
    }), NOW);
    expect(s.level).toBe('ok');
  });

  it('아직 기다리는 중이면 overdue 도 안 띄운다 — 우리 명령을 우리가 고장으로 신고하지 않게', () => {
    const s = judgeCompactWatch(input({
      contextUsed: 390_000, contextMax: 1_000_000, autoCompactTokens: 400_000,
      compactSentAt: NOW - 1_000, lastCompactAt: NOW - T.overdueMs - 1,
    }), NOW);
    expect(s.level).toBe('ok');
    expect(s.sinceSentMs).toBe(1_000);
  });

  it('stalled 가 rejected 를 이긴다 — 창이 찬 것이 가장 급하다', () => {
    const s = judgeCompactWatch(input({
      contextUsed: 995_000, contextMax: 1_000_000,
      compactSentAt: sent, lastCompactAt: undefined,
    }), NOW);
    expect(s.level).toBe('stalled');
  });

  it('서열은 stalled > rejected > overdue > ok', () => {
    expect(compactWatchRank('stalled')).toBeGreaterThan(compactWatchRank('rejected'));
    expect(compactWatchRank('rejected')).toBeGreaterThan(compactWatchRank('overdue'));
    expect(compactWatchRank('overdue')).toBeGreaterThan(compactWatchRank('ok'));
  });

  it('judgeAll 은 rejected 도 전선에 싣는다', () => {
    const out = judgeAll([input({
      contextUsed: 10_000, contextMax: 1_000_000,
      compactSentAt: sent, lastCompactAt: undefined,
    })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.level).toBe('rejected');
  });
});
