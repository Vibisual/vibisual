import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppShellProps } from '../../apps/registry.js';
import { updateAppWindowTarget, useAppWindowTarget, useAppWindowTransferGuard } from '../../apps/appWindowLifecycle.js';
import { useAppWindowCloseGuard } from '../../apps/appWindowCloseGuard.js';
import { useAppBoxTier } from '../../hooks/useBoxTier.js';
import { confirmDialog } from '../../utils/appDialog.js';
import { fetchWorkspaceMediaBlob } from '../../utils/workspaceMedia.js';
import { ScrollFade } from '../ScrollFade.js';
import { SourceConnections } from '../Creation/SourceConnections.js';
import { creationErrorText } from '../Creation/creationErrors.js';
import { IMAGE_LIMITS, applyImageStyle, isImageDocument, newImageLayer, patchImageLayer, type ImageDocument } from '../Creation/imageSource.js';
import { loadImage } from '../Creation/imageRender.js';
import { useImageDocument } from './useImageDocument.js';
import { useImageExport } from './useImageExport.js';
import { ImageToolbar } from './ImageToolbar.js';
import { ImageToolRail } from './ImageToolRail.js';
import { ImageStage } from './ImageStage.js';
import { ImageStatusBar } from './ImageStatusBar.js';
import { ImageInspector } from './ImageInspector.js';
import { ImageLayersPanel } from './ImageLayersPanel.js';
import { ImageEditorDock } from './ImageEditorDock.js';
import { ImageAgentPanel } from './ImageAgentPanel.js';
import { ImagePhotoTools } from './ImagePhotoTools.js';
import { ImageReview } from './ImageReview.js';
import { ImageSourcePicker } from './ImageSourcePicker.js';
import { imageLayerOrigin, updateLinkedImage } from './imageSources.js';
import { importedImageSource } from './imageImport.js';
import { imageLabelKey } from './imageLabels.js';
import { latestImageCandidate } from './imagePresentation.js';
import type { LayerEditPicture } from './layerEditHandoff.js';
import { VibimageChromeBar } from './VibimageChromeBar.js';
import { arrangeLayers, duplicateLayers, moveLayers, removeLayers, type ArrangeMode } from './imageArrange.js';
import type { Box, Point } from './imageGeometry.js';
import type { DrawTool, EditorTool } from './editorTools.js';
import { editorKeyHandlers } from './editorShortcuts.js';
import { createCursorStore } from './editorCursor.js';
import { useEditorViewport } from './useEditorViewport.js';
import { EditorIcon } from './editorIcons.js';

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

