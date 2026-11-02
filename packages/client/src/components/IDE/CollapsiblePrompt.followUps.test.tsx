import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ko from '../../i18n/locales/ko.json';
import { CollapsiblePrompt, type PromptCommandState } from './CollapsiblePrompt.js';

const store = vi.hoisted(() => ({ setCommandDispatchMode: vi.fn(), removeCommand: vi.fn() }));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: (select: (state: typeof store) => unknown) => select(store) }));
vi.mock('../../hooks/usePopupDismiss.js', () => ({ useOutsidePressDismiss: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  i18n: { language: 'ko' },
  t: (key: string, params: Record<string, string> = {}) => {
    const value = key.split('.').reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, ko);
    return typeof value === 'string' ? value.replace(/{{(\w+)}}/g, (_m, name: string) => params[name] ?? '') : key;
  },
}) }));

const prompt = '현재 작업은 계속하세요.\n두 번째 줄의 요구사항도 유지합니다.\n' + '긴 메시지 본문입니다. '.repeat(30) + '\n마지막 요구사항도 기본으로 보입니다.';
const queued = (state: NonNullable<PromptCommandState['liveDelivery']>['state'], reason?: NonNullable<PromptCommandState['liveDelivery']>['reason']): PromptCommandState => ({
  status: 'queued', dispatchMode: 'steer', agentId: 'agent', commandId: 'follow', liveDelivery: { state, reason },
});
let view: ReactTestRenderer | undefined;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { act(() => view?.unmount()); view = undefined; });
function render(command: PromptCommandState): ReactTestRenderer {
  act(() => { view = create(<CollapsiblePrompt prompt={prompt} command={command} submittedAt={1700000000000} />); });
  return view!;
}

describe('live follow-up message bubble', () => {
  it.each(['waiting', 'sending', 'delivered', 'unavailable', 'uncertain'] as const)('shows the full multiline body and explicit %s state without expanding', (state) => {
    const command = state === 'delivered' ? { ...queued(state), status: 'completed' as const, commandId: undefined } : queued(state);
    const html = renderToStaticMarkup(<CollapsiblePrompt prompt={prompt} command={command} submittedAt={1700000000000} />);
    expect(html).toContain('두 번째 줄의 요구사항도 유지합니다.');
    expect(html).toContain('마지막 요구사항도 기본으로 보입니다.');
    expect(html).toContain(ko.ide.mainArea.liveDelivery[state]);
    expect(html).toContain('role="status"');
    if (state === 'delivered') {
      expect(html).toContain(ko.ide.mainArea.liveDelivery.hint.delivered);
      expect(html).not.toContain('aria-pressed');
      expect(html).not.toContain(ko.ide.mainArea.executing);
    }
  });

  it.each(['sending', 'uncertain'] as const)('locks all mode and delete controls for %s while retaining copy', (state) => {
    const tree = render(queued(state));
    const modes = tree.root.findAllByType('button').filter((button) => 'aria-pressed' in button.props);
    expect(modes).toHaveLength(4);
    for (const button of modes) {
      expect(button.props.disabled).toBe(true);
      act(() => button.props.onClick());
    }
    const remove = tree.root.findByProps({ 'aria-label': ko.ide.mainArea.queuedRemove });
    expect(remove.props.disabled).toBe(true);
    act(() => remove.props.onClick());
    expect(store.setCommandDispatchMode).not.toHaveBeenCalled();
    expect(store.removeCommand).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ 'aria-label': ko.ide.streamRenderer.copy }).props.disabled).not.toBe(true);
  });

  it('offers explicit retry and other modes when delivery is unavailable', () => {
    const tree = render(queued('unavailable', 'unsupported'));
    const modes = tree.root.findAllByType('button').filter((button) => 'aria-pressed' in button.props);
    const retry = modes.find((button) => button.props['aria-pressed'] === true)!;
    expect(retry.props.disabled).toBe(false);
    expect(JSON.stringify(tree.toJSON())).toContain(ko.ide.mainArea.liveDelivery.retry);
    act(() => retry.props.onClick());
    expect(store.setCommandDispatchMode).toHaveBeenLastCalledWith('agent', 'follow', 'steer');
    act(() => modes.find((button) => button.props.title === ko.ide.mainArea.dispatchModeTitle.wait)!.props.onClick());
    expect(store.setCommandDispatchMode).toHaveBeenLastCalledWith('agent', 'follow', 'wait');
    act(() => modes.find((button) => button.props.title === ko.ide.mainArea.dispatchModeTitle.immediate)!.props.onClick());
    expect(store.setCommandDispatchMode).toHaveBeenLastCalledWith('agent', 'follow', 'immediate');
    const remove = tree.root.findByProps({ 'aria-label': ko.ide.mainArea.queuedRemove });
    expect(remove.props.disabled).toBe(false);
    act(() => remove.props.onClick());
    expect(store.removeCommand).toHaveBeenCalledWith('agent', 'follow');
  });
});
