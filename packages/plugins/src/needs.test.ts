/**
 * §5.11 — `needs` 선언 ↔ 실제 데이터 축 사용 대조(소스 정적 검사). 호스트(`usePluginData`)는 선언한 축만 store 에서 읽는다.
 *  ① 과소 선언 — 읽는데 선언하지 않으면 축이 안 채워져 카드가 "0건 / 없음"으로 멀쩡히 그려진다(렌더 테스트는 컨텍스트를 직접 넣어 못 잡는다).
 *  ② 과대 선언 — 안 읽는 축을 선언하면 버블마다 쓸모없는 store 구독이 붙는다(카드 수만큼 곱해진다).
 * 런타임으로는 읽었는지 알 수 없어 소스를 읽어 대조한다.
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
 * SDK 가 내보내는 심볼 → 그 본문이 있는 파일(§5.11). 플러그인은 `../sdk/index.js` 하나만 물어 import 경로로는 어떤 헬퍼를 쓰는지 모른다.
 * SDK 를 물었다고 공용 층 전체를 끼우면 `toneIfActive` 의 `agentEvents`·`subAgents` 가 모든 카드가 읽는 것으로 보여 과대 선언 검사가 눈을 감는다 — 이름을 적어 가져간 심볼만 되짚는다.
 */
const SDK_SYMBOL_SOURCE: Record<string, string> = {
  hasActivity: 'framework/activity.ts',
  toneIfActive: 'framework/activity.ts',
  defineInspector: 'framework/inspector.tsx',
  ICONS: 'framework/inspector.tsx',
  PluginSection: 'ui/kit.tsx',
  PluginRow: 'ui/kit.tsx',
  PluginBadgePill: 'ui/kit.tsx',
  formatElapsed: 'ui/kit.tsx',
  judgeTrifecta: 'sdk/judgments/trifecta.ts',
  effectiveTools: 'sdk/judgments/trifecta.ts',
  judgeBlastRadius: 'sdk/judgments/blastRadius.ts',
  readAutoGoal: 'sdk/judgments/autoGoal.ts',
};

/**
 * 플러그인 하나의 구현 소스 전체(테스트 제외) — 폴더명 = 플러그인 id 규약에 기댄다.
 * 가져다 쓰는 공용 헬퍼 본문까지 포함한다 — `toneIfActive` 처럼 헬퍼를 거쳐 읽는 카드가 "선언만 하고 안 읽는다"로 잘못 잡히지 않게.
 */
function sourceOf(id: string): string {
  const dir = path.join(SRC, id);
  if (!fs.existsSync(dir)) return '';
  const own = walk(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
    .map((f) => fs.readFileSync(f, 'utf8'));

  const shared = new Set<string>();
  for (const text of own) {
    // `import { a, b, type C } from '../sdk/index.js'` 에서 실제로 적힌 이름만 뽑는다.
    for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'(?:\.\.\/)+sdk\/index\.js'/g)) {
      for (const raw of (m[1] ?? '').split(',')) {
        const name = raw.replace(/\btype\b/g, '').split(' as ')[0]?.trim() ?? '';
        const file = SDK_SYMBOL_SOURCE[name];
        if (file) shared.add(path.join(SRC, file));
      }
    }
  }
  return [...own, ...[...shared].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8'))].join('\n');
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

/**
 * 세 번째 다리 — 호스트(`usePluginData`)가 그 축을 실제로 채우는가. 카드가 바르게 선언해도 호스트가 안 읽으면 값이 `undefined` 로 와
 * 카드가 "0건 / 없음"을 멀쩡히 그린다(선언·사용 검사와 렌더 검사로는 못 잡는다). 축 목록은 손으로 유지돼 실제로 어긋나므로 여기서 못 박는다.
 */
describe('데이터 축 — 호스트 배선', () => {
  const HOST = path.resolve(__dirname, '../../client/src/plugins/host.tsx');
  const hostSource = fs.existsSync(HOST) ? fs.readFileSync(HOST, 'utf8') : '';

  it('호스트 소스를 실제로 찾았다 — 경로가 어긋나면 아래 검사가 공짜로 통과한다', () => {
    expect(hostSource).toContain('function usePluginData');
  });

  it('선언 가능한 축을 호스트가 하나도 빠짐없이 구독한다', () => {
    const missing = PLUGIN_DATA_NEEDS.filter((axis) => !hostSource.includes(`needs.has('${axis}')`));
    expect(missing, `호스트가 안 읽는 축: ${missing.join(', ')}`).toEqual([]);
  });

  it('구독한 축을 카드에게 넘기는 객체에도 싣는다 — 읽어 놓고 안 넘기면 같은 증상이다', () => {
    // `return useMemo(() => ({ ... }), [...])` 로 넘기는 그 객체.
    const returned = hostSource.slice(hostSource.indexOf('return useMemo'));
    const missing = PLUGIN_DATA_NEEDS.filter((axis) => !new RegExp(`\\b${axis}\\b`).test(returned));
    expect(missing, `조립 객체에 없는 축: ${missing.join(', ')}`).toEqual([]);
  });
});
