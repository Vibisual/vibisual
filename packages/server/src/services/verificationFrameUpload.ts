import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import multer from 'multer';
import { VERIFICATION_DEMO_FRAMES_MAX, type VerificationDemo } from '@vibisual/shared';
import { logger } from '../logger.js';

const FRAME_UPLOAD_LIMITS = { fileSize: 8 * 1024 * 1024, files: 1 };

interface VerificationFrameUploadOptions {
  findDemo: (demoId: string) => VerificationDemo | undefined;
  updateDemo: (demoId: string, patch: Partial<VerificationDemo>) => VerificationDemo | undefined;
  framesDir: (agentId: string, demoId: string) => string | null;
  onSaved: () => void;
}

// multer calls back on the write stream's 'finish', and at that moment the stream's own close has not
// even been requested — it lands a tick later (measured 0.59ms). Windows opens the file without
// FILE_SHARE_DELETE, so removing it while that handle lives fails with EPERM/EBUSY. The retries must be
// the asynchronous kind: `rmSync` retries sleep by *blocking* the event loop, so the close they wait for
// can never run (measured still open after 200ms of blocking, which outlasts the whole retry budget).
// POSIX unlinks open files outright, which is why this only ever surfaced on the Windows CI runner.
const FILE_RETRY = { maxRetries: 5, retryDelay: 20 };
// The directory budget stays short on purpose: an ENOTEMPTY that is not Windows' delete-pending window
// means another upload owns the directory, and giving up fast is better than waiting out its work.
const DIR_RETRY_DELAYS = [0, 20, 50, 100, 200];

// The waiting has to be written out here, because `rmdir` will not do it. `fs.promises.rmdir(dir,
// { maxRetries, retryDelay })` **ignores both unless `recursive` is set** — measured against a directory
// that can never be emptied it came back ENOTEMPTY in 0.1ms even with `retryDelay: 200`, so it never
// slept once and the whole budget was one attempt. `recursive` is not a way out: an ENOTEMPTY here
// usually means another upload owns the directory, and forcing it would delete that upload's frames.
// One attempt is exactly what Windows cannot afford — the file removed a line above stays listed until
// its handle closes, and that close only runs once the event loop is free, which is why the wait is
// awaited rather than blocking.
async function removeFrameDirectory(dir: string): Promise<void> {
  for (const delay of DIR_RETRY_DELAYS) {
    if (delay > 0) await new Promise<void>((resolve) => { setTimeout(resolve, delay); });
    try {
      await fs.promises.rmdir(dir);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM') throw err;
    }
  }
  // Still occupied after the budget: it belongs to someone else, and whoever owns it takes it down.
}

/** Rejecting an upload must also release its file, including after the demo was deleted. */
async function discardFrame(file: Express.Multer.File, removeEmptyDirectory: boolean): Promise<void> {
  try {
    await fs.promises.rm(file.path, { force: true, ...FILE_RETRY });
    if (removeEmptyDirectory) await removeFrameDirectory(path.dirname(file.path));
  } catch (err) {
    // Another upload/delete may already have removed the directory, or still be writing inside it.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') {
      logger.warn(`[verify] rejected frame cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Answer only once the file is gone — a rejection that still leaves its bytes on disk is a lie. */
function rejectAndDiscard(
  res: Response, file: Express.Multer.File, removeEmptyDirectory: boolean, status: number, error: string,
): void {
  // discardFrame swallows its own failures, so this settles even when the OS refuses the deletion.
  void discardFrame(file, removeEmptyDirectory).then(() => res.status(status).json({ ok: false, error }));
}

/** Each multipart request owns its file; committing the bounded frame list is synchronous. */
export function createVerificationFrameUpload(options: VerificationFrameUploadOptions): RequestHandler {
  const { findDemo, updateDemo, framesDir, onSaved } = options;
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const demoId = req.params['demoId'];
        if (typeof demoId !== 'string' || !demoId || /\.\.|[/\\]/.test(demoId)) {
          cb(new Error('invalid demoId'), '');
          return;
        }
        const demo = findDemo(demoId);
        const dir = demo ? framesDir(demo.agentId, demo.id) : null;
        if (!dir) { cb(new Error(demo ? 'project not found' : 'demo not found'), ''); return; }
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
          cb(err instanceof Error ? err : new Error('mkdir failed'), '');
          return;
        }
        cb(null, dir);
      },
      // frames.length is not a reservation: two streams can both begin before either commits.
      filename: (_req, _file, cb) => cb(null, `${randomUUID()}.png`),
    }),
    limits: FRAME_UPLOAD_LIMITS,
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) { cb(new Error('only image/* mime types allowed')); return; }
      cb(null, true);
    },
  }).single('image');

  return (req, res): void => {
    const demoId = typeof req.params['demoId'] === 'string' ? req.params['demoId'] : '';
    const demo = findDemo(demoId);
    if (!demo) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    if (demo.frames.length >= VERIFICATION_DEMO_FRAMES_MAX) {
      res.status(409).json({ ok: false, error: 'frames-full' });
      return;
    }
    upload(req, res, (err?: unknown): void => {
      if (err) {
        const error = err instanceof Error ? err.message : String(err);
        // A multipart write that fails partway has still created the file (a size limit trips only after
        // bytes are on disk). Answering without releasing it leaves the frame — and its directory —
        // behind for an upload that was never accepted.
        if (req.file) { rejectAndDiscard(res, req.file, !findDemo(demo.id), 400, error); return; }
        res.status(400).json({ ok: false, error });
        return;
      }
      if (!req.file) { res.status(400).json({ ok: false, error: 'no file uploaded (field name must be "image")' }); return; }
      const fields = (req.body ?? {}) as Record<string, unknown>;
      const atMs = typeof fields.atMs === 'string' && Number.isFinite(Number(fields.atMs))
        ? Math.max(0, Math.round(Number(fields.atMs))) : 0;
      // No await between this recheck and update: only one pending stream can claim the last slot.
      // The rejection branches hand off to rejectAndDiscard and return, so nothing follows their wait.
      const fresh = findDemo(demo.id);
      if (!fresh || fresh.frames.length >= VERIFICATION_DEMO_FRAMES_MAX) {
        rejectAndDiscard(res, req.file, !fresh, fresh ? 409 : 404, fresh ? 'frames-full' : 'not found');
        return;
      }
      const next = updateDemo(demo.id, {
        frames: [...fresh.frames, { rel: `${demo.id}/${path.basename(req.file.path)}`, atMs }]
          .sort((left, right) => left.atMs - right.atMs),
      });
      if (!next) {
        rejectAndDiscard(res, req.file, true, 404, 'not found');
        return;
      }
      onSaved();
      res.json({ ok: true, demo: next });
    });
  };
}
