import type { RefObject, KeyboardEventHandler } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoDoc } from '@vibisual/video';
import { WindowControls } from '../Layout/WindowControls.js';
import { VideoLibrary, type VideoLibraryProps } from './VideoLibrary.js';
import { VideoInspector, type VideoInspectorProps } from './VideoInspector.js';
import { VideoTimeline } from './VideoTimeline.js';
import type { DocSummary } from './videoApi.js';

interface Action { run: () => void; disabled?: boolean }
export interface VideoStudioViewProps {
  hosted: boolean; projectName: string; docs: DocSummary[]; doc: VideoDoc | null;
  disabled: boolean; importing: boolean; status: string; playing: boolean; playhead: number; duration: number;
  selectedItemId: string | null; canvasRef: RefObject<HTMLCanvasElement>; renderPct: number | null;
  library: VideoLibraryProps | null; inspector: VideoInspectorProps | null;
  showLibrary: boolean; showInspector: boolean; loop: boolean;
  onToggleLibrary: () => void; onToggleInspector: () => void; onToggleLoop: () => void;
  onSelectDoc: (id: string) => void; onCreateDoc: () => void; onSelectItem: (id: string | null) => void;
  onSeek: (time: number) => void; onPlay: () => void; onRefresh: () => void;
  undo: Action; redo: Action; split: Action; duplicate: Action; remove: Action; toggle: Action;
  onAddTitle: () => void; onRender: () => void; onStill: () => void;
  agents: readonly { id: string; label: string }[]; delegateTo: string; onDelegateTo: (id: string) => void; onDelegate: () => void;
  download: { url: string; name: string } | null; onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}
const BUTTON = 'rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10 disabled:opacity-35 disabled:cursor-default';
function time(sec: number): string {
  const seconds = Math.max(0, sec);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}
