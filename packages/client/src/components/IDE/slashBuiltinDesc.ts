/**
 * §5.5 #17-2 (보강) — 슬래시 드롭다운의 **내장 명령 설명**을 그 사람의 말로.
 *
 * `/이름` 은 영문 그대로 두고(사용자가 치는 글자이므로) 설명만 로케일을 따른다. 정본은 여전히
 * `BUILTIN_SLASH_COMMANDS` 이고, 서버가 그 값을 그대로 실어 보낸다.
 *
 * 번역은 **en.json 의 사본이 정본과 글자까지 같을 때만** 쓴다. 정본 문장이 바뀌었는데 번역이 그대로면
 * 옛 설명이 새 동작에 붙는다 — 영어 사용자는 새 문장을, 다른 언어 사용자는 옛 문장을 보게 된다.
 * 그때는 번역 대신 정본 영어를 보인다(틀린 설명보다 영어 설명이 낫다). 사본과 정본의 일치는
 * `i18n/slashBuiltinDescCoverage.test.ts` 가 빌드에서 확인한다.
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
