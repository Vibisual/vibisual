import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyTargetConnection } from './VerifyTargetConnection.js';
import { useVerifyDemoStore } from '../../stores/verifyDemo.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let view: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  useVerifyDemoStore.setState({ target: {}, pickerFor: null, recordingFor: null });
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('verification connection UI', () => {
  it('ignores a successful probe for a target the user has replaced', async () => {
    let finishFirst!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ available: false, reason: 'closed', actions: [], checks: [] })));
    vi.stubGlobal('fetch', fetcher);
    const onAvailability = vi.fn();
    const props = { agentId: 'agent', subAgentId: 'session', disabled: false, onAvailability };
    await act(async () => { view = create(createElement(VerifyTargetConnection, { ...props, target: { kind: 'browser', url: 'http://localhost:3000' } })); });
    await act(async () => { vi.advanceTimersByTime(350); });
    await act(async () => { view!.update(createElement(VerifyTargetConnection, { ...props, target: { kind: 'browser', url: 'http://localhost:4000' } })); });
    await act(async () => { vi.advanceTimersByTime(350); });
    await act(async () => { finishFirst(new Response(JSON.stringify({ available: true, actions: ['click'], checks: ['text'] }))); });
    expect(onAvailability.mock.calls.every(([available]) => available === false)).toBe(true);
    expect(JSON.stringify(view!.toJSON())).toContain('closed');
  });

  it('choosing a desktop target opens selection without starting a recording', async () => {
    await act(async () => { view = create(createElement(VerifyTargetConnection, { agentId: 'agent', subAgentId: 'session', disabled: false, target: undefined, onAvailability: vi.fn() })); });
    await act(async () => { view!.root.findByType('select').props.onChange({ target: { value: 'desktop' } }); });
    expect(useVerifyDemoStore.getState().pickerFor).toEqual({ agentId: 'agent', subAgentId: 'session', purpose: 'connect' });
    expect(useVerifyDemoStore.getState().recordingFor).toBeNull();
  });
});
