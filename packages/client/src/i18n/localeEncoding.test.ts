/**
 * **글자가 물음표로 뭉개진 번역이 없다 — 12개 로케일 전부.**
 *
 * 스킬 공유의 "파일 수·크기 한도" 안내(`ide.skillSharing.issues.skill-too-large`)가 여덟 로케일에서
 * 비ASCII 글자마다 `?` 로 바뀐 채 저장돼 있었다(2026-09-29 QA — 한국어 화면에 `??? ?? ? ?? ...` 가 떴다,
 * 독일어는 `?berschreitet`·`Gr??e`). 키는 다 있고 값도 비어 있지 않아 `untranslatedCopy.test.ts` 의
 * 구조 검사가 모두 통과했다 — 뭉개진 글자 자체를 봐야 잡힌다.
 *
 * 두 모양을 본다.
 *  1. 물음표가 셋 이상 잇달아 선다 — CJK·데바나가리처럼 글자 전부가 비ASCII 인 언어가 뭉개진 모양.
 *  2. 물음표가 글자 둘 사이에 끼어 있다 — 라틴 문자 언어에서 악센트 글자 하나만 뭉개진 모양
 *     (`n?mero`). 문장 끝의 물음표·`¿Qué?` 는 글자 사이가 아니라 걸리지 않는다.
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

const MANGLED = [/\?{3,}/, /\p{L}\?\p{L}/u];

describe('locale encoding', () => {
  it.each(SUPPORTED_UI_LOCALES.map((l) => [l]))('%s has no values mangled into question marks', (loc) => {
    const mangled = Object.entries(localeFlat(loc))
      .filter(([, value]) => MANGLED.some((re) => re.test(value)))
      .map(([key, value]) => `${key} = ${value}`);
    expect(mangled).toEqual([]);
  });

  it('catches both mangled shapes and leaves real questions alone', () => {
    const hit = (s: string): boolean => MANGLED.some((re) => re.test(s));
    expect(hit('??? ?? ? ?? ??? ?? ??? ?????.')).toBe(true);
    expect(hit('La habilidad supera el n?mero de archivos.')).toBe(true);
    expect(hit('Discard your edits?')).toBe(false);
    expect(hit('¿Descartar los cambios? Se perderán.')).toBe(false);
    expect(hit('편집을 버릴까요?')).toBe(false);
  });
});
