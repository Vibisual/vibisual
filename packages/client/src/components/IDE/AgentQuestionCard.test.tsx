import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestions } from '@vibisual/shared';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { resetQuestionCardState } from './questionCardState.js';

const mocks = vi.hoisted(() => ({ addCommand: vi.fn(), writeText: vi.fn(async () => {}), focus: vi.fn() }));
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
/** 직접 입력을 여는 접힌 버튼의 이름(번역 키 그대로 — 위 `translate` 가 키를 돌려준다). */
const OTHER = 'ide.askQuestion.otherLabel';
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
  act(() => {
    view = create(<AgentQuestionCard questions={card} onSendPrompt={onSendPrompt} />, {
      // 입력칸만 초점을 받을 수 있는 가짜 노드 — 버튼으로 연 칸이 초점을 받는지 본다.
      createNodeMock: (el) => (el.type === 'textarea' ? { focus: mocks.focus } : null),
    });
  });
}
function items(): ReactTestInstance[] { return view.root.findAllByType('li'); }
function textareas(qi: number): ReactTestInstance[] { return items()[qi]!.findAllByType('textarea'); }
function input(qi: number): ReactTestInstance { return items()[qi]!.findByType('textarea'); }
function toggles(qi: number): ReactTestInstance[] {
  return items()[qi]!.findAll((n) => n.type === 'button' && n.props['aria-label'] === OTHER);
}
function openCustom(qi: number): void { click(toggles(qi)[0]!); }
function edit(qi: number, value: string): void {
  if (textareas(qi).length === 0) openCustom(qi);
  act(() => { input(qi).props.onChange({ target: { value } }); });
}
function blur(qi: number): void {
  act(() => { input(qi).props.onBlur(); });
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

describe('AgentQuestionCard — the suggested answers are the card, direct input is a folded fallback', () => {
  it('shows every supplied suggestion and folds the direct input behind one button per question', () => {
    draw();
    expect(view.root.findAllByType('pre').map((n) => n.children.join(''))).toEqual(['I meant the bonus.']);
    // 입력칸은 처음부터 펼쳐지지 않는다 — 답을 비워 보낸 질문이 "질문 + 입력칸"만 남지 않게.
    expect(view.root.findAllByType('textarea')).toHaveLength(0);
    expect(toggles(0)).toHaveLength(1);
    expect(toggles(1)).toHaveLength(1);
    expect(toggles(1)[0]!.props['aria-expanded']).toBe(false);

    openCustom(1);
    expect(textareas(1)).toHaveLength(1);
    expect(toggles(1)).toHaveLength(0);
    expect(input(1).props.disabled).toBe(false);
    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(customButton(1, 'ide.question.instant').props.disabled).toBe(true);
    expect(batch(0).props.disabled).toBe(true);
    // 다른 질문은 그대로 접혀 있다.
    expect(textareas(0)).toHaveLength(0);
  });

  it('refolds an opened input left empty, but never folds one under the caret', () => {
    draw();
    openCustom(0);
    blur(0);
    expect(textareas(0)).toHaveLength(0);
    expect(toggles(0)).toHaveLength(1);

    edit(0, 'my own answer');
    blur(0);
    expect(input(0).props.value).toBe('my own answer');
    // 쓰던 글을 다 지워도 쓰는 동안은 칸이 남는다 — 비운 채 떠날 때만 접힌다.
    edit(0, '');
    expect(textareas(0)).toHaveLength(1);
    blur(0);
    expect(textareas(0)).toHaveLength(0);
  });

  it('locks the direct-input button once another answer was sent for that question', () => {
    draw();
    click(customButton(0, 'ide.question.instant'));
    click(customButton(0, 'ide.question.instantConfirm'));
    expect(mocks.addCommand).toHaveBeenCalledExactlyOnceWith('agent', 'I meant the bonus.', 'session');
    expect(toggles(0)[0]!.props.disabled).toBe(true);
    expect(toggles(1)[0]!.props.disabled).toBe(false);
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
    expect(toggles(0)[0]!.props.disabled).toBe(true);
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
    expect(toggles(0)[0]!.props.disabled).toBe(false);
    expect(input(1).props.disabled).toBe(true);
    expect(batch(0).props.disabled).toBe(true);
    expect(mocks.addCommand).toHaveBeenCalledTimes(1);
  });

  it('preserves drafts, selection and sent locks across virtual-list remounts', () => {
    draw();
    edit(1, 'keep my draft');
    act(() => { view.unmount(); });
    mocks.focus.mockClear();
    draw();
    // 쓴 답이 있으면 다시 열 필요 없이 펼쳐져 있고, 다시 그려졌다고 초점을 빼앗지 않는다.
    expect(input(1).props.value).toBe('keep my draft');
    expect(mocks.focus).not.toHaveBeenCalled();
    expect(batch(1).props.disabled).toBe(false);
    click(batch(1));
    act(() => { view.unmount(); });
    draw();
    expect(input(1).props.value).toBe('keep my draft');
    expect(input(1).props.disabled).toBe(true);
    expect(toggles(0)[0]!.props.disabled).toBe(false);
  });

  it('isolates drafts when a mounted renderer switches cards', () => {
    draw();
    edit(1, 'only on card one');
    act(() => { view.update(<AgentQuestionCard questions={{ ...questions, id: 'other-card' }} />); });
    expect(textareas(1)).toHaveLength(0);
    expect(toggles(1)).toHaveLength(1);
    expect(batch(0).props.disabled).toBe(true);
    act(() => { view.update(<AgentQuestionCard questions={questions} />); });
    expect(input(1).props.value).toBe('only on card one');
  });
});
