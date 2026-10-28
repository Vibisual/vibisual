/**
 * §5.11 — 전 플러그인 렌더 안전성 + i18n 키 실재 검사(한 카드가 렌더 중 던지면 그 버블 패널이 통째 무너지고, 없는 키는 키 문자열로 보인다).
 * 모든 기여(배지·패널·헤더·설정)를 빈~가득 찬 컨텍스트로 렌더하고, 요청된 키가 `en.json` 에 실재하는지 본다.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import { pluginLocaleResources } from './locales.js';
import type { PluginHeaderContext, PluginTranslate } from './types.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';

/** 화면과 같은 트리 — 로케일 파일 + 플러그인 폴더 `strings.ts` 를 호스트와 같은 함수로 합친다(한쪽만 보면 카드 키가 통째로 "없는 키"). */
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
    if (node && typeof node === 'object' && seg in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[seg];
    }
    return undefined;
  }, EN);
}

describe('전 플러그인 렌더 안전성', () => {
  for (const mod of PLUGIN_CLIENT_MODULES) {
    it(`${mod.manifest.id} — 어떤 컨텍스트에서도 던지지 않는다`, () => {
      const seen = new Set<string>();
      const t = recorder(seen);

      for (const ctx of pluginTestContexts(t)) {
        for (const badge of mod.bubbleBadges ?? []) {
          if (badge.match(ctx)) expect(() => renderToStaticMarkup(<>{badge.render(ctx)}</>)).not.toThrow();
        }
        for (const section of mod.panelSections ?? []) {
          if (section.match(ctx)) expect(() => renderToStaticMarkup(<>{section.render(ctx)}</>)).not.toThrow();
        }
      }

      const headerCtx: PluginHeaderContext = {
        t,
        now: 1_000_000,
        liveAgents: 2,
        actions: { stopEverything: async () => 0 },
      };
      for (const item of mod.headerItems ?? []) {
        if (item.match?.(headerCtx) ?? true) {
          expect(() => renderToStaticMarkup(<>{item.render(headerCtx)}</>)).not.toThrow();
        }
      }
      if (mod.settingsSection) {
        expect(() => renderToStaticMarkup(<>{mod.settingsSection?.({ enabled: true, t })}</>)).not.toThrow();
      }
    });
  }
});

describe('i18n 키 실재', () => {
  for (const mod of PLUGIN_CLIENT_MODULES) {
    it(`${mod.manifest.id} — 부르는 키가 en.json 에 전부 있다`, () => {
      const seen = new Set<string>([mod.manifest.descriptionKey]);
      const t = recorder(seen);

      for (const ctx of pluginTestContexts(t)) {
        for (const badge of mod.bubbleBadges ?? []) if (badge.match(ctx)) renderToStaticMarkup(<>{badge.render(ctx)}</>);
        for (const section of mod.panelSections ?? []) if (section.match(ctx)) renderToStaticMarkup(<>{section.render(ctx)}</>);
      }
      const headerCtx: PluginHeaderContext = { t, now: 1, liveAgents: 1, actions: { stopEverything: async () => 0 } };
      for (const item of mod.headerItems ?? []) {
        if (item.match?.(headerCtx) ?? true) renderToStaticMarkup(<>{item.render(headerCtx)}</>);
      }

      const missing = [...seen].filter((key) => typeof lookup(key) !== 'string');
      expect(missing).toEqual([]);
    });
  }
});
