import { describe, it, expect } from 'vitest';
import { pickReadableTextColor } from '../../utils/commentBoxStyle.js';

/** 색 선택기 가독 규약 집행 — 눈으로만 보이는 규칙이라 되돌리려면 이 시험을 함께 고치게 한다. DOM 이 없어 `import.meta.glob(?raw)` 로 소스를 읽는다. */

const sources = import.meta.glob('./CommentBoxColorPopover.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const src = Object.values(sources)[0] ?? '';

/** `Swatch` 본문만 본다 — 다른 상자는 테두리 규칙이 다르고, 주석의 옛 값이 오탐을 낸다. */
function swatchBody(): string {
  const start = src.indexOf('function Swatch(');
  expect(start, 'Swatch 컴포넌트가 사라졌다 — 세 팔레트가 다시 각자 마크업을 들면 규약이 무너진다').toBeGreaterThan(0);
  // 다음 최상위 문서 주석까지 = 이 컴포넌트의 끝.
  const end = src.indexOf('\n/**', start);
  expect(end, 'Swatch 뒤의 문서 주석을 못 찾았다').toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('색 선택기 — 칸에서 색이 차지하는 넓이', () => {
  it('색 칸은 격자 칸을 꽉 채운다 — 고정 크기로 되돌아가지 않는다', () => {
    const body = swatchBody();
    expect(body).toContain('aspect-square');
    expect(body).toContain('w-full');
    // 종전 판의 고정 치수. 이게 돌아오면 칸의 65% 가 다시 여백이 된다.
    expect(body).not.toMatch(/\bh-4 w-4\b/);
  });

  it('칸 테두리는 회색이 아니라 흰색 반투명 헤어라인이다', () => {
    // 회색 테두리는 색을 먹으면서 정작 어두운 칸(#0F172A)을 gray-900 바닥에서 떼어내지 못했다.
    expect(swatchBody()).not.toMatch(/border-gray-\d/);
    expect(swatchBody()).toContain('SWATCH_EDGE');
    expect(src).toMatch(/const SWATCH_EDGE = 'inset 0 0 0 1px rgba\(255,255,255,[\d.]+\)'/);
  });

  it('고른 표시는 색을 덮지 않고, 표식 색은 그 칸의 밝기가 정한다', () => {
    const body = swatchBody();
    // 흰 테두리 고정은 가장 밝은 칸에서 "골랐는지조차 안 보이는" 상태를 만든다.
    expect(body).not.toContain('border-white');
    expect(body).toContain('pickReadableTextColor');
    // 대비 잉크가 선택 링과 체크 글리프 **양쪽**에 쓰여야 한다.
    expect(body).toContain('inset 0 0 0 2px ${ink}');
    expect(body).toContain('stroke={ink}');
  });

  it('세 팔레트(프리셋·확장·그레이)가 모두 같은 칸 컴포넌트를 쓴다', () => {
    // 마크업이 세 벌로 갈리면 한 곳만 고쳐져 어긋난다(종전 판이 그랬다).
    const uses = src.match(/<Swatch\b/g) ?? [];
    expect(uses.length).toBe(3);
  });
});

describe('색 선택기 — 표식은 어느 색 위에서도 보인다', () => {
  // 팔레트 양 끝. 소스에 아직 있는지까지 확인해 테스트가 조용히 무의미해지지 않게 한다.
  const LIGHTEST = '#F8FAFC';
  const DARKEST = '#0F172A';

  it('팔레트 양 끝 색이 아직 그 값이다', () => {
    expect(src).toContain(LIGHTEST);
    expect(src).toContain(DARKEST);
  });

  it('가장 밝은 칸과 가장 어두운 칸의 표식 색이 서로 반대다', () => {
    const onLight = pickReadableTextColor(LIGHTEST);
    const onDark = pickReadableTextColor(DARKEST);
    expect(onLight).not.toBe(onDark);
    expect(onLight).toBe(DARKEST); // 밝은 칸 → 어두운 표식
    expect(onDark).toBe(LIGHTEST); // 어두운 칸 → 밝은 표식
  });

  it('팔레트 전 색에서 표식이 칸과 같은 색이 되는 일이 없다', () => {
    // 표식이 칸 색과 같아지면 "고름"이 화면에서 사라진다. 실제 팔레트 전수로 확인한다.
    const palette = [...(src.match(/'#[0-9A-F]{6}'/g) ?? [])].map((s) => s.slice(1, -1));
    expect(palette.length).toBeGreaterThan(30);
    for (const c of palette) {
      expect(pickReadableTextColor(c).toUpperCase(), `${c} 의 표식이 칸과 같은 색이다`).not.toBe(c.toUpperCase());
    }
  });
});

describe('색 선택기 — 미리보기는 실제로 나올 모습이다', () => {
  it('HEX 옆 미리보기가 불투명도를 반영한다', () => {
    // 알파를 무시하면 30% 로 낮춰도 여기만 진하게 보인다.
    const at = src.indexOf('{/* 미리보기는');
    expect(at, '미리보기 주석이 사라졌다').toBeGreaterThan(0);
    const block = src.slice(at, at + 900);
    expect(block).toContain('CHECKERBOARD');
    expect(block).toContain('opacity: alphaRef.current');
  });
});

describe('색 선택기 — 커진 몸이 화면 밖으로 나가지 않는다', () => {
  it('뷰포트 안으로 묶고 넘치면 스크롤한다', () => {
    expect(src).toContain('overflow-y-auto');
    expect(src).toMatch(/const maxHeight = Math\.max\(\d+, screenH - \d+\)/);
    expect(src).toContain('maxHeight }');
  });
});
