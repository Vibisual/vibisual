import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import { applyStudioEnvironment, releaseStudioEnvironment, renderStudioView } from '../Creation/studioLighting.js';
import { CandidatePreviewStage, PreviewModelCache } from './candidatePreview.js';
import { modelInspectLevels, storedModelId, type ModelInspectSubject } from './modelInspect.js';
import { disposeModel } from './modelIO.js';
import { loadModelSource } from './modelSource.js';

const WIDTH = 480;
const HEIGHT = 270;
/** What to show: a cache key that changes only when the source changes, and how to read its payload. */
export interface PreviewItem { key: string; load: () => unknown }

/** §5.13 (R-10) — one renderer while the review is open; before/after only swaps the shown scene. */
export function Vibi3DCandidatePreview({ projectId, item, inspect }: {
  projectId: string; item: PreviewItem | null;
  /** §5.4 #15 (C) — which side is shown, so the Alt inspector can pick an object inside it. */
  inspect?: ModelInspectSubject | null;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<CandidatePreviewStage | null>(null);
  useInspectorPicker(canvasRef, inspect ? (at) => {
    const stage = stageRef.current; const shown = stage?.current;
    return stage && shown ? modelInspectLevels({ camera: stage.camera, root: shown, idOf: storedModelId }, inspect, at) : [];
  } : null);
  const itemRef = useRef(item); itemRef.current = item;
  const [failed, setFailed] = useState(false);
  const [lost, setLost] = useState(false);
  const { t } = useTranslation();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const cache = new PreviewModelCache((payload) => loadModelSource(payload, 'model', projectId), (model) => disposeModel(model.object));
    const stage = new CandidatePreviewStage({
      cache, width: WIDTH, height: HEIGHT,
      createRenderer: () => {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setSize(WIDTH, HEIGHT, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        return renderer;
      },
      environment: (scene, renderer, level) => applyStudioEnvironment(scene, renderer as THREE.WebGLRenderer, level),
      renderView: (scene, renderer, camera, object) => renderStudioView(scene, renderer as THREE.WebGLRenderer, camera, { object, quality: 'draft' }),
      releaseEnvironment: (renderer) => releaseStudioEnvironment(renderer as THREE.WebGLRenderer),
    });
    stageRef.current = stage;
    const onLost = (): void => setLost(true);
    const onRestored = (): void => { setLost(false); stage.contextRestored(); };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      stage.dispose();
      stageRef.current = null;
    };
  }, [projectId]);
  const key = item?.key ?? '';
  useEffect(() => {
    const stage = stageRef.current;
    const next = itemRef.current;
    if (!stage || !next) return undefined;
    let current = true;
    setFailed(false);
    stage.show(next.key, next.load).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [key, projectId]);
  return <div className="rounded border border-white/10 bg-gray-950">
    <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="aspect-video w-full" />
    {(failed || lost) && <p role="alert" className="p-2 text-amber-300">{t('panel.vibi3d.review.previewFailed')}</p>}
  </div>;
}
