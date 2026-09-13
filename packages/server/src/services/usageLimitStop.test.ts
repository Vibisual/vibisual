/**
 * §2.4 (한도 정지) — shared `usageLimitStop.ts` 의 판정 고정 시험.
 *
 * 시험 재료는 **실측 원문**이다(`~/.claude/projects` 의 대화록 JSONL 에서 그대로 옮겨 왔다 — 2026-09-09).
 * 이 판정이 틀리는 두 방향이 서로 반대라 둘 다 고정한다:
 *  · 못 알아보면 → 한도로 멎은 세션이 초록 "완료"로 내려앉아 **멈춘 사실이 화면에서 사라진다**(원증상).
 *  · 넘겨짚으면 → 그 문장을 말하는 대화(지금 이 기능을 지시한 프롬프트가 그랬다)까지 한도로 세어
 *    **멀쩡히 도는 세션이 주황이 된다**.
 *
 * shared 에는 러너가 없으므로 서버 쪽에서 돌린다(`bashWritePaths.test.ts` 와 같은 자리).
 * 시각은 인자로 넘긴다 — 함수가 `Date.now()` 를 읽으면 이 시험이 성립하지 않는다.
 */
import { describe, it, expect } from 'vitest';
import {
  detectUsageLimitStop,
  detectUsageLimitInText,
  matchUsageLimitNotice,
  parseUsageLimitResetLabel,
} from '@vibisual/shared';

const NOW = 1_757_000_000_000;

/** 실측 그대로의 합성 assistant 줄(세션 한도). */
function syntheticLine(text: string, quota?: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'assistant',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] },
    ...(quota ? { quotaLimits: quota } : {}),
    error: 'rate_limit',
    isApiErrorMessage: true,
    apiErrorStatus: 429,
  };
}

describe('matchUsageLimitNotice — 통지 그 자체인가', () => {
  it('현행 CLI 세 창 모두 알아본다', () => {
    expect(matchUsageLimitNotice("You've hit your session limit · resets 10pm (Asia/Seoul)")).toBe('session');
    expect(matchUsageLimitNotice("You've hit your weekly limit · resets 3am (Asia/Seoul)")).toBe('weekly');
    expect(matchUsageLimitNotice("You've hit your usage limit. Upgrade to Plus to continue")).toBe('usage');
  });

  it('옛 CLI 의 `Claude AI usage limit reached|<epoch>` 도 같은 자리로 온다', () => {
    expect(matchUsageLimitNotice('Claude AI usage limit reached|1757000000')).toBe('usage');
  });

  it('문장 **가운데** 인용은 통지가 아니다 — 이것이 오탐을 막는 관문이다', () => {
    expect(matchUsageLimitNotice("작업 하다가 You've hit your session limit 로 끊긴 거 표시해 줘")).toBeNull();
    expect(matchUsageLimitNotice('세션 한도에 대해 설명하겠습니다')).toBeNull();
    expect(matchUsageLimitNotice('')).toBeNull();
  });
});

describe('parseUsageLimitResetLabel — 사용자가 본 그 글자를 그대로', () => {
  it('리셋 표기를 떼어 낸다', () => {
    expect(parseUsageLimitResetLabel("You've hit your session limit · resets 10pm (Asia/Seoul)"))
      .toBe('10pm (Asia/Seoul)');
    expect(parseUsageLimitResetLabel("You've hit your session limit · resets 2:10pm (Asia/Seoul)"))
      .toBe('2:10pm (Asia/Seoul)');
  });

  it('꼬리의 진단문(`(error type …)`)은 표기가 아니다', () => {
    expect(parseUsageLimitResetLabel(
      "You've hit your session limit · resets 5pm (Asia/Seoul) (error type rate_limit, HTTP 429, req_01)",
    )).toBe('5pm (Asia/Seoul)');
  });

  it('표기가 없으면 지어내지 않는다', () => {
    expect(parseUsageLimitResetLabel("You've hit your usage limit.")).toBeUndefined();
  });
});

