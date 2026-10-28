/**
 * §5.11 — 호스트가 연 기여 종류(`PLUGIN_SUPPORTED_CONTRIBUTIONS`)는 전부 12로케일에 칩 라벨이 있어야 한다(i18next 는 없는 키를 그대로 그리고 `pluginCoverage` 는 카드 문자열만 본다).
 * 로케일 JSON 은 plugins 패키지에서 읽는다 — 클라 빌드는 테스트까지 컴파일하는데 Node 타입이 없어 `node:fs` 를 못 쓴다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_SUPPORTED_CONTRIBUTIONS } from '@vibisual/shared';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import { PLUGIN_MANIFESTS } from './registry.js';

const LOCALE_DIR = path.resolve(__dirname, '../../client/src/i18n/locales');
const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'de', 'fr', 'es', 'es-419', 'pt-BR', 'it', 'id', 'hi'];

function labelsAt(locale: string, group: 'contribution' | 'need'): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(LOCALE_DIR, `${locale}.json`), 'utf-8');
  const json = JSON.parse(raw) as { panel?: { plugins?: Record<string, Record<string, unknown> | undefined> } };
  return json.panel?.plugins?.[group] ?? {};
}

const contributionLabels = (locale: string): Record<string, unknown> => labelsAt(locale, 'contribution');

describe('기여 칩 라벨 로케일 커버리지', () => {
  it('로케일 파일을 실제로 찾는다 — 경로가 틀리면 아래 검사가 공짜로 통과한다', () => {
    expect(Object.keys(contributionLabels('en')).length).toBeGreaterThan(5);
  });

  for (const locale of LOCALES) {
    it(`${locale} — 개통된 기여 종류 전부에 라벨이 있다`, () => {
      const labels = contributionLabels(locale);
      const missing = PLUGIN_SUPPORTED_CONTRIBUTIONS.filter((kind) => typeof labels[kind] !== 'string');
      expect(missing, `${locale} 에 라벨이 없는 기여: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('라벨이 비어 있지 않다 — 빈 문자열은 칩이 사라진 것으로 보인다', () => {
    for (const locale of LOCALES) {
      const labels = contributionLabels(locale);
      for (const kind of PLUGIN_SUPPORTED_CONTRIBUTIONS) {
        expect(String(labels[kind] ?? '').trim(), `${locale}.${kind}`).not.toBe('');
      }
    }
  });

  it('라벨이 키를 그대로 되풀이하지 않는다 — 그건 번역이 아니라 누락을 옮겨 적은 것이다', () => {
    for (const locale of LOCALES) {
      const labels = contributionLabels(locale);
      for (const kind of PLUGIN_SUPPORTED_CONTRIBUTIONS) {
        expect(String(labels[kind]), `${locale}.${kind}`).not.toContain('panel.plugins.contribution');
      }
    }
  });
});

/**
 * 데이터 축 칩 라벨 — 창의 `PluginUsage` 는 "어디에 보이나"(`contribution.*`)와 "무엇을 읽나"(`need.*`) 두 줄을 그린다. 없으면 `panel.plugins.need.<축>` 키가 그대로 뜬다.
 * 대상은 카드가 실제로 선언한 축만이다(union 전체 ❌) — 아무도 안 읽는 축은 화면에 안 뜨고, 읽기 시작하는 순간 라벨을 요구한다.
 */
describe('데이터 축 칩 라벨 로케일 커버리지', () => {
  const axes = [...new Set(PLUGIN_CLIENT_MODULES.flatMap((m) => m.needs ?? []))].sort();

  it('카드가 선언한 축을 실제로 모았다 — 비어 있으면 아래 검사가 공짜로 통과한다', () => {
    expect(axes.length).toBeGreaterThan(5);
  });

  for (const locale of LOCALES) {
    it(`${locale} — 카드가 읽는 축 전부에 라벨이 있다`, () => {
      const labels = labelsAt(locale, 'need');
      const missing = axes.filter((axis) => typeof labels[axis] !== 'string' || String(labels[axis]).trim() === '');
      expect(missing, `${locale} 에 라벨이 없는 축: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('라벨이 키를 그대로 되풀이하지 않는다', () => {
    for (const locale of LOCALES) {
      const labels = labelsAt(locale, 'need');
      for (const axis of axes) {
        expect(String(labels[axis]), `${locale}.${axis}`).not.toContain('panel.plugins.need');
      }
    }
  });
});

/**
 * 창이 그리는 나머지 라벨 — 칩만 잠그면 옆자리가 샌다.
 *  ① 등록된 카드가 쓰는 분류 전부에 머리글 라벨이 있다(`category.${m.category}` 로 조립돼 문자열 검색에 안 잡힌다).
 *  ② 창 소스가 직접 적어 부르는 키(`t('panel.plugins.…')`, 예: `scopeProject`·`scopeNone`)가 전부 12로케일에 있다.
 */
describe('창이 그리는 나머지 라벨', () => {
  const WINDOW_SOURCES = [
    path.resolve(__dirname, '../../client/src/components/Plugins/PluginsWindow.tsx'),
    path.resolve(__dirname, '../../client/src/components/Plugins/PluginUsage.tsx'),
  ];

  const lookup = (locale: string, key: string): unknown => {
    const raw = fs.readFileSync(path.join(LOCALE_DIR, `${locale}.json`), 'utf-8');
    return key.split('.').reduce<unknown>(
      (node, seg) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[seg] : undefined),
      JSON.parse(raw) as unknown,
    );
  };

  const categories = [...new Set(PLUGIN_MANIFESTS.map((m) => m.category))].sort();

  it('카드가 쓰는 분류를 실제로 모았다', () => {
    expect(categories.length).toBeGreaterThan(1);
  });

  for (const locale of LOCALES) {
    it(`${locale} — 분류 머리글이 전부 있다`, () => {
      const labels = labelsAt(locale, 'category');
      const missing = categories.filter((c) => typeof labels[c] !== 'string' || String(labels[c]).trim() === '');
      expect(missing, `${locale} 에 없는 분류: ${missing.join(', ')}`).toEqual([]);
    });
  }

  /** 창 소스가 리터럴로 적어 부르는 키. 조립되는 키(`${...}`)는 위 검사들이 따로 본다. */
  const literalKeys = [...new Set(
    WINDOW_SOURCES.flatMap((file) =>
      [...fs.readFileSync(file, 'utf-8').matchAll(/t\('panel\.plugins\.([A-Za-z0-9_.]+)'/g)].map((m) => m[1] ?? ''),
    ),
  )].filter(Boolean).sort();

  it('창 소스에서 키를 실제로 뽑았다 — 경로가 어긋나면 아래 검사가 공짜로 통과한다', () => {
    expect(literalKeys.length).toBeGreaterThan(10);
  });

  for (const locale of LOCALES) {
    it(`${locale} — 창이 직접 부르는 키가 전부 있다`, () => {
      const missing = literalKeys.filter((k) => {
        const v = lookup(locale, `panel.plugins.${k}`);
        return typeof v !== 'string' || v.trim() === '';
      });
      expect(missing, `${locale} 에 없는 키: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
