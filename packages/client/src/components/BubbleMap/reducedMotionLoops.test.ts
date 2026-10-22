import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_CARD, REDUCED_MOTION_LOOP_SLOWDOWN, REF_LINK_STYLE } from '@vibisual/shared';

/**
 * §5.4 #31 (K) · #36 (A)(B) — 도는 동안 계속 도는 움직임(활성 선의 흐름 · 말풍선 궤도 · 위성줄 구슬)은
 * 움직임 줄이기에서 **멈추지 않고 느리게** 돈다(원문 계약).
 *
 * 2026-10-22 사용자 보고 — "우리 선들이 커스텀마다 뭔가 움직임이 있었는데 지금 왜 안 움직이고 멈춰 있나".
 * 그 PC 는 OS 애니메이션 효과가 꺼져 있어(`prefers-reduced-motion: reduce`) 세 움직임이 전부 `animation: none` 으로
 * 지워져 있었다. 활성 선은 10-20 선 모양 개편 전까지 React Flow 기본 대시로 그 설정과 무관하게 흘렀다.
 *
 * vitest 는 CSS 를 처리하지 않아(`?raw` 로 읽어도 빈 문자열) 파일로 직접 읽는다.
 */
const INDEX_CSS = '../../index.css';
const EDGE_CSS = './bubbleEdgeAppearance.css';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const indexCss = read(INDEX_CSS);
const edgeCss = read(EDGE_CSS);

/** `@media (prefers-reduced-motion: reduce) { … }` 블록들의 안쪽. */
function reducedMotionBlocks(css: string): string[] {
  const head = '@media (prefers-reduced-motion: reduce)';
  const out: string[] = [];
  for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + head.length)) {
    const open = css.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}' && --depth === 0) { out.push(css.slice(open + 1, i)); break; }
    }
  }
  return out;
}

/** 그 선택자 하나만 가진 규칙들의 선언부. */
function rulesFor(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!);
}

const seconds = (ms: number): string => `${ms / 1000}s`;
const STOPS = /animation\s*:\s*none|animation-name\s*:\s*none|animation-play-state\s*:\s*paused/;

describe('§5.4 #31 (K) · #36 — 움직임 줄이기에서도 도는 동안의 움직임은 멈추지 않는다', () => {
  it('원문이 실제로 읽혔다', () => {
    expect(indexCss).toContain('.agent-orbit-spin');
    expect(indexCss).toContain('.ref-bead-flow');
    expect(edgeCss).toContain('.bubble-edge-paint[data-paint-layer="travel"]');
    expect(reducedMotionBlocks(indexCss).length).toBeGreaterThan(0);
    expect(reducedMotionBlocks(edgeCss).length).toBeGreaterThan(0);
  });

  it('일하는 선의 흐르는 층은 멎지 않고, 층이 실어 둔 느린 흐름으로 갈아 끼운다', () => {
    const rules = reducedMotionBlocks(edgeCss).flatMap((b) => rulesFor(b, '.bubble-edge-paint[data-paint-layer="travel"]'));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(STOPS);
    expect(rules.join('\n')).toMatch(/animation\s*:\s*var\(--bubble-edge-flow-reduced\)\s*!important/);
  });

  it('말풍선 궤도는 멎지 않고 공유 배율만큼 느리게 돈다', () => {
    const rules = reducedMotionBlocks(indexCss).flatMap((b) => rulesFor(b, '.agent-orbit-spin'));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(STOPS);
    expect(rules.join('\n')).toContain(`animation-duration: ${seconds(AGENT_CARD.orbitSpinReducedMs)};`);
  });

  it('위성줄 구슬은 멎지 않고 공유 배율만큼 느리게 흐른다', () => {
    const rules = reducedMotionBlocks(indexCss).flatMap((b) => rulesFor(b, '.ref-bead-flow'));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(STOPS);
    expect(rules.join('\n')).toContain(`animation-duration: ${seconds(REF_LINK_STYLE.flowReducedMs)};`);
  });

  it('평소 주기는 공유 상수와 같고, 줄이기 주기는 그 주기에 배율을 곱한 값이다', () => {
    expect(REDUCED_MOTION_LOOP_SLOWDOWN).toBeGreaterThan(1);
    expect(rulesFor(indexCss, '.agent-orbit-spin')[0]).toContain(`animation: agent-orbit-spin ${seconds(AGENT_CARD.orbitSpinMs)} linear infinite;`);
    expect(rulesFor(indexCss, '.ref-bead-flow')[0]).toContain(`animation: ref-bead-flow ${seconds(REF_LINK_STYLE.flowMs)} linear infinite;`);
    expect(AGENT_CARD.orbitSpinReducedMs).toBe(AGENT_CARD.orbitSpinMs * REDUCED_MOTION_LOOP_SLOWDOWN);
    expect(REF_LINK_STYLE.flowReducedMs).toBe(REF_LINK_STYLE.flowMs * REDUCED_MOTION_LOOP_SLOWDOWN);
  });
});
