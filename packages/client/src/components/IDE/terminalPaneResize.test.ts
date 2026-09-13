/**
 * §4 (CMD 터미널 ⑤) — **경계선 하나를 끌면 split 하나만 움직이는가.**
 *
 * 종전 결함: `IDETerminalPanes` 는 split 노드를 *첫째* 자식의 첫 leaf id 로 식별했다. 그 키는
 * **유일하지 않다** — 잎 `L` 에서 루트로 올라가며 "부모의 children[0] 인 동안" 만나는 조상 split 이
 * 전부 같은 키를 갖는다. 그래서 첫 pane 을 한 번 더 분할한 `row[ col[leaf0, leaf2], leaf1 ]` 에서
 * 바깥 row 와 안쪽 col 이 둘 다 `'0'` 이 되어, **가로 분할선을 끌면 세로 분할선까지 같이 움직였고**
 * 그 비율이 `handleResizeEnd` → `PUT /api/cmd-pane-tree` 로 서버에 저장까지 됐다.
 *
 * 판정 로직 자체(`resizeCmdPane`)의 회귀는 `server/services/cmdPaneTree.test.ts` 가 실제 트리로
 * 잡는다. 여기서 지키는 것은 **클라이언트가 그 규약과 같은 자식을 보고 있는가** 다 — 드래그는
 * DOM pointer 이벤트 위에 살아 클라이언트 테스트에 jsdom 이 없으면(`vitest.config.ts`) 실행할 수
 * 없으므로, 되돌아가면 결함이 그대로 되살아나는 **소스 계약**을 고정한다.
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
