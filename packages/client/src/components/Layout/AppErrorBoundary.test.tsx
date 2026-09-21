import { createInstance } from 'i18next';
import { useLayoutEffect, type ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as persistence from '../../utils/persistFlush.js';
import { SESSION_FORM_DRAFT_STORAGE_KEY, useSessionFormDraftStore } from '../../stores/sessionFormDrafts.js';
import { AppErrorBoundary } from './AppErrorBoundary.js';

const i18n = createInstance();
let renderer: ReactTestRenderer | undefined;
let cleanups: Array<() => void> = [];
let storage: Map<string, string>;

beforeAll(() => i18n.init({
  lng: 'en', fallbackLng: 'en', initAsync: false,
  resources: {
    en: { translation: { common: { appError: { title: 'Window unavailable', description: 'Saved work is kept.', retry: 'Try again' } } } },
    ko: { translation: { common: { appError: { title: '화면을 표시할 수 없습니다', description: '저장된 작업은 유지됩니다.', retry: '다시 시도' } } } },
  },
}));

beforeEach((): void => {
  vi.spyOn(console, 'error').mockImplementation((): void => undefined);
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => { storage.set(key, value); },
    removeItem: (key: string): void => { storage.delete(key); },
  });
  useSessionFormDraftStore.setState({ drafts: {} });
});

afterEach((): void => {
  act((): void => { renderer?.unmount(); });
  renderer = undefined;
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  vi.restoreAllMocks();
  persistence.flushAllPersisted();
  vi.unstubAllGlobals();
});

function shell(child: ReactElement): ReactElement {
  return <I18nextProvider i18n={i18n}><AppErrorBoundary>{child}</AppErrorBoundary></I18nextProvider>;
}

function mounted(): ReactTestRenderer {
  if (!renderer) throw new Error('Test renderer has not been mounted');
  return renderer;
}

function renderShell(child: ReactElement): void {
  act((): void => { renderer = create(shell(child)); });
}

function retry(): void {
  const onClick: unknown = mounted().root.findByType('button').props.onClick;
  if (typeof onClick !== 'function') throw new Error('Recovery button has no handler');
  act((): void => { onClick(); });
}

function BrokenRender({ failure }: { failure: unknown }): never {
  throw failure;
}

function BrokenEffect(): ReactElement {
  useLayoutEffect((): void => { throw new Error('Lifecycle failure'); }, []);
  return <span>Never left visible</span>;
}

describe('AppErrorBoundary', (): void => {
  it('leaves healthy content and its persistence alone', (): void => {
    const flush = vi.fn();
    cleanups.push(persistence.registerPersistFlush(flush));
    renderShell(<span>こんにちは · مرحبا · 👩🏽‍💻</span>);
    expect(mounted().root.findByType('span').children).toEqual(['こんにちは · مرحبا · 👩🏽‍💻']);
    expect(mounted().root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(flush).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'multilingual Error', failure: new Error('한글 日本語 中文 हिन्दी مرحبا 👨‍👩‍👧‍👦 e\u0301 <script>') },
    { label: 'string exception', failure: '非 Error の例外 <img src=x> & "' },
    { label: 'null exception', failure: null },
    { label: 'unsafe object', failure: { toString: (): never => { throw new Error('Unsafe error formatting'); } } },
  ])('contains $label without exposing or formatting it', ({ failure }: { failure: unknown }): void => {
    const flush = vi.fn();
    cleanups.push(persistence.registerPersistFlush(flush));
    renderShell(<BrokenRender failure={failure} />);
    expect(mounted().root.findAllByProps({ role: 'alert' })).toHaveLength(1);
    expect(mounted().root.findAllByType('button')).toHaveLength(1);
    expect(JSON.stringify(mounted().toJSON())).not.toContain('<script>');
    expect(flush).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('[AppErrorBoundary] UI rendering failed', failure, expect.any(String));
  });

  it('contains lifecycle failures as well as render failures', (): void => {
    renderShell(<BrokenEffect />);
    expect(mounted().root.findAllByProps({ role: 'alert' })).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith('[AppErrorBoundary] UI rendering failed', expect.any(Error), expect.stringContaining('BrokenEffect'));
  });

  it('waits for explicit retry, flushes multilingual drafts and keeps stores and unrelated settings', (): void => {
    const draft = '조합 中文 かな हिन्दी مرحبا e\u0301 👩🏽‍💻 <>&';
    storage.set('existing-preference', 'unchanged');
    useSessionFormDraftStore.getState().patchFormDraft('prompt::session', { prompt: draft });
    expect(storage.has(SESSION_FORM_DRAFT_STORAGE_KEY)).toBe(false);
    const storeBefore = useSessionFormDraftStore.getState().drafts;
    renderShell(<BrokenRender failure={new Error('Temporary render failure')} />);
    expect(storage.get(SESSION_FORM_DRAFT_STORAGE_KEY)).toContain(draft);
    act((): void => { mounted().update(shell(<span>Recovered</span>)); });
    expect(mounted().root.findAllByProps({ role: 'alert' })).toHaveLength(1);
    retry();
    expect(mounted().root.findByType('span').children).toEqual(['Recovered']);
    expect(useSessionFormDraftStore.getState().drafts).toBe(storeBefore);
    expect(storage.get('existing-preference')).toBe('unchanged');
  });

  it('contains repeated failure without automatically entering a retry loop', (): void => {
    const flush = vi.fn();
    cleanups.push(persistence.registerPersistFlush(flush));
    renderShell(<BrokenRender failure={new Error('Persistent failure')} />);
    expect(flush).toHaveBeenCalledTimes(1);
    retry();
    // One pre-retry flush and one new failure flush; no automatic next attempt.
    expect(flush).toHaveBeenCalledTimes(3);
    expect(mounted().root.findAllByProps({ role: 'alert' })).toHaveLength(1);
    retry();
    expect(flush).toHaveBeenCalledTimes(5);
    expect(mounted().root.findAllByType('button')).toHaveLength(1);
  });

  it('keeps recovery usable if both draft flushing and diagnostic reporting throw', (): void => {
    vi.spyOn(persistence, 'flushAllPersisted').mockImplementation((): never => { throw new Error('Storage unavailable'); });
    vi.mocked(console.error).mockImplementation((message: unknown): void => {
      // React itself also reports caught errors; fail only the application's diagnostic call.
      if (typeof message === 'string' && message.startsWith('[AppErrorBoundary]')) throw new Error('Diagnostic sink unavailable');
    });
    renderShell(<BrokenRender failure={new Error('Render failure')} />);
    expect(mounted().root.findAllByProps({ role: 'alert' })).toHaveLength(1);
    act((): void => { mounted().update(shell(<span>Recovered</span>)); });
    expect((): void => { retry(); }).not.toThrow();
    expect(mounted().root.findByType('span').children).toEqual(['Recovered']);
  });

  it('updates the recovery control when the active language changes', async (): Promise<void> => {
    try {
      renderShell(<BrokenRender failure={new Error('Render failure')} />);
      await act(async (): Promise<void> => { await i18n.changeLanguage('ko'); });
      expect(mounted().root.findByType('button').children).toEqual(['다시 시도']);
      expect(mounted().root.findByType('h1').children).toEqual(['화면을 표시할 수 없습니다']);
    } finally {
      await act(async (): Promise<void> => { await i18n.changeLanguage('en'); });
    }
  });
});
