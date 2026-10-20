import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readVibi3DAuthoring } from '@vibisual/shared';
import type { AppCanvasFaceProps } from '../../apps/registry.js';
import {
  FACE_BAR_HEIGHT, FACE_CONTROL, FaceBar, FaceButton, FaceFrame, FaceNote, FaceStage, FaceStill, ResetViewGlyph, SpinGlyph,
} from '../../apps/canvasFaceKit.js';
import { useModelCanvasDocument, useModelCanvasVisible } from './useModelCanvasDocument.js';
import { useModelCanvasView } from './useModelCanvasView.js';
import { useModelCanvasMirror } from './useModelCanvasMirror.js';

/** Same inset as the static face's object-contain p-1.5. */
const LIVE_INSET = 6;

/** Mirror an open editor, with the same stage renderer as a fallback when it is closed. */
export function ModelCanvasFace({ projectId, file, workRef, version, width, height, glow, icon, thumb, thumbLoading }: AppCanvasFaceProps): React.JSX.Element {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const visible = useModelCanvasVisible(host);
  const target = JSON.stringify([projectId, workRef ? 'document' : 'file', workRef || file, workRef ? null : version]);
  const [manualTarget, setManualTarget] = useState<string | null>(null);
  const pending = useRef<{ target: string; action: 'spin' } | { target: string; action: 'drag'; x: number; y: number } | null>(null);
  useEffect(() => { setManualTarget(null); pending.current = null; }, [target]);
  const mirror = useModelCanvasMirror({ projectId, workRef, file, enabled: visible && manualTarget !== target });
  const source = useModelCanvasDocument(projectId, workRef, visible);
  const stageHeight = Math.max(1, height - FACE_BAR_HEIGHT);
  const view = useModelCanvasView({
    projectId, file, workRef, version, document: source.document, enabled: visible && !mirror, host,
    width: Math.max(1, width - LIVE_INSET * 2), height: Math.max(1, stageHeight - LIVE_INSET * 2),
  });
  // Start gestures after the mirror has released the face and its own renderer is enabled.
  useEffect(() => {
    const next = pending.current;
    if (!next || mirror) return;
    pending.current = null;
    if (!visible || next.target !== target) return;
    if (next.action === 'spin') view.toggleSpin(); else view.beginDrag(next.x, next.y);
  });
  const blocked = (!mirror && (view.phase === 'tooLarge' || view.phase === 'failed' || view.phase === 'empty')) || (!!workRef && !source.document);
  const dragLabel = t('panel.apps.canvas.dragRotate');
  const stage = readVibi3DAuthoring((mirror ? source.document : view.shownDocument)?.payload)?.stage;
  const note = mirror ? (stage ? t('panel.vibi3d.authoring.stagePreview', { stage: stage.label }) : dragLabel)
    : source.failed || view.phase === 'failed'
    ? t('panel.apps.canvas.unavailable')
    : view.phase === 'tooLarge'
      ? t('panel.apps.canvas.tooLarge')
      : source.loading || view.phase === 'loading'
        ? t('ide.explorer.loading')
        : view.phase === 'empty' || (!!workRef && !source.document)
          ? t('panel.vibi3d.authoring.waiting')
          : stage ? t('panel.vibi3d.authoring.stagePreview', { stage: stage.label }) : dragLabel;

  return (
    <FaceFrame>
      <FaceStage className="bg-[#0b0d12]">
        {mirror || view.phase !== 'live' ? (
          mirror || view.snapshot !== null ? (
            <img src={mirror?.url ?? view.snapshot!} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain p-1.5" />
          ) : (
            <FaceStill thumb={workRef ? null : thumb} loading={source.loading || view.phase === 'loading' || (!workRef && thumbLoading)} glow={glow} icon={icon} width={width} height={stageHeight} />
          )
        ) : null}
        <div ref={host} className="pointer-events-none absolute inset-1.5" />
        <div
          title={dragLabel}
          className={`${FACE_CONTROL} absolute inset-0 ${blocked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerDown={(event) => {
            if (blocked || event.button !== 0) return;
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            setManualTarget(target);
            if (mirror) pending.current = { target, action: 'drag', x: event.clientX, y: event.clientY };
            else view.beginDrag(event.clientX, event.clientY);
          }}
          onPointerMove={(event) => view.moveDrag(event.clientX, event.clientY)}
          onPointerUp={(event) => {
            pending.current = null;
            view.endDrag();
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { pending.current = null; view.endDrag(); }}
          onDoubleClick={(event) => event.stopPropagation()}
        />
      </FaceStage>
      <FaceBar>
        <FaceButton label={t('panel.vibi3d.spin')} active={view.spinning} accent={glow} onClick={() => {
          setManualTarget(target);
          if (mirror) pending.current = { target, action: 'spin' }; else view.toggleSpin();
        }} disabled={blocked}>
          <SpinGlyph />
        </FaceButton>
        <FaceButton label={t('panel.vibi3d.frame')} onClick={() => { pending.current = null; setManualTarget(null); view.resetView(); }} disabled={blocked}><ResetViewGlyph /></FaceButton>
        <FaceNote title={note}>{note}</FaceNote>
      </FaceBar>
    </FaceFrame>
  );
}
