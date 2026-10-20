import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppShellProps } from '../../apps/registry.js';
import { updateAppWindowTarget, useAppWindowTarget, useAppWindowTransferGuard } from '../../apps/appWindowLifecycle.js';
import { useAppWindowCloseGuard } from '../../apps/appWindowCloseGuard.js';
import { confirmDialog } from '../../utils/appDialog.js';
import { shortcutLabel } from '../../utils/platform.js';
import { fetchWorkspaceMediaBlob } from '../../utils/workspaceMedia.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { ScrollFade } from '../ScrollFade.js';
import { SourceConnections } from '../Creation/SourceConnections.js';
import { creationErrorText } from '../Creation/creationErrors.js';
import { IMAGE_LIMITS, applyImageStyle, imageId, isImageDocument, newImageLayer, type ImageDocument } from '../Creation/imageSource.js';
import { loadImage } from '../Creation/imageRender.js';
import { useImageDocument } from './useImageDocument.js';
import { useImageExport } from './useImageExport.js';
import { ImageToolbar } from './ImageToolbar.js';
import { ImageStage } from './ImageStage.js';
import { ImageInspector } from './ImageInspector.js';
import { ImageAgentPanel } from './ImageAgentPanel.js';
import { ImagePhotoTools } from './ImagePhotoTools.js';
import { ImageReview } from './ImageReview.js';
import { ImageSourcePicker } from './ImageSourcePicker.js';
import { imageLayerOrigin, updateLinkedImage } from './imageSources.js';
import { importedImageSource } from './imageImport.js';
import { imageLabelKey } from './imageLabels.js';
import { latestImageCandidate } from './imagePresentation.js';

/** Typing in a field owns its keys (its own undo, its own delete). */
function typingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable);
}

/** Adds a picture as one image layer of the latest draft; an empty canvas takes the picture's size. */
function withPicture(doc: ImageDocument, image: HTMLImageElement, name: string, source: string, original?: string): { doc: ImageDocument; id: string } {
  const empty = doc.layers.length === 0;
  const factor = Math.min(1, IMAGE_LIMITS.maxSize / image.naturalWidth, IMAGE_LIMITS.maxSize / image.naturalHeight);
  const canvas: ImageDocument = empty
    ? { ...doc, width: Math.max(16, Math.round(image.naturalWidth * factor)), height: Math.max(16, Math.round(image.naturalHeight * factor)), background: 'transparent' }
    : doc;
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const layer = {
    ...newImageLayer(canvas, 'image', name), x: 0, y: 0, width: image.naturalWidth * scale, height: image.naturalHeight * scale,
    source, ...(original ? { sourceOriginal: original } : {}),
  };
  return { doc: { ...canvas, layers: [...canvas.layers, layer] }, id: layer.id };
}

