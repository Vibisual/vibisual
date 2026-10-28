/**
 * §5.11 — 죽은 플러그인 문자열 감시(래칫): 있는데 아무도 안 부르는 키(`renderAll.test.tsx` 의 반대편).
 * "안 불렸다"가 곧 "죽었다"는 아니라(픽스처가 분기를 안 밟았을 수 있다) 삭제 목록 대신 상한만 건다 — 늘면 실패, 줄이는 건 픽스처를 늘리거나 실제로 지울 때.
 * 호스트 창 문자열(`contribution.*`·`category.*`·창 뼈대)은 셈에서 뺀다.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { pluginLocaleResources } from './locales.js';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import type { PluginHeaderContext } from './types.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';

/** 카드 문자열 정본은 각 폴더의 `strings.ts`(자립 규약)라 호스트 창 뼈대(`contribution`·`category`·검색 …)는 애초에 이 표에 없다 — 여기 있는 것은 전부 카드가 부르라고 만든 문자열이다. */
const EN = { panel: { plugins: pluginLocaleResources('en') } };

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
 * 지금 측정값 그대로 — 여유를 주면 그만큼은 감시가 안 된다. 0 이 목표가 아니다: 남은 3개는 이 검사에서 원리상 도달할 수 없다.
 *  ① `killSwitch.confirm` — 두 번째 누름 상태의 문구(정적 렌더에는 첫 상태만 있다).
 *  ②③ `ssotDrift.settings.saved`·`.failed` — 저장을 시도한 뒤에만 그리는 줄(만들려면 서버 응답까지 흉내 내야 한다).
 * 이 셋을 지우지 마라 — 실제로 그려지는 문구라 지우면 키 누락이 된다. 도달 불가가 판정이 죽은 신호일 수도 있다(`tokenBudget.level.heavy` 는 판정을 고쳐 픽스처 ⑳ 이 밟는다).
 */
const CEILING = 3;

describe('죽은 플러그인 문자열', () => {
  it(`아무도 부르지 않는 카드 문자열이 ${CEILING}개를 넘지 않는다`, () => {
    const seen = requestedKeys();
    const unused = flat(EN.panel.plugins, 'panel.plugins', []).filter((k) => !seen.has(k));
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
    const orphans = Object.keys(EN.panel.plugins).filter((group) => !known.has(group));
    expect(orphans).toEqual([]);
  });
});
