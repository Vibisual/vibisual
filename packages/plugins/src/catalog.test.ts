/**
 * §5.11 v4.18 — CATALOG.md ↔ 등록부 1:1 대조.
 *
 * `CATALOG.md` 는 "용어집 110개를 하나씩 체크해 나간다"는 이 작업의 체크리스트다. 그런데 체크리스트가
 * 사람 손으로만 관리되면 **거짓말을 하기 시작한다** — 실제로 카탈로그가 `react` 라고 적어 둔 항목의
 * 진짜 id 는 `react-pattern` 이었고, 다섯 항목은 한 줄에 묶여 있어 개수를 세면 108개로 보였다.
 * 둘 다 코드에는 아무 영향이 없어서 빌드·타입체크·기존 테스트 어디에도 걸리지 않았다.
 *
 * 그래서 대장을 기계가 읽게 한다.
 *  ① 카탈로그의 모든 id 가 실제 등록부에 있다 — 없는 것을 있다고 적을 수 없다.
 *  ② 등록부의 모든 id 가 카탈로그에 있다 — 만들어 놓고 대장에 빠뜨릴 수 없다.
 *  ③ 한 줄에 항목 하나 — 여러 개를 묶어 한 줄로 포장하면 진행 수치가 어긋난다.
 *  ④ 미구현 표시 `[ ]` 가 남아 있지 않다 — 남았다면 "전부 구현" 이라는 문장이 거짓이 된다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_MANIFESTS } from './registry.js';

const CATALOG = fs.readFileSync(path.resolve(__dirname, '../CATALOG.md'), 'utf8');

/** 체크된 항목 줄에서 id 만 뽑는다. 형식: `- [x] **plugin-id** — 설명` */
const catalogIds = [...CATALOG.matchAll(/^- \[x\] \*\*([a-z0-9-]+)\*\*/gm)].map((m) => m[1]);
const registryIds = PLUGIN_MANIFESTS.map((m) => m.id);

describe('CATALOG.md 대장 대조', () => {
  it('카탈로그에 적힌 id 가 전부 등록부에 실재한다', () => {
    const known = new Set(registryIds);
    expect(catalogIds.filter((id) => !known.has(id))).toEqual([]);
  });

  it('등록된 플러그인이 전부 카탈로그에 적혀 있다', () => {
    const listed = new Set(catalogIds);
    expect(registryIds.filter((id) => !listed.has(id))).toEqual([]);
  });

  it('카탈로그에 같은 id 가 두 번 적히지 않았다', () => {
    expect(catalogIds.filter((id, i) => catalogIds.indexOf(id) !== i)).toEqual([]);
  });

  it('한 줄에 항목 하나만 적는다 — 묶어서 포장하면 진행 수치가 어긋난다', () => {
    const packed = CATALOG.split('\n').filter((line) => (line.match(/\[x\]/g) ?? []).length > 1);
    expect(packed).toEqual([]);
  });

  it('미구현으로 남은 항목이 없다', () => {
    expect(CATALOG.match(/^- \[ \]/gm)).toBeNull();
  });
});
