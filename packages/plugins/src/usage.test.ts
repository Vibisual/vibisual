/**
 * §5.11 v4.41 — "켜면 뭘 보게 되는가"(`PluginUsage`) 계약.
 *
 * Plugins 창에서 설명을 누르면 그 카드가 **실제로 그리는 행 이름**이 펼쳐진다. 그 재료가 `module.usage` 인데,
 * 이것은 **선택 필드**라 빠져도 타입이 통과하고 창도 멀쩡히 그려진다 — 그저 "무엇을 보여 주나" 줄만
 * 조용히 사라진다. 실제로 손으로 쓴 카드 7장(`lethal-trifecta` 포함, 그중 하나는 창을 열면 **가장 먼저
 * 선택되는** 카드다)이 전부 이 상태였고, 골격으로 만든 104장만 채워져 있었다.
 *
 * 세 가지를 못 박는다.
 *  ① 모든 카드가 `usage` 를 갖는다 — 골격을 안 쓴 카드가 다시 빠지지 않게.
 *  ② `checkKeys` 가 en 에 실재한다 — 창에 키 문자열이 그대로 노출되는 것을 막는다. 행 키는 카드가
 *     화면에 그릴 때 쓰는 것과 **같은 키**여야 하므로, 새 문자열을 만들지 않았는지도 함께 확인된다.
 *  ③ `i18nKey` 지붕이 매니페스트의 `descriptionKey` 와 같다 — 두 갈래로 갈리면 창의 설명과 행 목록이
 *     서로 다른 카드를 가리키게 된다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_CLIENT_MODULES } from './client.js';

const EN = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../client/src/i18n/locales/en.json'), 'utf8'),
) as Record<string, unknown>;

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
