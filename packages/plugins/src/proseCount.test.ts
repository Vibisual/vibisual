/**
 * §5.11 v4.32 — 주석에 박힌 카드 수를 등록부와 대조.
 *
 * 두 라운드 연속으로 **주석이 먼저 틀렸다.** v4.30 은 "기여가 없으면 렌더 비용 0", v4.31 은 "1분마다
 * 값이 바뀐다" 였는데, 둘 다 의도를 사실처럼 적어 둔 문장이었고 **적혀 있으니 아무도 다시 재 보지 않았다.**
 *
 * 같은 부류가 하나 더 있다 — 열두 군데가 "111종 / 111장" 이라고 카드 수를 프로세에 박아 두고 있다.
 * 지금은 맞지만 112번째가 들어오는 순간 열두 군데가 **조용히 전부 거짓**이 된다. 그리고 그 숫자는
 * 대부분 판단의 근거로 쓰인다("111종을 켠 화면은 배지 띠가 된다" 같은).
 *
 * 사람이 지킬 수 없는 약속이므로 기계에 맡긴다. 숫자를 고칠 수 없다면 최소한 **틀렸다는 사실이 즉시
 * 드러나야** 한다.
 *
 * 검사 대상은 `<세 자리 숫자>종` · `<세 자리 숫자>장` 형태뿐이다. 카드 수를 세는 말투가 그것이고,
 * "세 장"·"열 장" 같은 한글 수사나 두 자리 이하는 다른 것을 세는 경우가 많아 건드리지 않는다.
 *
 * 카드 수가 아닌 것을 세는 줄(예: Brain 예산 "300장")은 줄 안에 `count-ok` 를 적어 빼 둔다 —
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
