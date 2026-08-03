/**
 * §5.11 v4.21 — 죽은 플러그인 문자열 감시(래칫).
 *
 * `renderAll.test.tsx` 는 **부르는 키가 있는가**를 본다. 그 반대편 — **있는데 아무도 안 부르는 키** —
 * 는 지금까지 아무도 보지 않았다. 카드가 111종이고 로케일이 12개라 죽은 키 하나는 화면에서 안 보이는
 * 문자열 12개가 되고, 다음 사람은 그것이 쓰이는 줄 알고 번역을 유지한다.
 *
 * 다만 "안 불렸다"가 곧 "죽었다"는 아니다. 픽스처가 그 분기를 안 밟았을 수도 있다. 그래서 **삭제 목록을
 * 만들지 않고 상한선만 건다** — 지금보다 늘어나면 실패한다. 새 카드를 만들며 안 쓰는 키를 같이 심는 것을
 * 막는 것이 목적이고, 줄이는 것은 분기 픽스처를 늘리거나 실제로 지울 때 함께 내린다.
 *
 * 호스트가 그리는 창 자체의 문자열(`contribution.*` · `category.*` · 창 뼈대)은 플러그인 카드가 아니므로 셈에서 뺀다.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import type { PluginHeaderContext } from './types.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';

const EN = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../client/src/i18n/locales/en.json'), 'utf8'),
) as { panel: { plugins: Record<string, unknown> } };

/** PluginsWindow 가 직접 그리는 문자열 — 카드가 부르지 않는 것이 정상이다. */
const HOST_CHROME = new Set(['contribution', 'category', 'title', 'close', 'saving', 'empty',
  'enabled', 'disabled', 'contributes', 'unsupported', 'offNote', 'showMore', 'showLess',
  // 찾기·거르기 (v4.24) — 111종을 고르는 화면의 뼈대다.
  'searchPlaceholder', 'clearSearch', 'onlyEnabled', 'noMatch', 'enabledCount',
  // 사용법 패널·데이터 축 이름 (v4.39) — 창이 그리는 것이지 카드가 부르는 키가 아니다.
  'usage', 'need']);

function flat(node: unknown, prefix: string, out: string[]): string[] {
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else if (typeof v === 'string') out.push(key);
  }
  return out;
}

function requestedKeys(): Set<string> {
  const seen = new Set<string>();
  const t = recorder(seen);
  for (const mod of PLUGIN_CLIENT_MODULES) {
    seen.add(mod.manifest.descriptionKey);
    for (const ctx of pluginTestContexts(t)) {
      for (const badge of mod.bubbleBadges ?? []) if (badge.match(ctx)) renderToStaticMarkup(<>{badge.render(ctx)}</>);
      for (const section of mod.panelSections ?? []) {
        section.severity?.(ctx);
        if (section.match(ctx)) renderToStaticMarkup(<>{section.render(ctx)}</>);
      }
    }
    const headerCtx: PluginHeaderContext = { t, now: 1, liveAgents: 1, actions: { stopEverything: async () => 0 } };
    for (const item of mod.headerItems ?? []) if (item.match?.(headerCtx) ?? true) renderToStaticMarkup(<>{item.render(headerCtx)}</>);
    if (mod.settingsSection) renderToStaticMarkup(<>{mod.settingsSection({ enabled: true, t })}</>);
  }
  return seen;
}

/**
 * 지금 측정값 그대로. 반올림해서 여유를 주지 않는다 — 여유만큼은 감시가 안 되는 구간이 된다.
 *
 * 이력: 266 → 198(경고·중간·위험명령 분기) → 89(도달 불가 `displayOnly` 109장 제거)
 * → 70(미사용 보일러플레이트 19종 제거) → 23(조용함·가운데·전면허용·읽기전용 분기)
 * → 2(위임·연쇄·빈검색·기본값 분기 + 문턱 보정) → 배지 조건을 좁히며 8종 제거, 다시 2.
 *
 * **남은 2개는 이 검사에서 원리상 도달할 수 없는 것들이다.** 0 이 목표가 아니다.
 *  ① `tokenBudget.level.heavy` — 고정 소비(9,800토큰) ÷ 모델 창 ≥ 0.1 이어야 하는데, 알려진 계열은
 *     전부 20만 이상이라 0.049 를 넘지 못한다. 창이 작은 모델이 레지스트리에 실려야 나온다.
 *  ② `killSwitch.confirm` — **두 번째 누름** 상태의 문구다. 정적 렌더에는 첫 상태만 있다.
 *
 * 이 둘을 지우면 안 된다. 실제 상황에서는 그려지는 문구이고, 지우는 순간 그때 키 누락이 된다.
 */
const CEILING = 2;

describe('죽은 플러그인 문자열', () => {
  it(`아무도 부르지 않는 카드 문자열이 ${CEILING}개를 넘지 않는다`, () => {
    const seen = requestedKeys();
    const unused = flat(EN.panel.plugins, 'panel.plugins', [])
      .filter((k) => !HOST_CHROME.has(k.split('.')[2] ?? ''))
      .filter((k) => !seen.has(k));
    // 상한을 내리려면 무엇이 남았는지 봐야 한다. 그때마다 임시 스크립트를 다시 만들지 않도록
    // 검사 자체가 목록을 내놓게 해 둔다: `DUMP_UNUSED=1 vitest run src/deadStrings.test.tsx`
    // (vitest 가 콘솔 출력을 삼키므로 파일로 쓴다. 산출물은 git 무시 대상이다.)
    if (process.env.DUMP_UNUSED) {
      fs.writeFileSync(path.resolve(__dirname, '../unused-keys.local.txt'), unused.join('\n'), 'utf8');
    }
    expect(unused.length).toBeLessThanOrEqual(CEILING);
  });

  it('카드 문자열은 반드시 등록된 플러그인 이름 아래에 있다 — 오타로 만든 고아 묶음을 잡는다', () => {
    const known = new Set(PLUGIN_CLIENT_MODULES.map((m) => m.manifest.id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())));
    const orphans = Object.keys(EN.panel.plugins)
      .filter((group) => !HOST_CHROME.has(group) && !known.has(group));
    expect(orphans).toEqual([]);
  });
});
