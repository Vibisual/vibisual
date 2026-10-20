import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_CANVAS_FACE } from '@vibisual/shared';
import type { AppCanvasFaceProps } from '../../apps/registry.js';
import {
  CheckGlyph, CopyGlyph, FACE_BAR_HEIGHT, FaceBar, FaceButton, FaceFrame, FaceNote, FaceStage, FaceStill, FillGlyph, FitGlyph,
} from '../../apps/canvasFaceKit.js';
import { copyImageToClipboard, resolveClipboardSurface, type ClipboardScope } from '../IDE/imageClipboard.js';
import { useCreationHead } from '../Creation/useCreationHead.js';
import { renderImageBlob } from '../Creation/imageRender.js';
import type { ImageDocument } from '../Creation/imageSource.js';
import { imageCandidateSummaries, readImageCandidate, readImageDoc, type ImageSourceDoc } from './imageApi.js';
import { latestImageCandidate } from './imagePresentation.js';

type CopyState = 'idle' | 'busy' | 'done' | 'failed';
interface ImageFacePreview {
  scope: string;
  url: string;
  payload: ImageDocument;
  revision: number;
  proposal: string | null;
  pending: number;
  stale: boolean;
}

/** An untouched white/transparent source is a creation placeholder, not a delivered picture. */
function isEmpty(payload: ImageDocument, revision: number, proposal: string | null): boolean {
  return revision === 1 && proposal === null && payload.layers.length === 0
    && (payload.background === '#ffffff' || payload.background === 'transparent');
}

/**
 * Agents deliver proposals without changing the source revision. Preview the newest current proposal, clearly
 * labeled, until the user accepts/discards it in the editor. Only the head is polled; no mutation happens here.
 */
export function ImageSourceFace(props: AppCanvasFaceProps & { workRef: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ImageFacePreview | null>(null);
  const source = useRef<{ scope: string; doc: ImageSourceDoc } | null>(null);
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState<'cover' | 'contain'>('contain');
  const [copy, setCopy] = useState<CopyState>('idle');
  const clipboard = useMemo(() => resolveClipboardSurface(globalThis as unknown as ClipboardScope), []);
  const head = useCreationHead(props.projectId, props.workRef, { intervalMs: APP_CANVAS_FACE.sourcePollMs });
  const revision = head?.revision ?? 0;
  const stamp = head?.candidateStamp ?? 0;
  const pending = head?.pendingCandidates ?? 0;
  const scope = `${props.projectId}\u0000${props.workRef}`;
  const current = preview?.scope === scope ? preview : null;
  const url = current?.url ?? '';
  useEffect(() => { setFailed(false); setCopy('idle'); }, [scope]);
  useEffect(() => {
    if (!revision) return undefined;
    let cancelled = false;
    setFailed(false);
    void (async () => {
      const cached = source.current;
      const doc = cached?.scope === scope && cached.doc.revision === revision ? cached.doc : await readImageDoc(props.projectId, props.workRef);
      if (cancelled) return;
      source.current = { scope, doc };
      let payload = doc.payload; let proposal: string | null = null; let count = pending; let stale = false; let proposalFailed = false;
      if (pending) {
        try {
          const candidates = await imageCandidateSummaries(props.projectId, props.workRef);
          if (cancelled) return;
          count = candidates.length;
          const latest = latestImageCandidate(candidates, doc.revision);
          stale = count > 0 && !latest;
          if (latest) {
            const candidate = await readImageCandidate(props.projectId, props.workRef, latest.id);
            if (cancelled) return;
            // A decision or source edit may have happened between listing and reading the proposal.
            if (candidate.status === 'pending' && candidate.baseRevision === doc.revision) {
              payload = candidate.payload; proposal = candidate.label;
            }
          }
        } catch { proposalFailed = true; }
      }
      if (cancelled) return;
      let blob: Blob | null = null;
      try { if (!isEmpty(payload, doc.revision, proposal)) blob = await renderImageBlob(payload, props.projectId, 'svg'); }
      catch (error) {
        if (proposal === null) throw error;
        // A broken proposal must not hide the last accepted picture.
        payload = doc.payload; proposal = null; proposalFailed = true;
        if (!isEmpty(payload, doc.revision, proposal)) blob = await renderImageBlob(payload, props.projectId, 'svg');
      }
      if (cancelled) return;
      setPreview({ scope, url: blob ? URL.createObjectURL(blob) : '', payload, revision: doc.revision, proposal, pending: count, stale });
      setFailed(proposalFailed);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [props.projectId, props.workRef, scope, revision, stamp, pending]);
  // Keep the displayed URL alive during the next read/render; release it only after replacing the picture.
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);
  useEffect(() => {
    if (copy !== 'done' && copy !== 'failed') return undefined;
    const id = setTimeout(() => setCopy('idle'), APP_CANVAS_FACE.copiedFlashMs);
    return () => clearTimeout(id);
  }, [copy]);
  const copyNow = (): void => {
    if (copy === 'busy' || !current || !url) return;
    setCopy('busy');
    // Copy exactly the source/proposal shown. Previewing or copying never accepts a proposal.
    void copyImageToClipboard(renderImageBlob(current.payload, props.projectId, 'png'), clipboard).then((result) => setCopy(result.ok ? 'done' : 'failed'));
  };
  const failedText = t('panel.apps.canvas.copyFailed');
  const note = copy === 'failed' ? failedText : failed ? t('panel.apps.vibimage.loadFailed')
    : current?.proposal != null ? t('panel.apps.vibimage.editor.compare')
      : current?.stale ? t('panel.creation.staleShort') : current && !url ? t('panel.apps.vibimage.empty')
        : t('panel.creation.revisionShort', { revision: current?.revision ?? revision });
  return <FaceFrame>
    <FaceStage className="bg-alpha-checker">
      <FaceStill thumb={url ? { kind: 'picture', url } : null} loading={!current && !failed} glow={props.glow} icon={props.icon} width={props.width}
        height={Math.max(1, props.height - FACE_BAR_HEIGHT)} fit={fit} />
      {current && !url && !failed && <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-2 text-center text-xs text-white/70">
        {t('panel.apps.vibimage.empty')}
      </div>}
    </FaceStage>
    <FaceBar>
      <FaceButton label={fit === 'cover' ? t('panel.apps.vibimage.fit') : t('panel.apps.canvas.fill')} onClick={() => setFit((f) => (f === 'cover' ? 'contain' : 'cover'))} disabled={!url}>
        {fit === 'cover' ? <FitGlyph /> : <FillGlyph />}
      </FaceButton>
      <FaceButton label={copy === 'done' ? t('ide.imageAnnotate.copied') : t('panel.apps.canvas.copyImage')} onClick={copyNow}
        disabled={clipboard === null || copy === 'busy' || !url} active={copy === 'done'} accent={props.glow}>
        {copy === 'done' ? <CheckGlyph /> : <CopyGlyph />}
      </FaceButton>
      <FaceNote title={copy === 'failed' ? failedText : current?.proposal ?? (current?.stale ? t('panel.apps.vibimage.editor.staleCandidate') : undefined)}>
        {note}{!!current?.pending && <> · {current.pending}</>}
      </FaceNote>
    </FaceBar>
  </FaceFrame>;
}