export function ImageEditor({ params, onShowPicture }: AppShellProps & { onShowPicture?: () => void }): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const root = params['projectId'] ?? ''; const file = params['file'] ?? '';
  const initial = useRef({ root, id: params['imageId'] ?? params['ref'] ?? '', file });
  if (initial.current.root !== root) initial.current = { root, id: params['imageId'] ?? params['ref'] ?? '', file };
  const state = useImageDocument(root, initial.current.id);
  const output = useImageExport(root, state.save);
  const [selected, setSelected] = useState(''); const [agentId, setAgentId] = useState('');
  const [reviewChoice, setReviewChoice] = useState<{ scope: string; id: string; latestId: string } | null>(null);
  const [tools, setTools] = useState<{ doc: ImageDocument; selected: string } | null>(null);
  const [importError, setImportError] = useState(''); const [importBusy, setImportBusy] = useState(false);
  const busy = state.busy || output.busy || importBusy || !!tools;
  const scope = `${root}\u0000${state.doc?.id ?? ''}`;
  const latest = latestImageCandidate(state.candidates, state.doc?.revision);
  const choice = reviewChoice?.scope === scope ? reviewChoice : null;
  // An explicit comparison stays selected. Back stays in the source until a new proposal arrives.
  // Automatic review never hides unsaved work or an active photo edit.
  const chosen = choice?.id ? state.candidates.find((item) => item.id === choice.id) : undefined;
  const sourceChosen = choice?.id === '' && choice.latestId === (latest?.id ?? '');
  const summary = chosen ?? (!sourceChosen && !state.dirty && !tools ? latest : undefined);
  const reviewTarget = `${scope}\u0000${summary?.id ?? ''}`;
  const activeReview = useRef(reviewTarget); activeReview.current = reviewTarget;
  const setReviewId = (id: string): void => { setReviewChoice({ scope, id, latestId: latest?.id ?? '' }); };
  const edit = (next: ImageDocument, group?: string): void => { if (!busy) state.change(next, group); };
  const current = useRef(state); current.current = state;
  const hosted = !!params['appWindowId'] || params['appWindowHosted'] === '1';
  useAppWindowTarget(params, state.doc ? { ref: state.doc.id, file: initial.current.file || undefined } : null);
  useAppWindowTransferGuard(params, async () => {
    if (busy) return false;
    const saved = state.dirty ? await state.save() : state.doc;
    if (state.dirty && !saved) return false;
    if (saved) await updateAppWindowTarget(params, { ref: saved.id, file: initial.current.file || undefined });
    return true;
  });
  const confirmDiscard = async (): Promise<boolean> => {
    const snapshot = current.current;
    if (!snapshot.dirty) return true;
    const accepted = await confirmDialog(key('confirmCloseUnsaved'), {
      title: t('panel.options.discardTitle'), confirmLabel: t('panel.options.discardLeave'),
      cancelLabel: t('panel.options.discardKeep'), tone: 'danger',
    });
    return accepted && current.current.draft === snapshot.draft && current.current.doc?.id === snapshot.doc?.id;
  };
  useAppWindowCloseGuard(params, confirmDiscard);

  /** The picture stays inline in the draft; it reaches the disk only when the source is saved (as a blob). */
  const importRaster = useCallback(async (blob: Blob, name: string, original?: string): Promise<void> => {
    const source = await importedImageSource(blob);
    const image = await loadImage(source);
    if (image.naturalWidth < 1 || image.naturalHeight < 1) throw new Error('image-source-invalid');
    // Applied to the draft as it is NOW — an edit made while the picture decoded is kept, the picture is not dropped.
    const next = withPicture(current.current.draft, image, name, source, original);
    current.current.change(next.doc); setSelected(next.id);
  }, []);
  useEffect(() => {
    if (!initial.current.file || initial.current.id) return undefined;
    let cancelled = false; setImportBusy(true);
    void fetchWorkspaceMediaBlob(root, initial.current.file).then(async (blob) => {
      if (cancelled) return;
      if (!blob) throw new Error('image-source-unavailable');
      await importRaster(blob, initial.current.file, initial.current.file);
    }).catch((failure: unknown) => { if (!cancelled) setImportError(creationErrorText(t, failure)); })
      .finally(() => { if (!cancelled) setImportBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);
  const importFile = async (incoming: File): Promise<void> => {
    setImportBusy(true); setImportError('');
    try {
      if (incoming.size > IMAGE_LIMITS.fileBytes) throw new Error('largeImage');
      if (incoming.name.endsWith('.json')) {
        const value: unknown = JSON.parse(await incoming.text());
        if (!isImageDocument(value)) throw new Error('invalidSource');
        state.change(value); setSelected('');
      } else await importRaster(incoming, incoming.name);
    } catch (failure) {
      const reason = failure instanceof Error && (failure.message === 'largeImage' || failure.message === 'invalidSource') ? failure.message : '';
      setImportError(reason ? key(reason) : creationErrorText(t, failure));
    } finally { setImportBusy(false); }
  };
  const add = (kind: 'text' | 'shape'): void => {
    const layer = newImageLayer(state.draft, kind, key(kind)); state.change({ ...state.draft, layers: [...state.draft.layers, layer] }); setSelected(layer.id);
  };
  const layer = state.draft.layers.find((item) => item.id === selected);
  const duplicate = (): void => {
    if (!layer || layer.locked || busy) return;
    const copy = { ...layer, id: imageId(), x: layer.x + 20, y: layer.y + 20 };
    state.change({ ...state.draft, layers: [...state.draft.layers, copy] }); setSelected(copy.id);
  };
  const remove = (): void => {
    if (!layer || layer.locked || busy) return;
    state.change({ ...state.draft, layers: state.draft.layers.filter((item) => item.id !== layer.id) }); setSelected('');
  };
  const stale = state.candidates.filter((item) => item.baseRevision !== state.doc?.revision).length;
  const error = importError || (output.error ? creationErrorText(t, new Error(output.error)) : '') || (state.error ? creationErrorText(t, new Error(state.error)) : '');
  const backToPicture = async (): Promise<void> => { if (await confirmDiscard()) onShowPicture?.(); };
  return <div className="relative flex h-full min-h-0 flex-col bg-gray-950 text-gray-100" data-shortcut-scope="dialog" onKeyDown={(event) => {
    if (typingTarget(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const name = event.key.toLowerCase();
    if (summary) {
      // A proposal is being inspected, not the editable source behind it.
      if ((mod && ['s', 'z', 'y'].includes(name)) || event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault(); event.stopPropagation();
      }
      return;
    }
    if (mod && name === 'z') { event.preventDefault(); event.stopPropagation(); void (event.shiftKey ? state.redo() : state.undo()); }
    else if (mod && name === 'y') { event.preventDefault(); event.stopPropagation(); void state.redo(); }
    else if (mod && name === 's') { event.preventDefault(); event.stopPropagation(); void state.save(); }
    else if (!mod && (event.key === 'Delete' || event.key === 'Backspace') && layer) { event.preventDefault(); remove(); }
  }}>
    <header className={`${hosted ? '' : 'app-drag '}flex h-11 shrink-0 items-center gap-3 border-b border-white/10 px-3`}>
      <span className={`${hosted ? '' : 'app-drag-label '}shrink-0 text-sm font-semibold`}>Vibimage</span>
      {summary ? <span className="min-w-0 truncate text-xs text-amber-200" title={summary.label}>{key('compare')} · {summary.label}</span> : <span className="min-w-0 truncate text-xs text-gray-400">
        {state.draft.width} × {state.draft.height} · {key(state.draft.background === 'transparent' ? 'transparent' : 'opaque')}
        {' · '}{key(busy ? 'working' : !state.doc || state.dirty ? 'unsaved' : 'saved')}
        {state.doc ? ` · ${t('panel.creation.revisionShort', { revision: state.doc.revision })}` : ''}
      </span>}
      {!hosted && <div className="app-nodrag ml-auto"><WindowControls /></div>}
    </header>
    {!summary && <ImageToolbar title={state.title} onTitle={(value) => { if (!busy) state.setTitle(value); }} docs={state.docs} id={state.doc?.id ?? ''} dirty={state.dirty} busy={busy}
      canUndo={state.canUndo} canRedo={state.canRedo} onOpen={(id) => { if (id) void state.open(id); }} onNew={state.fresh}
      onSave={() => { void state.save(); }} onUndo={() => { void state.undo(); }} onRedo={() => { void state.redo(); }}
      onAdd={add} onImport={(incoming) => { void importFile(incoming); }} onExport={(kind, variants) => { void output.run(kind, variants); }}
      onTools={() => setTools({ doc: state.draft, selected })} onOriginal={onShowPicture ? backToPicture : undefined} />}
    {!summary && <ImageSourcePicker root={root} doc={state.doc} disabled={busy || state.dirty} styleDisabled={busy} onDoc={state.receive}
      onStyle={(style, toLayers) => edit(toLayers ? applyImageStyle(state.draft, style) : { ...state.draft, style })} />}
    {state.failedDocs.length > 0 && <p role="alert" className="break-words bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">{t('panel.creation.unreadableSources', { count: state.failedDocs.length })}</p>}
    {error && <p role="alert" className="break-words bg-amber-950/50 px-3 py-2 text-xs text-amber-200">{error}</p>}
    {state.remote && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-950/50 px-3 py-2 text-xs"><span className="min-w-0 break-words">{key('conflict')}</span>
      <button type="button" className="pointer-coarse:py-2" onClick={() => { void state.copy(); }}>{key('keepCopy')}</button><button type="button" className="pointer-coarse:py-2" onClick={state.useRemote}>{key('loadLatest')}</button></div>}
    {!!state.candidates.length && !summary && <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-xs">
      {state.candidates.map((item) => <span key={item.id} className="flex min-w-0 max-w-full items-center gap-1 rounded bg-amber-200/10">
        <button type="button" className="min-w-0 break-words px-3 py-1.5 text-left pointer-coarse:py-2" onClick={() => setReviewId(item.id)}>{key('compare')} · {item.label}</button>
        <button type="button" className="shrink-0 px-2 py-1.5 text-gray-400 hover:text-gray-100 pointer-coarse:py-2" aria-label={key('discard')} title={key('discard')}
          onClick={() => { void state.discard(item.id); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </span>)}
      {stale > 0 && <button type="button" className="rounded bg-white/5 px-3 py-1.5 pointer-coarse:py-2" onClick={() => { void state.cleanup('stale'); }}>{key('cleanupStale')}</button>}
        <button type="button" className="rounded bg-white/5 px-3 py-1.5 pointer-coarse:py-2" onClick={async () => { if (await confirmDialog(key('confirmCleanupAll'), { tone: 'danger' })) await state.cleanup('all'); }}>{key('cleanupAll')}</button>
    </div>}
    {summary && state.doc ? <ImageReview root={root} source={state.doc} summary={summary} readCandidate={state.readCandidate} disabled={busy || state.dirty}
      onAccept={() => state.accept(summary)} onDiscard={() => state.discard(summary.id)}
      onRebase={async () => {
        const moved = await state.rebase(summary.id);
        if (moved && activeReview.current === reviewTarget) setReviewId(moved);
        return moved;
      }}
      onClose={() => setReviewId('')} /> :
      <div className="flex min-h-40 flex-1 box-compact:grid box-compact:grid-cols-[11rem_minmax(0,1fr)] box-compact:grid-rows-[minmax(10rem,1fr)_fit-content(40%)] box-compact:overflow-y-auto box-narrow:grid-cols-[9rem_minmax(0,1fr)]">
        {/* 넓은 창은 [레이어 목록 | 무대 | 속성] 한 줄. 창 폭이 좁으면(box-compact) 속성이 무대 아래 전폭으로, 폰 폭(box-narrow)이면
            무대가 전폭을 갖고 목록·속성이 그 아래에 나란히 선다. 아래 줄은 본문 높이의 40% 까지만 쓰고 칸마다 스크롤한다 — 무대
            하한(10rem)도 못 지키는 낮은 창이면 본문이 통째로 스크롤한다(어느 칸도 잘리지 않게). */}
        <aside className="flex w-44 shrink-0 flex-col gap-2 border-r border-white/10 p-2 text-xs box-compact:min-h-0 box-compact:w-auto box-narrow:row-[2] box-narrow:overflow-y-auto box-narrow:border-t">
          <button type="button" className="p-2 text-left text-gray-400" onClick={() => setSelected('')}>{key('canvas')}</button>
          {/* 폰 폭의 목록 칸은 낮아서 목록만 따로 스크롤하면 한 줄도 안 남는다 — 칸 전체가 한 번에 스크롤한다. */}
          <ScrollFade fill className="box-narrow:shrink-0">{[...state.draft.layers].reverse().map((item) => <button type="button" key={item.id}
            className={`mb-1 flex w-full items-center gap-2 rounded p-2 text-left ${selected === item.id ? 'bg-amber-200/20' : 'bg-white/5'}`} onClick={() => setSelected(item.id)}>
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            {item.locked && <svg role="img" aria-label={key('locked')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
              <title>{key('locked')}</title><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4" />
            </svg>}
          </button>)}</ScrollFade>
          <button type="button" disabled={!layer || layer.locked || busy} className="rounded bg-white/5 p-2 disabled:opacity-35" onClick={duplicate}>{key('duplicate')}</button>
          <button type="button" disabled={!layer || layer.locked || busy} className="rounded bg-white/5 p-2 disabled:opacity-35" title={shortcutLabel('Delete')} onClick={remove}>
            {key('delete')}
          </button>
        </aside>
        <ImageStage root={root} doc={state.draft} selected={selected} onSelect={setSelected} onChange={(next) => edit(next)}
          className="box-narrow:col-[1/3]"
          inspect={{ projectId: root, source: state.doc ? { id: state.doc.id, revision: state.doc.revision, title: state.doc.title } : null, unsaved: state.dirty }} />
        <ImageInspector doc={state.draft} selected={selected} onChange={edit} onEndEdit={state.endEdit}
          className="box-compact:col-span-2 box-compact:min-h-0 box-compact:w-auto box-compact:border-l-0 box-compact:border-t box-narrow:col-[2/3] box-narrow:row-[2]"
          origin={(id) => imageLayerOrigin(state.doc?.links ?? [], id)} />
      </div>}
    {/* 아래 묶음(내보낸 경로 · 원본 연결 · AI 요청)은 높이 상한 안에서 스크롤한다 — 짧은 창에서 이 묶음이 무대를 밀어내거나 창
        밖으로 잘리지 않게. 늘 같은 자리에 그려 비교 중에도 요청 칸이 다시 마운트되지 않는다. */}
    <div className="scrollbar-thin max-h-[50%] min-h-0 overflow-y-auto box-compact:max-h-[40%]">
      {!summary && !!output.paths.length && <div className="border-t border-white/10 px-3 py-2 text-xs text-emerald-200">{output.paths.map((path) => <p key={path} className="break-all">{path}</p>)}</div>}
      {!summary && state.doc && <SourceConnections projectId={root} doc={state.doc} disabled={busy || state.dirty}
        onDoc={(next) => { if (isImageDocument(next.payload)) state.receive({ ...next, payload: next.payload }); }}
        onUpdateLink={async (link, revision) => {
          const doc = current.current.doc;
          if (!doc) return false;
          const next = await updateLinkedImage(root, doc, link, revision);
          if (next) state.receive(next);
          return !!next;
        }} />}
      {/* Keep the request draft and standalone window's agent connection alive while reviewing. */}
      <div hidden={!!summary} className="shrink-0">
        <ImageAgentPanel root={root} selected={selected} doc={state.doc} busy={busy || !!summary} onSave={state.save} onAgent={setAgentId} />
      </div>
    </div>
    {tools && <ImagePhotoTools root={root} doc={tools.doc} selected={tools.selected} agentId={agentId} onApply={(id, source) => {
      const latest = current.current.draft;
      const before = tools.doc.layers.find((item) => item.id === id);
      const now = latest.layers.find((item) => item.id === id);
      // The layer changed while its picture was being edited: keep both by refusing to overwrite silently.
      if (!before || !now || JSON.stringify({ ...now, source: '' }) !== JSON.stringify({ ...before, source: '' }) || now.source !== before.source) {
        setImportError(key('conflict')); return;
      }
      const linked = current.current.doc?.links.some((item) => item.targets.includes(id));
      state.change({ ...latest, layers: latest.layers.map((item) => item.id === id && !item.locked ? { ...item, source, locked: linked || item.locked } : item) });
    }} onClose={() => setTools(null)} />}
  </div>;
}
