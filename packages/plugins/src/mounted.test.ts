/**
 * §5.11 v4.37 — 호스트 슬롯이 코어 화면에 실제로 물려 있는가.
 *
 * 카드를 111장 만들고 검사를 열 겹으로 둘렀지만, **슬롯이 코어에서 빠지면 전부 화면에 없는 것과 같다.**
 * 그리고 그 사고는 조용히 일어난다 — 빌드도 타입체크도 통과하고, 플러그인 쪽 테스트도 전부 초록이다.
 * 카드가 안 보이는 것을 사람이 알아채는 수밖에 없는데, **전부 기본 비활성이라 안 보이는 게 정상**이라서
 * 알아챌 방법이 없다.
 *
 * 검사 대상은 클라이언트 파일이지만 이 파일은 **plugins 패키지**에 둔다 — 클라이언트 빌드는 테스트까지
 * 컴파일하는데 그 설정에는 Node 타입이 없어 `node:fs` 를 쓸 수 없다. plugins 쪽은 이미 같은 이유로
 * 클라이언트의 `en.json` 을 읽고 있다(`renderAll.test.tsx`).
 *
 * 렌더 동작이 아니라 **배선의 존재**를 본다 — 빠지는 사고의 대부분은 배선이 통째로 사라지는 형태다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_SRC = path.resolve(__dirname, '../../client/src');

/** 슬롯 → 그것을 부르기로 한 코어 파일. 자리를 옮기면 이 표도 함께 고친다. */
const WIRING: { slot: string; file: string; why: string }[] = [
  { slot: 'PluginsWindow', file: 'components/Layout/FileMenu.tsx', why: '켜고 끄는 창으로 들어가는 유일한 입구' },
  { slot: 'PluginBubbleBadgeSlot', file: 'components/BubbleMap/BubbleNode.tsx', why: '버블 위 배지' },
  { slot: 'PluginPanelSectionSlot', file: 'components/Panel/DetailPanel.tsx', why: '버블을 열었을 때의 카드들' },
  { slot: 'PluginHeaderSlot', file: 'components/Layout/Header.tsx', why: '버블에 매이지 않는 전역 항목' },
];

describe('플러그인 슬롯 배선', () => {
  for (const { slot, file, why } of WIRING) {
    it(`${slot} 가 ${file} 에 물려 있다 — ${why}`, () => {
      const full = path.join(CLIENT_SRC, file);
      expect(fs.existsSync(full), `코어 파일이 없다: ${file}`).toBe(true);

      // 그리는지만 본다. import 가 빠지면 타입체크가 먼저 막으므로 여기서 또 확인할 필요가 없다.
      const text = fs.readFileSync(full, 'utf8');
      expect(text.includes(`<${slot}`), `${file} 이 <${slot}> 를 그리지 않는다`).toBe(true);
    });
  }

  it('배선 표가 비어 있지 않다 — 표가 비면 이 검사가 조용히 통과한다', () => {
    expect(WIRING.length).toBe(4);
  });
});
