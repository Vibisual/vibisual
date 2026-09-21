import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
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

/** Rejecting an upload must also release its file, including after the demo was deleted. */
function discardFrame(file: Express.Multer.File, removeEmptyDirectory: boolean): void {
  try {
    fs.rmSync(file.path, { force: true });
    if (removeEmptyDirectory) fs.rmdirSync(path.dirname(file.path));
  } catch (err) {
    // Another upload/delete may already have removed the directory, or still be writing inside it.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') {
      logger.warn(`[verify] rejected frame cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
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
      if (err) { res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) }); return; }
      if (!req.file) { res.status(400).json({ ok: false, error: 'no file uploaded (field name must be "image")' }); return; }
      const fields = (req.body ?? {}) as Record<string, unknown>;
      const atMs = typeof fields.atMs === 'string' && Number.isFinite(Number(fields.atMs))
        ? Math.max(0, Math.round(Number(fields.atMs))) : 0;
      // No await between this recheck and update: only one pending stream can claim the last slot.
      const fresh = findDemo(demo.id);
      if (!fresh || fresh.frames.length >= VERIFICATION_DEMO_FRAMES_MAX) {
        discardFrame(req.file, !fresh);
        res.status(fresh ? 409 : 404).json({ ok: false, error: fresh ? 'frames-full' : 'not found' });
        return;
      }
      const next = updateDemo(demo.id, {
        frames: [...fresh.frames, { rel: `${demo.id}/${path.basename(req.file.path)}`, atMs }]
          .sort((left, right) => left.atMs - right.atMs),
      });
      if (!next) {
        discardFrame(req.file, true);
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      onSaved();
      res.json({ ok: true, demo: next });
    });
  };
}
