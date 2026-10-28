/** §5.26 (I) ⑤ — 실패한 압축 건수는 상태바가 아니라 보험 창 안에서 본다. 상태바 배지를 도로 붙이지 않는지, 안에서는 보이는지 둘 다 잠근다(DOM 이 없어 소스 문자열로). */
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
