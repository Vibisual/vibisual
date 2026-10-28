/**
 * §5.11 — `CATALOG.md` ↔ 등록부 1:1 대조. 손으로만 관리하는 체크리스트는 어긋나도 빌드·타입체크·다른 시험에 안 걸린다.
 *  ① 카탈로그의 모든 id 가 등록부에 있다 ② 등록부의 모든 id 가 카탈로그에 있다
 *  ③ 한 줄에 항목 하나(묶으면 진행 수치가 어긋난다) ④ 미구현 표시 `[ ]` 가 없다.
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
