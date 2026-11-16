import { describe, it, expect } from 'vitest';
import { SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import { VIDEO_FORMAT_IDS } from '@vibisual/video';

import { recordedContext } from '../components/VideoStudio/studioCommandFixtures.js';
import { STUDIO_COMMANDS } from '../components/VideoStudio/studioCommands.js';
import type { StudioPaletteState } from '../components/VideoStudio/studioCommandTypes.js';
import { PALETTE_GROUP_ORDER } from '../components/VideoStudio/studioPaletteModel.js';
import en from './locales/en.json';

/**
 * §5.13 37-22 (I) — **등록부와 번역이 한 벌인가.** 팔레트는 명령의 이름·설명·묶음을 번역 키로 그린다 — 한 로케일에서라도 빠지면 그 줄에 키가
 * 날것으로 뜬다. 명령을 표에 한 줄 더했는데 문구를 안 넣은 경우를 여기서 잡는다.
 */

type Dict = Record<string, unknown>;

const localeSources = import.meta.glob('./locales/*.json', { eager: true });

function localeDict(loc: string): Dict {
  const mod = localeSources[`./locales/${loc}.json`] as { default?: Dict } | undefined;
  if (!mod) throw new Error(`로케일 파일이 없다: ${loc}.json`);
  return (mod.default ?? mod) as Dict;
}

const read = (bundle: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Dict)[key] : undefined), bundle);

const P = 'panel.videoStudio';
const PALETTE = `${P}.palette`;

/** 상태에 따라 이름이 바뀌는 명령이 있어, 이름이 갈리는 상태를 다 돌려 본다. */
const NAME_STATES: ReadonlyArray<Partial<StudioPaletteState>> = [{}, { playing: true }, { muted: true }, { zoom: 'actual' }, { aiCollapsed: true }];

function commandKeys(): string[] {
  const keys = new Set<string>();
  for (const command of STUDIO_COMMANDS) {
    keys.add(command.detail);
    if (typeof command.name === 'string') keys.add(command.name);
    else for (const state of NAME_STATES) keys.add(command.name(recordedContext([], {}, state)));
  }
  return [...keys];
}

/** 판이 직접 그리는 문구(`StudioPalette.tsx` · `StudioPaletteRow.tsx`)와 2단계 목록의 이름. */
const PANEL_KEYS = [
  ...['title', 'placeholder', 'back', 'current', 'on', 'empty', 'nothing', 'footer'].map((k) => `${PALETTE}.${k}`),
  ...PALETTE_GROUP_ORDER.map((g) => `${PALETTE}.group.${g}`),
  `${P}.header.recent`,
  ...VIDEO_FORMAT_IDS.flatMap((id) => [`${P}.formats.${id}`, `${P}.export.preset_${id}`]),
];

const ALL_KEYS = [...new Set([...commandKeys(), ...PANEL_KEYS])];

const leaves = (node: unknown): string[] => Object.keys((node ?? {}) as Dict);
const varsOf = (text: string): string[] => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1] as string).sort();

/** 번역문에 남아 있으면 안 되는 키 이름 — 표기는 `shortcutLabel()` 이 플랫폼에 맞춰 넣는다. */
const KEY_NAME = /Ctrl|Strg|Cmd|⌘|\bEsc\b/;

describe('명령 팔레트 — 등록부 ↔ 번역', () => {
  it('키 목록이 실제로 모였다 — 비면 아래 검사가 공짜로 통과한다', () => {
    expect(commandKeys().length).toBeGreaterThan(60);
    expect(ALL_KEYS.filter((k) => k.startsWith(`${PALETTE}.`)).length).toBeGreaterThan(50);
  });

  it('en 의 설명·이름·묶음에 아무 명령도 쓰지 않는 죽은 문구가 없다', () => {
    const used = new Set(ALL_KEYS);
    const dead = ['detail', 'name', 'group'].flatMap((branch) => leaves(read(en, `${PALETTE}.${branch}`))
      .map((leaf) => `${PALETTE}.${branch}.${leaf}`).filter((key) => !used.has(key)));
    expect(dead).toEqual([]);
  });

  it('en 의 팔레트 문구는 전부 판이나 등록부가 쓴다', () => {
    const used = new Set(ALL_KEYS);
    const top = leaves(read(en, PALETTE)).filter((k) => !['detail', 'name', 'group'].includes(k)).map((k) => `${PALETTE}.${k}`);
    expect(top.filter((key) => !used.has(key))).toEqual([]);
  });

  for (const loc of SUPPORTED_UI_LOCALES) {
    it(`${loc} — 명령의 이름·설명·묶음과 판 문구가 다 있다`, () => {
      const bundle = localeDict(loc);
      const missing = ALL_KEYS.filter((key) => { const v = read(bundle, key); return typeof v !== 'string' || v.trim() === ''; });
      expect(missing).toEqual([]);
    });

    it(`${loc} — 팔레트 문구가 en 과 같은 보간 변수를 갖고 키 이름을 박지 않는다`, () => {
      const bundle = localeDict(loc);
      const problems = ALL_KEYS.filter((k) => k.startsWith(`${PALETTE}.`)).flatMap((key) => {
        const text = read(bundle, key);
        const source = read(en, key);
        if (typeof text !== 'string' || typeof source !== 'string') return [];
        return [
          ...(varsOf(text).join() !== varsOf(source).join() ? [`${key}: 변수가 다르다 — ${text}`] : []),
          ...(KEY_NAME.test(text) ? [`${key}: 키 이름이 박혀 있다 — ${text}`] : []),
        ];
      });
      expect(problems).toEqual([]);
    });
  }
});
