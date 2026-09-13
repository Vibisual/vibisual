/**
 * §5.5 #17-6 — **밖에 선 IDE 창의 닫기는 창을 닫는다**는 회귀.
 *
 * 역사: 끌어낸 창의 닫기가 버블로 변하던 것을 (H-4)/(H-9) 가 출신으로 갈라 고쳤고, (H-18) 이
 * 타이틀바 [오버레이 버블로 바꾸기]를 세우며 "바꾼 창은 그 뒤로 접힌다"를 얹었다. (H-20) 은 그
 * 갈래를 전부 걷는다 — 사용자 지시: "이거 누르면 독립된 창이 오버레이 버블이 되는데 여기에 버튼이
 * 생겼으니 독립된 IDE 창을 닫기 누르면 닫히게 만들어". 버블로 가는 손잡이가 따로 섰으니 닫기는
 * 닫아야 한다 — 출신도, 바꾼 이력도 닫기의 뜻을 바꾸지 않는다.
 *
 * 여기서 못 박는 것 셋:
 *  ① 규칙 자체(세 갈래 — 버블 부탁은 접기 · 닫기는 닫기 · 닫을 다리 없으면 물러남), 그리고
 *     출신이 입력에서 **빠졌다**는 사실.
 *  ② `OverlayShell` 이 그 규칙을 **실제로 부르고 있는가** — 표식은 손잡이가 닫기 전에 세우고,
 *     효과가 읽은 뒤 **곧바로 내리는가**(안 내리면 다시 편 뒤의 닫기가 접기로 간다), 닫기 전에
 *     (H-9) 대로 앱을 앞으로 끌어올리되 IDE 는 다시 열지 않는가, 받아 주지 못해도 닫는가.
 *  ③ 되돌리기(↩)는 종전대로 IDE 를 다시 연다(닫기와 뜻이 갈린다).
 *
 * ⚠ 이 스위트에는 DOM 이 없다(jsdom 미설치). 컴포넌트를 렌더할 수 없으므로 ②③ 은 소스 스캔으로
 *   본다 — `sliceScopeCarryForward.test.ts` 와 같은 계열의 집행이다.
 */
import { describe, it, expect } from 'vitest';
import { resolveOverlayCloseIntent } from './overlayCloseIntent.js';

