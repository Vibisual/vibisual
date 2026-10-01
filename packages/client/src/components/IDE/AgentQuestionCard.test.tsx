import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestions } from '@vibisual/shared';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { resetQuestionCardState } from './questionCardState.js';

const mocks = vi.hoisted(() => ({ addCommand: vi.fn(), writeText: vi.fn(async () => {}) }));
const translate = (key: string, opts?: { n?: number }): string => opts?.n === undefined ? key : `${key}:${opts.n}`;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (select: (state: { addCommand: typeof mocks.addCommand }) => unknown) => select(mocks),
}));

// Regression: a two-way question with one suggestion followed by a free-form question.
const questions: AgentQuestions = {
  id: 'question-card', agentId: 'agent', subAgentId: 'session', createdAt: 0,
  items: [
    { header: 'Meaning', question: 'Bonus or fixed stacks?', prompts: ['I meant the bonus.'] },
    { header: 'Speed', question: 'What are the four speeds?', prompts: [] },
  ],
};
let view: ReactTestRenderer;

beforeEach(() => {
  resetQuestionCardState();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } });
});
afterEach(() => {
  act(() => { view?.unmount(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function draw(card: AgentQuestions = questions, onSendPrompt?: (prompt: string) => void): void {
  act(() => { view = create(<AgentQuestionCard questions={card} onSendPrompt={onSendPrompt} />); });
}
function items(): ReactTestInstance[] { return view.root.findAllByType('li'); }
function input(qi: number): ReactTestInstance { return items()[qi]!.findByType('textarea'); }
function edit(qi: number, value: string): void {
  act(() => { input(qi).props.onChange({ target: { value } }); });
}
function customButton(qi: number, label: string): ReactTestInstance {
  return items()[qi]!.findAll((n) => n.type === 'button' && n.props['aria-label'] === label).at(-1)!;
}
function batch(n: number): ReactTestInstance {
  return view.root.findAllByType('button').find((b) =>
    b.findAllByType('span').some((s) => s.children.join('') === `ide.question.sendSelected:${n}`))!;
}
function click(button: ReactTestInstance): void {
  expect(button.props.disabled).not.toBe(true);
  act(() => { button.props.onClick(); });
}

describe('AgentQuestionCard free-form answers', () => {
  it('keeps every supplied suggestion and provides an input even with zero suggestions', () => {
    draw();
    expect(view.root.findAllByType('pre').map((n) => n.children.join(''))).toEqual(['I meant the bonus.']);
    expect(view.root.findAllByType('textarea')).toHaveLength(2);
    expect(input(0).props.disabled).toBe(false);
    expect(input(1).props.disabled).toBe(false);
    expect(customButton(1, 'ide.question.instant').props.disabled).toBe(true);
    expect(batch(0).props.disabled).toBe(true);
  });

  it('copies and sends a suggestion plus an authored answer together to the owning session', async () => {
    draw();
    click(items()[0]!.findAll((n) => n.props.role === 'checkbox')[0]!);
    edit(1, ' 100 / 200 / 300 / 400 ');
    const expected = 'I meant the bonus.\n\n2. [Speed] What are the four speeds?\n100 / 200 / 300 / 400';
    await act(async () => {
      view.root.findByProps({ 'aria-label': 'ide.question.copySelectionChecked:2' }).props.onClick();
    });
    expect(mocks.writeText).toHaveBeenCalledWith(expected);
    click(batch(2));
    expect(mocks.addCommand).toHaveBeenCalledExactlyOnceWith('agent', expected, 'session');
    expect(input(0).props.disabled).toBe(true);
    expect(input(1).props.disabled).toBe(true);
    expect(batch(0).props.disabled).toBe(true);
  });

  it('excludes empty or deselected direct answers from batch copy and send', () => {
    draw();
    edit(1, 'draft');
    expect(batch(1).props.disabled).toBe(false);
    click(items()[1]!.findByProps({ role: 'checkbox' }));
    expect(batch(0).props.disabled).toBe(true);
    edit(1, '\n  ');
    expect(customButton(1, 'ide.question.instant').props.disabled).toBe(true);
    expect(items()[1]!.findByProps({ role: 'checkbox' }).props['aria-checked']).toBe(false);
    expect(mocks.addCommand).not.toHaveBeenCalled();
  });

  it('supports direct answers on single questions and re-confirms after editing', () => {
    const send = vi.fn();
    draw({ ...questions, items: [questions.items[1]!] }, send);
    edit(0, 'first answer');
    click(customButton(0, 'ide.question.instant'));
    expect(send).not.toHaveBeenCalled();
    edit(0, 'revised answer');
    click(customButton(0, 'ide.question.instant'));
    expect(send).not.toHaveBeenCalled();
    click(customButton(0, 'ide.question.instantConfirm'));
    expect(send).toHaveBeenCalledExactlyOnceWith('[Speed] What are the four speeds?\nrevised answer');
    expect(mocks.addCommand).not.toHaveBeenCalled();
    expect(input(0).props.disabled).toBe(true);
  });

  it('locks only the answered question when sending immediately', () => {
    draw();
    edit(1, 'custom speeds');
    click(customButton(1, 'ide.question.instant'));
    act(() => { vi.advanceTimersByTime(4_001); });
    click(customButton(1, 'ide.question.instant'));
    expect(mocks.addCommand).not.toHaveBeenCalled();
    click(customButton(1, 'ide.question.instantConfirm'));
    expect(input(0).props.disabled).toBe(false);
    expect(input(1).props.disabled).toBe(true);
    expect(batch(0).props.disabled).toBe(true);
    expect(mocks.addCommand).toHaveBeenCalledTimes(1);
  });

  it('preserves drafts, selection and sent locks across virtual-list remounts', () => {
    draw();
    edit(1, 'keep my draft');
    act(() => { view.unmount(); });
    draw();
    expect(input(1).props.value).toBe('keep my draft');
    expect(batch(1).props.disabled).toBe(false);
    click(batch(1));
    act(() => { view.unmount(); });
    draw();
    expect(input(1).props.value).toBe('keep my draft');
    expect(input(1).props.disabled).toBe(true);
    expect(input(0).props.disabled).toBe(false);
  });

  it('isolates drafts when a mounted renderer switches cards', () => {
    draw();
    edit(1, 'only on card one');
    act(() => { view.update(<AgentQuestionCard questions={{ ...questions, id: 'other-card' }} />); });
    expect(input(1).props.value).toBe('');
    expect(batch(0).props.disabled).toBe(true);
    act(() => { view.update(<AgentQuestionCard questions={questions} />); });
    expect(input(1).props.value).toBe('only on card one');
  });
});
