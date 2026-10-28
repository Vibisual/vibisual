/**
 * §5.11 — `PluginUsage`("켜면 뭘 보게 되나") 계약. `module.usage` 는 선택 필드라 빠져도 타입·창이 멀쩡하고 그 줄만 조용히 사라진다.
 * ① 모든 카드가 `usage` 를 갖는다 ② `checkKeys` 가 en 에 실재한다(새 문자열 ❌) ③ `i18nKey` 지붕 = 매니페스트 `descriptionKey`(갈리면 설명과 행이 다른 카드를 가리킨다).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import { pluginLocaleResources } from './locales.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';

/** 화면과 같은 트리 — 로케일 파일 + 플러그인 폴더 `strings.ts` 를 호스트와 같은 함수로 합친다(한쪽만 보면 카드 키가 통째로 '없는 키'). */
const BASE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../client/src/i18n/locales/en.json'), 'utf8'),
) as Record<string, unknown>;
const BASE_PANEL = (BASE.panel ?? {}) as Record<string, unknown>;
const EN: Record<string, unknown> = {
  ...BASE,
  panel: {
    ...BASE_PANEL,
    plugins: { ...(BASE_PANEL.plugins as Record<string, unknown>), ...pluginLocaleResources('en') },
  },
};

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((node, seg) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[seg];
    return undefined;
  }, EN);
}

describe('플러그인 사용 정보(usage) 계약', () => {
  it('모든 카드가 usage 를 갖는다 — 없으면 창의 "무엇을 보여 주나"가 통째로 빈다', () => {
    expect(PLUGIN_CLIENT_MODULES.filter((m) => !m.usage).map((m) => m.manifest.id)).toEqual([]);
  });

  it('usage 의 지붕이 매니페스트 설명 키와 같은 카드를 가리킨다', () => {
    const mismatched = PLUGIN_CLIENT_MODULES.filter(
      (m) => m.usage && m.manifest.descriptionKey !== `panel.plugins.${m.usage.i18nKey}.desc`,
    ).map((m) => `${m.manifest.id}: ${m.manifest.descriptionKey} ≠ ${m.usage?.i18nKey}`);
    expect(mismatched).toEqual([]);
  });

  it('행 키가 en 에 실재한다 — 없으면 창에 키 문자열이 그대로 뜬다', () => {
    const missing: string[] = [];
    for (const mod of PLUGIN_CLIENT_MODULES) {
      for (const key of mod.usage?.checkKeys ?? []) {
        const full = `panel.plugins.${mod.usage?.i18nKey}.${key}`;
        if (typeof lookup(full) !== 'string') missing.push(full);
      }
    }
    expect(missing).toEqual([]);
  });

  it('패널 카드는 행을 하나 이상 선언한다 — 헤더 기여만 있는 카드는 예외', () => {
    const empty = PLUGIN_CLIENT_MODULES.filter(
      (m) => (m.panelSections?.length ?? 0) > 0 && (m.usage?.checkKeys.length ?? 0) === 0,
    ).map((m) => m.manifest.id);
    expect(empty).toEqual([]);
  });

  it('배지가 없는 카드는 "문제일 때만 뜬다"고 말하지 않는다', () => {
    const lying = PLUGIN_CLIENT_MODULES.filter(
      (m) => m.usage?.badgeIsConditional && (m.bubbleBadges?.length ?? 0) === 0,
    ).map((m) => m.manifest.id);
    expect(lying).toEqual([]);
  });
});

/**
 * **약속한 행 ↔ 실제로 그리는 행.** 골격 카드는 `checkKeys` 를 `spec.checks` 에서 파생해 어긋날 수 없고, 손으로 적은 카드가 위험하다
 * — 행을 더하며 안 적으면 창이 적게 말하고, 지우며 남기면 없는 행을 약속한다(화면은 둘 다 멀쩡하다).
 */
describe('usage — 약속한 행이 실제로 그려진다', () => {
  /** `PluginRow` 의 라벨 자리. 기록용 `t` 를 쓰면 라벨 = i18n 키 그대로다. */
  const ROW = /text-\[12px\] text-gray-300">([^<]*)<\/span>/g;

  const renderedRowKeys = (mod: (typeof PLUGIN_CLIENT_MODULES)[number]): Set<string> => {
    const t = recorder(new Set<string>());
    const prefix = `panel.plugins.${mod.usage?.i18nKey ?? ''}.`;
    const keys = new Set<string>();
    for (const ctx of pluginTestContexts(t)) {
      for (const section of mod.panelSections ?? []) {
        if (!section.match(ctx)) continue;
        let markup = '';
        try {
          markup = renderToStaticMarkup(section.render(ctx));
        } catch {
          continue;
        }
        for (const m of markup.matchAll(ROW)) {
          const label = m[1] ?? '';
          if (label.startsWith(prefix)) keys.add(label.slice(prefix.length));
        }
      }
    }
    return keys;
  };

  const panelCards = PLUGIN_CLIENT_MODULES.filter((m) => (m.panelSections?.length ?? 0) > 0 && m.usage);

  it('검사 대상 카드를 실제로 모았다 — 비면 아래가 공짜로 통과한다', () => {
    expect(panelCards.length).toBeGreaterThan(100);
  });

  it('그리는 행을 빠짐없이 선언한다 — 안 적힌 행은 창이 말하지 않는 기능이 된다', () => {
    const unlisted: string[] = [];
    for (const mod of panelCards) {
      const declared = new Set(mod.usage?.checkKeys ?? []);
      for (const key of renderedRowKeys(mod)) {
        if (!declared.has(key)) unlisted.push(`${mod.manifest.id}.${key}`);
      }
    }
    expect(unlisted).toEqual([]);
  });

  it('선언한 행은 실제로 그려진다 — 안 그리는 행은 창이 하는 빈 약속이다', () => {
    const phantom: string[] = [];
    for (const mod of panelCards) {
      const rendered = renderedRowKeys(mod);
      for (const key of mod.usage?.checkKeys ?? []) {
        if (!rendered.has(key)) phantom.push(`${mod.manifest.id}.${key}`);
      }
    }
    expect(phantom).toEqual([]);
  });
});
