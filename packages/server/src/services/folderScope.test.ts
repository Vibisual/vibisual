import { describe, it, expect } from 'vitest';
import { resolveFolderShipSet } from './folderScope.js';

/**
 * §9 폴더 스코프 — **규칙 자체**를 표로 고정한다.
 *
 * 이 규칙이 틀리면 증상은 성능이 아니라 **기능 손상**으로 나온다: 폴더를 열었는데 안이 비어 있다 ·
 * 뒤로 갔더니 상위가 비어 있다 · 경로 표시(breadcrumb)에서 이름이 사라진다. 그래서 "무엇을
 * 빼는가" 만큼 **"무엇은 절대 빼지 않는가"** 를 함께 못 박는다(프로젝트 축이 세운 것과 같은 규율).
 */

/** `a` 안에 `a1`·`a2`, `a1` 안에 `a1x` — 두 단계짜리 최소 트리. */
const TREE: Record<string, string[]> = {
  a: ['a1', 'a2'],
  a1: ['a1x'],
  a2: [],
  a1x: [],
  b: ['b1'],
  b1: [],
};
const childFoldersOf = (id: string): readonly string[] => TREE[id] ?? [];

describe('resolveFolderShipSet — 그리는 폴더 + 한 칸 앞', () => {
  it('선언이 없으면(null) 전량이다 — 침묵은 축소가 아니다', () => {
    // 구버전 클라가 하나라도 붙어 있거나 부팅 직후라 아무도 선언하지 않은 상태.
    // 여기서 좁히면 그 창의 폴더 내부가 영영 빈 채로 굳는다.
    expect(resolveFolderShipSet(['a', 'b'], null, childFoldersOf)).toBeNull();
  });

  it('메인 뷰(빈 선언)에서도 최상위 폴더의 children 은 싣는다 — 폴더를 누르면 즉시 열려야 한다', () => {
    const ship = resolveFolderShipSet(['a', 'b'], new Set(), childFoldersOf);
    expect(ship).not.toBeNull();
    expect([...ship!].sort()).toEqual(['a', 'b']);
  });

  it('폴더에 들어가면 그 폴더 + 하위 폴더(한 칸 앞)가 함께 실린다', () => {
    const ship = resolveFolderShipSet(['a', 'b'], new Set(['a']), childFoldersOf)!;
    // 지금 그리는 내용
    expect(ship.has('a')).toBe(true);
    // 한 칸 앞 — 이 안에서 다음에 누를 수 있는 것들. 이게 없으면 드릴다운마다 왕복이 보인다.
    expect(ship.has('a1')).toBe(true);
    expect(ship.has('a2')).toBe(true);
    // 두 칸 앞은 싣지 않는다 — 실측 세 배 부피에 얻는 것이 없다(누르는 사이 왕복이 끝난다).
    expect(ship.has('a1x')).toBe(false);
  });

  it('내비 경로의 조상도 전부 실린다 — 뒤로가기와 경로 표시가 이름을 찾는 자리다', () => {
    // a → a1 로 두 칸 들어간 상태. 선언은 조상부터 현재까지 전부다.
    const ship = resolveFolderShipSet(['a', 'b'], new Set(['a', 'a1']), childFoldersOf)!;
    expect(ship.has('a')).toBe(true);    // ← Back 이 즉시 열려야 한다
    expect(ship.has('a1')).toBe(true);   // 지금 그리는 내용
    expect(ship.has('a1x')).toBe(true);  // 한 칸 앞
  });

  it('폴더 안에 들어가 있어도 최상위는 계속 싣는다 — 홈으로 돌아가는 것도 즉시여야 한다', () => {
    const ship = resolveFolderShipSet(['a', 'b'], new Set(['a', 'a1']), childFoldersOf)!;
    expect(ship.has('b')).toBe(true);
  });

  it('선언에 없는 가지는 싣지 않는다 — 이 한 줄이 이 최적화의 전부다', () => {
    const ship = resolveFolderShipSet(['a', 'b'], new Set(['a']), childFoldersOf)!;
    // b 자체는 최상위라 실리지만, b 의 자식은 b 를 열어야 온다.
    expect(ship.has('b')).toBe(true);
    expect(ship.has('b1')).toBe(false);
  });

  it('여러 창이 서로 다른 폴더를 보고 있으면 합집합이다', () => {
    // 메인 창은 a 안, 별창은 b 안 — 한쪽을 좁히면 다른 창이 빈다.
    const ship = resolveFolderShipSet(['a', 'b'], new Set(['a', 'b']), childFoldersOf)!;
    expect([...ship].sort()).toEqual(['a', 'a1', 'a2', 'b', 'b1']);
  });

  it('없는 폴더를 선언해도 조용히 넘어간다(창이 오래된 id 를 들고 있어도 스냅샷이 깨지지 않는다)', () => {
    const ship = resolveFolderShipSet(['a'], new Set(['gone-folder']), childFoldersOf)!;
    expect(ship.has('a')).toBe(true);
    expect(ship.has('gone-folder')).toBe(true); // 실을 것이 없으면 그냥 빈 항목이 된다
  });
});
