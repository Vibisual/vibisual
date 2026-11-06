import { applyEditOp, pixelsToCanvas, readPixels, type EditOp, type EditOpOutcome, type LayerFrame, type PixelBuffer } from './imageEdit.js';
import type { ImagePixelJob, ImagePixelOutput } from './imagePixelWorkerProtocol.js';

export type ImagePixelExecutor = (pixels: PixelBuffer, job: ImagePixelJob, signal?: AbortSignal) => Promise<ImagePixelOutput>;

/** Canvas composition remains native. Every full pixel scan in the UI edit path
 * runs in the editor worker; commit/export share the same result and errors. */
export async function applyEditOpAsync(frame: LayerFrame, op: EditOp, execute: ImagePixelExecutor, basePixels?: PixelBuffer | null): Promise<EditOpOutcome> {
  try {
    if (op.kind === 'crop') {
      // Suppress the synchronous post-crop transparency scan, then ask the worker.
      const result = applyEditOp({ ...frame, transparent: false }, op);
      if (!result.ok || op.shape === 'ellipse' || frame.transparent === false) return result;
      let transparent = true;
      try {
        const pixels = readPixels(result.frame.base);
        if (pixels) transparent = await execute(pixels, { kind: 'transparent' }) === true;
      } catch { /* Preserve conservative JPEG protection. */ }
      return { ok: true, frame: { ...result.frame, transparent } };
    }
    const pixels = basePixels ?? readPixels(frame.base);
    if (!pixels) return { ok: false, reason: 'failed' };
    if (op.kind === 'key') {
      const result = await execute(pixels, { kind: 'key', options: { color: op.color, tolerance: op.tolerance, contiguous: op.contiguous, seeds: op.seeds } });
      if (!result || typeof result !== 'object' || !('buffer' in result)) return { ok: false, reason: 'failed' };
      if (result.changed === 0) return { ok: false, reason: 'noMatch' };
      const base = pixelsToCanvas(result.buffer);
      return base ? { ok: true, frame: { ...frame, base, transparent: true } } : { ok: false, reason: 'failed' };
    }
    if (await execute(pixels, { kind: 'transparent' }) === false) return { ok: false, reason: 'noTransparency' };
    const result = await execute(pixels, { kind: 'fill', color: op.color });
    if (!result || typeof result !== 'object' || !('data' in result)) return { ok: false, reason: 'failed' };
    const base = pixelsToCanvas(result);
    return base ? { ok: true, frame: { ...frame, base, transparent: false } } : { ok: false, reason: 'failed' };
  } catch { return { ok: false, reason: 'failed' }; }
}
