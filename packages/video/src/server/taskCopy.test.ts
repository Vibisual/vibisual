import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '../index.js';
import { mountVideoRoutes, videoService } from './routes.js';
import { copyVideoTaskDocument } from './taskCopy.js';

let root: string;
let server: Server;
let base: string;
function write(relative: string, text: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-task-copy-'));
  const app = express(); app.use(express.json());
  mountVideoRoutes(app, {
    resolveProjectPath: name => name === 'project' ? root : null,
    atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); },
    info: () => undefined, warn: () => undefined,
  });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test port.');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const absolute = path.resolve(root);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('vibistudio-task-copy-')) throw new Error('Unsafe test cleanup.');
  fs.rmSync(absolute, { recursive: true, force: true });
});
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('independent video task copies', () => {
  it('copies code, sibling imports and library snapshots while retaining independent timeline edits on retry', async () => {
    const entry = '.vibisual/video/compositions/scene/index.html';
    const shared = '.vibisual/video/compositions/shared.js';
    write(entry, '<html><head><meta name="vibi:libs" content="motion"></head><script src="../shared.js"></script></html>');
    write(shared, 'const original = true;');
    write('.vibisual/video/libs/motion/main.js', 'const libraryVersion = 1;');
    write('.vibisual/video/libs.json', JSON.stringify({ schemaVersion: 1, requests: [], items: [
      { id: 'motion', kind: 'library', name: 'motion', folder: '.vibisual/video/libs/motion', entry: 'main.js', format: 'script' },
    ] }));
    const source: VideoDoc = { ...createEmptyDoc('source', 'Original'), version: 7, derivedFrom: { docId: 'origin', format: 'portrait' },
      assets: { comp: { id: 'comp', kind: 'composition', source: { kind: 'file', path: entry } } } };
    videoService.writeDoc(root, source);
    const request = { project: 'project', title: 'Another version', requestId: 'transition-one' };
    const result = await post(`${base}/doc/source/copy`, request);
    expect(result.status).toBe(200);
    const { doc } = await result.json() as { doc: VideoDoc };
    expect(doc).toMatchObject({ version: 1, title: 'Another version' });
    expect(doc.id).not.toBe(source.id); expect(doc.derivedFrom).toBeUndefined();
    const copiedPath = (doc.assets.comp!.source as { path: string }).path;
    expect(copiedPath).not.toBe(entry);
    const copiedShared = path.posix.join(path.posix.dirname(copiedPath), '../shared.js');
    write(copiedShared, 'const variant = true;');
    expect(fs.readFileSync(path.join(root, shared), 'utf8')).toBe('const original = true;');
    const sibling = await fetch(`${base}/content/project/${doc.id}/${copiedShared}`);
    expect(sibling.status).toBe(200); expect(await sibling.text()).toBe('const variant = true;');
    write('.vibisual/video/libs/motion/main.js', 'const libraryVersion = 2;');
    const html = await (await fetch(`${base}/content/project/${doc.id}/${copiedPath}`)).text();
    const libraryUrl = /<script src="([^"]+libs\/motion\/main\.js)"/.exec(html)?.[1];
    expect(libraryUrl).toContain('task-copies');
    expect(await (await fetch(`${base}${libraryUrl}`)).text()).toBe('const libraryVersion = 1;');
    videoService.writeDoc(root, { ...doc, title: 'Human edit', version: 2 });
    expect(await (await post(`${base}/doc/source/copy`, request)).json()).toMatchObject({ doc: { id: doc.id, title: 'Human edit', version: 2 } });
    expect(videoService.readDoc(root, 'source')).toEqual(source);
    expect(videoService.listDocs(root)).toHaveLength(2);
  });

  it('copies a copy without retaining the previous code path or growing nested namespace paths', () => {
    const entry = '.vibisual/video/compositions/scene/index.html';
    write(entry, '<html>original</html>');
    const source = { ...createEmptyDoc('source', 'Original'), assets: { comp: { id: 'comp', kind: 'composition' as const, source: { kind: 'file' as const, path: entry } } } };
    const first = copyVideoTaskDocument(root, source, 'one', 'One');
    const second = copyVideoTaskDocument(root, first, 'two', 'Two');
    const firstPath = (first.assets.comp!.source as { path: string }).path;
    const secondPath = (second.assets.comp!.source as { path: string }).path;
    expect(secondPath.split('task-copies')).toHaveLength(2);
    write(secondPath, 'second edit');
    expect(fs.readFileSync(path.join(root, firstPath), 'utf8')).toBe('<html>original</html>');
  });

  it('does not publish an incomplete document if a composition cannot be copied', async () => {
    const source = { ...createEmptyDoc('source', 'Original'), assets: { missing: { id: 'missing', kind: 'composition' as const, source: { kind: 'file' as const, path: 'missing/index.html' } } } };
    videoService.writeDoc(root, source);
    const result = await post(`${base}/doc/source/copy`, { project: 'project', title: 'Copy', requestId: 'failure' });
    expect(result.status).toBe(400);
    expect(videoService.listDocs(root)).toEqual([expect.objectContaining({ id: 'source' })]);
    expect(videoService.readDoc(root, 'source')).toEqual(source);
  });

  it('imports mutable media outputs and does not retain an external command that writes the source', () => {
    write('source.png', 'image-one');
    const source = { ...createEmptyDoc('source', 'Original'), assets: {
      image: { id: 'image', kind: 'image' as const, source: { kind: 'external' as const, command: 'generate', output: 'source.png' } },
    } };
    const copy = copyVideoTaskDocument(root, source, 'copy', 'Copy');
    const mediaPath = (copy.assets.image!.source as { path: string }).path;
    expect(copy.assets.image!.source.kind).toBe('file');
    expect(mediaPath).not.toBe('source.png');
    write('source.png', 'changed');
    expect(fs.readFileSync(path.join(root, mediaPath), 'utf8')).toBe('image-one');
  });

  it('rejects recursive source roots and linked code paths without changing the source', () => {
    write('.vibisual/video/index.html', 'original');
    const broad = { ...createEmptyDoc('source', 'Original'), assets: { comp: { id: 'comp', kind: 'composition' as const, source: { kind: 'file' as const, path: '.vibisual/video/index.html' } } } };
    expect(() => copyVideoTaskDocument(root, broad, 'copy', 'Copy')).toThrow('copy-source-contains-destination');
    write('.vibisual/video/compositions/real/index.html', 'original');
    fs.symlinkSync(path.join(root, '.vibisual/video/compositions/real'), path.join(root, '.vibisual/video/compositions/linked'), 'junction');
    const linked = { ...broad, assets: { comp: { ...broad.assets.comp, source: { kind: 'file' as const, path: '.vibisual/video/compositions/linked/index.html' } } } };
    expect(() => copyVideoTaskDocument(root, linked, 'copy', 'Copy')).toThrow('copy-linked-path');
    expect(fs.readFileSync(path.join(root, '.vibisual/video/index.html'), 'utf8')).toBe('original');
  });
});