const SOURCES = import.meta.glob<string>(
  [
    '/src/components/Layout/OverlayShell.tsx',
    '/src/components/Layout/overlayCloseIntent.ts',
    '/src/components/IDE/AgentIDEOverlay.tsx',
    '/src/hooks/useOverlayReveal.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);

const LOCALES = import.meta.glob<Record<string, unknown>>(
  '/src/i18n/locales/*.json',
  { import: 'default', eager: true },
);

function readSource(path: string): string {
  const src = SOURCES[path];
  expect(typeof src, path + ' 를 원문으로 못 읽었다 — 이 스캔의 전제가 깨졌다').toBe('string');
  expect((src ?? '').length, path + ' 가 빈 문자열로 왔다').toBeGreaterThan(0);
  return src ?? '';
}

/** 접힘을 미러하는 효과의 본문 — 판정·표식 내림·되돌리기·닫기가 전부 이 안에 있다. */
function closeEffect(text: string): string {
  const from = text.indexOf('resolveOverlayCloseIntent(');
  expect(from, 'resolveOverlayCloseIntent 호출을 못 찾았다').toBeGreaterThan(0);
  const to = text.indexOf('}, [expanded,', from);
  expect(to, '효과의 끝(의존성 배열)을 못 찾았다').toBeGreaterThan(from);
  return text.slice(from, to);
}

describe('① 닫기는 닫는다 — 출신도 이력도 뜻을 바꾸지 않는다', () => {
  it('✕/Esc 는 창을 닫는다', () => {
    expect(resolveOverlayCloseIntent({ toBubble: false, canCloseSelf: true })).toBe('close');
  });

  it('[오버레이 버블로 바꾸기]의 부탁이면 접는다 — 버블로 가는 유일한 길', () => {
    expect(resolveOverlayCloseIntent({ toBubble: true, canCloseSelf: true })).toBe('collapse');
  });

  it('닫을 다리가 없으면(옛 preload) 접기로 물러난다 — 남아 있어야 손댈 수 있다', () => {
    expect(resolveOverlayCloseIntent({ toBubble: false, canCloseSelf: false })).toBe('collapse');
  });

  it('판정은 출신·바꾼 이력을 받지 않는다 — 그 입력이 되살아나면 위젯 출신·바꾼 창의 닫기가 다시 접기로 간다', () => {
    const rule = readSource('/src/components/Layout/overlayCloseIntent.ts');
    expect(rule, '출신(initiallyExpanded)이 입력으로 돌아왔다').not.toMatch(/initiallyExpanded\s*\??:/);
    expect(rule, '바꾼 이력(convertedToBubble)이 입력으로 돌아왔다').not.toMatch(/convertedToBubble\s*\??:/);
    expect(rule, '되돌리기 실패를 접기로 돌리던 갈래가 남아 있다').not.toContain('resolveAfterReveal');
  });
});

describe('② OverlayShell 이 그 규칙을 실제로 쓰고 있다', () => {
  const src = (): string => readSource('/src/components/Layout/OverlayShell.tsx');

  it('`resolveOverlayCloseIntent` 를 부르고 표식(`toBubble`)만 넘긴다 — 출신은 넘기지 않는다', () => {
    const text = src();
    const at = text.indexOf('resolveOverlayCloseIntent(');
    expect(at, 'resolveOverlayCloseIntent 호출을 못 찾았다').toBeGreaterThan(0);
    const call = text.slice(at, at + 200);
    expect(call).toContain('toBubble: toBubbleRef.current');
    expect(call, '출신을 판정에 넘긴다 — 닫기가 다시 출신으로 갈린다').not.toContain('initiallyExpanded');
    expect(call, '(H-18) 의 눌러 둔 이력을 판정에 넘긴다').not.toContain('convertedToBubble');
  });

  it('표식은 손잡이가 닫기보다 **먼저** 세운다 — 뒤에 세우면 같은 틱의 효과가 닫기로 읽는다', () => {
    const text = src();
    const mark = text.indexOf('toBubbleRef.current = true');
    const close = text.indexOf('closeIDEOverlay();');
    expect(mark, '버블 부탁 표식을 못 찾았다').toBeGreaterThan(0);
    expect(close, '그 뒤의 닫기 호출을 못 찾았다').toBeGreaterThan(0);
    expect(mark, '표식보다 닫기가 앞선다').toBeLessThan(close);
  });

  it('효과는 표식을 읽은 뒤 **곧바로 내린다** — 안 내리면 버블을 다시 편 뒤의 닫기가 접기로 간다', () => {
    const effect = closeEffect(src());
    const reset = effect.indexOf('toBubbleRef.current = false');
    expect(reset, '표식을 내리는 자리를 못 찾았다').toBeGreaterThan(0);
    // 내리는 자리는 어느 갈래로 가든 지나는 곳이어야 한다 — 접기 갈래보다 앞.
    const collapse = effect.indexOf('overlay.collapseSelf(');
    expect(collapse, '접기 호출을 못 찾았다').toBeGreaterThan(0);
    expect(reset, '접기 갈래가 표식을 내리기 전에 돌아간다 — 다음 닫기가 접기로 읽는다').toBeLessThan(collapse);
  });

  it('`collapseSelf` 를 그 판정 **없이** 부르는 자리가 없다(옛 무조건 접기의 흔적)', () => {
    const text = src();
    // 접기 **호출**은 전부 판정 뒤에 와야 한다. 주석에도 `collapseSelf()` 가 등장하므로
    //   실제 호출 형태(`overlay.collapseSelf(`)로만 찾는다 — 문자열만 보고 세면 주석 한 줄에
    //   이 집행이 무너진다.
    const decide = text.indexOf('resolveOverlayCloseIntent(');
    expect(decide, 'resolveOverlayCloseIntent 호출을 못 찾았다').toBeGreaterThan(0);
    const calls = [...text.matchAll(/overlay\.collapseSelf\(/g)].map((m) => m.index ?? -1);
    expect(calls.length, 'collapseSelf 호출을 못 찾았다').toBeGreaterThan(0);
    for (const at of calls) expect(at, '판정보다 앞선 접기 호출이 있다').toBeGreaterThan(decide);
  });

  it('닫기 전에 앱을 앞으로 끌어올리되 IDE 는 **다시 열지 않는다**((H-9)) — 열면 닫기를 두 번 눌러야 닫힌다', () => {
    const text = src();
    const at = text.indexOf('reveal({');
    expect(at, '닫기의 revealInMain 호출을 못 찾았다').toBeGreaterThan(0);
    const call = text.slice(at, at + 200);
    expect(call, '닫기가 openIde 로 창을 다시 연다(= 되돌리기와 같은 길)').toContain('openIde: false');
    expect(call, '닫기가 앱 안 남의 창까지 닫는다').toContain('keepPanes: true');
    expect(call, '닫기가 짐을 싣는다 — 열 창이 없으므로 꺼내는 쪽이 없다').not.toContain('handoff');
  });

  it('받아 주지 못해도 닫는다 — 되돌리기 실패·다리 없음이 접기로 물러나던 갈래는 없다', () => {
    const effect = closeEffect(src());
    expect(effect, '되돌리기 실패를 접기로 돌리던 갈래가 남아 있다').not.toContain('resolveAfterReveal');
    // 되돌리기의 성공·실패 양쪽이 같은 닫기로 간다.
    expect(effect, '되돌리기가 실패하면 닫지 않는다').toContain('.then(close, close)');
    // 되돌릴 다리가 없어도 닫는다.
    expect(effect, '되돌릴 다리가 없으면 닫지 않는다').toContain('if (!reveal) { close(); return; }');
  });

  it('닫는 것은 `closeSelf` 다 — 창을 접거나 숨기는 다른 길로 새지 않는다', () => {
    const effect = closeEffect(src());
    expect(effect).toContain('overlay.closeSelf?.()');
  });
});

describe('③ (H-21) 되돌리기(↩) 손잡이는 없다 — 닫기(✕)가 같은 일을 한다', () => {
  it('타이틀바에 [앱 안으로 되돌리기] 버튼이 서지 않는다 — 같은 결과로 가는 손잡이가 둘이면 안 된다', () => {
    const text = readSource('/src/components/IDE/AgentIDEOverlay.tsx');
    expect(text, '↩ 버튼 문구가 남아 있다').not.toContain("t('ide.overlay.returnToApp')");
    expect(text, '↩ 버튼의 칩 합치기 드래그가 남아 있다').not.toContain('redockDragStart');
  });

  it('IDE 가 `revealInMain` 을 직접 부르지 않는다 — 앱으로 돌아가는 길은 셸의 닫기((H-9))와 타이틀바 끌어 넣기((H-4))뿐', () => {
    const text = readSource('/src/components/IDE/AgentIDEOverlay.tsx');
    expect(text).not.toContain('revealInMain(');
  });

  it('Esc 는 ✕ 와 같은 길이다 — 밖에 선 창에서 Esc 만 버블로 가면 안 된다', () => {
    const text = readSource('/src/components/IDE/AgentIDEOverlay.tsx');
    expect(text).toContain("if (e.key === 'Escape') closeOverlay();");
  });
});

describe('④ 닫기로 돌아온 길은 앱 안 창을 건드리지 않는다', () => {
  it('`useOverlayReveal` 이 `keepPanes` 를 보고 앞 창 닫기를 건너뛴다', () => {
    const text = readSource('/src/hooks/useOverlayReveal.ts');
    // 앞 창 정리(`closeIDEOverlay`)는 우클릭 점프의 규율이다 — 닫기에는 조건이 붙어야 한다.
    expect(text, 'closeIDEOverlay 호출을 못 찾았다').toContain('store.closeIDEOverlay()');
    expect(text, 'keepPanes 를 안 본다 — 밖의 창을 닫으면 앱 안 남의 창이 함께 닫힌다')
      .toContain('if (!keepPanes) store.closeIDEOverlay();');
  });
});

describe('⑤ (H-18) 손잡이 — 밖에 있을 때만, 셸이 준 길로, 12 로케일', () => {
  it('손잡이는 **밖에 있을 때만** 선다 — 앱 안 창에는 바꿀 창이 없다', () => {
    const text = readSource('/src/components/IDE/AgentIDEOverlay.tsx');
    expect(text, '노출 조건이 fullWindow 에 걸려 있지 않다')
      .toContain('{fullWindow && !!onCollapseToBubble && (');
    expect(text, '손잡이가 셸이 준 길로 가지 않는다').toContain('onClick={onCollapseToBubble}');
  });

  it('IDE 가 접기 IPC 를 직접 부르지 않는다 — 부르면 셸의 표식 없이 접혀 닫기와 구분이 안 된다', () => {
    const text = readSource('/src/components/IDE/AgentIDEOverlay.tsx');
    expect(text).not.toContain('collapseSelf(');
  });

  it('두 문자열이 12 로케일 전부에 있다 — 하나라도 비면 그 언어에서 손잡이가 벙어리가 된다', () => {
    const paths = Object.keys(LOCALES);
    expect(paths.length, '로케일 파일을 못 읽었다').toBeGreaterThanOrEqual(12);
    for (const path of paths) {
      const dict = LOCALES[path] as { ide?: { overlay?: Record<string, string> } };
      const overlay = dict.ide?.overlay ?? {};
      expect(overlay.toBubble, `${path} 에 ide.overlay.toBubble 이 없다`).toBeTruthy();
      expect(overlay.toBubbleHint, `${path} 에 ide.overlay.toBubbleHint 가 없다`).toBeTruthy();
    }
  });
});
