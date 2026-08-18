/**
 * §5.11 v4.58 — **자립(portability) 규약 강제.**
 *
 * 사용자 요구 — "각 플러그인은 다른 우리 앱에 **복붙해서 써도 될 정도로** 개별적으로. 언리얼 플러그인이
 * 그렇게 되어 있잖아."
 *
 * 규약은 사람이 지키는 것이 아니라 **기계가 지킨다.** 한 번 정리해 놓아도 다음 카드 하나가 옆 폴더를
 * 물면 그 순간 두 폴더는 다시 하나가 되고, 그런 결합은 조용하다 — 빌드도 타입체크도 통과한다.
 * 그래서 네 가지를 여기서 못 박는다.
 *
 *  ① 폴더 밖으로 나가는 import 는 **`sdk/index.js` 하나뿐**이다.
 *  ② **다른 플러그인 폴더**를 직접 물지 않는다.
 *  ③ 폴더마다 **`plugin.json` 디스크립터**(= 언리얼 `.uplugin`)가 있고 등록된 매니페스트와 일치한다.
 *  ④ 폴더마다 **자기 문자열**(`strings.ts`)을 들고 있고 12개 로케일이 다 있다.
 *  ⑤ 호스트 타입을 **캐스트로 우회하지 않는다**(`hostApi` 계약을 컴파일러가 지키게 둔다).
 *  ⑥ **서버 기여도 폴더 안에 산다**(REST 창구를 호스트 코어에 손으로 붙이지 않는다).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_MANIFESTS } from './registry.js';
import { PLUGIN_CLIENT_MODULES } from './client.js';
import { PLUGIN_SERVER_MODULES } from './server.js';
import { PLUGIN_HOST_API } from './sdk/index.js';

const SRC = path.resolve(__dirname);
/** 플러그인이 아닌 폴더 — 호스트 층이다. 규약의 대상이 아니라 규약이 기대는 바닥. */
const HOST_DIRS = new Set(['sdk', 'framework', 'ui', 'testkit']);
const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'es', 'es-419', 'fr', 'de', 'hi', 'id', 'it', 'pt-BR'];

const pluginIds = PLUGIN_MANIFESTS.map((m) => m.id);

const walk = (p: string): string[] =>
  fs.readdirSync(p, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(p, e.name)) : [path.join(p, e.name)]));

function sourcesOf(id: string): { file: string; abs: string; text: string }[] {
  const dir = path.join(SRC, id);
  if (!fs.existsSync(dir)) return [];
  return walk(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => ({ file: path.relative(SRC, f).replace(/\\/g, '/'), abs: f, text: fs.readFileSync(f, 'utf8') }));
}

/**
 * 이 파일이 **자기 플러그인 폴더 밖으로** 가져오는 상대경로만.
 *
 * `../` 가 있다고 다 밖은 아니다 — `lethal-trifecta/client/index.tsx` 의 `../manifest.js` 는 같은
 * 플러그인 안이다. 문자열만 보면 그것까지 위반으로 잡히므로 **실제로 어디에 떨어지는지** 로 판정한다.
 * 패키지 이름(`@vibisual/shared` 등)은 애초에 대상이 아니다(어느 앱에서든 호스트가 제공한다).
 */
function outwardImports(fileAbs: string, text: string, id: string): string[] {
  const pluginRoot = path.join(SRC, id);
  const out: string[] = [];
  for (const m of text.matchAll(/from\s+'((?:\.\.\/)+[^']*)'/g)) {
    const spec = m[1] ?? '';
    const resolved = path.resolve(path.dirname(fileAbs), spec);
    const rel = path.relative(pluginRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) out.push(spec);
  }
  return out;
}