describe('detectUsageLimitStop — CLI 한 줄에서', () => {
  it('실측 합성 줄을 알아보고 봉투에서 리셋 시각까지 가져온다', () => {
    const stop = detectUsageLimitStop(
      syntheticLine("You've hit your session limit · resets 10pm (Asia/Seoul)", {
        status: 'rejected', resetsAt: 1_788_958_800, rateLimitType: 'five_hour',
      }),
      NOW,
    );
    expect(stop).toEqual({
      kind: 'session',
      at: NOW,
      message: "You've hit your session limit · resets 10pm (Asia/Seoul)",
      resetsAt: 1_788_958_800_000, // 초 → ms
      resetsLabel: '10pm (Asia/Seoul)',
    });
  });

  it('봉투의 창 판정이 원문보다 우선한다 — 주간 창은 주간으로 센다', () => {
    const stop = detectUsageLimitStop(
      syntheticLine("You've hit your weekly limit · resets 3am (Asia/Seoul)", {
        status: 'rejected', resetsAt: 1_788_958_800, rateLimitType: 'seven_day',
      }),
      NOW,
    );
    expect(stop?.kind).toBe('weekly');
  });

  it('봉투가 없어도(stdout 만 오는 경로) 합성 표식이면 인정한다', () => {
    const line = {
      type: 'assistant',
      message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit · resets 2am (Asia/Seoul)" }] },
    };
    expect(detectUsageLimitStop(line, NOW)?.kind).toBe('session');
  });

  it('코덱스의 `{"type":"error"}` 도 같은 자리로 온다(§5.25 (F))', () => {
    const line = { type: 'error', message: "You've hit your usage limit. Upgrade to Plus to continue using Codex" };
    expect(detectUsageLimitStop(line, NOW)?.kind).toBe('usage');
  });

  it('**user 줄은 절대 보지 않는다** — 사용자가 그 문장을 프롬프트에 적는 일이 실제로 있다', () => {
    const line = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: "You've hit your session limit · resets 10pm (Asia/Seoul)" }] },
    };
    expect(detectUsageLimitStop(line, NOW)).toBeNull();
  });

  it('진짜 모델이 통지로 **시작하는 긴 답**을 써도 한도로 세지 않는다', () => {
    const line = {
      type: 'assistant',
      message: {
        model: 'claude-opus-5',
        content: [{
          type: 'text',
          text: `You've hit your session limit · resets 10pm (Asia/Seoul) — ${'이 문장은 통지가 아니라 그것을 인용한 보고서다. '.repeat(8)}`,
        }],
      },
    };
    expect(detectUsageLimitStop(line, NOW)).toBeNull();
  });

  it('한도와 무관한 줄·모양이 다른 값은 조용히 지나간다', () => {
    expect(detectUsageLimitStop({ type: 'result', result: '작업을 마쳤습니다' }, NOW)).toBeNull();
    expect(detectUsageLimitStop({ type: 'system', subtype: 'init' }, NOW)).toBeNull();
    expect(detectUsageLimitStop(null, NOW)).toBeNull();
    expect(detectUsageLimitStop('문자열', NOW)).toBeNull();
    expect(detectUsageLimitStop([1, 2], NOW)).toBeNull();
  });
});

describe('detectUsageLimitInText — 봉투 없는 결과 본문', () => {
  it('짧은 통지 한 줄은 인정한다(스트림을 놓쳤을 때의 마지막 그물)', () => {
    const stop = detectUsageLimitInText("You've hit your session limit · resets 10pm (Asia/Seoul)", NOW);
    expect(stop?.kind).toBe('session');
    expect(stop?.resetsLabel).toBe('10pm (Asia/Seoul)');
    expect(stop?.resetsAt).toBeUndefined(); // 본문에는 숫자 시각이 없다 — 지어내지 않는다
  });

  it('통지를 인용한 긴 글은 인정하지 않는다', () => {
    const long = `You've hit your session limit · resets 10pm (Asia/Seoul)\n${'그래서 이렇게 고쳤습니다. '.repeat(20)}`;
    expect(detectUsageLimitInText(long, NOW)).toBeNull();
  });
});
