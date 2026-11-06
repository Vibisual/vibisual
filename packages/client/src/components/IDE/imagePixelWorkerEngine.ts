import { ImagePixelSession } from '@vibisual/compute';
import { dominantCorner, type PixelBuffer } from './imageEdit.js';
import type { ImagePixelMessage, ImagePixelReply } from './imagePixelWorkerProtocol.js';

/** One editor worker retains only its current immutable source and color distances. */
export class ImagePixelWorkerEngine {
  private source: { id: number; pixels: PixelBuffer } | null = null;
  private session: ImagePixelSession | null = null;

  run(message: ImagePixelMessage): ImagePixelReply {
    try {
      if (message.pixels) {
        this.session?.dispose(); this.session = null; this.source = null;
        this.session = new ImagePixelSession(message.pixels);
        this.source = { id: message.sourceId, pixels: message.pixels };
      }
      if (this.source?.id !== message.sourceId || !this.session) throw new Error('Image worker source is unavailable');
      const pixels = this.source.pixels;
      const job = message.job;
      if (job.kind === 'transparent') return { id: message.id, output: this.session.hasTransparency() };
      if (job.kind === 'trim') {
        const reference = dominantCorner(pixels, job.tolerance);
        return { id: message.id, output: reference ? this.session.trim(reference, job.tolerance) : null };
      }
      if (job.kind === 'fill') return { id: message.id, output: this.session.flatten(job.color) };
      return { id: message.id, output: this.session.key(job.options) };
    } catch (error) { return { id: message.id, error: error instanceof Error ? error.message : String(error) }; }
  }
}

export function imagePixelTransfers(reply: ImagePixelReply): Transferable[] {
  if ('error' in reply || !reply.output || typeof reply.output !== 'object') return [];
  if ('buffer' in reply.output) return [reply.output.buffer.data.buffer];
  if ('data' in reply.output) return [reply.output.data.buffer];
  return [];
}