describe('자립 규약 ① 폴더 밖 의존은 SDK 하나뿐', () => {
  it('플러그인은 sdk/index.js 말고 다른 폴더를 물지 않는다', () => {
    const bad: string[] = [];
    for (const id of pluginIds) {
      for (const { file, abs, text } of sourcesOf(id)) {
        for (const spec of outwardImports(abs, text, id)) {
          if (!/^(\.\.\/)+sdk\/index\.js$/.test(spec)) bad.push(`${file} → ${spec}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('플러그인이 아닌 폴더는 규약 대상이 아니다 — 호스트 층이 SDK 를 통해 자기를 물 수는 없다', () => {
    for (const d of HOST_DIRS) expect(pluginIds).not.toContain(d);
  });
});

describe('자립 규약 ② 플러그인끼리 직접 물지 않는다', () => {
  it('다른 플러그인 폴더 이름이 import 경로에 등장하지 않는다', () => {
    const others = new Set(pluginIds);
    const bad: string[] = [];
    for (const id of pluginIds) {
      for (const { file, abs, text } of sourcesOf(id)) {
        for (const spec of outwardImports(abs, text, id)) {
          const head = spec.replace(/^(\.\.\/)+/, '').split('/')[0] ?? '';
          if (head !== id && others.has(head)) bad.push(`${file} → ${spec}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('자립 규약 ③ plugin.json 디스크립터', () => {
  it('플러그인마다 디스크립터가 있다 — 없으면 다른 앱이 무엇을 얹는지 알 수 없다', () => {
    const missing = pluginIds.filter((id) => !fs.existsSync(path.join(SRC, id, 'plugin.json')));
    expect(missing).toEqual([]);
  });

  it('디스크립터가 등록된 매니페스트와 어긋나지 않는다', () => {
    const needsById = new Map(PLUGIN_CLIENT_MODULES.map((m) => [m.manifest.id, m.needs ?? []]));
    const drift: string[] = [];
    for (const m of PLUGIN_MANIFESTS) {
      const file = path.join(SRC, m.id, 'plugin.json');
      if (!fs.existsSync(file)) continue;
      const d = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      const expected: Record<string, unknown> = {
        id: m.id,
        name: m.name,
        version: m.version,
        category: m.category,
        descriptionKey: m.descriptionKey,
        enabledByDefault: m.enabledByDefault,
        contributes: m.contributes,
        clientOnly: m.clientOnly,
        needs: needsById.get(m.id) ?? [],
        // ⚠ 여기 `1` 을 숫자로 적어 두면 계약 판이 올라가는 날 이 검사가 **판올림을 가로막는다** —
        //   SDK 는 2 를 말하는데 디스크립터는 1 을 유지하라고 요구하게 되고, 그 둘이 갈린 채로 굳는다.
        //   상수를 그대로 물어 두면 판을 올리는 사람이 이 파일을 찾아 헤맬 필요도 없다.
        hostApi: PLUGIN_HOST_API,
      };
      for (const [k, v] of Object.entries(expected)) {
        if (JSON.stringify(d[k]) !== JSON.stringify(v)) drift.push(`${m.id}.${k}: ${JSON.stringify(d[k])} ≠ ${JSON.stringify(v)}`);
      }
    }
    expect(drift).toEqual([]);
  });
});

describe('자립 규약 ④ 문자열이 폴더 안에 있다', () => {
  it('플러그인마다 strings.ts 를 들고 있다 — 폴더를 복사하면 번역도 함께 간다', () => {
    const missing = pluginIds.filter((id) => !fs.existsSync(path.join(SRC, id, 'strings.ts')));
    expect(missing).toEqual([]);
  });

  it('폴더 안 문자열이 12개 로케일을 다 갖는다', () => {
    const bad: string[] = [];
    for (const id of pluginIds) {
      const file = path.join(SRC, id, 'strings.ts');
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const loc of LOCALES) {
        if (!new RegExp(`"${loc}"\\s*:`).test(text)) bad.push(`${id}:${loc}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('카드 문자열이 클라이언트 로케일 파일에 남아 있지 않다 — 두 군데 있으면 반드시 갈린다', () => {
    const en = path.resolve(__dirname, '../../client/src/i18n/locales/en.json');
    const tree = JSON.parse(fs.readFileSync(en, 'utf8')) as { panel: { plugins: Record<string, unknown> } };
    const camel = (id: string): string => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    const leftover = pluginIds.map(camel).filter((c) => tree.panel.plugins[c] !== undefined);
    expect(leftover).toEqual([]);
  });
});

/**
 * 자립 규약 ⑤ — **호스트 타입을 우회하지 않는다.**
 *
 * `plugin.json` 의 `hostApi` 는 "이 폴더는 호스트 계약 1판을 구현한다"는 선언이다. 그 계약을 지키는 것은
 * 사람이 아니라 컴파일러여야 하는데, 캐스트 한 줄이면 그 감시가 통째로 꺼진다 — 그리고 그 순간부터
 * **호스트가 필드 이름을 바꿔도 빌드는 초록**이고, 카드만 조용히 기본값을 세다 죽는다.
 * 실제로 `progressive-disclosure` 가 그랬다(`repeatCount` 를 캐스트로 읽고 있었고, 그 필드는 애초에
 * 호스트 타입에 있었다 — 캐스트가 얻는 것은 없고 잃는 것만 있었다).
 *
 * 필요한 값이 호스트 타입에 없으면 캐스트로 뚫지 말고 **호스트 타입에 추가하는 것이 맞다**(그래야 다른 앱에
 * 이 폴더를 붙일 때 무엇이 필요한지가 계약에 드러난다).
 */
describe('자립 규약 ⑤ 호스트 타입을 우회하지 않는다', () => {
  /** 타입 검사를 끄는 표현들. 좁히는 캐스트(`as const`)와 문자열 리터럴 좁힘은 대상이 아니다. */
  const ESCAPES = [
    { re: /\bas\s+\{/, why: '즉석 구조 타입으로 캐스트' },
    { re: /\bas\s+any\b/, why: 'any 캐스트' },
    { re: /as\s+unknown\s+as\b/, why: '이중 캐스트' },
    { re: /@ts-(ignore|expect-error|nocheck)/, why: '컴파일러 억제 주석' },
  ];

  it('플러그인 폴더 안에 타입 우회가 없다 — 우회한 줄은 호스트가 바뀌어도 빌드가 안 잡는다', () => {
    const bad: string[] = [];
    for (const id of pluginIds) {
      for (const { file, text } of sourcesOf(id)) {
        text.split('\n').forEach((line, i) => {
          for (const { re, why } of ESCAPES) {
            if (re.test(line)) bad.push(`${file}:${i + 1} — ${why}`);
          }
        });
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * 자립 규약 ⑥ — **서버 기여도 폴더 안에 산다.**
 *
 * v4.67 의 SSOT 지정 창구는 서버 기여 배럴을 우회해 호스트 코어(`server/src/services/pluginHost.ts`)에
 * 손으로 붙어 있었다. 동작은 멀쩡했지만 그 폴더를 다른 앱에 복사하면 카드·문자열·집행만 따라가고
 * **서버 쪽은 남았다** — 자립 규약이 클라이언트에서만 지켜지고 있었다는 뜻이다. 배럴이 있는데도 그런
 * 일이 벌어진 이유는 간단하다: 배럴을 안 써도 아무 검사도 실패하지 않았다.
 *
 * 그래서 두 가지를 못 박는다 — 배럴에 실린 카드는 **자기 폴더에 `server.ts` 를 갖고**, 경로는 접두사
 * 아래를 벗어나지 않는다(선행 `/`·`..` 로 남의 라우트에 얹히지 않는다).
 */
describe('자립 규약 ⑥ 서버 기여도 폴더 안에', () => {
  it('배럴에 실린 서버 모듈은 등록된 카드다', () => {
    const known = new Set(pluginIds);
    expect(PLUGIN_SERVER_MODULES.map((m) => m.manifest.id).filter((id) => !known.has(id))).toEqual([]);
  });

  it('서버 기여가 있는 카드는 자기 폴더에 server.ts 를 들고 있다', () => {
    const missing = PLUGIN_SERVER_MODULES
      .map((m) => m.manifest.id)
      .filter((id) => !fs.existsSync(path.join(SRC, id, 'server.ts')));
    expect(missing).toEqual([]);
  });

  it('빈 기여를 배럴에 싣지 않는다 — 경로도 라우터도 없으면 마운트할 것이 없다', () => {
    const empty = PLUGIN_SERVER_MODULES.filter((m) => (m.routes ?? []).length === 0 && !m.createRouter);
    expect(empty.map((m) => m.manifest.id)).toEqual([]);
  });

  it('경로가 자기 접두사 아래를 벗어나지 않는다', () => {
    const bad: string[] = [];
    for (const mod of PLUGIN_SERVER_MODULES) {
      for (const route of mod.routes ?? []) {
        const p = route.path;
        if (p.startsWith('/') || p.includes('..') || p.trim() === '') bad.push(`${mod.manifest.id}: "${p}"`);
      }
    }
    expect(bad).toEqual([]);
  });
});
