import { describe, it, expect } from 'vitest';
import { selectOrphanIDEPanes } from './graphStore.js';

/**
 * zustand 스냅샷 안정성 규약 — **구독 셀렉터는 같은 상태에 대해 같은 참조를 돌려줘야 한다.**
 *
 * zustand v5 의 `useStore` 는 고른 값을 메모하지 않는다:
 *
 * ```js
 * useSyncExternalStore(api.subscribe, () => selector(api.getState()), …)
 * ```
 *
 * React 는 커밋마다 스냅샷을 다시 읽어 직전 값과 `Object.is` 로 견준다. 그래서 셀렉터가 호출마다
 * 새 배열·새 객체를 만들면 "스토어가 또 바뀌었다"가 **영원히 참**이 되어 강제 리렌더가 반복되고,
 * 중첩 갱신 한도를 넘기는 순간 예외가 난다. 클라이언트에는 전역 에러 경계가 없으므로 그 예외는
 * 루트를 통째로 내린다 — 화면이 통째로 사라진다(헤더 [IDE 창] 메뉴를 여는 순간 그렇게 됐다).
 *
 * v4 에서는 `useSyncExternalStoreWithSelector` 가 결과를 캐시해 이 실수가 드러나지 않았다. 그래서
 * v4 시절 감각으로 짠 코드가 조용히 지뢰가 된다 — 사람 눈이 아니라 이 검사로 막는다.
 *
 * 규칙: 구독 셀렉터가 **돌려주는 식**이 배열·객체를 새로 만들면 안 된다. 새로 만들어야 하는 목록은
 * 참조가 안정적인 스토어 필드만 구독하고 컴포넌트 쪽 `useMemo` 로 조립한다(개수·지문이 필요할
 * 뿐이면 `.length` · `.join(…)` 처럼 원시값으로 줄여서 구독한다).
 */

const tsSources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true });
const tsxSources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true });

/** 이 스토어들에 붙는 구독만 검사한다. 새 zustand 스토어를 만들면 여기 등록. */
const STORE_HOOKS = ['useGraphStore'];

/** 새 배열·새 객체를 만드는 연산 — 돌려주는 식에 이게 있으면 스냅샷이 흔들린다. */
const FRESH_MARKERS = [
  '.filter(', '.map(', '.slice(', '.sort(', '.concat(', '.flatMap(', '.reverse(',
  'Object.values(', 'Object.keys(', 'Object.entries(', 'Array.from(',
];

/** 위 연산 뒤에 이게 붙으면 결과가 원시값이라 안전하다(개수·지문 구독). */
const PRIMITIVE_TAILS = [
  '.length', '.join(', '.findIndex(', '.some(', '.every(', '.includes(', '.indexOf(',
];

const BACKSLASH = String.fromCharCode(92);

/**
 * glob 키(이 파일=`src/stores/` 기준 상대 경로)를 src 기준 경로로 편다.
 * `popupDismissContract.test.ts` 와 같은 방식.
 */
