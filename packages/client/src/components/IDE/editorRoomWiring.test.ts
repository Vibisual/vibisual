/**
 * §5.5 #17-27 ①-1 · ⑪ (e) — 창 컴포넌트(`AgentIDEOverlay`)의 **편집창 자리 배선**.
 *
 *  ① 판 때문에 창을 넓힌 기억은 **창 슬롯**(`editorRoom`)에서 읽고 쓴다. 종전 ref 는 창을 접었다 펴거나 프로젝트
 *     탭을 오가 컴포넌트가 내려가면 사라져, 판을 닫아도 되돌리지 못했고 다시 설 때 또 넓혔다.
 *  ② 판을 닫은 도크 창은 두께를 직접 되돌리지 않고 `settleIDEDockGrowth` 에 맡긴다 — 두께는 같은 변의 창들이 나눠
 *     쓰므로 옆 창을 봐야 한다(되돌리면 그 넓힘에 기대 판을 연 옆 창이 찌부러졌다).
 *  ③ [추종] 은 열면 덮개가 되는 폭뿐 아니라 **창이 자라는 폭**에서도 스스로 판을 열지 않는다 — AI 활동이 창 크기를
 *     바꾸지 않는다. "자랄 수 있는 창" 의 판정은 넓히기 효과가 실제로 넓히는 모양과 같아야 한다.
 *
 * 수치 규칙은 순수 함수 시험이 본다(`ideResponsive.test.ts` 의 `editorGrowth`·`dockGrowthOnClose`,
 * `idePanes.test.ts` 의 슬롯·같은 변 시험). 여기는 그 함수들이 창에 **이어져 있는지**만 본다.
 *
 * ⚠ 이 스위트에는 DOM 이 없다(jsdom 미설치). 컴포넌트는 소스 스캔으로 본다 — `overlayPinButton.test.ts` 와 같은 계열.
 */
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob<string>(
  ['/src/components/IDE/AgentIDEOverlay.tsx'],
  { query: '?raw', import: 'default', eager: true },
);

function readOverlay(): string {
  const src = SOURCES['/src/components/IDE/AgentIDEOverlay.tsx'];
  expect(typeof src, 'AgentIDEOverlay.tsx 를 원문으로 못 읽었다 — 이 스캔의 전제가 깨졌다').toBe('string');
  expect((src ?? '').length).toBeGreaterThan(0);
  return (src ?? '').replace(/\r\n/g, '\n');
}

function slice(text: string, startMarker: string, endMarker: string): string {
  const from = text.indexOf(startMarker);
  expect(from, '시작점을 못 찾았다: ' + startMarker).toBeGreaterThan(-1);
  const to = text.indexOf(endMarker, from);
  expect(to, '끝점을 못 찾았다: ' + endMarker).toBeGreaterThan(from);
  return text.slice(from, to + endMarker.length);
}

/** ①-1 넓히기 효과 — 머리 주석부터 의존성 배열 끝까지. */
function growthEffect(src: string): string {
  return slice(src, '①-1 — 판이 열릴 때 창이 좁으면 덮지 않고', '\n  ]);\n');
}

describe('① 넓힌 기억은 창 슬롯에 산다', () => {
  it('효과는 슬롯의 editorRoom 을 읽고, 판이 닫히면 지우고, 따진 결과를 적는다', () => {
    const block = growthEffect(readOverlay());
    expect(block).toContain('selectIDEPane(useGraphStore.getState(), paneKey).editorRoom');
    expect(block).toContain('setEditorRoom(paneKey, null);');
    expect(block).toContain('setEditorRoom(paneKey, { checked: true, seq, growth });');
    // 이미 따진 판이면 다시 넓히지 않는다 — 접었다 편 창이 도로 자라지 않게.
    expect(block).toContain('if (memo?.checked || !bodyLayout.measured) return;');
  });

  it('기억을 ref 에 두지 않는다 — 컴포넌트가 내려가면 함께 사라진다', () => {
    const block = growthEffect(readOverlay());
    expect(block).not.toMatch(/useRef\s*</);
    expect(readOverlay()).not.toMatch(/paneGrowthRef|paneGrowCheckedRef/);
  });
});

describe('② 도크 두께는 같은 변의 옆 창을 보고 돌려준다', () => {
  it('판을 닫은 도크 창은 settleIDEDockGrowth 에 맡긴다(제 기록대로 곧장 되돌리지 않는다)', () => {
    const block = growthEffect(readOverlay());
    expect(block).toContain('settleDockGrowth(paneKey, rec);');
    expect(block).not.toContain('setPaneDockSize(paneKey, rec.before)');
  });
});

describe('③ [추종] 은 창이 자라는 폭에서 스스로 판을 열지 않는다', () => {
  it('추종의 "좁은 창" 은 덮개 또는 (자랄 수 있는 창에서) 창이 자라는 폭이다', () => {
    const src = readOverlay();
    expect(src).toContain(
      "useEditorFollow(agentId ?? '', activeSessionId, editorWouldCover || (paneCanGrow && editorWouldGrow));",
    );
    // 옛 판정(덮개만)으로 부르는 자리가 남아 있으면 그쪽이 창을 넓힌다.
    expect(src.match(/useEditorFollow\(/g)).toHaveLength(1);
  });

  it('자랄 수 있는 창의 판정이 넓히기 효과의 모양(독립 창·떠 있는 창·좌/우 도크)과 같다', () => {
    const src = readOverlay();
    const canGrow = slice(src, 'const paneCanGrow = ', ';\n');
    expect(canGrow).toContain('!osMaximized');
    expect(canGrow).toContain('growEditorRoomSelf');
    expect(canGrow).toContain('!maximized');
    expect(canGrow).toContain("mode === 'floating'");
    expect(canGrow).toContain("storeDockSide === 'left' || storeDockSide === 'right'");
    const effect = growthEffect(src);
    expect(effect).toContain("if (mode === 'floating') {");
    expect(effect).toContain("if (mode === 'docked' && (storeDockSide === 'left' || storeDockSide === 'right')) {");
  });

  it('"자라는 폭" 은 넓히기 효과와 같은 editorGrowth 로 묻고, 판이 이미 서 있으면 자라지 않는 것으로 본다', () => {
    const wouldGrow = slice(readOverlay(), 'const editorWouldGrow = ', ']);');
    expect(wouldGrow).toContain('!paneOpen && editorGrowth(');
  });
});
