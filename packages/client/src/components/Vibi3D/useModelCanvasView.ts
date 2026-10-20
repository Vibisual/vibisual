import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { APP_CANVAS_FACE, APP_THUMB, type CreationDoc } from '@vibisual/shared';
import { useFrameLoop } from '../../apps/canvasFaceKit.js';
import type { LiveModel, LiveView, OrbitAngles } from './modelCanvasLive.js';

export type ModelCanvasPhase = 'still' | 'loading' | 'live' | 'tooLarge' | 'failed' | 'empty';
interface ViewArgs {
  projectId: string; file: string; version: number; workRef?: string | undefined;
  document: CreationDoc | null; enabled: boolean; width: number; height: number;
  host: RefObject<HTMLDivElement>;
}
interface CanvasView {
  phase: ModelCanvasPhase; spinning: boolean; snapshot: string | null; shownDocument: CreationDoc | null;
  toggleSpin: () => void; resetView: () => void;
  beginDrag: (x: number, y: number) => void; moveDrag: (x: number, y: number) => void; endDrag: () => void;
}

/** The face keeps data, but lends WebGL only while interacting or baking an actual committed stage. */
export function useModelCanvasView({ projectId, file, version, workRef, document, enabled, width, height, host }: ViewArgs): CanvasView {
  const [phase, setPhase] = useState<ModelCanvasPhase>('still');
  const [spinning, setSpinning] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [shownDocument, setShownDocument] = useState<CreationDoc | null>(null);
  const modelRef = useRef<LiveModel | null>(null);
  const viewRef = useRef<LiveView | null>(null);
  const anglesRef = useRef<OrbitAngles | null>(null);
  const loadRef = useRef<Promise<LiveView | null> | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const spinningRef = useRef(false);
  const snapshotRef = useRef<string | null>(null);
  const generation = useRef(0);
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };
  const identity = JSON.stringify([projectId, workRef || file, workRef ? null : version]);
  const clearIdle = useCallback((): void => {
    if (idleRef.current !== null) clearTimeout(idleRef.current);
    idleRef.current = null;
  }, []);
  const replaceSnapshot = useCallback((url: string | null): void => {
    if (snapshotRef.current !== null) URL.revokeObjectURL(snapshotRef.current);
    snapshotRef.current = url;
    setSnapshot(url);
  }, []);

  useEffect(() => {
    // Revisions of the same document keep the user's orbit and the last good picture during loading.
    anglesRef.current = null;
    replaceSnapshot(null);
    setShownDocument(null);
    return () => {
      if (snapshotRef.current !== null) URL.revokeObjectURL(snapshotRef.current);
      snapshotRef.current = null;
    };
  }, [identity, replaceSnapshot]);

  useEffect(() => {
    generation.current += 1;
    setPhase('still');
    setSpinning(false);
    spinningRef.current = false;
    return () => {
      generation.current += 1;
      clearIdle();
      viewRef.current?.canvas.remove();
      viewRef.current?.dispose();
      viewRef.current = null;
      modelRef.current?.dispose();
      modelRef.current = null;
      loadRef.current = null;
      dragRef.current = null;
    };
  }, [identity, document, enabled, clearIdle]);

  const ensureLive = useCallback(async (): Promise<LiveView | null> => {
    if (!enabled || (workRef && !document)) return null;
    if (viewRef.current) return viewRef.current;
    if (loadRef.current) return loadRef.current;
    const gen = generation.current;
    const job = (async (): Promise<LiveView | null> => {
      try {
        const lib = await import('./modelCanvasLive.js');
        if (gen !== generation.current) return null;
        let model = modelRef.current;
        if (!model) {
          setPhase('loading');
          const loaded = document
            ? await lib.loadLiveModelSource(projectId, document.payload, document.title)
            : await lib.loadLiveModel(projectId, file);
          if (gen !== generation.current) { if (loaded.ok) loaded.model.dispose(); return null; }
          if (!loaded.ok) {
            setPhase(loaded.reason);
            if (loaded.reason === 'empty') { replaceSnapshot(null); setShownDocument(null); }
            return null;
          }
          model = loaded.model;
          modelRef.current = model;
        }
        if (!host.current) return null;
        const angles = anglesRef.current ?? lib.homeAngles();
        anglesRef.current = angles;
        const ratio = Math.min(APP_THUMB.pixelRatioMax, Math.max(1, window.devicePixelRatio || 1));
        const size = sizeRef.current;
        const view = lib.createLiveView(model, size.width, size.height, ratio, angles);
        viewRef.current = view;
        host.current.appendChild(view.canvas);
        view.render();
        setShownDocument(document);
        setPhase('live');
        return view;
      } catch {
        if (gen === generation.current) {
          viewRef.current?.canvas.remove(); viewRef.current?.dispose(); viewRef.current = null;
          setPhase('failed');
        }
        return null;
      }
    })();
    loadRef.current = job;
    try { return await job; }
    finally { if (loadRef.current === job) loadRef.current = null; }
  }, [projectId, file, workRef, document, enabled, host, replaceSnapshot]);

  const retire = useCallback(async (): Promise<void> => {
    idleRef.current = null;
    const view = viewRef.current;
    if (!view || spinningRef.current || dragRef.current) return;
    const gen = generation.current;
    let url: string | null = null;
    try { url = await view.snapshot(); } catch { /* Keep the last valid picture if the GPU context was lost. */ }
    if (gen !== generation.current || viewRef.current !== view || spinningRef.current || dragRef.current) {
      if (url !== null) URL.revokeObjectURL(url);
      return;
    }
    viewRef.current = null;
    view.canvas.remove();
    view.dispose();
    if (url !== null) replaceSnapshot(url);
    setPhase(url !== null ? (modelRef.current?.empty ? 'empty' : 'still') : 'failed');
  }, [replaceSnapshot]);
  const scheduleIdle = useCallback((): void => {
    clearIdle();
    idleRef.current = setTimeout(() => { void retire(); }, APP_CANVAS_FACE.liveIdleMs);
  }, [clearIdle, retire]);

  useEffect(() => {
    if (!document || !enabled) return undefined;
    let stopped = false;
    // A checkpoint is shown immediately, then its context is released; no fake build animation.
    void ensureLive().then(() => { if (!stopped) void retire(); });
    return () => { stopped = true; };
  }, [document, enabled, ensureLive, retire]);
  useEffect(() => {
    viewRef.current?.setSize(width, height);
    viewRef.current?.render();
  }, [width, height]);
  useEffect(() => {
    if (phase === 'live' && !document && !spinningRef.current && !dragRef.current) scheduleIdle();
  }, [phase, document, scheduleIdle]);
  useFrameLoop(spinning && phase === 'live', (dt) => {
    viewRef.current?.orbit(APP_CANVAS_FACE.spinDegPerSec * dt, 0);
    viewRef.current?.render();
  });

  return {
    phase, spinning, snapshot, shownDocument,
    toggleSpin: () => {
      const next = !spinningRef.current;
      spinningRef.current = next; setSpinning(next);
      if (next) { clearIdle(); void ensureLive(); } else scheduleIdle();
    },
    resetView: () => {
      if (viewRef.current) { viewRef.current.home(); viewRef.current.render(); if (!spinningRef.current) scheduleIdle(); }
      else {
        anglesRef.current = null;
        if (document) { void ensureLive().then(() => { void retire(); }); }
        else replaceSnapshot(null);
      }
    },
    beginDrag: (x, y) => { dragRef.current = { x, y }; clearIdle(); void ensureLive(); },
    moveDrag: (x, y) => {
      const from = dragRef.current;
      if (!from) return;
      dragRef.current = { x, y };
      viewRef.current?.orbit(-(x - from.x) * APP_CANVAS_FACE.orbitDegPerPx, (y - from.y) * APP_CANVAS_FACE.orbitDegPerPx);
      viewRef.current?.render();
    },
    endDrag: () => { dragRef.current = null; if (!spinningRef.current) scheduleIdle(); },
  };
}
