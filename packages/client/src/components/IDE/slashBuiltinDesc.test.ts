/**
 * §5.5 #17-2 (보강) — 내장 명령 설명을 고르는 규칙.
 *
 * 번역은 en 사본이 정본과 글자까지 같을 때만 쓴다. 어긋나면(정본 문장이 바뀌었는데 번역이 옛 문장이면)
 * 정본 영어를 보인다 — 틀린 설명보다 영어 설명이 낫다.
 */
import { describe, it, expect } from 'vitest';
import { builtinSlashDescription, slashBuiltinDescKey, SLASH_BUILTIN_DESC_PREFIX } from './slashBuiltinDesc.js';

const CANONICAL = 'Free up context by summarizing the conversation so far';
const KO = '지금까지의 대화를 요약해 컨텍스트를 비웁니다';

function lookup(enCopy: unknown, translated: string): Parameters<typeof builtinSlashDescription>[2] {
  return {
    enCopy: (key) => (key === slashBuiltinDescKey('compact') ? enCopy : undefined),
    translate: (key) => (key === slashBuiltinDescKey('compact') ? translated : key),
  };
}

describe('builtinSlashDescription', () => {
  it('키는 명령 이름 하나를 접두사 아래에 둔다', () => {
    expect(slashBuiltinDescKey('add-dir')).toBe(`${SLASH_BUILTIN_DESC_PREFIX}.add-dir`);
  });

  it('en 사본이 정본과 같으면 번역을 쓴다', () => {
    expect(builtinSlashDescription('compact', CANONICAL, lookup(CANONICAL, KO))).toBe(KO);
  });

  it('en 사본이 정본과 다르면(정본이 바뀌었다) 번역 대신 정본을 쓴다', () => {
    const stale = 'Clear conversation history but keep a summary in context';
    expect(builtinSlashDescription('compact', CANONICAL, lookup(stale, KO))).toBe(CANONICAL);
  });

  it('번역 키가 없는 명령(새로 생긴 명령)은 정본을 쓴다', () => {
    expect(builtinSlashDescription('compact', CANONICAL, lookup(undefined, KO))).toBe(CANONICAL);
  });

  it('번역이 비어 있으면 정본을 쓴다', () => {
    expect(builtinSlashDescription('compact', CANONICAL, lookup(CANONICAL, ''))).toBe(CANONICAL);
  });
});
