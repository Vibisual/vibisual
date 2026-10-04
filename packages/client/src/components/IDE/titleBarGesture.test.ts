/**
 * titleBarGesture.test.ts — IDE 제목 줄에서 시작한 손짓이 **그 자리의 것**인지 판정한다.
 *
 * 사용자를 때린 것: 이름을 고치다 낱말을 더블클릭하면 친 글자가 원래 이름으로 돌아갔고,
 * 읽기 설정·붙이기 메뉴 안 빈 곳을 더블클릭하면 창이 최대화됐고, 붙이기 메뉴의 안내 글을 누른 채
 * 움직이면 창이 끌려갔다. 셋 다 제목 줄 판정이 "버튼인가 · 이름인가" 둘만 봤기 때문이다.
 *
 * 클라 시험에는 DOM 이 없다 — 판정은 `closest` 만 쓰므로 그것만 흉내 낸 작은 나무로 돌리고,
 * 표식이 실제 두 팝업에 붙어 있는지는 소스로 본다.
 */
import { describe, expect, it } from 'vitest';
import {
  TITLE_BAR_POPUP_ATTR,
  titleBarDoubleClickAction,
  titleBarPressStartsDrag,
  type TitleBarGestureTarget,
} from './titleBarGesture.js';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(key: string): string {
  const found = tsx[key];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${key}`);
  return found;
}

// ─── `closest` 만 아는 작은 나무 — 태그 이름과 `[속성]` 선택자만 쓴다 ────────────────
interface FakeNode extends TitleBarGestureTarget {
  tag: string;
  attrs: string[];
  parent: FakeNode | null;
}

function matchesSimple(node: FakeNode, sel: string): boolean {
  if (sel.startsWith('[')) {
    expect(sel.endsWith(']') && !sel.includes('='), `시험 나무가 모르는 선택자: ${sel}`).toBe(true);
    return node.attrs.includes(sel.slice(1, -1));
  }
  return node.tag === sel;
}

function node(tag: string, parent: FakeNode | null, attrs: string[] = []): FakeNode {
  const self: FakeNode = {
    tag,
    attrs,
    parent,
    closest(selector: string): unknown {
      const parts = selector.split(',').map((s) => s.trim());
      for (let n: FakeNode | null = self; n; n = n.parent) {
        if (parts.some((p) => matchesSimple(n as FakeNode, p))) return n;
      }
      return null;
    },
  };
  return self;
}

// 제목 줄 한 벌 — 실제 JSX 의 가지 모양을 그대로 옮긴다.
const titleBar = node('div', null);
const left = node('div', titleBar);
const nameSpan = node('span', left, ['data-ide-agent-name']);
const nameInput = node('input', left, ['data-ide-agent-name']);
const right = node('div', titleBar);
const maximizeBtn = node('button', right);
const maximizeIcon = node('svg', maximizeBtn);
const readingWrap = node('div', right, [TITLE_BAR_POPUP_ATTR]);
const readingPanel = node('div', readingWrap);
const readingLabel = node('span', readingPanel);
const readingSlider = node('input', readingPanel);
const dockMenu = node('div', right, [TITLE_BAR_POPUP_ATTR]);
const dockHint = node('div', dockMenu);
const dockItem = node('button', dockMenu);

describe('더블클릭 — 이름 편집 · 최대화 · 아무것도', () => {
  it('이름 입력칸 안 더블클릭(낱말 고르기)은 이름 편집을 다시 시작하지 않는다 — 친 글자가 지워졌다', () => {
    expect(titleBarDoubleClickAction(nameInput)).toBe('none');
  });

  it('보이는 이름을 더블클릭하면 이름 편집이다', () => {
    expect(titleBarDoubleClickAction(nameSpan)).toBe('rename');
  });

  it('읽기 설정 팝업 안 빈 곳 · 슬라이더 더블클릭은 창을 최대화하지 않는다', () => {
    expect(titleBarDoubleClickAction(readingLabel)).toBe('none');
    expect(titleBarDoubleClickAction(readingPanel)).toBe('none');
    expect(titleBarDoubleClickAction(readingSlider)).toBe('none');
  });

  it('붙이기 메뉴의 안내 글 · 항목 더블클릭도 창을 최대화하지 않는다', () => {
    expect(titleBarDoubleClickAction(dockHint)).toBe('none');
    expect(titleBarDoubleClickAction(dockItem)).toBe('none');
  });

  it('제목 줄 빈 곳 더블클릭은 종전대로 최대화 토글이다', () => {
    expect(titleBarDoubleClickAction(titleBar)).toBe('maximize');
    expect(titleBarDoubleClickAction(left)).toBe('maximize');
  });

  it('버튼(안의 아이콘 포함) 더블클릭은 버튼의 것이다', () => {
    expect(titleBarDoubleClickAction(maximizeIcon)).toBe('none');
  });
});

describe('누름 — 창 끌기를 시작하는가', () => {
  it('붙이기 메뉴의 안내 글 · 여백을 누르면 창을 끌지 않는다', () => {
    expect(titleBarPressStartsDrag(dockHint)).toBe(false);
    expect(titleBarPressStartsDrag(dockMenu)).toBe(false);
  });

  it('읽기 설정 팝업 안 누름도 창을 끌지 않는다', () => {
    expect(titleBarPressStartsDrag(readingSlider)).toBe(false);
    expect(titleBarPressStartsDrag(readingLabel)).toBe(false);
  });

  it('이름 · 이름 입력칸 · 버튼은 종전대로 끌지 않는다', () => {
    expect(titleBarPressStartsDrag(nameSpan)).toBe(false);
    expect(titleBarPressStartsDrag(nameInput)).toBe(false);
    expect(titleBarPressStartsDrag(maximizeIcon)).toBe(false);
  });

  it('제목 줄 빈 곳 누름은 끈다', () => {
    expect(titleBarPressStartsDrag(titleBar)).toBe(true);
    expect(titleBarPressStartsDrag(left)).toBe(true);
  });
});

describe('IDE 창이 이 판정과 표식을 실제로 쓴다', () => {
  const overlay = source('./AgentIDEOverlay.tsx');

  it('제목 줄 두 손짓이 같은 모듈의 판정을 부른다 — 한쪽만 고쳐지지 않게', () => {
    expect(overlay).toContain("from './titleBarGesture.js'");
    expect(overlay).toContain('titleBarDoubleClickAction(e.target as Element)');
    expect(overlay).toContain('titleBarPressStartsDrag(e.target as Element)');
  });

  it('읽기 설정 팝업과 붙이기 메뉴 두 곳에 팝업 표식이 붙는다', () => {
    const marks = overlay.split(`${TITLE_BAR_POPUP_ATTR}=""`).length - 1;
    expect(marks).toBe(2);
    const reading = overlay.indexOf('<ReadingSettingsPopover');
    const readingMark = overlay.lastIndexOf(`${TITLE_BAR_POPUP_ATTR}=""`, reading);
    expect(reading - readingMark, '표식이 읽기 설정 팝업을 감싸야 한다').toBeLessThan(120);
    const hint = overlay.indexOf("t('ide.overlay.dockShortcutHint'");
    const dockMark = overlay.lastIndexOf(`${TITLE_BAR_POPUP_ATTR}=""`, hint);
    expect(dockMark, '표식이 붙이기 메뉴 상자에 있어야 한다').toBeGreaterThan(readingMark);
  });

  it('붙이기 메뉴가 열려 있으면 Esc 는 메뉴만 닫는다 — window 의 창 닫기 Esc 보다 앞(document)에서 멈춘다', () => {
    const from = overlay.indexOf('if (!dockMenuOpen) return;');
    expect(from).toBeGreaterThan(-1);
    const effect = overlay.slice(from, overlay.indexOf('}, [dockMenuOpen]);', from));
    expect(effect).toContain("e.key !== 'Escape'");
    expect(effect).toContain('isComposingKeyEvent(e)');
    expect(effect).toContain('e.stopPropagation();');
    expect(effect).toContain('setDockMenuOpen(false);');
    expect(effect).toContain("document.addEventListener('keydown', onKeyDown);");
  });
});
