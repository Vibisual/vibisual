/**
 * §4 (CMD 터미널 ⑤) — 경계선 하나를 끌면 split 하나만 움직이는지 소스 계약으로 고정한다(드래그는 DOM 이라 못 돌린다).
 * split 을 첫째 자식의 첫 leaf id 로 식별하면 안 된다 — 중첩 split 이 같은 키를 가져 다른 선도 함께 움직이고 그 비율이 저장된다.
 */

import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('./*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(name: string): string {
  const found = sources[`./${name}`];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${name}`);
  return found;
}

describe('CMD pane 경계선 — split 식별 키', () => {
  const src = source('IDETerminalPanes.tsx');

  it('split 을 식별할 때 첫째 자식이 아니라 둘째 자식의 첫 leaf 를 본다', () => {
    // `collectCmdPaneIds(node.children[N])[0]` 이 split 을 식별하는 자리 — N 은 전부 1 이어야 한다.
    const picks = [...src.matchAll(/collectCmdPaneIds\(node\.children\[(\d)\]\)\[0\]/g)].map((m) => m[1]);

    expect(picks.length, '식별 자리를 못 찾았다 — 이 스캔의 전제가 깨졌다(리팩터링됐으면 이 테스트를 고쳐라)')
      .toBeGreaterThanOrEqual(2);
    expect(
      picks.filter((n) => n !== '1'),
      'children[0] 의 첫 leaf 로 split 을 식별하면 조상과 자손이 같은 키를 갖는다 — ' +
      '중첩 분할에서 경계선 두 개가 함께 움직인다.',
    ).toEqual([]);
  });

  it('비율을 갈아 끼우는 자리는 clamp 를 거친다 — 경계선을 창 밖까지 끌어도 pane 이 사라지지 않는다', () => {
    expect(src).toContain('CMD_PANE_RATIO_MIN');
    expect(src).toContain('CMD_PANE_RATIO_MAX');
  });
});
