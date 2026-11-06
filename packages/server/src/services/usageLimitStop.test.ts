/**
 * §2.4 (한도 정지) — shared `usageLimitStop.ts` 판정(재료는 대화록 실측 원문, 2026-09-09 · shared 엔 러너가 없어 여기서 돈다).
 * 못 알아보면 멎은 세션이 초록 "완료"가 되고, 넘겨짚으면 그 문장을 인용한 대화가 주황이 된다. 시각은 인자로 — `Date.now()` 를 읽으면 시험이 안 된다.
 */
import { describe, it, expect } from 'vitest';
import {
  detectUsageLimitStop,
  detectUsageLimitInText,
  matchUsageLimitNotice,
  parseUsageLimitResetLabel,
} from '@vibisual/shared';

const NOW = 1_757_000_000_000;

/**
 * 월 지출 한도 통지 실측 원문(대화록 JSONL · 2026-10-22, 6건 · 156자) — §5.5 #17-47 (H).
 * 추가 사용량을 켠 요금제가 세션 한도에 닿고 그 달 지출 상한까지 다 썼을 때 적힌다.
 */
const SPEND_LIMIT_TEXT =
  "You've hit your monthly spend limit · raise it at https://claude.ai/settings/usage?from=cc_cli_limit_message · your session limit resets 2:40pm (Asia/Seoul)";

