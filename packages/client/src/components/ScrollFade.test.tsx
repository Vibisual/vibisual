import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexCss from 'virtual:vibisual-css-source/index';
import { ScrollFade } from './ScrollFade.js';

class ScrollBox extends EventTarget {
  scrollTop = 0;
  clientHeight = 100;
  scrollHeight = 300;
}

class ObservedResize {
  static instances: ObservedResize[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly notify: () => void) { ObservedResize.instances.push(this); }
}

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  ObservedResize.instances = [];
  vi.stubGlobal('ResizeObserver', ObservedResize);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

function fadeClasses(edge: 'top' | 'bottom'): string[] {
  const fade = renderer!.root.find(node => node.type === 'div'
    && String(node.props.className).split(/\s+/).includes(`scroll-fade-${edge}`));
  return String(fade.props.className).trim().split(/\s+/);
}

function expectFades(top: boolean, bottom: boolean): void {
  for (const [edge, shown] of [['top', top], ['bottom', bottom]] as const) {
    const classes = fadeClasses(edge);
    expect(classes.includes('scroll-fade-shown')).toBe(shown);
    // Tailwind's `visible` utility overrides inherited visibility:hidden on an app window.
    expect(classes).not.toContain('visible');
  }
}

const cssRules = [...indexCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(match => ({ selectors: match[1]!.split(',').map(selector => selector.trim()), body: match[2]! }));

function declarationsFor(selector: string): string {
  const rules = cssRules.filter(rule => rule.selectors.includes(selector));
  expect(rules.length, `Missing fade selector: ${selector}`).toBeGreaterThan(0);
  return rules.map(rule => rule.body).join('\n');
}

describe('scroll fades inside retained hidden app windows', () => {
  it('updates overflow cues while keeping a hidden parent authoritative through scroll and resize', () => {
    const box = new ScrollBox();
    act(() => {
      renderer = create(
        <div data-hidden-app-window="" style={{ visibility: 'hidden' }}>
          <ScrollFade fill><div>Retained model properties</div></ScrollFade>
        </div>,
        { createNodeMock: () => box },
      );
    });
    expectFades(false, true);

    act(() => { box.scrollTop = 80; box.dispatchEvent(new Event('scroll')); });
    expectFades(true, true);

    act(() => { box.scrollTop = 200; box.dispatchEvent(new Event('scroll')); });
    expectFades(true, false);

    // A hidden editor still has layout; resizing it must retire cues when the content fits.
    act(() => {
      box.scrollTop = 0;
      box.clientHeight = box.scrollHeight;
      ObservedResize.instances[0]!.notify();
    });
    expectFades(false, false);
    expect(renderer!.root.findByProps({ 'data-hidden-app-window': '' }).props.style.visibility).toBe('hidden');

    act(() => { box.clientHeight = 100; ObservedResize.instances[0]!.notify(); });
    expectFades(false, true);
  });

  it.each(['top', 'bottom', 'left', 'right'])('%s fade changes opacity without overriding ancestor visibility', edge => {
    const selector = `.scroll-fade-${edge}`;
    const base = declarationsFor(selector);
    const shown = declarationsFor(`${selector}.scroll-fade-shown`);
    expect(base).toMatch(/\bopacity\s*:\s*0\s*;/);
    expect(shown).toMatch(/\bopacity\s*:\s*1\s*;/);
    expect(cssRules.some(rule => rule.selectors.includes(`${selector}.visible`))).toBe(false);
    const allFadeRules = cssRules.filter(rule => rule.selectors.some(value => value.includes(selector)));
    for (const rule of allFadeRules) {
      expect(rule.body, rule.selectors.join(', ')).not.toMatch(/\bvisibility\s*:/);
    }
  });
});
