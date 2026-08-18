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
import { pluginLocaleResources } from './locales.js';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import type { PluginHeaderContext } from './types.js';
import { pluginTestContexts, recorder } from './testkit/contexts.js';

/**
 * v4.58 — 카드 문자열은 이제 **각 플러그인 폴더의 `strings.ts`** 가 정본이다(자립 규약).
 *
 * 그래서 호스트 창 뼈대(`contribution`·`category`·검색 …)를 걸러 낼 필요가 없어졌다 — 그것들은
 * 애초에 이 표에 들어오지 않는다. 여기 있는 것은 **전부 카드가 부르라고 만든 문자열**이다.
 */
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
 * 지금 측정값 그대로. 반올림해서 여유를 주지 않는다 — 여유만큼은 감시가 안 되는 구간이 된다.
 *
 * 이력: 266 → 198(경고·중간·위험명령 분기) → 89(도달 불가 `displayOnly` 109장 제거)
 * → 70(미사용 보일러플레이트 19종 제거) → 23(조용함·가운데·전면허용·읽기전용 분기)
 * → 2(위임·연쇄·빈검색·기본값 분기 + 문턱 보정) → 배지 조건을 좁히며 8종 제거, 다시 2.
 * → 4(v4.67 설정 두 줄) → **3**(`tokenBudget.level.heavy` 가 도달 가능해져 픽스처 ⑳ 으로 밟음).
 *
 * `tokenBudget.level.heavy` 가 여기 있었다. 고정 구획(9,800토큰)만 나눠 보던 시절에는 알려진 계열의 창이
 * 전부 20만 이상이라 몫이 0.049 를 못 넘어 **원리상 도달 불가**였다 — 카드가 등급을 낼 수 없다는 뜻이므로
 * 그것은 "지울 수 없는 문구"가 아니라 **판정이 죽어 있다는 신호**였다. 판정이 에이전트 규칙까지 세도록
 * 고친 뒤 도달 가능해졌고, 픽스처 ⑳(규칙 5만 자)이 그 분기를 밟는다.
 *
 * **남은 3개는 이 검사에서 원리상 도달할 수 없는 것들이다.** 0 이 목표가 아니다.
 *  ① `killSwitch.confirm` — **두 번째 누름** 상태의 문구다. 정적 렌더에는 첫 상태만 있다.
 *  ②③ `ssotDrift.settings.saved` · `.failed` (v4.67) — 설정 화면이 **저장을 시도한 뒤**에만 그리는 두 줄.
 *     정적 렌더에는 버튼을 누른 뒤 상태가 없고, 그 상태를 만들려면 이 검사가 서버 응답까지 흉내 내야 한다
 *     (그러면 죽은 문자열 검사가 아니라 통신 검사가 된다).
 *
 * 이 셋을 지우면 안 된다. 실제 상황에서는 그려지는 문구이고, 지우는 순간 그때 키 누락이 된다.
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