/** 위 통지의 봉투 실측 그대로. */
const SPEND_LIMIT_QUOTA = {
  status: 'rejected',
  resetsAt: 1_792_647_600,
  unifiedRateLimitFallbackAvailable: false,
  rateLimitType: 'five_hour',
  overageStatus: 'rejected',
  overageDisabledReason: 'org_level_disabled_until',
  upgradePaths: ['overage'],
  isUsingOverage: false,
};

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

  it('월 지출 한도(§5.5 #17-47 (H)) — 지출은 지갑이라 막힌 창은 꼬리가 말한다', () => {
    // 실측: 꼬리 `your session limit resets` → 세션 창.
    expect(matchUsageLimitNotice(SPEND_LIMIT_TEXT)).toBe('session');
    // 꼬리 규칙 고정용으로 지은 변형 — 주간 꼬리는 주간, 꼬리가 없으면 창을 특정하지 않는다.
    expect(matchUsageLimitNotice(
      "You've hit your monthly spend limit · raise it at https://claude.ai/settings/usage · your weekly limit resets Mon 3am (Asia/Seoul)",
    )).toBe('weekly');
    expect(matchUsageLimitNotice("You've hit your monthly spend limit · raise it at https://claude.ai/settings/usage")).toBe('usage');
    expect(matchUsageLimitNotice("You've hit your spending limit")).toBe('usage');
  });

  it('문장 **가운데** 인용은 통지가 아니다 — 이것이 오탐을 막는 관문이다', () => {
    expect(matchUsageLimitNotice("작업 하다가 You've hit your session limit 로 끊긴 거 표시해 줘")).toBeNull();
    expect(matchUsageLimitNotice('이렇게 You\'ve hit your monthly spend limit 로 멈췄는데 왜 주황이 아니야')).toBeNull();
    expect(matchUsageLimitNotice('세션 한도에 대해 설명하겠습니다')).toBeNull();
    expect(matchUsageLimitNotice('')).toBeNull();
  });

  it('머리 낱말은 아는 것만 받는다 — "한도" 를 말하는 다른 글로 넓히지 않는다', () => {
    expect(matchUsageLimitNotice("You've hit your GitHub API rate limit, so I paused.")).toBeNull();
    expect(matchUsageLimitNotice("You've hit your context limit")).toBeNull();
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

  it('월 지출 한도 통지는 주소를 지나 꼬리의 표기를 뗀다', () => {
    expect(parseUsageLimitResetLabel(SPEND_LIMIT_TEXT)).toBe('2:40pm (Asia/Seoul)');
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

  it('월 지출 한도 실측 줄도 한도다 — 놓치면 초록 "끝남"으로 굳는다', () => {
    const stop = detectUsageLimitStop(syntheticLine(SPEND_LIMIT_TEXT, SPEND_LIMIT_QUOTA), NOW);
    expect(stop).toEqual({
      kind: 'session',
      at: NOW,
      message: SPEND_LIMIT_TEXT,
      resetsAt: 1_792_647_600_000, // 초 → ms
      resetsLabel: '2:40pm (Asia/Seoul)',
    });
  });

  it('월 지출 한도 — 봉투 없이 합성 표식만 오는 stdout 경로에서도 알아본다', () => {
    const line = { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: SPEND_LIMIT_TEXT }] } };
    expect(detectUsageLimitStop(line, NOW)?.kind).toBe('session');
  });

  it('낱말을 몰라도 합성 표식 + quotaLimits 거절이면 한도다 — 다음 판의 문구가 또 바뀌어도', () => {
    const stop = detectUsageLimitStop(
      syntheticLine('Extra usage is used up for this month · resets Mon 3am (Asia/Seoul)', {
        status: 'rejected', resetsAt: 1_792_647_600, rateLimitType: 'seven_day',
      }),
      NOW,
    );
    expect(stop).toEqual({
      kind: 'weekly',
      at: NOW,
      message: 'Extra usage is used up for this month · resets Mon 3am (Asia/Seoul)',
      resetsAt: 1_792_647_600_000,
      resetsLabel: 'Mon 3am (Asia/Seoul)',
    });
    // 봉투가 창을 모르고 원문도 비었으면 — 창을 특정하지 않고, 원문을 지어내지 않는다.
    const bare = detectUsageLimitStop(
      { type: 'assistant', message: { model: '<synthetic>', content: [] }, quotaLimits: { status: 'rejected' } },
      NOW,
    );
    expect(bare).toEqual({ kind: 'usage', at: NOW });
  });

  it('봉투 하나만으로는 받지 않는다 — 합성 표식 없는 quotaLimits 거절', () => {
    // 초과 사용으로 계속 도는 턴: 진짜 모델의 줄에 quotaLimits 가 실려도 한도 통지가 아니다.
    const line = {
      type: 'assistant',
      message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: '추가 사용량으로 이어서 고쳤습니다.' }] },
      quotaLimits: { status: 'rejected', rateLimitType: 'five_hour', overageStatus: 'allowed', isUsingOverage: true },
    };
    expect(detectUsageLimitStop(line, NOW)).toBeNull();
  });

  it('합성 표식 하나만으로도 받지 않는다 — 한도가 아닌 합성 통지들(실측 원문)', () => {
    const notices: Array<{ text: string; envelope: Record<string, unknown> }> = [
      { text: 'No response requested.', envelope: { isApiErrorMessage: false } },
      { text: 'Failed to authenticate: OAuth session expired and could not be refreshed', envelope: { error: 'authentication_failed', isApiErrorMessage: true } },
      {
        text: 'Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access',
        envelope: { error: 'oauth_org_not_allowed', apiErrorStatus: 403, isApiErrorMessage: true },
      },
      {
        text: 'Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh.',
        envelope: { error: 'invalid_request', isApiErrorMessage: true },
      },
    ];
    for (const { text, envelope } of notices) {
      const line = { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text }] }, ...envelope };
      expect(detectUsageLimitStop(line, NOW)).toBeNull();
    }
    // 요청 단위 429(요금제 창이 아니다) — quotaLimits 가 없으면 낱말 없이 받지 않는다.
    const transient = {
      type: 'assistant',
      message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Rate limit reached' }] },
      error: 'rate_limit', apiErrorStatus: 429, isApiErrorMessage: true,
    };
    expect(detectUsageLimitStop(transient, NOW)).toBeNull();
  });

  it('**user 줄은 절대 보지 않는다** — 사용자가 그 문장을 프롬프트에 적는 일이 실제로 있다', () => {
    const line = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: "You've hit your session limit · resets 10pm (Asia/Seoul)" }] },
    };
    expect(detectUsageLimitStop(line, NOW)).toBeNull();
    // 통지 원문을 그대로 붙여 넣은 프롬프트도 user 줄이라 한도로 세지 않는다.
    const pasted = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: `${SPEND_LIMIT_TEXT}\n\n이렇게 사용 한도로 중단 되었는데 왜 주황으로 안 나오는 거야` }] },
    };
    expect(detectUsageLimitStop(pasted, NOW)).toBeNull();
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

  it('월 지출 한도 결과 본문(156자)도 그물에 걸린다 — 실측: 이 문장이 lastResult 인 세션 6개가 모두 놓쳤다', () => {
    expect(detectUsageLimitInText(SPEND_LIMIT_TEXT, NOW)).toEqual({
      kind: 'session',
      at: NOW,
      message: SPEND_LIMIT_TEXT,
      resetsLabel: '2:40pm (Asia/Seoul)',
    });
  });
});

