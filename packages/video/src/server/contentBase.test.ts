import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOBILE_CONTENT_BASE_HEADER } from '@vibisual/shared';
import { createEmptyDoc, type VideoDoc } from '../index.js';
import { mountVideoRoutes, videoService } from './routes.js';

/** §5.13 (T-3) — 모바일 권한 경로로 들어온 문서는 CSP 출처와 심이 적는 절대 주소가 같은 경로를 타야 한다. */

const ENTRY = '.vibisual/video/compositions/scene/index.html';
const BASE = `/mobile/content/${'a'.repeat(43)}`;

let root: string;
let server: Server;
let origin: string;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-content-base-'));
  const app = express();
  app.use(express.json());
  mountVideoRoutes(app, {
    resolveProjectPath: (name) => (name === 'project' ? root : null),
    atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); },
    info: () => undefined,
    warn: () => undefined,
  });
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port.');
  origin = `http://127.0.0.1:${address.port}`;

  const file = path.join(root, ENTRY);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '<!doctype html><html><head><meta name="vibi:libs" content="motion"></head><body></body></html>');
  const lib = path.join(root, '.vibisual/video/libs/motion/main.js');
  fs.mkdirSync(path.dirname(lib), { recursive: true });
  fs.writeFileSync(lib, 'const motion = 1;');
  fs.writeFileSync(path.join(root, '.vibisual/video/libs.json'), JSON.stringify({ schemaVersion: 1, requests: [], items: [
    { id: 'motion', kind: 'library', name: 'motion', folder: '.vibisual/video/libs/motion', entry: 'main.js', format: 'script' },
  ] }));
  const doc: VideoDoc = { ...createEmptyDoc('doc-1', 'Doc'), assets: { comp: { id: 'comp', kind: 'composition', source: { kind: 'file', path: ENTRY } } } };
  videoService.writeDoc(root, doc);
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  const absolute = path.resolve(root);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('vibistudio-content-base-')) throw new Error('Unsafe test cleanup.');
  fs.rmSync(absolute, { recursive: true, force: true });
});

const load = (headers: Record<string, string> = {}): Promise<Response> => fetch(`${origin}/content/project/doc-1/${ENTRY}?item=clip`, { headers });
const scriptSources = (csp: string): string => /script-src ([^;]+)/.exec(csp)?.[1] ?? '';

describe('composition content under a mobile capability path', () => {
  it('writes the capability into the CSP sources and injected library URLs', async () => {
    const response = await load({ [MOBILE_CONTENT_BASE_HEADER]: BASE });
    const csp = response.headers.get('content-security-policy') ?? '';
    // A port-qualified http source never matches an https request in CSP, and the listener is HTTPS-only.
    expect(scriptSources(csp)).toContain(`${origin.replace('http://', 'https://')}${BASE}/content/project/doc-1/`);
    expect(scriptSources(csp)).not.toContain(`${origin}${BASE}`);
    const html = await response.text();
    expect(html).toMatch(new RegExp(`<script src="${BASE}/content/project/doc-1/\\.vibisual/video/libs/motion/main\\.js"`));
  });

  it('keeps the plain paths when the request did not come through a capability', async () => {
    const response = await load();
    expect(scriptSources(response.headers.get('content-security-policy') ?? '')).toContain(`${origin}/content/project/doc-1/`);
    expect(await response.text()).toMatch(/<script src="\/content\/project\/doc-1\/\.vibisual\/video\/libs\/motion\/main\.js"/);
  });

  it.each(['/api/projects', 'javascript:alert(1)', `${BASE}"><script>`, `${BASE}/extra`])('ignores a header that is not a capability base: %s', async (value) => {
    const response = await load({ [MOBILE_CONTENT_BASE_HEADER]: value });
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).not.toContain(value);
    expect(scriptSources(csp)).toContain(`${origin}/content/project/doc-1/`);
    expect(await response.text()).not.toContain(value);
  });
});
