/**
 * **번역 못 한 문장을 영어로 채워 두지 않는다 — 12개 로케일 전부**(`/i18n-sync` 는 없는 키만 채워 영문 값은 영영 다시 번역되지 않는다).
 * ① 키가 다 있다 ② 문장(영어 낱말 3개↑ + 기능어 1개↑)이 en 과 같지 않다. 어디서나 영문이어야 하는 문장만 `ALLOWED_COPIES` 에 이유와 함께.
 */
import { describe, it, expect } from 'vitest';
import { SUPPORTED_UI_LOCALES } from '@vibisual/shared';

type Dict = Record<string, unknown>;

const localeSources = import.meta.glob('./locales/*.json', { eager: true });

function flatten(node: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node as Dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

function localeFlat(loc: string): Record<string, string> {
  const mod = localeSources[`./locales/${loc}.json`] as { default?: Dict } | undefined;
  if (!mod) throw new Error(`로케일 파일이 없다: ${loc}.json`);
  return flatten(mod.default ?? mod);
}

/** 어느 언어에서나 영문 그대로가 맞는 문장. 늘릴 때는 이유를 한 줄로 남긴다. */
const ALLOWED_COPIES: Readonly<Record<string, string>> = {
  'panel.gitStatus.commitTitleDirty': '실제로 실행되는 git 명령줄을 그대로 보여 준다',
};

const FUNCTION_WORDS = new Set(
  ('the a an to of is are and or for this that with in on at by from be it its you your when click not no can will was has have if '
    + 'as into only use used before after then than so do does what which who how all any each more').split(' '),
);

/** 번역해야 할 영어 문장인가 — 변수·코드·주소·경로를 걷어낸 뒤 낱말 수와 기능어로 본다. */
function isEnglishSentence(text: string): boolean {
  const stripped = text
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[A-Za-z]:?[\\/]\S*/g, ' ');
  const words = stripped.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  const functionWords = words.filter((w) => FUNCTION_WORDS.has(w.toLowerCase())).length;
  return words.length >= 3 && functionWords >= 1;
}

const EN = localeFlat('en');
const SENTENCE_KEYS = Object.keys(EN).filter((k) => !(k in ALLOWED_COPIES) && isEnglishSentence(EN[k]!));

describe('영어 복사본 금지', () => {
  it('판정이 실제로 문장을 잡는다 — 비면 나머지 검사가 공짜로 통과한다', () => {
    expect(isEnglishSentence('Hands over the result itself — the file or diff')).toBe(true);
    expect(isEnglishSentence('Critique / review — audit and red-team role (the watcher)')).toBe(true);
    expect(isEnglishSentence('Web search')).toBe(false);
    expect(isEnglishSentence('{{current}} / {{total}}')).toBe(false);
    expect(SENTENCE_KEYS.length).toBeGreaterThan(1000);
  });

  it('허용 목록의 키가 en 에 실제로 있다 — 지워진 키가 면제로 남지 않는다', () => {
    expect(Object.keys(ALLOWED_COPIES).filter((k) => typeof EN[k] !== 'string')).toEqual([]);
  });

  for (const loc of SUPPORTED_UI_LOCALES) {
    if (loc === 'en') continue;

    it(`${loc} — en 의 키가 전부 있다`, () => {
      const dict = localeFlat(loc);
      const missing = Object.keys(EN).filter((k) => typeof dict[k] !== 'string');
      expect(missing.slice(0, 10), `${loc} 에 없는 키 (총 ${missing.length}개) — /i18n-sync 를 돌릴 것`).toEqual([]);
    });

    it(`${loc} — 문장이 영어 그대로 복사돼 있지 않다`, () => {
      const dict = localeFlat(loc);
      const copied = SENTENCE_KEYS
        .filter((k) => dict[k] === EN[k])
        .map((k) => `${k}: ${JSON.stringify(EN[k])}`);
      expect(copied.slice(0, 10), `${loc} 에 번역 없이 영어가 들어간 문장 (총 ${copied.length}개)`).toEqual([]);
    });
  }
});
