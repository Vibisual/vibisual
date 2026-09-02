import { describe, it, expect } from 'vitest';
import { formatPromptStamp, calendarDayDiff } from './promptStamp.js';

/**
 * 내 명령 말풍선의 "언제 보냈나" 표기.
 *
 * 로케일 문자열 자체(`9월`·`Sep`)는 ICU 판본에 따라 흔들릴 수 있어, **분기가 제대로 갈렸는가**를
 * 본다 — 오늘/어제/날짜 세 갈래 · 달력 경계 · 대기 꼬리 표식 차단 · 이상한 로케일에서 안 죽는가.
 */

/** 로컬 시각으로 짓는다 — 판정이 자정(로컬) 기준이라 TZ 가 달라도 답이 같아야 한다. */
function local(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number {
  return new Date(y, m - 1, d, hh, mm, ss).getTime();
}

const NOW = local(2026, 9, 2, 15, 0, 0); // 2026-09-02 (수) 15:00

describe('formatPromptStamp — 갈래', () => {
  it('오늘은 "오늘 HH:MM" 으로, 날짜는 접는다', () => {
    const s = formatPromptStamp(local(2026, 9, 2, 14, 32, 7), 'ko', NOW);
    expect(s).not.toBeNull();
    expect(s?.text).toContain('오늘');
    expect(s?.text).toContain('14:32');
    // 오늘 것에 연도가 붙으면 짧은 표기가 아니다 — 접은 값은 툴팁에만 있어야 한다.
    expect(s?.text).not.toContain('2026');
    expect(s?.title).toContain('2026');
    expect(s?.aged).toBe(false);
  });

  it('어제는 "어제 HH:MM"', () => {
    const s = formatPromptStamp(local(2026, 9, 1, 9, 7, 0), 'ko', NOW);
    expect(s?.text).toContain('어제');
    expect(s?.text).toContain('09:07');
    expect(s?.aged).toBe(true);
  });

  it('올해의 다른 날은 월·일을 적고, 연도는 접는다', () => {
    const s = formatPromptStamp(local(2026, 8, 30, 20, 5, 0), 'ko', NOW);
    expect(s?.text).not.toContain('오늘');
    expect(s?.text).not.toContain('어제');
    expect(s?.text).toContain('20:05');
    expect(s?.text).toContain('8');   // 8월
    expect(s?.text).toContain('30');
    expect(s?.text).not.toContain('2026');
    expect(s?.aged).toBe(true);
  });

  it('해가 다르면 연도까지 적는다', () => {
    const s = formatPromptStamp(local(2024, 12, 31, 23, 10, 0), 'ko', NOW);
    expect(s?.text).toContain('2024');
    expect(s?.text).toContain('23:10');
    expect(s?.aged).toBe(true);
  });

  it('시계가 앞선(미래) 값도 날짜를 적는다 — 오늘/어제로 새지 않는다', () => {
    const s = formatPromptStamp(local(2026, 9, 5, 8, 0, 0), 'ko', NOW);
    expect(s?.text).not.toContain('오늘');
    expect(s?.text).not.toContain('어제');
    expect(s?.aged).toBe(true);
  });
});

describe('formatPromptStamp — 하루는 달력으로 센다', () => {
  it('23:59 → 00:01 은 2분 차이지만 "어제"다', () => {
    const s = formatPromptStamp(local(2026, 9, 1, 23, 59, 0), 'ko', local(2026, 9, 2, 0, 1, 0));
    expect(s?.text).toContain('어제');
  });

  it('같은 날 00:01 과 23:59 는 둘 다 "오늘"이다 (24시간 가까이 벌어져도)', () => {
    const now = local(2026, 9, 2, 23, 59, 0);
    expect(formatPromptStamp(local(2026, 9, 2, 0, 1, 0), 'ko', now)?.text).toContain('오늘');
    expect(formatPromptStamp(now, 'ko', now)?.text).toContain('오늘');
  });

  it('calendarDayDiff 는 자정 기준 날짜 차를 돌려준다', () => {
    expect(calendarDayDiff(new Date(local(2026, 9, 2, 23, 59)), new Date(local(2026, 9, 2, 0, 1)))).toBe(0);
    expect(calendarDayDiff(new Date(local(2026, 9, 1, 23, 59)), new Date(local(2026, 9, 2, 0, 1)))).toBe(1);
    expect(calendarDayDiff(new Date(local(2026, 8, 26, 12, 0)), new Date(local(2026, 9, 2, 12, 0)))).toBe(7);
  });
});

describe('formatPromptStamp — 시각으로 못 읽는 값', () => {
  it('대기 중 명령의 꼬리 표식(MAX_SAFE_INTEGER)은 표기하지 않는다', () => {
    // PENDING_COMMAND_TS — 그대로 찍으면 "서기 275760년" 이 된다.
    expect(formatPromptStamp(Number.MAX_SAFE_INTEGER, 'ko', NOW)).toBeNull();
  });

  it('없음·0·NaN·Infinity 는 전부 null', () => {
    expect(formatPromptStamp(undefined, 'ko', NOW)).toBeNull();
    expect(formatPromptStamp(0, 'ko', NOW)).toBeNull();
    expect(formatPromptStamp(Number.NaN, 'ko', NOW)).toBeNull();
    expect(formatPromptStamp(Number.POSITIVE_INFINITY, 'ko', NOW)).toBeNull();
    expect(formatPromptStamp(-1, 'ko', NOW)).toBeNull();
  });
});

describe('formatPromptStamp — 로케일', () => {
  it('영어에서는 today / yesterday 가 나온다', () => {
    expect(formatPromptStamp(local(2026, 9, 2, 14, 32), 'en', NOW)?.text).toMatch(/today/i);
    expect(formatPromptStamp(local(2026, 9, 1, 14, 32), 'en', NOW)?.text).toMatch(/yesterday/i);
  });

  it('시각은 어느 로케일에서나 24시간제 HH:MM 이다', () => {
    for (const loc of ['ko', 'en', 'ja', 'de', 'pt-BR', 'zh-CN']) {
      expect(formatPromptStamp(local(2026, 9, 2, 21, 5), loc, NOW)?.text).toContain('21:05');
      // 자정을 24:00 으로 찍는 옛 hour12:false 동작이 아니어야 한다.
      expect(formatPromptStamp(local(2026, 9, 2, 0, 0), loc, NOW)?.text).toContain('00:00');
    }
  });

  it('알아들을 수 없는 로케일 태그에도 던지지 않는다', () => {
    expect(() => formatPromptStamp(local(2026, 9, 2, 14, 32), '!!!not-a-locale', NOW)).not.toThrow();
    expect(formatPromptStamp(local(2026, 9, 2, 14, 32), '!!!not-a-locale', NOW)).not.toBeNull();
    expect(formatPromptStamp(local(2026, 9, 2, 14, 32), '', NOW)).not.toBeNull();
  });
});

describe('formatPromptStamp — 기계 판독용 값', () => {
  it('iso 는 그 시각의 ISO 표기다', () => {
    const at = local(2026, 9, 2, 14, 32, 7);
    expect(formatPromptStamp(at, 'ko', NOW)?.iso).toBe(new Date(at).toISOString());
  });
});
