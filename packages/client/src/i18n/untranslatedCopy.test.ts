/**
 * **번역하지 못한 문장을 영어로 채워 두지 않는다 — 12개 로케일 전부.**
 *
 * `/i18n-sync` 는 **없는 키**만 채운다. 그래서 어떤 라운드에서 번역 대신 영문이 그대로 들어간 값은
 * "이미 있는 키"라 다음 동기화에서도 영영 다시 번역되지 않는다. 앱은 멀쩡히 돌고, 그 언어 사용자만
 * 한국어 화면 한가운데서 영어 툴팁을 본다(2026-09-13 실제 신고 — 태스크 엣지 관계 종류 설명 4개가
 * 12개 로케일 전부 영어였고, 같은 부류가 로케일마다 10~17개 더 있었다).
 *
 * 그래서 두 가지를 본다.
 *  1. **키가 다 있다** — en 에 있는 키는 모든 로케일에 있다(없으면 조용히 en 으로 폴백한다).
 *  2. **문장이 영어 그대로가 아니다** — en 값이 문장(영어 낱말 3개 이상 + 기능어 1개 이상)인데 로케일
 *     값이 글자까지 같으면 번역을 건너뛴 것이다. 한두 낱말짜리 라벨(`Git`·`MCP`·`Hook`)은 언어마다
 *     그대로 쓰는 게 자연스러울 수 있어 보지 않는다.
 *
 * 정말로 어느 언어에서나 영문이어야 하는 문장(명령줄 같은 것)만 `ALLOWED_COPIES` 에 이유와 함께 적는다.
 * 플러그인 카드 문자열은 각 플러그인 폴더의 `strings.ts` 가 정본이라 여기서 보지 않는다(`pluginCoverage.test.ts`).
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