/** §5.5 #17-47 (I) — 재료는 CLI 2.1.312 변경 기록("5-hour limit")과 공식 오류 문서(code.claude.com/docs/en/errors)의 원문. */
describe('5시간 창의 새 이름과 공식 문서의 변형들', () => {
  it('2.1.312 의 "5-hour limit" 도 세션 창이다 — 봉투 없는 결과 본문 그물까지', () => {
    expect(matchUsageLimitNotice("You've hit your 5-hour limit · resets 3:45pm")).toBe('session');
    expect(matchUsageLimitNotice("You've hit your five-hour limit · resets 3:45pm")).toBe('session');
    expect(detectUsageLimitInText("You've hit your 5-hour limit · resets 3:45pm (Asia/Seoul)", NOW))
      .toMatchObject({ kind: 'session', resetsLabel: '3:45pm (Asia/Seoul)' });
  });

  it('모델별 한도(Opus·Sonnet, 플랜의 Fable 주간)는 주간 창이다', () => {
    expect(matchUsageLimitNotice("You've hit your Opus limit · resets 3:45pm")).toBe('weekly');
    expect(matchUsageLimitNotice("You've hit your Sonnet limit · resets 3:45pm")).toBe('weekly');
    expect(matchUsageLimitNotice("You've hit your Fable limit · resets Nov 11, 12am (Asia/Seoul)")).toBe('weekly');
    expect(matchUsageLimitNotice("You've hit your Fable weekly limit · resets Mon 12:00am")).toBe('weekly');
  });

  it('주인이 붙은 지출·사용량 한도와 공유 예산 — 창은 꼬리가 말하고, 새 이름 꼬리도 읽는다', () => {
    for (const text of [
      "You've hit your individual spend limit · ask your admin for a higher limit",
      "You've hit your org's monthly spend limit · visit https://claude.ai/admin-settings/usage to raise it",
      "You've hit your team's shared budget · ask your admin to raise it at https://claude.ai/admin-settings/usage",
      "You've hit your channel's monthly spend limit · an org owner or channel manager can raise it in the channel's Claude settings",
      "You've hit your individual usage limit",
    ]) expect(matchUsageLimitNotice(text)).toBe('usage');
    expect(matchUsageLimitNotice(
      "You've hit your monthly spend limit · raise it at https://claude.ai/settings/usage · your 5-hour limit resets 2:40pm (Asia/Seoul)",
    )).toBe('session');
    expect(matchUsageLimitNotice("You've hit your org's monthly spend limit · your weekly limit resets Mon 3am")).toBe('weekly');
  });

  it('옛 머리(`… limit reached`)도 같은 낱말을 받는다 — 사용 크레딧 동의 창이 답 없이 닫힌 Fable 통지', () => {
    expect(matchUsageLimitNotice(
      'Fable limit reached · continuing on Fable 5.1 uses usage credits, and the prompt to confirm went unanswered — nothing was sent · answer it where this session is running, or /model to change',
    )).toBe('weekly');
    expect(matchUsageLimitNotice('5-hour limit reached')).toBe('session');
  });

  it('넓힌 만큼 오탐이 늘지 않는다 — 경고·동의 안내·목록 밖 낱말·인용은 통지가 아니다', () => {
    expect(matchUsageLimitNotice("You've used 85% of your 5-hour limit · resets 3:45pm")).toBeNull();
    expect(matchUsageLimitNotice('Fable 5.1 now uses usage credits · the prompt to confirm went unanswered — nothing was sent')).toBeNull();
    expect(matchUsageLimitNotice("You've hit your budget for this sprint")).toBeNull();
    expect(matchUsageLimitNotice("You've hit your rate limit on the GitHub API")).toBeNull();
    expect(matchUsageLimitNotice("You've hit your Copilot limit")).toBeNull();
    expect(matchUsageLimitNotice("이 글은 You've hit your 5-hour limit 을 인용한다")).toBeNull();
  });

  it('봉투의 모델별 주간 창(`seven_day_<모델>`)도 주간 — 창 이름은 접두로 읽는다', () => {
    expect(detectUsageLimitStop(
      syntheticLine("You've hit your Opus limit · resets 3:45pm", { status: 'rejected', rateLimitType: 'seven_day_opus', resetsAt: 1_792_647_600 }),
      NOW,
    )).toMatchObject({ kind: 'weekly', resetsAt: 1_792_647_600_000 });
    // 접두 규칙 고정용으로 지은 값 — 낱말을 몰라도 합성 + 거절이면 받고, 창은 접두가 말한다.
    expect(detectUsageLimitStop(
      syntheticLine('Something new · resets 9pm', { status: 'rejected', rateLimitType: 'five_hour_extended' }),
      NOW,
    )?.kind).toBe('session');
    expect(detectUsageLimitStop(
      syntheticLine('Something new · resets 9pm', { status: 'rejected', rateLimitType: 'overage' }),
      NOW,
    )?.kind).toBe('usage');
  });
});
