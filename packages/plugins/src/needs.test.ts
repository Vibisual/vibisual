/**
 * §5.11 v4.20 — `needs` 선언 ↔ 실제 데이터 축 사용 대조(소스 정적 검사).
 *
 * 데이터 축은 **옵트인**이다. 호스트(`usePluginData`)는 켜진 카드가 선언한 축만 store 에서 읽는다.
 * 그래서 선언이 어긋나면 두 방향 모두 조용히 잘못된다.
 *
 *  ① **과소 선언** — 카드가 `ctx.data.x` 를 읽는데 선언하지 않으면 호스트가 그 축을 채우지 않는다.
 *     카드는 던지지 않고 **빈 값으로 그려진다.** 화면에는 "0건 / 없음" 이 멀쩡히 뜨므로 아무도 모른다.
 *     기존 렌더 테스트는 컨텍스트를 직접 만들어 넣기 때문에 이 경우를 절대 잡지 못한다.
 *  ② **과대 선언** — 안 읽는 축을 선언하면 버블마다 쓸모없는 store 구독이 하나씩 붙는다. 카드가
 *     111종이라 이 낭비는 개수만큼 곱해진다.
 *
 * 런타임으로는 "읽었는지"를 알 수 없으므로 소스를 읽어 대조한다. `CATALOG.md` 를 기계가 읽게 한 것과 같은 이유다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DATA_NEEDS } from './registry.js';
import { PLUGIN_CLIENT_MODULES } from './client.js';

const SRC = path.resolve(__dirname);

const walk = (p: string): string[] =>
  fs.readdirSync(p, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(p, e.name)) : [path.join(p, e.name)]));

/**
 * 플러그인 하나의 구현 소스 전체(테스트 제외). 폴더명 = 플러그인 id 규약에 기댄다.
 *
 * **가져다 쓰는 공용 모듈까지 포함한다.** 축을 직접 읽지 않고 `framework/activity.ts` 의 `toneIfActive`
 * 같은 헬퍼를 거쳐 읽는 카드가 있는데, 카드 폴더만 보면 그 축이 "선언만 하고 안 읽는다"로 잘못 잡힌다.
 */
function sourceOf(id: string): string {
  const dir = path.join(SRC, id);
  if (!fs.existsSync(dir)) return '';
  const own = walk(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
    .map((f) => fs.readFileSync(f, 'utf8'));

  // `../framework/x.js` · `../ui/x.js` 처럼 카드 밖에서 끌어다 쓰는 모듈의 본문도 함께 본다.
  const shared = new Set<string>();
  for (const text of own) {
    for (const m of text.matchAll(/from '\.\.\/((?:framework|ui)\/[\w.-]+)\.js'/g)) {
      const p = path.join(SRC, `${m[1]}.ts`);
      const px = path.join(SRC, `${m[1]}.tsx`);
      if (fs.existsSync(p)) shared.add(p);
      else if (fs.existsSync(px)) shared.add(px);
    }
  }
  return [...own, ...[...shared].map((f) => fs.readFileSync(f, 'utf8'))].join('\n');
}

/** `ctx.data.axis` 와 `const { axis } = ctx.data` 두 형태를 모두 잡는다. */
function readsAxis(src: string, axis: string): boolean {
  if (new RegExp(`data\\.${axis}\\b`).test(src)) return true;
  return new RegExp(`\\{[^}]*\\b${axis}\\b[^}]*\\}\\s*=\\s*(?:ctx\\.)?data\\b`).test(src);
}

describe('데이터 축 선언 대조', () => {
  it('플러그인 id 로 구현 소스를 찾을 수 있다 — 못 찾으면 아래 검사가 전부 무의미해진다', () => {
    const empty = PLUGIN_CLIENT_MODULES.filter((m) => sourceOf(m.manifest.id).length === 0);
    expect(empty.map((m) => m.manifest.id)).toEqual([]);
  });

  it('선언 없이 읽는 축이 없다 — 있으면 카드가 빈 값을 그린다', () => {
    const bad: string[] = [];
    for (const mod of PLUGIN_CLIENT_MODULES) {
      const src = sourceOf(mod.manifest.id);
      const declared = new Set<string>(mod.needs ?? []);
      for (const axis of PLUGIN_DATA_NEEDS) {
        if (readsAxis(src, axis) && !declared.has(axis)) bad.push(`${mod.manifest.id}:${axis}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('읽지 않는 축을 선언하지 않는다 — 버블마다 쓸모없는 구독이 붙는다', () => {
    const bad: string[] = [];
    for (const mod of PLUGIN_CLIENT_MODULES) {
      const src = sourceOf(mod.manifest.id);
      for (const axis of mod.needs ?? []) {
        if (!readsAxis(src, axis)) bad.push(`${mod.manifest.id}:${axis}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
