/**
 * §5.5 #17-2 (보강) — **슬래시 드롭다운의 내장 명령 설명이 12개 언어에 다 있고, 정본과 어긋나지 않는다.**
 *
 * 설명의 정본은 `BUILTIN_SLASH_COMMANDS`(shared)다. 화면은 `ide.mainArea.slashBuiltinDesc.<이름>` 번역을
 * 쓰되, en.json 의 사본이 정본과 **글자까지 같을 때만** 쓴다(`components/IDE/slashBuiltinDesc.ts`).
 * 그래서 이 표가 어긋나도 앱은 멀쩡히 돈다 — 명령 목록을 고친 사람이 en 사본을 잊으면 그 명령의 설명만
 * 12개 언어에서 한꺼번에 영어로 돌아가고, 아무도 모른다. 그 자리를 여기서 잡는다.
 *
 * 명령 목록을 고쳤으면: en.json 의 사본을 같은 글자로 고치고(추가·삭제 포함) `/i18n-sync` 를 돌린다.
 * 문장이 바뀐 명령은 로케일의 옛 번역도 지우고 다시 번역해야 한다 — 사본만 고치면 옛 번역이 새 문장 행세를 한다.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_SLASH_COMMANDS, SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import i18n from './index.js';
import { builtinSlashDescription } from '../components/IDE/slashBuiltinDesc.js';

type Dict = Record<string, unknown>;

const localeSources = import.meta.glob('./locales/*.json', { eager: true });

function localeDict(loc: string): Dict {
  const mod = localeSources[`./locales/${loc}.json`] as { default?: Dict } | undefined;
  if (!mod) throw new Error(`로케일 파일이 없다: ${loc}.json`);
  return (mod.default ?? mod) as Dict;
}

function descriptions(loc: string): Record<string, unknown> {
  const ide = localeDict(loc).ide as Dict | undefined;
  const mainArea = ide?.mainArea as Dict | undefined;
  return (mainArea?.slashBuiltinDesc ?? {}) as Record<string, unknown>;
}

const EN = descriptions('en');
const NAMES = BUILTIN_SLASH_COMMANDS.map((c) => c.name);

describe('내장 명령 설명 — en 사본이 정본과 한 벌', () => {
  it('정본 목록이 실제로 있다 — 비면 나머지 검사가 공짜로 통과한다', () => {
    expect(NAMES.length).toBeGreaterThan(50);
  });

  it('명령 이름에 키 구분자(. :)가 없다 — 있으면 번역 키가 중간에서 쪼개진다', () => {
    expect(NAMES.filter((n) => /[.:]/.test(n))).toEqual([]);
  });

  it('모든 명령의 en 사본이 정본과 글자까지 같다', () => {
    const drift = BUILTIN_SLASH_COMMANDS
      .filter((c) => EN[c.name] !== c.description)
      .map((c) => `${c.name}: 정본 ${JSON.stringify(c.description)} / en ${JSON.stringify(EN[c.name])}`);
    expect(drift.slice(0, 5), `en 사본이 정본과 어긋난 명령 (총 ${drift.length}개)`).toEqual([]);
  });

  it('없어진 명령의 설명이 남아 있지 않다', () => {
    const known = new Set(NAMES);
    expect(Object.keys(EN).filter((k) => !known.has(k))).toEqual([]);
  });
});

describe('내장 명령 설명 — 로케일 전부 번역', () => {
  for (const loc of SUPPORTED_UI_LOCALES) {
    if (loc === 'en') continue;
    it(`${loc} — 모든 명령에 번역이 있고 영어 복사본이 아니다`, () => {
      const dict = descriptions(loc);
      const missing = NAMES.filter((n) => typeof dict[n] !== 'string' || (dict[n] as string).trim() === '');
      expect(missing.slice(0, 5), `${loc} 에 설명이 없는 명령 (총 ${missing.length}개)`).toEqual([]);
      const copied = NAMES.filter((n) => dict[n] === EN[n]);
      expect(copied.slice(0, 5), `${loc} 에 영어가 그대로 복사된 설명 (총 ${copied.length}개)`).toEqual([]);
      const known = new Set(NAMES);
      expect(Object.keys(dict).filter((k) => !known.has(k))).toEqual([]);
    });

    it(`${loc} — 화면이 쓰는 경로로 조회해도 그 언어의 설명이 나온다`, () => {
      // 하이픈이 든 이름(add-dir 등)도 i18next 가 한 키로 읽는지 — 실제 조회 경로로 확인한다.
      const t = i18n.getFixedT(loc);
      const dict = descriptions(loc);
      const wrong = BUILTIN_SLASH_COMMANDS
        .filter((c) => builtinSlashDescription(c.name, c.description, {
          enCopy: (key) => i18n.getResource('en', 'translation', key),
          translate: (key) => t(key),
        }) !== dict[c.name])
        .map((c) => c.name);
      expect(wrong.slice(0, 5), `${loc} 에서 번역 대신 다른 값이 나온 명령 (총 ${wrong.length}개)`).toEqual([]);
    });
  }
});
