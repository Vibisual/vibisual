import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSessionInputKey, useGraphStore, type AgentSessionInputAttachment } from './graphStore.js';
import { decodeSessionInputDrafts } from './sessionInputDrafts.js';
import { flushAllPersisted } from '../utils/persistFlush.js';

const storageKey = 'vibisual:sessionInputDrafts';
const agent = 'draft-agent';
const session = 'draft-session';
const key = agentSessionInputKey(agent, session);
const image: AgentSessionInputAttachment = {
  tempId: 'pasted-image', previewUrl: 'blob:original-window',
  serverPath: 'C:/project/.vibisual/attachments/custom-agent/image.png', uploading: false,
};
const saved = new Map<string, string>();
const restored = () => decodeSessionInputDrafts(JSON.parse(saved.get(storageKey) ?? '{}'));
const store = () => useGraphStore.getState();

beforeEach(() => {
  flushAllPersisted();
  vi.useFakeTimers();
  saved.clear();
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => saved.get(name) ?? null,
    setItem: (name: string, value: string) => { saved.set(name, value); },
    removeItem: (name: string) => { saved.delete(name); },
  });
  useGraphStore.setState({ agentSessionInputs: {} });
});

afterEach(() => {
  flushAllPersisted();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('session input persistence follows the latest text and image changes', () => {
  it('saves an upload that finishes after the last text save, without further typing', () => {
    store().setAgentSessionInputText(agent, session, 'Look at this image');
    store().updateAgentSessionInputAttachments(agent, session, () => [{ ...image, uploading: true, serverPath: '' }]);
    vi.advanceTimersByTime(400);
    expect(restored()[key]).toEqual({ text: 'Look at this image', attachments: [] });

    store().updateAgentSessionInputAttachments(agent, session, () => [image]);
    vi.advanceTimersByTime(400);
    expect(restored()[key]).toEqual({
      text: 'Look at this image', attachments: [{ ...image, previewUrl: '' }],
    });
    expect(saved.get(storageKey)).not.toContain('blob:');
  });

  it('flushes an image-only draft when the app closes before the debounce fires', () => {
    store().updateAgentSessionInputAttachments(agent, session, () => [image]);
    expect(saved.has(storageKey)).toBe(false);
    flushAllPersisted();
    expect(restored()[key]).toEqual({ text: '', attachments: [{ ...image, previewUrl: '' }] });
  });

  it('does not resurrect a removed image from an older pending text save', () => {
    store().updateAgentSessionInputAttachments(agent, session, () => [image]);
    store().setAgentSessionInputText(agent, session, 'Keep this text');
    store().updateAgentSessionInputAttachments(agent, session, () => []);
    vi.advanceTimersByTime(400);
    expect(restored()[key]).toEqual({ text: 'Keep this text', attachments: [] });
  });

  it('clears only the submitted draft, preserving other sessions and projects', () => {
    store().setAgentSessionInputText(agent, session, 'Send this');
    store().updateAgentSessionInputAttachments(agent, session, () => [image]);
    store().updateAgentSessionInputAttachments(agent, 'other-session', () => [image]);
    store().updateAgentSessionInputAttachments('other-project-agent', session, () => [image]);
    store().clearAgentSessionInput(agent, session);
    vi.advanceTimersByTime(400);
    expect(restored()[key]).toBeUndefined();
    expect(Object.keys(restored())).toEqual([
      agentSessionInputKey(agent, 'other-session'),
      agentSessionInputKey('other-project-agent', session),
    ]);
    expect(Object.values(restored()).every(draft => draft.attachments[0]?.serverPath === image.serverPath)).toBe(true);
  });

  it('removes the persisted record when the last image-only draft is deleted', () => {
    store().updateAgentSessionInputAttachments(agent, session, () => [image]);
    flushAllPersisted();
    expect(saved.has(storageKey)).toBe(true);
    store().updateAgentSessionInputAttachments(agent, session, () => []);
    flushAllPersisted();
    expect(saved.has(storageKey)).toBe(false);
  });
});
