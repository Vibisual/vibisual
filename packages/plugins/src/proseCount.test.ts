/**
 * §5.11 — 주석·글에 박힌 카드 수를 등록부와 대조한다. 카드가 하나 늘면 그 숫자들이 조용히 전부 거짓이 되고,
 * 그 숫자는 판단 근거로 쓰인다 — 사람이 지킬 수 없는 약속이라 틀린 순간 드러나게 기계에 맡긴다.
 * 대상은 `<세 자리 숫자>종`·`<세 자리 숫자>장` 꼴뿐(한글 수사·두 자리 이하는 다른 것을 세는 일이 많다).
 * 카드 수가 아닌 것을 세는 줄(예: 절차 예산 "40벌")은 줄 안에 `count-ok` 를 적어 빼 둔다 —
 * 개인정보 스캐너의 `privacy-ok` 와 같은 방식이다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_MANIFESTS } from './registry.js';

const ROOT = path.resolve(__dirname, '../../..');

/** 플러그인 층에서 산문이 들어 있는 자리들. 테스트 파일은 뺀다 — 지난 수치를 이력으로 적기 때문이다. */
const SCOPE = [
  'packages/plugins/src',
  'packages/plugins/CATALOG.md',
  'packages/client/src/plugins',
  'packages/client/src/components/Plugins',
  'packages/server/src/services/pluginHost.ts',
];

function walk(target: string): string[] {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true })
    .flatMap((e) => walk(path.join(target, e.name)));
}

const FILES = SCOPE.flatMap(walk).filter(
  (f) => /\.(ts|tsx|md)$/.test(f) && !f.includes('.test.'),
);

/** `111종` · `111 장` 처럼 세 자리 숫자로 개수를 말하는 자리. */
const COUNT_CLAIM = /(\d{3})\s*(종|장)/g;

describe('산문에 박힌 카드 수', () => {
  it('검사할 파일을 실제로 찾았다 — 경로가 어긋나면 검사가 조용히 통과한다', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('주석·문서가 말하는 카드 수가 등록부와 같다', () => {
    const expected = PLUGIN_MANIFESTS.length;
    const wrong: string[] = [];

    for (const file of FILES) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (line.includes('count-ok')) continue;   // 카드 수가 아닌 것을 세는 줄
        for (const [, digits, counter] of line.matchAll(COUNT_CLAIM)) {
          if (Number(digits) !== expected) wrong.push(`${rel}: "${digits}${counter}" (등록 ${expected})`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });
});
