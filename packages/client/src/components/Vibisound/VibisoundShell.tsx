import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { audioDocDuration, cropRange, encodeWav, formatClipTime } from '@vibisual/audio';
import type { AppShellProps } from '../../apps/registry.js';
import { useAppWindowTarget, useAppWindowTransferGuard } from '../../apps/appWindowLifecycle.js';
import { writeWorkspaceMedia } from '../../utils/workspaceMedia.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { ScrollFade } from '../ScrollFade.js';
import { SoundButton } from './SoundButton.js';
import { SoundConnections } from './SoundConnections.js';
import { SoundInspector } from './SoundInspector.js';
import { SoundLibrary } from './SoundLibrary.js';
import { SoundTracks } from './SoundTracks.js';
import { SoundWaveform } from './SoundWaveform.js';
import { findSoundClip, safeSoundFileName } from './soundModel.js';
import type { SoundRange } from './soundConfig.js';
import { useSoundProject } from './useSoundProject.js';
import { useSoundAudio } from './useSoundAudio.js';

/** Humans and CLI edit one versioned document; PCM is a disposable preview. */
export function VibisoundShell({ params }: AppShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const tr = (key: string): string => t(`panel.vibisound.workbench.${key}`);
  const projectId = params['projectId'] ?? '';
  const initial = useRef({ projectId, ref: params['clipId'] ?? '', file: params['file'] ?? '' });
  if (initial.current.projectId !== projectId) initial.current = { projectId, ref: params['clipId'] ?? '', file: params['file'] ?? '' };
  const project = useSoundProject(projectId, initial.current.ref, initial.current.file);
  const { doc, envelope, busy } = project;
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<SoundRange | null>(null);
  const [loop, setLoop] = useState(false);
  const [source, setSource] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [title, setTitle] = useState('');
  const titleVersion = useRef(0);
  const titleFocused = useRef(false);
  const audio = useSoundAudio(projectId, doc, source ? selected : null);
  const clip = findSoundClip(doc, selected);
  const duration = doc ? audioDocDuration(doc) : 0;
  const disabled = busy || exporting || !projectId;
  const embedded = !!params['appWindowId'] || params['appWindowHosted'] === '1';
  useAppWindowTarget(params, doc ? { ref: doc.id, file: undefined } : null);
  useAppWindowTransferGuard(params, async () => !busy && !exporting);

  useEffect(() => { setRange(null); setSource(false); }, [doc?.id]);
  useEffect(() => {
    if (doc && !findSoundClip(doc, selected)) setSelected(doc.tracks.flatMap(track => track.clips)[0]?.id ?? null);
    if (!doc) setSelected(null);
    if (!titleFocused.current) setTitle(doc?.title ?? '');
  }, [doc, selected]);
  useEffect(() => {
    setRange(value => value && value.start < duration ? { start: value.start, end: Math.min(value.end, duration) } : null);
  }, [duration]);

  const togglePlay = (): void => { if (audio.playing) audio.stop(); else void audio.play(range, loop); };
  const exportWav = async (selectedRange: boolean): Promise<void> => {
    if (!doc || !audio.mix || exporting) return;
    setExporting(true); project.setError(''); project.setNotice('');
    try {
      const pcm = selectedRange && range ? cropRange(audio.mix, range.start, range.end) : audio.mix;
      const path = `.vibisual/audio/out/${safeSoundFileName(doc.title)}-${crypto.randomUUID()}.wav`;
      const result = await writeWorkspaceMedia(projectId, path, encodeWav(pcm));
      if (!result.ok) throw new Error(tr('saveFailed'));
      project.setNotice(t('panel.vibisound.workbench.exported', { path: result.path }));
    } catch (err) { project.setError(err instanceof Error ? err.message : tr('saveFailed')); }
    finally { setExporting(false); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('input,textarea,select,button,[contenteditable="true"],[role="button"]')) return;
    if (event.key === ' ' && audio.pcm) { event.preventDefault(); event.stopPropagation(); togglePlay(); }
    if (!disabled && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation();
      void project.history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
    }
  };
  return <div tabIndex={0} onKeyDown={onKeyDown} className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0b1118] text-slate-200 outline-none"
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); if (!disabled && event.dataTransfer.files.length) void project.importFiles(Array.from(event.dataTransfer.files)); }}>
    <header className={`flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3 ${embedded ? '' : 'app-drag'}`}>
      <svg className="h-6 w-6 shrink-0 text-teal-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 10v4m4-7v10m5-14v18m5-14v10m4-7v4" /></svg>
      <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold tracking-wide">Vibisound</h1><p className="truncate text-xs text-slate-500">{tr('subtitle')}</p></div>
      <span className="text-xs text-slate-400" role="status">{busy || exporting ? tr('working') : doc ? t('panel.vibisound.workbench.saved', { version: doc.version }) : ''}</span>
      {!embedded && <WindowControls />}
    </header>
    <ScrollFade fill className="flex-1">
      <div className="flex min-h-full flex-wrap items-start">
        <aside className="w-56 grow border-b border-white/10 lg:grow-0"><SoundLibrary doc={doc} docs={project.docs} disabled={disabled} open={project.open} create={project.create} importFiles={project.importFiles} /></aside>
        <main className="min-w-0 flex-[3_1_420px] space-y-4 border-x border-white/10 p-4">
          {doc ? <>
            <form className="flex gap-2" onSubmit={event => {
              event.preventDefault();
              if (title.trim() && title.trim() !== doc.title) void project.patch([{ op: 'setDoc', patch: { title: title.trim() } }], titleVersion.current);
              titleFocused.current = false;
            }}>
              <input aria-label={tr('projectTitle')} value={title} disabled={disabled} maxLength={240} onFocus={() => { titleVersion.current = doc.version; titleFocused.current = true; }} onBlur={() => { titleFocused.current = false; }} onChange={event => setTitle(event.target.value)} className="min-w-0 flex-1 rounded bg-white/5 px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-teal-400/50" />
              <SoundButton type="submit" disabled={disabled || !title.trim() || title === doc.title}>{tr('apply')}</SoundButton>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <SoundButton accent disabled={!audio.pcm || audio.loading || !duration} onClick={togglePlay}>{tr(audio.playing ? 'pause' : 'play')}</SoundButton>
              <SoundButton disabled={!audio.pcm} onClick={() => audio.seek(range?.start ?? 0)}>{tr('stop')}</SoundButton>
              <SoundButton accent={loop} aria-pressed={loop} onClick={() => { audio.stop(); setLoop(value => !value); }}>{tr('loop')}</SoundButton>
              <span className="px-1 font-mono text-xs tabular-nums text-teal-100">{formatClipTime(audio.playhead)} / {formatClipTime(duration)}</span>
              <SoundButton disabled={disabled || !envelope?.canUndo} onClick={() => void project.history('undo')}>{tr('undo')}</SoundButton>
              <SoundButton disabled={disabled || !envelope?.canRedo} onClick={() => void project.history('redo')}>{tr('redo')}</SoundButton>
            </div>
            <SoundWaveform pcm={audio.pcm} playhead={audio.playhead} selection={range} onSeek={audio.seek} onSelect={setRange} />
            <div className="flex flex-wrap items-center gap-2">
              <SoundButton disabled={!clip || audio.loading} accent={source} aria-pressed={source} title={tr('originalHint')} onClick={() => setSource(value => !value)}>{tr(source ? 'playMix' : 'playOriginal')}</SoundButton>
              <span className="flex-1 text-xs text-slate-500">{audio.loading ? tr('preparing') : tr(source ? 'sourceMode' : 'mixMode')}</span>
              <SoundButton disabled={disabled || !audio.mix || !duration} onClick={() => void exportWav(false)}>{tr('export')}</SoundButton>
              <SoundButton disabled={disabled || !audio.mix || !range} onClick={() => void exportWav(true)}>{tr('exportSelection')}</SoundButton>
            </div>
            <SoundTracks doc={doc} selected={selected} playhead={audio.playhead} busy={disabled} onSelect={setSelected} onSeek={audio.seek} patch={project.patch} />
            <p className="text-xs leading-relaxed text-slate-500">{tr('selectHint')}</p>
          </> : <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-teal-500/20 p-8 text-center">
            <h2 className="text-lg font-medium text-teal-100">{tr('emptyTitle')}</h2><p className="max-w-md text-sm leading-relaxed text-slate-400">{tr(projectId ? 'emptyHint' : 'noProject')}</p>
          </div>}
          {(project.error || audio.error) && <p role="alert" className="break-words rounded border border-rose-400/20 bg-rose-400/10 p-3 text-xs leading-relaxed text-rose-200">{t('panel.vibisound.workbench.error', { message: project.error || audio.error })}</p>}
          {project.notice && <p role="status" className="break-words rounded bg-teal-400/10 p-3 text-xs text-teal-200">{project.notice}</p>}
        </main>
        <aside className="min-w-0 flex-[1_1_280px] border-l border-white/5">
          <h2 className="px-3 pt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{tr('properties')}</h2>
          {doc ? <SoundInspector doc={doc} clip={clip} sourceDuration={clip ? audio.sourceDurations[clip.assetId] : undefined} selection={range} playhead={audio.playhead} busy={disabled} patch={project.patch} /> : <p className="p-3 text-xs text-slate-500">{tr('selectClip')}</p>}
          <div className="border-t border-white/10 p-3"><SoundConnections projectId={projectId} doc={doc} selectedClipId={selected} selection={range} disabled={disabled} /></div>
          <details className="border-t border-white/10 p-3 text-xs text-slate-400"><summary className="cursor-pointer">{tr('history')}</summary><div className="mt-3 space-y-2">
            {envelope?.history?.length ? envelope.history.slice(-10).reverse().map(item => <p key={`${item.version}-${item.requestId}`}>{t('panel.vibisound.workbench.version', { version: item.version })} · {item.actor ?? 'Vibisound'}</p>) : <p>{tr('emptyHistory')}</p>}
          </div></details>
        </aside>
      </div>
    </ScrollFade>
  </div>;
}
