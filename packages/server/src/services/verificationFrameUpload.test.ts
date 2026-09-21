import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VERIFICATION_DEMO_FRAMES_MAX, type VerificationDemo } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { createVerificationFrameUpload } from './verificationFrameUpload.js';

interface UploadResponse { status: number; body: unknown }
interface PendingUpload { finish: () => Promise<UploadResponse> }

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Only this handler listens on an ephemeral socket; no application or user project is started. */
async function harness(initialCount = 0): Promise<{
  graph: ProjectGraph;
  demo: VerificationDemo;
  dir: string;
  saved: ReturnType<typeof vi.fn>;
  beginUpload: (atMs: number, content: string) => Promise<PendingUpload>;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-verify-upload-'));
  const graph = new ProjectGraph();
  const demo: VerificationDemo = {
    id: 'demo-test', agentId: 'test-agent', subAgentId: 'test-session', projectName: 'test-project',
    label: 'demo', sourceName: 'test-source', steps: [], durationMs: 1000, recordedAt: 1,
    frames: Array.from({ length: initialCount }, (_, n) => ({ rel: `demo-test/${n}.png`, atMs: n })),
  };
  graph.addVerificationDemo(demo);
  const dir = path.join(root, demo.id);
  fs.mkdirSync(dir);
  for (const frame of demo.frames) fs.writeFileSync(path.join(root, frame.rel), 'original');
  const destinationWaiters: Array<() => void> = [];
  const saved = vi.fn();
  const app = express();
  app.post('/api/verification-demos/:demoId/frames', createVerificationFrameUpload({
    findDemo: (id) => graph.findVerificationDemo(id),
    updateDemo: (id, patch) => graph.updateVerificationDemo(id, patch),
    framesDir: () => {
      destinationWaiters.shift()?.();
      return dir;
    },
    onSaved: saved,
  }));
  const server = app.listen(0, '127.0.0.1');
  cleanups.push(async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    // A reset connection can leave its write handle open for a tick, and Windows will not delete a file
    // that still has one. It has to be the awaited form: rmSync retries block the event loop, so the
    // close they are waiting for cannot land, and teardown becomes a second failure that hides the first.
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test listener');

  async function beginUpload(atMs: number, content: string): Promise<PendingUpload> {
    const entered = new Promise<void>((resolve) => destinationWaiters.push(resolve));
    const boundary = 'verification-frame-boundary';
    const request = http.request({
      host: '127.0.0.1', port: address && typeof address !== 'string' ? address.port : 0,
      method: 'POST', path: `/api/verification-demos/${demo.id}/frames`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    const response = new Promise<UploadResponse>((resolve, reject) => {
      request.once('error', reject);
      request.once('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.once('error', reject);
        res.once('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
    });
    // An upload abandoned by a failing assertion is reset when afterEach closes the listener; without
    // this the ECONNRESET surfaces as an unhandled rejection and fails the whole run, not just that test.
    response.catch(() => undefined);
    request.write(`--${boundary}\r\nContent-Disposition: form-data; name="atMs"\r\n\r\n${atMs}\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="frame.png"\r\n`
      + `Content-Type: image/png\r\n\r\n${content}`);
    // Hold the multipart terminator so every overlapping stream selects its filename before any commit.
    await entered;
    return {
      finish: (): Promise<UploadResponse> => {
        request.end(`\r\n--${boundary}--\r\n`);
        return response;
      },
    };
  }
  return { graph, demo, dir, saved, beginUpload };
}

describe('verification demo frame uploads', () => {
  it('preserves both concurrent payloads and orders out-of-order completions by clip time', async () => {
    const fixture = await harness();
    const later = await fixture.beginUpload(200, 'later-frame');
    const earlier = await fixture.beginUpload(100, 'earlier-frame');
    expect((await later.finish()).status).toBe(200);
    expect((await earlier.finish()).status).toBe(200);

    const frames = fixture.graph.findVerificationDemo(fixture.demo.id)!.frames;
    expect(frames.map((frame) => frame.atMs)).toEqual([100, 200]);
    expect(new Set(frames.map((frame) => frame.rel)).size).toBe(2);
    expect(frames.map((frame) => fs.readFileSync(path.join(fixture.dir, path.basename(frame.rel)), 'utf8')))
      .toEqual(['earlier-frame', 'later-frame']);
    expect(fs.readdirSync(fixture.dir)).toHaveLength(2);
    expect(fixture.saved).toHaveBeenCalledTimes(2);
  });

  it('allows only one overlapping upload into the last slot and removes the rejected file', async () => {
    const fixture = await harness(VERIFICATION_DEMO_FRAMES_MAX - 1);
    const first = await fixture.beginUpload(100, 'first-frame');
    const second = await fixture.beginUpload(200, 'second-frame');
    const responses = await Promise.all([first.finish(), second.finish()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toEqual({ ok: false, error: 'frames-full' });
    expect(fixture.graph.findVerificationDemo(fixture.demo.id)!.frames).toHaveLength(VERIFICATION_DEMO_FRAMES_MAX);
    expect(fs.readdirSync(fixture.dir)).toHaveLength(VERIFICATION_DEMO_FRAMES_MAX);
    for (const frame of fixture.demo.frames) {
      expect(fs.readFileSync(path.join(fixture.dir, path.basename(frame.rel)), 'utf8')).toBe('original');
    }
    expect(fixture.saved).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('does not resurrect a deleted demo or leave an orphan (directory already removed: %s)', async (removeDir) => {
    const fixture = await harness();
    const upload = await fixture.beginUpload(100, 'in-flight-frame');
    fixture.graph.deleteVerificationDemo(fixture.demo.id);
    // Windows refuses to remove a directory holding an open handle, so this deletion lands on POSIX
    // and is refused on Windows. Both are real states a deleted demo can be in; neither may orphan the directory.
    if (removeDir) {
      try { fs.rmSync(fixture.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
      catch { /* the in-flight stream still holds it — the assertions below cover that path too */ }
    }
    const response = await upload.finish();
    // Removing a directory before the stream opens can also surface as a multer write error.
    expect(removeDir ? [400, 404] : [404]).toContain(response.status);
    expect(fixture.graph.findVerificationDemo(fixture.demo.id)).toBeUndefined();
    expect(fs.existsSync(fixture.dir)).toBe(false);
    expect(fixture.saved).not.toHaveBeenCalled();
  });

  // No POSIX run can catch a regression here: unlinking an open file just works, so both forms pass.
  // Only Windows tells them apart, and there the sync form cannot work at all — its retries sleep by
  // blocking the event loop, so the stream close they are waiting for never gets to run.
  it('discards rejected frames with the awaited form, not the blocking one', () => {
    const source = fs.readFileSync(new URL('./verificationFrameUpload.ts', import.meta.url), 'utf8')
      .replace(/\r\n/g, '\n');
    expect(source).toContain('await fs.promises.rm(');
    expect(source).toContain('await fs.promises.rmdir(');
    expect(source).not.toMatch(/\bfs\.(rmSync|rmdirSync|unlinkSync)\b/);
  });
});
