/**
 * §5.26 (I) ⑤ — **실패로 끝난 압축 건수는 상태바에 붙지 않는다. 보험 창 안에서 확인한다.**
 *
 * 사용자 지시(2026-09-13): "이거 1 밖에서는 안 뜨고 안에 들어갔을 때 확인 가능하게 해." 그 전까지
 * IDE 상태바 컨텍스트 칸 옆에 빨간 숫자(`1`)가 섰고, SSOT §5.26 (I) ④ 가 그 자리를 적어 두고 있었다.
 * 여기서 잠그는 것은 **되돌아감**이다 — ④ 의 문장만 읽고 배지를 도로 붙이면 사용자가 걷으라고 한
 * 숫자가 다시 선다. 반대쪽도 함께 잠근다: 밖에서 걷기만 하고 안에 안 세우면 그 수를 볼 곳이 없어진다.
 *
 * 클라 테스트에는 DOM 이 없으므로(jsdom 미설치) 렌더가 아니라 **소스 문자열**을 읽는다.
 */
import { describe, it, expect } from 'vitest';
import en from '../../i18n/locales/en.json';

const statusBar = import.meta.glob('./IDEStatusBar.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const popup = import.meta.glob('../Panel/ContextInsurancePopup.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** 주석을 걷은 코드만 — 주석은 옛 배지의 내력을 설명하느라 같은 낱말을 쓴다. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const read = (dotted: string): unknown =>
  dotted.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    en as unknown,
  );

describe('§5.26 (I) ⑤ 실패 압축 건수의 자리', () => {
  const barSrc = statusBar['./IDEStatusBar.tsx'] ?? '';
  const popupSrc = popup['../Panel/ContextInsurancePopup.tsx'] ?? '';

  it('두 소스를 실제로 읽었다 — glob 이 비면 아래 검사가 전부 헛통과한다', () => {
    expect(barSrc.length, 'IDEStatusBar.tsx 를 못 읽었다').toBeGreaterThan(0);
    expect(popupSrc.length, 'ContextInsurancePopup.tsx 를 못 읽었다').toBeGreaterThan(0);
  });

  it('상태바는 실패 건수를 읽지도 그리지도 않는다', () => {
    expect(codeOnly(barSrc), '상태바에 실패 건수가 되돌아왔다 — 사용자가 걷으라고 한 숫자다').not.toMatch(/failedCompacts/i);
  });

  it('보험 창은 그 수를 창의 눈금대로 읽어 칩으로 세운다', () => {
    const code = codeOnly(popupSrc);
    expect(code).toContain('scopedFailedCompacts(');
    expect(code).toContain("'panel.insurance.failedBadge'");
    expect(code).toContain("'panel.insurance.failedBadgeTip'");
  });

  it('칩 문구는 무엇의 수인지 말한다 — 숫자만 두지 않는다', () => {
    const badge = read('panel.insurance.failedBadge');
    const tip = read('panel.insurance.failedBadgeTip');
    expect(typeof badge === 'string' && badge.includes('{{count}}')).toBe(true);
    expect(typeof badge === 'string' && badge.replace('{{count}}', '').trim().length > 0, '낱말 없이 숫자만 남는다').toBe(true);
    expect(typeof tip === 'string' && tip.includes('{{count}}') && tip.includes('{{scope}}')).toBe(true);
  });

  it('상태바 전용이던 툴팁 키는 남아 있지 않다 — 되살리는 손이 옛 문구를 집어 들지 않게', () => {
    expect(read('ide.statusBar.failedCompactsTip')).toBeUndefined();
  });
});
