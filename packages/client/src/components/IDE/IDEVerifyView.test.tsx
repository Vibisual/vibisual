import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDEVerifyView } from './IDEVerifyView.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useVerifyDemoStore } from '../../stores/verifyDemo.js';

const fixture = vi.hoisted(() => ({ setSession: null as ((id: string) => void) | null }));
vi.mock('react-i18next', async (original) => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./idePane.js', async () => {
  const { create: createStore } = await import('zustand');
  const usePane = createStore<{ activeSessionId: string }>(() => ({ activeSessionId: 'session-a' }));
  fixture.setSession = (id) => usePane.setState({ activeSessionId: id });
  return { useIDEPaneValue: usePane };
});
vi.mock('./IDECodexReviewView.js', () => ({ IDECodexReviewView: () => null }));
vi.mock('./VerifyTargetConnection.js', async () => {
  const { useEffect } = await import('react');
  return { VerifyTargetConnection: ({ onAvailability }: { onAvailability: (available: boolean) => void }) => {
    useEffect(() => { onAvailability(true); }, [onAvailability]);
    return null;
  } };
});
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
let view: ReactTestRenderer | undefined;
const originalStart = useGraphStore.getState().startVerification;
beforeEach(() => {
  fixture.setSession!('session-a');
  useGraphStore.setState({ nodeMap: {}, agentConfigs: {}, verificationRuns: {}, verificationDemos: {} });
  useVerifyDemoStore.setState({ target: {}, source: {}, recordRun: {}, recordingFor: null, pickedDemo: {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  useGraphStore.setState({ startVerification: originalStart });
  vi.unstubAllGlobals();
});

describe('verification form ownership', () => {
  it('resets focus and expectation when the active session changes', async () => {
    await act(async () => { view = create(createElement(IDEVerifyView, { agentId: 'agent' })); });
    const expectation = () => view!.root.findAllByType('input').find((input) => input.props.placeholder === 'ide.verify.demo.expectedPlaceholder')!;
    await act(async () => {
      view!.root.findByType('textarea').props.onChange({ target: { value: 'Check project A' } });
      expectation().props.onChange({ target: { value: 'Project A saved' } });
    });
    expect(expectation().props.value).toBe('Project A saved');
    await act(async () => fixture.setSession!('session-b'));
    expect(view!.root.findByType('textarea').props.value).toBe('');
    expect(expectation().props.value).toBe('');
  });

  it('shows automatic screen evidence for a browser and cannot record an unrelated capture source', async () => {
    useVerifyDemoStore.setState({ target: { 'session-a': { kind: 'browser', url: 'http://localhost' } }, source: { 'session-a': { sourceId: 'window:other', sourceName: 'Other app' } }, recordRun: { 'session-a': true } });
    const start = vi.fn(async () => ({ ok: true as const, runId: 'run-browser' }));
    useGraphStore.setState({ startVerification: start });
    await act(async () => { view = create(createElement(IDEVerifyView, { agentId: 'agent' })); });
    const checkbox = view!.root.findAllByType('input').find((input) => input.props.type === 'checkbox')!;
    expect(checkbox.props.checked).toBe(false);
    expect(checkbox.props.disabled).toBe(true);
    expect(JSON.stringify(view!.toJSON())).toContain('ide.verify.demo.browserEvidenceOnly');
    await act(async () => view!.root.findAllByType('button').find((button) => button.children.includes('ide.verify.start'))!.props.onClick());
    expect(start).toHaveBeenCalledOnce();
    expect(useVerifyDemoStore.getState().recordingFor).toBeNull();
  });

  it('rechecks the capture source when an in-flight start finishes', async () => {
    useVerifyDemoStore.setState({ target: { 'session-a': { kind: 'desktop', sourceId: 'window:one', sourceName: 'App', sourceKind: 'window' } }, source: { 'session-a': { sourceId: 'window:one', sourceName: 'App' } }, recordRun: { 'session-a': true } });
    let finish!: (result: { ok: true; runId: string }) => void;
    useGraphStore.setState({ startVerification: () => new Promise((resolve) => { finish = resolve; }) });
    await act(async () => { view = create(createElement(IDEVerifyView, { agentId: 'agent' })); });
    await act(async () => view!.root.findAllByType('button').find((button) => button.children.includes('ide.verify.start'))!.props.onClick());
    await act(async () => useVerifyDemoStore.getState().setSource('session-a', { sourceId: 'window:other', sourceName: 'Other' }));
    await act(async () => finish({ ok: true, runId: 'run-desktop' }));
    expect(useVerifyDemoStore.getState().recordingFor).toBeNull();
  });
});
