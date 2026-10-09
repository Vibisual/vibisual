import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioProviderDraft, AudioProviderSettings } from '@vibisual/audio';

export type SoundProviderStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'loadFailed' | 'saveFailed';

/** Settings remain on the local Vibisual server; endpoints in drafts are never contacted. */
export function useSoundProviders(projectId: string): {
  providers: AudioProviderDraft[];
  setProviders: (providers: AudioProviderDraft[]) => void;
  status: SoundProviderStatus;
  dirty: boolean;
  retry: () => void;
  save: () => Promise<void>;
} {
  const [providers, updateProviders] = useState<AudioProviderDraft[]>([]);
  const [status, setStatus] = useState<SoundProviderStatus>('loading');
  const [dirty, setDirty] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void (async (): Promise<void> => {
      try {
        if (!projectId) throw new Error('Missing project');
        const response = await fetch(`/api/app/vibisound/settings?project=${encodeURIComponent(projectId)}`, { signal: controller.signal });
        // This local route owns the settings schema; reject incomplete responses before displaying a saved state.
        const body = await response.json() as { ok?: boolean; settings?: AudioProviderSettings };
        if (!response.ok || body.ok !== true || !Array.isArray(body.settings?.providers)) throw new Error('Invalid settings response');
        if (controller.signal.aborted) return;
        updateProviders([...body.settings.providers]);
        setDirty(false);
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('loadFailed');
      }
    })();
    return () => controller.abort();
  }, [projectId, attempt]);
  const setProviders = useCallback((next: AudioProviderDraft[]): void => {
    updateProviders(next);
    setDirty(true);
    setStatus('ready');
  }, []);
  const save = useCallback(async (): Promise<void> => {
    if (!projectId || saving.current || status === 'loading' || status === 'loadFailed') return;
    saving.current = true;
    setStatus('saving');
    try {
      const response = await fetch('/api/app/vibisound/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId, settings: { providers } }),
      });
      const body = await response.json() as { ok?: boolean; settings?: AudioProviderSettings };
      if (!response.ok || body.ok !== true || !Array.isArray(body.settings?.providers)) throw new Error('Settings save failed');
      if (!alive.current) return;
      updateProviders([...body.settings.providers]);
      setDirty(false);
      setStatus('saved');
    } catch {
      if (alive.current) setStatus('saveFailed');
    } finally {
      saving.current = false;
    }
  }, [projectId, providers, status]);
  return { providers, setProviders, status, dirty, retry: () => setAttempt((n) => n + 1), save };
}
