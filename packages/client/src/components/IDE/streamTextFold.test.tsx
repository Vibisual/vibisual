import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAGE_BLOCK_LANGS } from '@vibisual/shared';
import { StreamTextFold } from './CollapsiblePrompt.js';
import { clampStreamText, clampVisibleStreamMarkdown, COMPACT_TEXT_CLAMP_MD } from './streamDensity.js';
import { resetStreamToggles, STREAM_TOGGLE_ATTR, useStreamToggle } from './streamToggle.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: vi.fn() }));

const FENCE = '`'.repeat(3);
const VISIBLE_LINES = [
  'Visible introduction.', 'Second opening line.', 'Third opening line.', 'Fourth opening line.',
  'MIDDLE_DETAIL_A explains the first finding.',
  'MIDDLE_DETAIL_B explains the second finding.',
  'MIDDLE_DETAIL_C explains the third finding.',
  'First closing line.', 'Second closing line.', 'Visible conclusion.',
];
const VISIBLE_TEXT = VISIBLE_LINES.join('\n');

describe('compact Markdown folds only content the reader can see', () => {
  for (const language of STAGE_BLOCK_LANGS) {
    it.each(['closed', 'CRLF', 'unfinished', 'larger than 8 KB'] as const)(
      `${language} goals (%s) alone do not create a fold handle`,
      (variant) => {
        const goalRows = Array.from(
          { length: variant === 'larger than 8 KB' ? 500 : 12 },
          (_, i) => `- [ ] HIDDEN_GOAL_${i} prepare the next implementation step @change`,
        );
        const marker = variant === 'CRLF' ? '~~~~' : FENCE;
        const lines = [
          'The visible introduction.', `${marker}${language} json`, 'goal: Hidden progress', ...goalRows,
          ...(variant === 'unfinished' ? [] : [marker, 'The visible conclusion.']),
        ];
        const content = lines.join(variant === 'CRLF' ? '\r\n' : '\n');
        if (variant === 'larger than 8 KB') expect(content.length).toBeGreaterThan(8_000);
        // This fixture used to offer a toggle even though the middle never rendered.
        expect(clampStreamText(content, COMPACT_TEXT_CLAMP_MD)).not.toBeNull();
        expect(clampVisibleStreamMarkdown(content)).toBeNull();
      },
    );
  }

  it('still folds a real visible middle when goals occur in the same message', () => {
    const content = [
      ...VISIBLE_LINES.slice(0, 7),
      `${FENCE}vibisual`, 'goal: HIDDEN_GOAL', '- [ ] HIDDEN_TASK @verify', FENCE,
      ...VISIBLE_LINES.slice(7),
    ].join('\n');
    const folded = clampVisibleStreamMarkdown(content);
    expect(folded).not.toBeNull();
    expect(folded!.hiddenLines).toBeGreaterThan(0);
    expect(folded!.head).toContain('Visible introduction.');
    expect(folded!.tail).toContain('Visible conclusion.');
    expect(`${folded!.head}\n${folded!.tail}`).not.toMatch(/MIDDLE_DETAIL|HIDDEN_GOAL|HIDDEN_TASK/);
  });

  it('keeps ordinary code and a goal-fence example inside that code', () => {
    const outerFence = FENCE + '`';
    const content = [
      `${outerFence}ts`, 'const visibleStart = true;', `${FENCE}vibisual`, 'goal: ordinary code example', FENCE,
      ...Array.from({ length: 8 }, (_, i) => `const value${i} = ${i};`),
      'const visibleEnd = true;', outerFence, 'Visible conclusion.',
    ].join('\n');
    const folded = clampVisibleStreamMarkdown(content);
    expect(folded).not.toBeNull();
    expect(folded).toEqual(clampStreamText(content, COMPACT_TEXT_CLAMP_MD));
    expect(folded!.head).toContain('const visibleStart = true;');
    expect(folded!.head).toContain('goal: ordinary code example');
    expect(folded!.tail).toContain('const visibleEnd = true;');
    expect(folded!.tail).toContain('Visible conclusion.');
  });
});

// A small consumer exercises the real button, persisted toggle hook, and clamping policy together.
function FoldedText({ id, content }: { id: string; content: string }): React.JSX.Element {
  const clamped = clampVisibleStreamMarkdown(content);
  const [open, toggleOpen] = useStreamToggle(`text-more-${id}`, false);
  return (
    <article>
      <pre data-testid="visible-body">{!clamped || open ? content : `${clamped.head}\n${clamped.tail}`}</pre>
      {clamped && <StreamTextFold open={open} hiddenLines={clamped.hiddenLines} onToggle={toggleOpen} />}
    </article>
  );
}

let view: ReactTestRenderer | undefined;
beforeEach(() => { resetStreamToggles(); });
afterEach(() => {
  act(() => { view?.unmount(); });
  view = undefined;
  resetStreamToggles();
});

function render(id = 'text-1', content = VISIBLE_TEXT): void {
  act(() => { view = create(<FoldedText id={id} content={content} />); });
}

function visibleBody(): string {
  return view!.root.findByProps({ 'data-testid': 'visible-body' }).children.join('');
}

function clickFold(): void {
  act(() => { view!.root.findByType('button').props.onClick(); });
}

describe('compact text fold interaction', () => {
  it('reveals and hides the actual middle while exposing the scroll marker and expanded state', () => {
    render();
    expect(visibleBody()).not.toContain('MIDDLE_DETAIL_B');
    expect(visibleBody()).toContain('Visible introduction.');
    expect(visibleBody()).toContain('Visible conclusion.');
    expect(view!.root.findByType('button').props[STREAM_TOGGLE_ATTR]).toBe('');
    expect(view!.root.findByType('button').props['aria-expanded']).toBe(false);

    clickFold();
    expect(visibleBody()).toBe(VISIBLE_TEXT);
    expect(view!.root.findByType('button').props[STREAM_TOGGLE_ATTR]).toBe('');
    expect(view!.root.findByType('button').props['aria-expanded']).toBe(true);

    clickFold();
    expect(visibleBody()).not.toContain('MIDDLE_DETAIL_B');
    expect(view!.root.findByType('button').props['aria-expanded']).toBe(false);
  });

  it('preserves expansion after virtualized unmount and remembers a later collapse', () => {
    render();
    clickFold();
    act(() => { view!.unmount(); });
    render();
    expect(visibleBody()).toBe(VISIBLE_TEXT);
    expect(view!.root.findByType('button').props['aria-expanded']).toBe(true);

    clickFold();
    act(() => { view!.unmount(); });
    render();
    expect(visibleBody()).not.toContain('MIDDLE_DETAIL_B');
    expect(view!.root.findByType('button').props['aria-expanded']).toBe(false);
  });
});
