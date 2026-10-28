/**
 * §5.5 #17-2 (보강) — 내장 명령 설명을 로케일로(`/이름` 은 영문 그대로, 정본은 서버가 싣는 `BUILTIN_SLASH_COMMANDS`).
 * 번역은 en.json 사본이 정본과 글자까지 같을 때만 — 다르면 정본 영어(옛 설명이 새 동작에 붙지 않게, `i18n/slashBuiltinDescCoverage.test.ts`).
 */

export const SLASH_BUILTIN_DESC_PREFIX = 'ide.mainArea.slashBuiltinDesc';

export function slashBuiltinDescKey(name: string): string {
  return `${SLASH_BUILTIN_DESC_PREFIX}.${name}`;
}

export interface SlashBuiltinDescLookup {
  /** en 번역본에 적힌 사본 — 폴백 없이 읽는다. 키가 없으면 `undefined`. */
  enCopy: (key: string) => unknown;
  /** 지금 언어의 번역. */
  translate: (key: string) => string;
}

export function builtinSlashDescription(name: string, canonical: string, lookup: SlashBuiltinDescLookup): string {
  const key = slashBuiltinDescKey(name);
  if (lookup.enCopy(key) !== canonical) return canonical;
  const localized = lookup.translate(key);
  return localized || canonical;
}
