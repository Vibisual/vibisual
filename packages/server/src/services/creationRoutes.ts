import express, { type Express, type Request, type Response } from 'express';
import fs from 'node:fs';
import {
  CREATION_BLOB_MIME,
  CREATION_LIMITS,
  LOOPBACK_INGRESS_HEADER,
  LOOPBACK_INGRESS_VALUE,
  binaryNumbers,
  checkCreationRequirements,
  isNumericBlobExt,
  parseCreationBlobName,
  type CreationRequirement,
} from '@vibisual/shared';
import { CreationError, CreationStore, blobExtForUpload, creationDocId, creationKey, isMirrorDocId, type CreationHost } from './creationStore.js';

/** Largest numeric blob returned as JSON numbers (agents reading geometry); the raw bytes have no such cap. */
const JSON_NUMBERS_MAX = 4_000_000;

const GUIDE = [
  'Create editable source with POST /docs {projectId,appId,title,payload,requestId}; reuse requestId when retrying a lost response to avoid duplicate sources.',
  'GET /docs?projectId lists payload-free summaries (plus "failed" ids that could not be read). GET /docs/:id?projectId reads the current source;'
    + ' GET /docs/:id/head?projectId returns only {revision,updatedAt,candidateStamp} for cheap polling.',
  'Preserve stable object IDs, source code, dimensions, parameters and imported assets. Do not flatten editable sources into PNG/GLB/MP4.',
  'Large binaries live outside the payload as strings "vibi-blob:<sha256>.<ext>". Keep them unchanged unless you change that content.'
    + ' GET /blobs/<name>?projectId returns the bytes (numeric u32/f32/f64 blobs also as JSON numbers with &format=json).'
    + ' You may send new data URLs or long number arrays inline; the server moves them into blobs.',
  'Read before editing. POST /docs/:id/commit {projectId,baseRevision,requestId,payload,label} is atomic; 409 preserves user edits. Never retry with a newer revision without merging.',
  'For a reviewable alternative POST /docs/:id/candidates {projectId,baseRevision,requestId,payload,links?,label,input}. Optional links propose the complete pinned reference set with the payload; existing references cannot be advanced by agents. A proposal on an older revision is refused (409 stale-base):'
    + ' read the latest source and propose again. At 100 pending candidates the response explains that the user must review or clean up first.',
  'Only the user accepts, discards, rebases candidates, undoes, restores, moves an existing link to another revision or records "keep this version".',
  'lockedPaths are JSON pointers into payload; /layers/@stable-id addresses an array element by id (or uuid). Never change locked values or unrelated objects.',
  'Links {id,sourceId,sourceRevision,role,targets} pin immutable source revisions. GET /docs/:id/impact shows affected documents, their outputs and dependency depth.'
    + ' Never silently advance references.',
  'Store outputs separately with POST /docs/:id/outputs {projectId,requestId,sourceRevision,path,mediaType}. Output must already exist inside project.',
  'Visual requirements need actual frame/screen evidence and human/agent review; automated checks do not claim to see an image.',
];