/** `picture` — 빠른 편집이 넘긴 그림(§5.5 #17-25 ④-3). 원본이 없을 때 첫 그림으로 한 번 들어가고, 있으면 `file` 대신 쓴다. */
export function ImageEditor({ params, onShowPicture, picture }: AppShellProps & { onShowPicture?: () => void; picture?: LayerEditPicture | null }): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const root = params['projectId'] ?? ''; const file = params['file'] ?? '';
  const initial = useRef({ root, id: params['imageId'] ?? params['ref'] ?? '', file });
  if (initial.current.root !== root) initial.current = { root, id: params['imageId'] ?? params['ref'] ?? '', file };
  const state = useImageDocument(root, initial.current.id);
  const output = useImageExport(root, state.save);
  const narrow = useAppBoxTier() === 'narrow';
  const viewport = useEditorViewport(state.draft, narrow);
  const cursor = useMemo(() => createCursorStore(), []);
  const [picked, setPicked] = useState<string[]>([]); const [agentId, setAgentId] = useState('');
  const [tool, setTool] = useState<EditorTool>('move'); const [panning, setPanning] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  const freshText = useRef('');
  const [reviewChoice, setReviewChoice] = useState<{ scope: string; id: string; latestId: string } | null>(null);
  const [tools, setTools] = useState<{ doc: ImageDocument; selected: string } | null>(null);
  const [importError, setImportError] = useState(''); const [importBusy, setImportBusy] = useState(false);
  const [closedPaths, setClosedPaths] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = state.busy || output.busy || importBusy || !!tools;
  // 고른 레이어가 원본에서 사라지면(되돌리기·채택·다른 원본) 선택에서도 빠진다.
  const selection = useMemo(() => picked.filter((id) => state.draft.layers.some((layer) => layer.id === id)), [picked, state.draft.layers]);
  const selected = selection[selection.length - 1] ?? '';
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
  const edit = (next: ImageDocument, group?: string): void => { if (!busy && next !== state.draft) state.change(next, group); };
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
  useEffect(() => {
    // 창이 초점을 잃으면 Space 를 뗀 줄 모른다 — 손 도구에 갇히지 않게 푼다.
    if (typeof window === 'undefined') return undefined;
    const release = (): void => setPanning(false);
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, []);

  /** The picture stays inline in the draft; it reaches the disk only when the source is saved (as a blob). */
  const importRaster = useCallback(async (blob: Blob, name: string, original?: string): Promise<void> => {
    const source = await importedImageSource(blob);
    const image = await loadImage(source);
    if (image.naturalWidth < 1 || image.naturalHeight < 1) throw new Error('image-source-invalid');
    // Applied to the draft as it is NOW — an edit made while the picture decoded is kept, the picture is not dropped.
    const next = withPicture(current.current.draft, image, name, source, original);
    current.current.change(next.doc); setPicked([next.id]);
  }, []);
  const seed = useRef(picture ?? null);
  useEffect(() => {
    const handed = seed.current;
    if ((!initial.current.file && !handed) || initial.current.id) return undefined;
    let cancelled = false; setImportBusy(true);
    const bytes = handed ? Promise.resolve<Blob | null>(handed.blob) : fetchWorkspaceMediaBlob(root, initial.current.file);
    void bytes.then(async (blob) => {
      if (cancelled) return;
      if (!blob) throw new Error('image-source-unavailable');
      if (handed) await importRaster(blob, handed.name, handed.original);
      else await importRaster(blob, initial.current.file, initial.current.file);
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
        state.change(value); setPicked([]);
      } else await importRaster(incoming, incoming.name);
    } catch (failure) {
      const reason = failure instanceof Error && (failure.message === 'largeImage' || failure.message === 'invalidSource') ? failure.message : '';
      setImportError(reason ? key(reason) : creationErrorText(t, failure));
    } finally { setImportBusy(false); }
  };
  const add = (kind: 'text' | 'shape', shape: 'rect' | 'ellipse' = 'rect'): void => {
    if (busy) return;
    const layer = { ...newImageLayer(state.draft, kind, key(kind === 'text' ? 'text' : shape === 'ellipse' ? 'ellipse' : 'rectangle')), ...(kind === 'shape' ? { shape } : {}) };
    state.change({ ...state.draft, layers: [...state.draft.layers, layer] }); setPicked([layer.id]);
  };
  /** 그리기 도구 — 끈 상자 그대로, 클릭이면 기본 크기. 글자는 만든 즉시 그 자리 편집으로 들어간다. */
  const draw = (kind: DrawTool, box: Box | null, at: Point): void => {
    setTool('move');
    if (busy) return;
    const doc = state.draft;
    const text = kind === 'text';
    const base = newImageLayer(doc, text ? 'text' : 'shape', key(text ? 'text' : kind === 'ellipse' ? 'ellipse' : 'rectangle'));
    const fontSize = text ? Math.max(8, Math.min(base.fontSize ?? 64, box ? box.height / 1.25 : Infinity)) : undefined;
    const area = box ?? (text
      ? { x: at.x, y: at.y, width: Math.max(200, Math.min(600, doc.width - at.x)), height: (fontSize ?? 64) * 1.5 }
      : { x: at.x - 100, y: at.y - 100, width: 200, height: 200 });
    const layer = {
      ...base, x: area.x, y: area.y, width: Math.max(text ? 24 : 1, area.width), height: Math.max(1, area.height),
      ...(text ? { fontSize } : { shape: kind === 'ellipse' ? 'ellipse' as const : 'rect' as const }),
    };
    state.change({ ...doc, layers: [...doc.layers, layer] }); setPicked([layer.id]);
    if (text) { freshText.current = layer.id; setEditingText(layer.id); }
  };
  const endText = (): void => {
    const id = editingText; setEditingText(null);
    const fresh = freshText.current === id; freshText.current = '';
    const layer = current.current.draft.layers.find((item) => item.id === id);
    // 글자 도구로 막 만든 레이어를 비운 채 나오면 걷는다 — 있던 글자 레이어는 비워도 남긴다.
    if (fresh && layer && !(layer.text ?? '').trim() && !layer.locked) current.current.change(removeLayers(current.current.draft, [layer.id]), `text:${layer.id}`);
    current.current.endEdit();
  };
  const duplicate = (): void => {
    if (busy) return;
    const result = duplicateLayers(state.draft, selection, 20);
    if (result.ids.length) { state.change(result.doc); setPicked(result.ids); }
  };
  const remove = (): void => { if (!busy) { edit(removeLayers(state.draft, selection)); setPicked(selection.filter((id) => state.draft.layers.find((l) => l.id === id)?.locked)); } };
  const arrange = (mode: ArrangeMode): void => edit(arrangeLayers(state.draft, selection, mode));
  const keys = editorKeyHandlers({
    reviewing: !!summary, hasSelection: selection.length > 0, tool, setTool, setPanning, viewport,
    undo: () => { void state.undo(); }, redo: () => { void state.redo(); }, save: () => { void state.save(); },
    remove, duplicate, arrange, selectAll: () => setPicked(state.draft.layers.map((layer) => layer.id)), clearSelection: () => setPicked([]),
    nudge: (dx, dy) => edit(moveLayers(state.draft, selection, dx, dy), `nudge:${selection.join(',')}`), endNudge: state.endEdit,
    editText: () => {
      const layer = selection.length === 1 ? state.draft.layers.find((item) => item.id === selected) : undefined;
      if (layer?.kind !== 'text' || layer.locked || busy) return false;
      setEditingText(layer.id); return true;
    },
  });
  const stale = state.candidates.filter((item) => item.baseRevision !== state.doc?.revision).length;
  const error = importError || (output.error ? creationErrorText(t, new Error(output.error)) : '') || (state.error ? creationErrorText(t, new Error(state.error)) : '');
  const backToPicture = async (): Promise<void> => { if (await confirmDiscard()) onShowPicture?.(); };
  const status = busy ? 'working' : !state.doc || state.dirty ? 'unsaved' : 'saved';
  const pathsKey = output.paths.join('\u0000');
  const openTools = (): void => setTools({ doc: state.draft, selected });
  // 뿌리가 초점을 받는다(tabIndex -1) — 판·레이어 줄처럼 초점 없는 곳을 눌러도 키가 이 편집기로 온다.
  return <div className="relative flex h-full min-h-0 flex-col bg-gray-950 text-gray-100 outline-none" tabIndex={-1} data-shortcut-scope="dialog"
    onKeyDown={keys.onKeyDown} onKeyUp={keys.onKeyUp}>
    <VibimageChromeBar hosted={hosted} title={state.title.trim() || null}>{(dragRegion) => <>
      <span className={`${dragRegion ? 'app-drag-label ' : ''}min-w-0 max-w-[40%] shrink-0 truncate text-[13px] font-semibold text-gray-100`}>{state.title.trim() || 'Vibimage'}</span>
      {summary ? <span className={`${dragRegion ? 'app-drag-label ' : ''}min-w-0 truncate text-xs text-amber-200`} title={summary.label}>{key('compare')} · {summary.label}</span>
        : <span className={`${dragRegion ? 'app-drag-label ' : ''}flex min-w-0 items-center gap-2 text-xs tabular-nums text-gray-400`}>
          <span className="shrink-0">{state.draft.width} × {state.draft.height}</span>
          <span className="shrink-0 truncate box-narrow:hidden">{key(state.draft.background === 'transparent' ? 'transparent' : 'opaque')}</span>
          {state.doc && <span className="shrink-0 box-narrow:hidden">{t('panel.creation.revisionShort', { revision: state.doc.revision })}</span>}
          <span className={`flex min-w-0 items-center gap-1 ${status === 'saved' ? 'text-emerald-300' : status === 'working' ? 'text-blue-300' : 'text-amber-300'}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === 'saved' ? 'bg-emerald-400' : status === 'working' ? 'animate-pulse bg-blue-400' : 'bg-amber-400'}`} />
            <span className="truncate">{key(status)}</span>
          </span>
        </span>}
    </>}</VibimageChromeBar>
    {!summary && <ImageToolbar title={state.title} onTitle={(value) => { if (!busy) state.setTitle(value); }} docs={state.docs} id={state.doc?.id ?? ''} dirty={state.dirty} busy={busy}
      canUndo={state.canUndo} canRedo={state.canRedo} onOpen={(id) => { if (id) void state.open(id); }} onNew={state.fresh}
      onSave={() => { void state.save(); }} onUndo={() => { void state.undo(); }} onRedo={() => { void state.redo(); }}
      onAdd={add} onImport={() => fileInput.current?.click()} onExport={(kind, variants) => { void output.run(kind, variants); }}
      onTools={openTools} onOriginal={onShowPicture ? backToPicture : undefined} />}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,application/json,.vibimage.json" className="hidden"
      onChange={(e) => { const incoming = e.target.files?.[0]; if (incoming) void importFile(incoming); e.target.value = ''; }} />
    {state.failedDocs.length > 0 && <p role="alert" className="break-words border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">{t('panel.creation.unreadableSources', { count: state.failedDocs.length })}</p>}
    {error && <p role="alert" className="break-words border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>}
    {state.remote && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"><span className="min-w-0 break-words">{key('conflict')}</span>
      <button type="button" className="rounded-md bg-gray-800 px-2.5 py-1 hover:bg-gray-700 pointer-coarse:py-2" onClick={() => { void state.copy(); }}>{key('keepCopy')}</button>
      <button type="button" className="rounded-md bg-gray-800 px-2.5 py-1 hover:bg-gray-700 pointer-coarse:py-2" onClick={state.useRemote}>{key('loadLatest')}</button></div>}
    {!!state.candidates.length && !summary && <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
      <EditorIcon name="sparkles" className="h-3.5 w-3.5 shrink-0 text-amber-300" />
      {state.candidates.map((item) => <span key={item.id} className="flex min-w-0 max-w-full items-center rounded-md border border-amber-400/30 bg-amber-400/10 text-amber-100">
        <button type="button" className="min-w-0 break-words px-2.5 py-1 text-left hover:text-white pointer-coarse:py-2" onClick={() => setReviewId(item.id)}>{key('compare')} · {item.label}</button>
        <button type="button" className="shrink-0 px-1.5 py-1 text-amber-200/70 hover:text-white pointer-coarse:py-2" aria-label={key('discard')} title={key('discard')}
          onClick={() => { void state.discard(item.id); }}>
          <EditorIcon name="close" className="h-3.5 w-3.5" />
        </button>
      </span>)}
      {stale > 0 && <button type="button" className="rounded-md px-2.5 py-1 text-gray-300 hover:bg-gray-800 pointer-coarse:py-2" onClick={() => { void state.cleanup('stale'); }}>{key('cleanupStale')}</button>}
      <button type="button" className="rounded-md px-2.5 py-1 text-gray-300 hover:bg-gray-800 pointer-coarse:py-2" onClick={async () => { if (await confirmDialog(key('confirmCleanupAll'), { tone: 'danger' })) await state.cleanup('all'); }}>{key('cleanupAll')}</button>
    </div>}
    {summary && state.doc ? <ImageReview root={root} source={state.doc} summary={summary} readCandidate={state.readCandidate} disabled={busy || state.dirty}
      onAccept={() => state.accept(summary)} onDiscard={() => state.discard(summary.id)}
      onRebase={async () => {
        const moved = await state.rebase(summary.id);
        if (moved && activeReview.current === reviewTarget) setReviewId(moved);
        return moved;
      }}
      onClose={() => setReviewId('')} /> :
      <div className="flex min-h-0 flex-1 box-narrow:flex-col">
        <ImageToolRail tool={tool} onTool={setTool} onPlaceImage={() => fileInput.current?.click()} disabled={busy} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ImageStage root={root} doc={state.draft} selection={selection} onSelect={setPicked} onChange={(next) => edit(next)}
            tool={panning ? 'hand' : tool} onDraw={draw} viewport={viewport} cursor={cursor}
            editingText={editingText} onEditText={(id) => { if (id) setEditingText(id); else endText(); }}
            onTextChange={(id, text) => edit(patchImageLayer(state.draft, id, { text }), `text:${id}`)}
            inspect={{ projectId: root, source: state.doc ? { id: state.doc.id, revision: state.doc.revision, title: state.doc.title } : null, unsaved: state.dirty }} />
          <ImageStatusBar doc={state.draft} selection={selection} viewport={viewport} cursor={cursor} />
        </div>
        <ImageEditorDock narrow={narrow} layerCount={state.draft.layers.length} linkCount={state.doc?.links.length ?? 0}
          properties={<ImageInspector doc={state.draft} selection={selection} onChange={edit} onEndEdit={state.endEdit}
            origin={(id) => imageLayerOrigin(state.doc?.links ?? [], id)} onTools={openTools} onArrange={arrange} onDuplicate={duplicate} onRemove={remove} />}
          layers={<ImageLayersPanel doc={state.draft} selection={selection} busy={busy} onSelect={setPicked} onChange={(next) => edit(next)}
            onDuplicate={duplicate} onRemove={remove} onArrange={arrange} />}
          sources={state.doc ? <ScrollFade fill>
            <ImageSourcePicker root={root} doc={state.doc} disabled={busy || state.dirty} styleDisabled={busy} onDoc={state.receive}
              onStyle={(style, toLayers) => edit(toLayers ? applyImageStyle(state.draft, style) : { ...state.draft, style })} />
            <SourceConnections projectId={root} doc={state.doc} disabled={busy || state.dirty}
              onDoc={(next) => { if (isImageDocument(next.payload)) state.receive({ ...next, payload: next.payload }); }}
              onUpdateLink={async (link, revision) => {
                const doc = current.current.doc;
                if (!doc) return false;
                const next = await updateLinkedImage(root, doc, link, revision);
                if (next) state.receive(next);
                return !!next;
              }} />
          </ScrollFade> : null} />
      </div>}
    {!summary && !!output.paths.length && closedPaths !== pathsKey && <div role="status" className="flex shrink-0 items-start gap-2 border-t border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
      <EditorIcon name="download" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">{output.paths.map((path) => <p key={path} className="break-all">{path}</p>)}</div>
      <button type="button" aria-label={key('dismiss')} title={key('dismiss')} className="shrink-0 rounded p-0.5 hover:bg-emerald-500/20" onClick={() => setClosedPaths(pathsKey)}>
        <EditorIcon name="close" className="h-3.5 w-3.5" />
      </button>
    </div>}
    {/* Keep the request draft and standalone window's agent connection alive while reviewing. */}
    <div hidden={!!summary} className="shrink-0">
      <ImageAgentPanel root={root} selected={selected} doc={state.doc} busy={busy || !!summary} onSave={state.save} onAgent={setAgentId} />
    </div>
    {tools && <ImagePhotoTools root={root} doc={tools.doc} selected={tools.selected} agentId={agentId} onApply={(id, source) => {
      const latestDraft = current.current.draft;
      const before = tools.doc.layers.find((item) => item.id === id);
      const now = latestDraft.layers.find((item) => item.id === id);
      // The layer changed while its picture was being edited: keep both by refusing to overwrite silently.
      if (!before || !now || JSON.stringify({ ...now, source: '' }) !== JSON.stringify({ ...before, source: '' }) || now.source !== before.source) {
        setImportError(key('conflict')); return;
      }
      const linked = current.current.doc?.links.some((item) => item.targets.includes(id));
      state.change({ ...latestDraft, layers: latestDraft.layers.map((item) => item.id === id && !item.locked ? { ...item, source, locked: linked || item.locked } : item) });
    }} onClose={() => setTools(null)} />}
  </div>;
}
