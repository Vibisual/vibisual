import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AudioDocOp } from '@vibisual/audio';
import { clientPathKey } from '../../utils/platform.js';
import { assetClipOps } from './soundModel.js';
import { SOUND_UI } from './soundConfig.js';
import { measureSoundImport } from './soundImport.js';
import { createSoundDoc, importSoundAsset, listSoundDocs, mutateSoundDoc, readSoundDoc, SoundApiError, type SoundEnvelope, type SoundSummary } from './soundApi.js';

/** UI and CLI both commit to the server document; polling never overwrites a newer local response. */
export function useSoundProject(project: string, initialRef: string, initialFile: string) {
  const { t } = useTranslation();
  const [envelope, setEnvelope] = useState<SoundEnvelope | null>(null);
  const [docs, setDocs] = useState<SoundSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const current = useRef(envelope);
  const running = useRef(false);
  const epoch = useRef(0);
  const tr = useCallback((key: string) => t(`panel.vibisound.workbench.${key}`), [t]);
  const errorText = useCallback((error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return ['decodeError', 'memoryLimit'].includes(message) ? tr(message) : message;
  }, [tr]);
  const errorTextRef = useRef(errorText);
  errorTextRef.current = errorText;
  const accept = useCallback((next: SoundEnvelope | null): void => { current.current = next; setEnvelope(next); }, []);
  const refreshList = useCallback(async (): Promise<void> => {
    const tag = epoch.current;
    const result = await listSoundDocs(project);
    if (tag === epoch.current) setDocs(result);
  }, [project]);
  const run = useCallback(async (action: () => Promise<SoundEnvelope | void>): Promise<void> => {
    if (running.current || !project) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    const tag = epoch.current;
    try {
      const next = await action();
      if (tag !== epoch.current) return;
      if (next) accept(next);
      await refreshList();
    } catch (err) {
      if (tag !== epoch.current) return;
      if (err instanceof SoundApiError && err.status === 409 && current.current) {
        try { const latest = await readSoundDoc(project, current.current.doc.id); if (tag === epoch.current) accept(latest); }
        catch { /* The visible conflict remains actionable even if the refresh also fails. */ }
        if (tag !== epoch.current) return;
        setError(tr('conflict'));
      } else setError(errorText(err));
    } finally { if (tag === epoch.current) { running.current = false; setBusy(false); } }
  }, [project, accept, refreshList, tr, errorText]);
  const open = useCallback((id: string): Promise<void> => run(() => readSoundDoc(project, id)), [run, project]);
  const create = useCallback((): Promise<void> => run(() => createSoundDoc(project, tr('untitled'))), [run, project, tr]);
  const patch = useCallback((ops: readonly AudioDocOp[], expectedVersion?: number): Promise<void> => run(async () => {
    const value = current.current;
    if (!value) return;
    if (expectedVersion !== undefined && value.doc.version !== expectedVersion) throw new SoundApiError(409, 'version-conflict', tr('conflict'));
    return mutateSoundDoc(project, value.doc, 'patch', ops);
  }), [run, project, tr]);
  const history = useCallback((action: 'undo' | 'redo'): Promise<void> => run(async () => {
    if (current.current) return mutateSoundDoc(project, current.current.doc, action);
  }), [run, project]);
  const importFiles = useCallback((files: readonly (File | string)[]): Promise<void> => run(async () => {
    const tag = epoch.current;
    let value = current.current;
    for (const file of files) {
      if (typeof file !== 'string' && file.size > SOUND_UI.maxImportBytes) throw new Error(t('panel.vibisound.workbench.largeFile', { size: 128 }));
      const asset = await importSoundAsset(project, file);
      if (tag !== epoch.current) return;
      const duration = await measureSoundImport(project, asset);
      if (tag !== epoch.current) return;
      value ??= await createSoundDoc(project, asset.name);
      if (tag !== epoch.current) return;
      const ids = { track: crypto.randomUUID(), clip: crypto.randomUUID() };
      value = await mutateSoundDoc(project, value.doc, 'patch', assetClipOps(value.doc, asset, ids, duration));
      if (tag !== epoch.current) return;
      // Preserve successful earlier imports if a later file fails.
      accept(value);
    }
    return value ?? undefined;
  }), [run, project, accept, t]);

  useEffect(() => {
    const tag = ++epoch.current;
    running.current = true; setBusy(true); accept(null); setDocs([]); setError('');
    void (async () => {
      try {
        if (!project) return;
        let value: SoundEnvelope | null = null;
        if (initialRef) value = await readSoundDoc(project, initialRef);
        else if (initialFile) {
          const bytes = new TextEncoder().encode(clientPathKey(initialFile));
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
          if (tag !== epoch.current) return;
          value = await createSoundDoc(project, initialFile.split(/[/\\]/).pop() ?? initialFile, `file-${hash}`);
          if (tag !== epoch.current) return;
          if (value.doc.tracks.every(track => track.clips.length === 0)) {
            const asset = await importSoundAsset(project, initialFile);
            if (tag !== epoch.current) return;
            const duration = await measureSoundImport(project, asset);
            if (tag !== epoch.current) return;
            value = await mutateSoundDoc(project, value.doc, 'patch', assetClipOps(value.doc, asset, { track: crypto.randomUUID(), clip: crypto.randomUUID() }, duration));
          }
        }
        if (tag !== epoch.current) return;
        if (value) accept(value);
        await refreshList();
      } catch (err) { if (tag === epoch.current) setError(errorTextRef.current(err)); }
      finally { if (tag === epoch.current) { running.current = false; setBusy(false); } }
    })();
    return () => { epoch.current += 1; running.current = false; };
    // Initial open parameters are captured by the shell; selecting a document does not remount the editor.
  }, [project, initialRef, initialFile, accept, refreshList]);

  useEffect(() => {
    let alive = true;
    let pending = false;
    const timer = window.setInterval(() => {
      const value = current.current;
      if (!value || running.current || pending) return;
      pending = true;
      void readSoundDoc(project, value.doc.id).then(next => {
        if (!alive || running.current || current.current?.doc.id !== next.doc.id) return;
        if (next.doc.version > current.current.doc.version) { accept(next); setNotice(tr('updated')); }
      }).catch((err: unknown) => {
        if (alive && !running.current && current.current?.doc.id === value.doc.id) setError(err instanceof Error ? err.message : String(err));
      }).finally(() => { pending = false; });
    }, SOUND_UI.pollMs);
    return () => { alive = false; window.clearInterval(timer); };
  }, [project, accept, tr]);
  return { envelope, doc: envelope?.doc ?? null, docs, busy, error, notice, setError, setNotice, open, create, patch, history, importFiles, refreshList };
}
