import { useCallback, useEffect, useMemo, useState } from 'react';
import { EDITOR_ZOOM, centred, fitView, stepZoom, wheelZoom, zoomAround, type EditorView, type StageSize } from './editorViewport.js';

export interface EditorViewport {
  view: EditorView;
  stage: StageSize;
  /** 맞춤 상태 — 창 크기·판 크기가 바뀌면 다시 맞춘다. 사용자가 확대·이동하면 풀린다. */
  fitted: boolean;
  /** 무대 상자(크기를 잰다). */
  attach: (element: HTMLElement | null) => void;
  fit: () => void;
  actual: () => void;
  zoomStep: (direction: 1 | -1, at?: { x: number; y: number }) => void;
  zoomTo: (scale: number, at?: { x: number; y: number }) => void;
  wheel: (deltaY: number, at: { x: number; y: number }) => void;
  pan: (dx: number, dy: number) => void;
  set: (view: EditorView) => void;
}

/** §5.13 (R-9) 레이어 편집기 ② — 작업판 배율·자리. 계산은 `editorViewport.ts`, 여기는 상태와 크기 재기만. */
export function useEditorViewport(doc: { width: number; height: number }, narrow: boolean): EditorViewport {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [stage, setStage] = useState<StageSize>({ width: 0, height: 0 });
  const [view, setView] = useState<EditorView>({ scale: 1, x: 0, y: 0 });
  const [fitted, setFitted] = useState(true);
  const padding = narrow ? EDITOR_ZOOM.narrowPadding : EDITOR_ZOOM.padding;
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setStage((old) => old.width === width && old.height === height ? old : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  useEffect(() => {
    if (fitted && stage.width > 0 && stage.height > 0) setView(fitView(doc, stage, padding));
  }, [fitted, stage, doc.width, doc.height, padding]); // eslint-disable-line react-hooks/exhaustive-deps
  const middle = useCallback((): { x: number; y: number } => ({ x: stage.width / 2, y: stage.height / 2 }), [stage]);
  const fit = useCallback(() => { setFitted(true); if (stage.width > 0) setView(fitView(doc, stage, padding)); }, [doc, stage, padding]);
  const actual = useCallback(() => { setFitted(false); setView(centred(doc, stage, 1)); }, [doc, stage]);
  const zoomStep = useCallback((direction: 1 | -1, at?: { x: number; y: number }) => {
    setFitted(false); setView((v) => zoomAround(v, stepZoom(v.scale, direction), at ?? middle()));
  }, [middle]);
  const zoomTo = useCallback((scale: number, at?: { x: number; y: number }) => {
    setFitted(false); setView((v) => zoomAround(v, scale, at ?? middle()));
  }, [middle]);
  const wheel = useCallback((deltaY: number, at: { x: number; y: number }) => { setFitted(false); setView((v) => wheelZoom(v, deltaY, at)); }, []);
  const pan = useCallback((dx: number, dy: number) => { setFitted(false); setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })); }, []);
  const set = useCallback((next: EditorView) => { setFitted(false); setView(next); }, []);
  return useMemo(() => ({ view, stage, fitted, attach: setElement, fit, actual, zoomStep, zoomTo, wheel, pan, set }),
    [view, stage, fitted, fit, actual, zoomStep, zoomTo, wheel, pan, set]);
}