function toSrcPath(key: string): string {
  const out: string[] = [];
  for (const part of `stores/${key}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * 주석과 문자열 리터럴을 걷어낸다. 정규식 대신 손으로 훑는다 — 이 파일이 다루는 표식(`//`, `/*`)이
 * 정규식 리터럴 안에도 나올 수 있어, 패턴으로 지우면 멀쩡한 코드까지 먹는다.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < src.length) {
        const e = src[i];
        if (e === BACKSLASH) { i += 2; continue; }
        out += e;
        i++;
        if (e === c) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** `(` 위치에서 짝이 맞는 `)` 까지의 인자 텍스트. 못 닫으면 null. */
function balancedArg(src: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

function normalize(text: string): string {
  return text.split(/\s+/).join(' ').trim();
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

/**
 * `graphStore.ts` 에서 **배열을 돌려주는** `select*` 이름을 모은다. 손으로 적어 두면 새 셀렉터가
 * 조용히 검사 밖으로 빠지므로 소스에서 직접 읽는다.
 */
function arrayReturningSelectors(storeSource: string): string[] {
  const names: string[] = [];
  const needle = 'export function select';
  let at = storeSource.indexOf(needle);
  while (at >= 0) {
    const nameStart = at + 'export function '.length;
    const parenAt = storeSource.indexOf('(', nameStart);
    if (parenAt < 0) break;
    const name = storeSource.slice(nameStart, parenAt).trim();
    const args = balancedArg(storeSource, parenAt);
    if (args !== null) {
      const afterArgs = parenAt + args.length + 2;
      const braceAt = storeSource.indexOf('{', afterArgs);
      const returnType = braceAt < 0 ? '' : normalize(storeSource.slice(afterArgs, braceAt));
      if (returnType.endsWith('[]')) names.push(name);
    }
    at = storeSource.indexOf(needle, at + needle.length);
  }
  return names;
}

/** 셀렉터가 실제로 **돌려주는 식**들. 식 본문이면 하나, 블록 본문이면 `return` 마다 하나. */
function returnedExpressions(selectorArg: string): string[] {
  const arrowAt = selectorArg.indexOf('=>');
  if (arrowAt < 0) return [];
  const body = selectorArg.slice(arrowAt + 2).trim();
  if (!body.startsWith('{')) return [normalize(body)];
  const out: string[] = [];
  let at = body.indexOf('return ');
  while (at >= 0) {
    const end = body.indexOf(';', at);
    out.push(normalize(body.slice(at + 'return '.length, end < 0 ? body.length : end)));
    at = body.indexOf('return ', at + 1);
  }
  return out;
}

/** 이 식이 새 배열·새 객체를 만드는가. */
function makesFreshValue(expr: string, selectorMarkers: string[]): boolean {
  if (expr.startsWith('[') || expr.startsWith('({') || expr.startsWith('{')) return true;
  let last = -1;
  for (const marker of [...FRESH_MARKERS, ...selectorMarkers]) {
    const at = expr.lastIndexOf(marker);
    if (at > last) last = at;
  }
  if (last < 0) return false;
  const tail = expr.slice(last);
  return !PRIMITIVE_TAILS.some((k) => tail.includes(k));
}

function collectSources(): { path: string; text: string }[] {
  const all = { ...tsSources, ...tsxSources } as Record<string, string>;
  return Object.entries(all)
    .map(([key, text]) => ({ path: toSrcPath(key), text }))
    .filter(({ path }) => !/[.]test[.]tsx?$/.test(path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe('zustand 스냅샷 안정성 규약', () => {
  const sources = collectSources();

  it('스캔 대상 소스를 실제로 읽는다', () => {
    // glob 이 조용히 비면 아래 검사가 항상 통과해 규약이 무력해진다.
    expect(sources.length).toBeGreaterThan(50);
  });

  it('배열을 돌려주는 select* 목록을 스토어 소스에서 찾아낸다', () => {
    const store = sources.find((s) => s.path === 'stores/graphStore.ts');
    expect(store, 'graphStore.ts 를 못 읽었다').toBeDefined();
    const names = arrayReturningSelectors(stripComments(store?.text ?? ''));
    // 이름이 하나도 안 잡히면 아래 검사가 통째로 헛돈다.
    expect(names).toContain('selectOrphanIDEPanes');
    expect(names).toContain('selectCanvasAgentBubbles');
  });

  it('구독 셀렉터가 새 배열·새 객체를 돌려주지 않는다', () => {
    const store = sources.find((s) => s.path === 'stores/graphStore.ts');
    const selectorNames = arrayReturningSelectors(stripComments(store?.text ?? ''));
    const selectorMarkers = selectorNames.map((n) => `${n}(`);

    const violations: string[] = [];
    for (const { path, text } of sources) {
      const src = stripComments(text);
      for (const hook of STORE_HOOKS) {
        const needle = `${hook}(`;
        let at = src.indexOf(needle);
        while (at >= 0) {
          const openIdx = at + needle.length - 1;
          const arg = balancedArg(src, openIdx);
          at = src.indexOf(needle, at + needle.length);
          if (arg === null) continue;
          for (const expr of returnedExpressions(arg)) {
            if (!makesFreshValue(expr, selectorMarkers)) continue;
            violations.push(`${path}:${lineOf(src, openIdx)} — ${expr.slice(0, 90)}`);
          }
        }
      }
    }

    expect(
      violations,
      'zustand v5 는 고른 값을 메모하지 않는다 — 새 배열·새 객체를 구독하면 무한 리렌더로 화면이 통째로 죽는다. '
        + '스토어 필드만 구독하고 목록은 useMemo 로 만들 것.',
    ).toEqual([]);
  });

  it('배열 셀렉터는 호출마다 새 배열이다 — 규칙이 이론이 아님을 못 박는다', () => {
    const state = { ideOverlays: {}, activeProject: null, nodeMap: {} };
    const first = selectOrphanIDEPanes(state);
    const second = selectOrphanIDEPanes(state);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