export function VideoStudioView(p: VideoStudioViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const label = (key: string, fallback: string): string => t(`panel.videoStudio.editor.${key}`, { defaultValue: fallback });
  const editButton = (key: string, fallback: string, action: Action): React.JSX.Element =>
    <button type="button" className={BUTTON} disabled={p.disabled || action.disabled} onClick={action.run}>{label(key, fallback)}</button>;
  return <div className="flex h-full min-h-0 flex-col bg-gray-950 text-gray-100 outline-none" tabIndex={-1} onKeyDown={p.onKeyDown}>
    <header className={`${p.hosted ? '' : 'app-drag '}flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-3`}>
      <span className={`${p.hosted ? '' : 'app-drag-label '}text-sm font-semibold tracking-tight`}>Vibistudio</span>
      <span className="min-w-0 truncate text-xs text-white/40">{p.projectName}</span>
      <div className="app-nodrag ml-auto flex min-w-0 items-center gap-2">
        <select className="min-w-0 max-w-56 rounded bg-gray-800 px-2 py-1.5 text-xs" value={p.doc?.id ?? ''} disabled={p.disabled}
          aria-label={t('panel.videoStudio.pickDoc')} onChange={e => p.onSelectDoc(e.target.value)}>
          <option value="">{t('panel.videoStudio.pickDoc', { defaultValue: '영상 선택…' })}</option>
          {p.doc && !p.docs.some(d => d.id === p.doc?.id) && <option value={p.doc.id}>{p.doc.title}</option>}
          {p.docs.map(d => <option key={d.id} value={d.id}>{p.doc?.id === d.id ? p.doc.title : d.title}</option>)}
        </select>
        <button type="button" className={BUTTON} disabled={p.disabled} onClick={p.onCreateDoc}>{t('panel.videoStudio.newDoc', { defaultValue: '새 영상' })}</button>
      </div>
      {!p.hosted && <WindowControls />}
    </header>
    {!p.doc ? <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m10 8 6 4-6 4Z"/></svg></div>
      <h1 className="text-lg font-semibold">{label('welcome', 'Your next video starts here')}</h1>
      <p className="max-w-md text-sm text-white/50">{label('welcomeHint', 'Build a timeline with motion scenes, media, text, and captions. Fine-tune every clip and render locally.')}</p>
      <button type="button" className={`${BUTTON} bg-violet-600 px-4 py-2`} disabled={p.disabled} onClick={p.onCreateDoc}>{label('createVideo', 'Create a video')}</button>
    </div> : <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <button type="button" className={BUTTON} aria-pressed={p.showLibrary} onClick={p.onToggleLibrary}>{label('library', 'Library')}</button>
        {editButton('undo', 'Undo', p.undo)}{editButton('redo', 'Redo', p.redo)}
        <span className="mx-1 h-4 border-l border-white/15" />
        {editButton('split', 'Split', p.split)}{editButton('duplicate', 'Duplicate', p.duplicate)}
        <button type="button" className={BUTTON} disabled={p.disabled || p.toggle.disabled} onClick={p.toggle.run}>{t('panel.videoStudio.toggleItem', { defaultValue: '켜기/끄기' })}</button>
        <button type="button" className={BUTTON} disabled={p.disabled || p.remove.disabled} onClick={p.remove.run}>{t('panel.videoStudio.removeItem', { defaultValue: '삭제' })}</button>
        <button type="button" className={BUTTON} disabled={p.disabled} onClick={p.onAddTitle}>{t('panel.videoStudio.addTitle', { defaultValue: '제목 추가' })}</button>
        <div className="ml-auto flex gap-2">
          <button type="button" className={BUTTON} disabled={p.disabled} onClick={p.onRefresh}>{label('refresh', 'Reload')}</button>
          <button type="button" className={BUTTON} aria-pressed={p.showInspector} onClick={p.onToggleInspector}>{label('inspector', 'Inspector')}</button>
        </div>
      </div>
      <div className="flex min-h-32 flex-1">
        {p.showLibrary && p.library && <VideoLibrary {...p.library} />}
        <main className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-white/40"><span className="truncate">{p.doc.title}</span><span className="shrink-0 tabular-nums">{p.doc.size.width} × {p.doc.size.height} · {p.doc.fps} fps</span></div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black"
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
            onDrop={event => { event.preventDefault(); if (!p.disabled && p.library) void p.library.onImport(Array.from(event.dataTransfer.files)); }}>
            <canvas ref={p.canvasRef} width={p.doc.size.width} height={p.doc.size.height} className="h-full w-full object-contain" aria-label={label('preview', 'Video preview')} />
            {p.duration === 0 && <p className="pointer-events-none absolute px-4 text-center text-xs text-white/40">{label('emptyTimeline', 'Choose a scene or import media to start editing.')}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
            <button type="button" className={BUTTON} disabled={p.duration <= 0} onClick={() => p.onSeek(p.playhead - 1 / p.doc!.fps)} aria-label={label('previousFrame', 'Previous frame')}>‹</button>
            <button type="button" className={`${BUTTON} min-w-16 bg-violet-500/20`} disabled={p.duration <= 0 || p.disabled} onClick={p.onPlay}>{p.playing ? t('panel.videoStudio.pause', { defaultValue: '일시정지' }) : t('panel.videoStudio.play', { defaultValue: '재생' })}</button>
            <button type="button" className={BUTTON} disabled={p.duration <= 0} onClick={() => p.onSeek(p.playhead + 1 / p.doc!.fps)} aria-label={label('nextFrame', 'Next frame')}>›</button>
            <span className="text-xs tabular-nums text-white/60">{time(p.playhead)} / {time(p.duration)}</span>
            <button type="button" className={BUTTON} aria-pressed={p.loop} onClick={p.onToggleLoop}>{label('loop', 'Loop')}</button>
          </div>
        </main>
        {p.showInspector && p.inspector && <VideoInspector {...p.inspector} />}
      </div>
      <div className="shrink-0 border-t border-white/10 bg-gray-900/40 p-3">
        <VideoTimeline doc={p.doc} playhead={p.playhead} selectedItemId={p.selectedItemId} onSeek={p.onSeek} onSelectItem={p.onSelectItem}
          onApplyOps={p.inspector?.onApplyOps} disabled={p.disabled} />
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 px-3 py-2">
        <select className="max-w-40 rounded bg-gray-800 px-2 py-1.5 text-xs" value={p.delegateTo} onChange={e => p.onDelegateTo(e.target.value)} aria-label={t('panel.videoStudio.pickAgent')}>
          <option value="">{t('panel.videoStudio.pickAgent', { defaultValue: '에이전트 선택…' })}</option>
          {p.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
        </select>
        <button type="button" className={BUTTON} disabled={!p.selectedItemId || !p.delegateTo || p.disabled} onClick={p.onDelegate}>{t('panel.videoStudio.delegate', { defaultValue: '이 컷 맡기기' })}</button>
        <div className="ml-auto flex items-center gap-2">
          {p.importing && <span role="status" className="text-xs text-violet-200">{label('importing', 'Importing…')}</span>}
          {p.renderPct !== null && <span role="status" className="text-xs tabular-nums text-violet-200">{Math.round(p.renderPct * 100)}%</span>}
          {p.download && <a className={`${BUTTON} text-emerald-300`} href={p.download.url} download={p.download.name}>{label('download', 'Download MP4')}</a>}
          <button type="button" className={BUTTON} disabled={p.disabled || p.duration <= 0} onClick={p.onStill}>{label('saveStill', 'Save PNG')}</button>
          <button type="button" className={`${BUTTON} bg-violet-600 font-medium hover:bg-violet-500`} disabled={p.disabled || p.duration <= 0} onClick={p.onRender}>{t('panel.videoStudio.render', { defaultValue: '렌더' })} MP4</button>
        </div>
      </footer>
    </>}
    {p.status && <p role="status" className="shrink-0 border-t border-amber-500/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{p.status}</p>}
  </div>;
}
