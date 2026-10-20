import { describe, expect, it } from 'vitest';

/**
 * §5.13 (Y) 40-4 — **스튜디오 첫 청크에 3D 가 다시 들어오지 못하게** 지킨다.
 *
 * 39-2 가 three.js·모델 해독기를 늦은 로드로 걷었는데, 그 뒤 `videoMediaProvider.ts`·`videoModelImport.ts` 의 정적 import 로 소리 없이
 * 되돌아왔다(설치본 실측 — 스튜디오 정적 사슬 2.78MB 중 2.06MB). 빌드 산출물이 없는 시험 환경에서도 돌도록 소스의 **정적 import
 * 그래프**를 따라간다 — `import type`·`import()` 는 빼고, `export … from` 은 넣는다. 본체(`main.tsx`)가 이미 정적으로 싣는 모듈은
 * 스튜디오 몫이 아니라 뺀다(그쪽은 앱을 켤 때 이미 낸 비용이다).
 */

const SOURCES = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** 값으로 들어오는 정적 import·re-export 의 지정자들(타입만 부르는 것은 번들에서 지워지므로 뺀다). */
function staticSpecifiers(src: string): string[] {
  const out: string[] = [];
  const fromRe = /^[ \t]*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(fromRe)) {
    if (m[2]) continue; // import type … / export type …
    const clause = (m[3] ?? '').trim();
    const named = /^\{([\s\S]*)\}$/.exec(clause);
    if (named) {
      const parts = (named[1] ?? '').split(',').map((p) => p.trim()).filter((p) => p !== '');
      if (parts.length > 0 && parts.every((p) => p.startsWith('type '))) continue; // { type A, type B }
    }
    out.push(m[4] ?? '');
  }
  for (const m of src.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) out.push(m[1] ?? '');
  return out;
}

function resolveLocal(spec: string, from: string): string | null {
  if (!spec.startsWith('.')) return null;
  const dir = from.slice(0, from.lastIndexOf('/'));
  const parts = `${dir}/${spec}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = `/${stack.join('/')}`.replace(/\.(js|jsx|ts|tsx)$/, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (candidate in SOURCES) return candidate;
  }
  return null;
}

function closure(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of staticSpecifiers(SOURCES[file] ?? '')) {
      const local = resolveLocal(spec, file);
      if (local) stack.push(local);
      else if (!spec.startsWith('.')) packages.add(spec);
    }
  }
  return { files, packages };
}

const STUDIO_ENTRIES = [
  '/src/components/VideoStudio/VideoStudioShell.tsx',
  '/src/components/VideoStudio/VideoRenderShell.tsx',
  '/src/components/VideoStudio/VideoWorkerShell.tsx',
];
const HEAVY_3D_FILES = /\/Creation\/model(?:Decoders|IO)\.ts$|\/VideoStudio\/videoModel(?:Frames|Import|Scene)\.ts$/;

describe('§5.13 (Y) 40-4 스튜디오 정적 청크 가드', () => {
  const main = closure('/src/main.tsx');

  it('소스를 읽었다(빈 결과로 통과하지 않는다)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    for (const entry of STUDIO_ENTRIES) expect(SOURCES[entry], entry).toBeTruthy();
  });

  for (const entry of STUDIO_ENTRIES) {
    it(`${entry.split('/').pop()} 의 정적 import 닫힘(본체 몫 제외)에 three·모델 해독기가 없다`, () => {
      const own = closure(entry);
      const studioOnlyFiles = [...own.files].filter((f) => !main.files.has(f));
      const heavyFiles = studioOnlyFiles.filter((f) => HEAVY_3D_FILES.test(f));
      const threePackages = [...own.packages].filter((p) => (p === 'three' || p.startsWith('three/')) && !main.packages.has(p));
      expect(heavyFiles, `정적으로 끌려온 3D 파일: ${heavyFiles.join(', ')}`).toEqual([]);
      expect(threePackages, `정적으로 끌려온 three: ${threePackages.join(', ')}`).toEqual([]);
    });
  }
});
