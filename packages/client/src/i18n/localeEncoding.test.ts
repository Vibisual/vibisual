/** **물음표로 뭉개진 번역이 없다 — 12개 로케일 전부**(구조 검사로는 안 잡힌다). ① 물음표 셋 이상 잇달아(CJK·데바나가리) ② 글자 둘 사이 물음표(`n?mero`). 문장 끝 물음표·`¿Qué?` 는 걸리지 않는다. */
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