export function mountCreationRoutes(app: Express, host: CreationHost, shared?: CreationStore): void {
  const store = shared ?? new CreationStore(host);
  const body = (req: Request): Record<string, unknown> => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Buffer.isBuffer(req.body)) throw new CreationError(400, 'invalid-body');
    return req.body as Record<string, unknown>;
  };
  const author = (req: Request) => req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE ? 'agent' as const : 'user' as const;
  const userOnly = (req: Request) => { if (author(req) !== 'user') throw new CreationError(403, 'user-decision-required'); };
  const writable = (id: string) => { if (isMirrorDocId(id)) throw new CreationError(403, 'mirror-read-only'); };
  const docId = (req: Request) => creationDocId(req.params['id']);
  const endpoint = (action: (req: Request, res: Response) => void | Promise<void>) => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await action(req, res); } catch (error) {
      if (error instanceof CreationError) {
        res.status(error.status).json({ ok: false, error: error.message, ...(error.doc ? { doc: error.doc } : {}), ...(error.detail ? { detail: error.detail } : {}) });
        return;
      }
      host.warn?.(`[creation] ${req.method} ${req.path} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      res.status(500).json({ ok: false, error: 'source-request-failed' });
    }
  };
  /** Inline binaries an agent sent become blobs before the synchronous store validates the payload. */
  const prepared = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => (
    input.payload === undefined ? input : { ...input, payload: await store.externalize(input.projectId, input.payload) }
  );

  app.get('/guide', endpoint((_req, res) => { res.json({ ok: true, guide: GUIDE }); }));
  app.get('/docs', endpoint((req, res) => { res.json({ ok: true, ...store.listWithFailures(req.query['projectId']) }); }));
  app.post('/docs', endpoint(async (req, res) => {
    const input = await prepared(body(req));
    res.json({ ok: true, doc: store.create(input.projectId, input, author(req)) });
  }));
  app.get('/mirror', endpoint((req, res) => {
    res.json({ ok: true, doc: store.mirror(req.query['projectId'], String(req.query['appId'] ?? ''), String(req.query['key'] ?? '')) });
  }));
  app.get('/docs/:id', endpoint((req, res) => { res.json({ ok: true, doc: store.get(req.query['projectId'], docId(req)) }); }));
  app.get('/docs/:id/head', endpoint((req, res) => { res.json({ ok: true, head: store.head(req.query['projectId'], docId(req)) }); }));
  app.get('/docs/:id/revisions/:revision', endpoint((req, res) => {
    res.json({ ok: true, doc: store.revision(req.query['projectId'], docId(req), Number(req.params['revision'])) });
  }));
  app.get('/docs/:id/history', endpoint((req, res) => { res.json({ ok: true, revisions: store.history(req.query['projectId'], docId(req)) }); }));
  app.get('/docs/:id/impact', endpoint((req, res) => { res.json({ ok: true, impacts: store.impacts(req.query['projectId'], docId(req)) }); }));
  app.post('/docs/:id/commit', endpoint(async (req, res) => {
    const id = docId(req); writable(id);
    const input = await prepared(body(req));
    res.json({ ok: true, doc: store.commit(input.projectId, id, input, author(req)) });
  }));
  for (const operation of ['undo', 'redo', 'restore'] as const) {
    app.post(`/docs/:id/${operation}`, endpoint((req, res) => {
      userOnly(req);
      const id = docId(req); writable(id);
      const input = body(req);
      res.json({ ok: true, doc: store.restore(input.projectId, id, input, operation, 'user') });
    }));
  }
  app.post('/docs/:id/links/:linkId/keep', endpoint((req, res) => {
    userOnly(req);
    const input = body(req);
    const revision = input.revision === null ? null : Number(input.revision);
    res.json({ ok: true, doc: store.decide(input.projectId, docId(req), creationKey(req.params['linkId']), revision) });
  }));
  app.get('/docs/:id/candidates', endpoint((req, res) => { res.json({ ok: true, candidates: store.candidates(req.query['projectId'], docId(req)) }); }));
  app.get('/docs/:id/candidates/:candidateId', endpoint((req, res) => {
    res.json({ ok: true, candidate: store.candidate(req.query['projectId'], docId(req), creationKey(req.params['candidateId'])) });
  }));
  app.post('/docs/:id/candidates', endpoint(async (req, res) => {
    const id = docId(req); writable(id);
    const input = await prepared(body(req));
    res.json({ ok: true, candidate: store.propose(input.projectId, id, input) });
  }));
  app.post('/docs/:id/candidates-cleanup', endpoint((req, res) => {
    userOnly(req);
    const input = body(req);
    res.json({ ok: true, discarded: store.discardPending(input.projectId, docId(req), input.scope) });
  }));
  app.post('/docs/:id/candidates/:candidateId/accept', endpoint((req, res) => {
    userOnly(req);
    const input = body(req);
    res.json({ ok: true, doc: store.accept(input.projectId, docId(req), creationKey(req.params['candidateId']), input) });
  }));
  app.post('/docs/:id/candidates/:candidateId/discard', endpoint((req, res) => {
    userOnly(req);
    const input = body(req);
    res.json({ ok: true, candidate: store.discard(input.projectId, docId(req), creationKey(req.params['candidateId'])) });
  }));
  app.post('/docs/:id/candidates/:candidateId/rebase', endpoint((req, res) => {
    userOnly(req);
    const input = body(req);
    res.json({ ok: true, candidate: store.rebase(input.projectId, docId(req), creationKey(req.params['candidateId']), input) });
  }));
  app.get('/docs/:id/outputs', endpoint((req, res) => { res.json({ ok: true, outputs: store.outputs(req.query['projectId'], docId(req)) }); }));
  app.post('/docs/:id/outputs', endpoint((req, res) => {
    const id = docId(req); writable(id);
    const input = body(req);
    res.json({ ok: true, output: store.output(input.projectId, id, input) });
  }));
  app.post('/docs/:id/check', endpoint((req, res) => {
    const input = body(req);
    const doc = store.get(input.projectId, docId(req));
    const before = store.revision(input.projectId, doc.id, Number(input.baseRevision));
    const valid = Array.isArray(input.requirements) && input.requirements.length <= 500 && input.requirements.every(rule => !!rule && typeof rule === 'object'
      && typeof rule.id === 'string' && typeof rule.description === 'string' && ['equals', 'unchanged', 'visual'].includes(rule.kind)
      && (rule.kind === 'visual' || typeof rule.pointer === 'string'));
    if (!valid) throw new CreationError(400, 'invalid-requirements');
    res.json({ ok: true, revision: doc.revision, checks: checkCreationRequirements(before.payload, doc.payload, input.requirements as CreationRequirement[]) });
  }));

  // ─── content-addressed binaries ──────────────────────────────────────────────────
  app.post('/blobs/missing', endpoint((req, res) => {
    const input = body(req);
    res.json({ ok: true, missing: store.missingBlobs(input.projectId, input.names) });
  }));
  app.put('/blobs', express.raw({ type: () => true, limit: CREATION_LIMITS.blobBytes }), endpoint(async (req, res) => {
    const ext = blobExtForUpload(req.query['ext']);
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw new CreationError(400, 'invalid-blob');
    const ref = await store.putBlob(req.query['projectId'], { bytes: new Uint8Array(req.body.buffer, req.body.byteOffset, req.body.length), ext });
    res.json({ ok: true, ref });
  }));
  app.get('/blobs/:name', endpoint(async (req, res) => {
    const name = parseCreationBlobName(req.params['name']);
    if (!name) throw new CreationError(400, 'invalid-blob');
    const file = store.blobPath(req.query['projectId'], name.name);
    if (req.query['format'] === 'json') {
      if (!isNumericBlobExt(name.ext)) throw new CreationError(400, 'invalid-blob');
      const bytes = await fs.promises.readFile(file);
      const numbers = binaryNumbers(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), name.ext);
      if (numbers.length > JSON_NUMBERS_MAX) throw new CreationError(413, 'blob-too-large');
      res.json({ ok: true, values: numbers });
      return;
    }
    res.setHeader('Content-Type', CREATION_BLOB_MIME[name.ext]);
    // Immutable content: the name is the hash. SVG never runs script when opened directly.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(await fs.promises.readFile(file));
  }));
}
