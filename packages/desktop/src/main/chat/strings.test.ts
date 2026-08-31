import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_LOCALE, SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import { chatStrings, fmt } from './strings';
import type { ChatStrings } from './strings';

// §4 메신저 브리지 — 봇이 폰에서 하는 말.
// 모달만 12개 로케일이고 카드가 한 언어면 그 사용자에게는 기능 전체가 읽을 수 없는 것이 된다.

const KEYS = Object.keys(chatStrings('en')) as (keyof ChatStrings)[];

describe('chatStrings — 12개 로케일이 같은 모양이어야 한다', () => {
  it('지원 로케일 전부에 한 벌씩 있다', () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      expect(chatStrings(locale), locale).toBeTruthy();
    }
  });

  it('어느 로케일에도 빠진 키·빈 값이 없다', () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      const table = chatStrings(locale);
      for (const key of KEYS) {
        expect(typeof table[key], `${locale}.${key}`).toBe('string');
        expect(table[key].trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('자리표시자가 있는 문장은 어느 로케일에서도 같은 자리표시자를 갖는다', () => {
    // 번역하다 `{seconds}` 를 잃으면 그 언어에서만 문장이 조용히 뜻을 잃는다.
    const marks = (v: string): string[] => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
    const en = chatStrings('en');
    for (const locale of SUPPORTED_UI_LOCALES) {
      const table = chatStrings(locale);
      for (const key of KEYS) {
        expect(marks(table[key]), `${locale}.${key}`).toEqual(marks(en[key]));
      }
    }
  });

  it('슬래시 명령 이름은 번역되지 않는다 — 그 글자를 그대로 쳐야 동작한다', () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      const table = chatStrings(locale);
      expect(table.helpAgents, locale).toContain('/agents');
      expect(table.helpStatus, locale).toContain('/status');
      expect(table.helpLog, locale).toContain('/log');
      expect(table.helpStop, locale).toContain('/stop');
      expect(table.helpUnpair, locale).toContain('/unpair');
    }
  });

  it('이모지를 쓰지 않는다(메신저마다 모양이 달라진다)', () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      const table = chatStrings(locale);
      for (const key of KEYS) {
        expect(table[key], `${locale}.${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it('모르는 언어·빈 값은 기본 로케일로 떨어진다 — 침묵보다 영어가 낫다', () => {
    const fallback = chatStrings(DEFAULT_UI_LOCALE);
    expect(chatStrings(undefined)).toBe(fallback);
    expect(chatStrings(null)).toBe(fallback);
    expect(chatStrings('')).toBe(fallback);
    expect(chatStrings('kl-GL')).toBe(fallback);
  });

  it('언어가 다르면 실제로 다른 문장이다(복사만 해 둔 것이 아니다)', () => {
    const seen = new Set(SUPPORTED_UI_LOCALES.map((l) => chatStrings(l).titlePermission));
    // es 와 es-419 는 이 키를 공유하므로 12 가 아니라 11 이 상한이다.
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});

describe('fmt', () => {
  it('자리표시자를 채운다', () => {
    expect(fmt('{a} 와 {b}', { a: '하나', b: 2 })).toBe('하나 와 2');
  });

  it('같은 자리표시자가 여러 번 나와도 전부 채운다', () => {
    expect(fmt('{x}-{x}', { x: 7 })).toBe('7-7');
  });

  it('값이 없는 자리표시자는 지우지 않고 남긴다 — 어느 키가 빠졌는지 보이게', () => {
    expect(fmt('{a} {b}', { a: '1' })).toBe('1 {b}');
  });

  it('자리표시자가 없으면 원문 그대로', () => {
    expect(fmt('그냥 문장', { a: 1 })).toBe('그냥 문장');
  });

  it('0 과 빈 문자열도 값으로 친다', () => {
    expect(fmt('{n}개', { n: 0 })).toBe('0개');
    expect(fmt('[{s}]', { s: '' })).toBe('[]');
  });
});
