import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STREAM_DENSITIES } from '@vibisual/shared';
import { TerminalLine } from './IDEMainArea.js';
import { TextBlock } from './StreamRenderer.js';
import { STREAM_TOGGLE_ATTR } from './streamToggle.js';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
// 본문 줄만 직접 그린다 — 터미널 칸은 import 만으로 브라우저 서비스를 띄우므로 막아 둔다.
vi.mock('./IDETerminalPanes.js', () => ({ IDETerminalPanes: () => null }));

// §5.5 #17-49 — 사용자가 집어 준 그 경우: 종전(#17-46) 간결에서 이 15줄은 머리 4줄·꼬리 3줄만 남고
//   가운데 8줄이 「8줄 더 보기」 뒤로 접혔다.
const LINES = Array.from({ length: 15 }, (_, i) => `Line ${i + 1} reports finding number ${i + 1}.`);
const BODY = LINES.join('\n');

let view: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => { view?.unmount(); });
  view = undefined;
});

/** 화면에 실제로 그려진 글자 전부 — 접힌 가운데는 트리에 없으므로 여기에도 없다. */
function renderedText(): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') { parts.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object' && 'children' in node) walk((node as { children: unknown }).children);
  };
  walk(view!.toJSON());
  return parts.join('');
}

/** 펼침/접기 손잡이(`data-stream-toggle`)가 붙은 실제 요소 수. */
function foldHandles(): number {
  return view!.root.findAll((n) => typeof n.type === 'string' && n.props[STREAM_TOGGLE_ATTR] !== undefined).length;
}

describe('§5.5 #17-49 — AI 본문은 어느 밀도에서도 접히지 않는다', () => {
  it.each([...STREAM_DENSITIES])('Sub 탭 TextBlock 은 %s 에서 본문 전부를 그리고 접기 손잡이가 없다', (density) => {
    act(() => {
      view = create(<TextBlock item={{ kind: 'text', id: 't1', content: BODY, timestamp: 1 }} density={density} run="solo" />);
    });
    const shown = renderedText();
    for (const line of LINES) expect(shown).toContain(line);
    expect(foldHandles()).toBe(0);
  });

  it.each([...STREAM_DENSITIES])('메인 탭 본문 줄은 %s 에서 본문 전부를 그리고 접기 손잡이가 없다', (density) => {
    act(() => {
      view = create(<TerminalLine entry={{ id: 't1', type: 'text', text: BODY, timestamp: 1 }} density={density} run="solo" />);
    });
    const shown = renderedText();
    for (const line of LINES) expect(shown).toContain(line);
    expect(foldHandles()).toBe(0);
  });
});
