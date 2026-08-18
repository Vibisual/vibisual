/**
 * §5.11 v4.03 — 전 플러그인 렌더 안전성 + i18n 키 실재 검사.
 *
 * 지금까지의 검증은 "존재하는가"(등록부 대조)와 "판정이 맞는가"(순수 함수 테스트)였다. 빠져 있던 것은
 * **실제로 그려지는가**이다. 카드 하나가 렌더 중에 던지면 그 버블의 패널 전체가 무너지고,
 * 컴포넌트가 부르는 i18n 키가 로케일에 없으면 화면에 키 문자열이 그대로 노출된다.
 *
 * 두 가지를 한 번에 잡는다.
 *  ① 모든 기여(배지·패널·헤더·설정)를 **비어 있는 컨텍스트부터 가득 찬 컨텍스트까지** 여러 모양으로 렌더한다.
 *  ② 렌더 중 요청된 모든 키를 기록해 `en.json` 에 실재하는지 확인한다.
 *
 * 111종을 사람 눈으로 하나씩 열어 보는 것은 불가능하므로, 이 테스트가 그 자리를 대신한다.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import { pluginLocaleResources } from './locales.js';
import type { PluginHeaderContext, PluginTranslate } from './types.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';

/**
 * 화면이 실제로 보는 것과 같은 트리 — 로케일 파일(호스트 창 뼈대) + **플러그인 폴더 안 문자열**(v4.58).
 *
 * v4.58 에서 카드 문자열이 각 플러그인 폴더의 `strings.ts` 로 옮겨 갔다(자립 규약). 한쪽만 보면
 * 카드가 부르는 키가 통째로 "없는 키"가 되므로, 호스트가 합치는 것과 **같은 함수**로 합쳐서 본다.
 */
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
