import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isPathWithin } from '@vibisual/shared';
import type { VideoAsset, VideoDoc } from '../types.js';
import { importProjectAsset } from './assets.js';
import { compositionFolderAbs } from './composition.js';
import { taskCopyNamespaceOf } from './taskCopyPaths.js';

const COPY_MAX_FILES = 10_000;
const COPY_MAX_BYTES = 256 * 1024 * 1024;
const COMPOSITIONS = '.vibisual/video/compositions';
const IMMUTABLE_ASSETS = '.vibisual/video/assets/';

/** No source writes. The document is published by the caller only after all code is copied. */
export function copyVideoTaskDocument(project: string, source: VideoDoc, id: string, title: string): VideoDoc {
  const root = fs.realpathSync(project);
  const namespace = `.vibisual/video/task-copies/${randomUUID()}/`;
  const destination = path.join(root, namespace);
  const mappings = new Map<string, string>();
  const copied = new Set<string>();
  let fileCount = 0;
  let byteCount = 0;
  let copiedNamespace = false;

  const safePath = (relative: string): string => {
    const absolute = path.resolve(root, relative);
    if (!isPathWithin(absolute, root, process.platform) || absolute === root) throw new Error('copy-path-outside-project');
    let current = root;
    for (const part of path.relative(root, absolute).split(path.sep)) {
      current = path.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('copy-linked-path');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return absolute;
  };
  safePath(namespace);
  fs.mkdirSync(destination, { recursive: true });

  const copyTree = (from: string, to: string): void => {
    const absolute = safePath(from);
    const target = safePath(to);
    if (copied.has(target)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      if (isPathWithin(destination, absolute, process.platform)) throw new Error('copy-source-contains-destination');
      fs.mkdirSync(target, { recursive: true });
      for (const entry of fs.readdirSync(absolute)) copyTree(`${from}/${entry}`, `${to}/${entry}`);
    } else if (stat.isFile()) {
      fileCount += 1; byteCount += stat.size;
      if (fileCount > COPY_MAX_FILES || byteCount > COPY_MAX_BYTES) throw new Error('task-copy-too-large');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(absolute, target, fs.constants.COPYFILE_EXCL);
      copied.add(target);
    } else throw new Error('copy-unsupported-file');
  };

  for (const asset of Object.values(source.assets)) {
    if (asset.kind !== 'composition') continue;
    if (asset.source.kind !== 'file' || !compositionFolderAbs(root, asset.source.path)) throw new Error('copy-composition-unavailable');
    const file = asset.source.path.replace(/\\/g, '/');
    const previousNamespace = taskCopyNamespaceOf(file);
    copiedNamespace ||= previousNamespace !== null;
    // The default code root may contain sibling imports. Copy that tree once, not just index.html.
    const from = previousNamespace?.slice(0, -1)
      ?? (file.startsWith(`${COMPOSITIONS}/`) ? COMPOSITIONS : path.posix.dirname(file));
    if (!mappings.has(from)) {
      const to = previousNamespace ? namespace.slice(0, -1) : `${namespace}${from}`;
      copyTree(from, to);
      mappings.set(from, to);
    }
  }
  if (mappings.size > 0 && !copiedNamespace) {
    // Imported libraries/fonts are snapshot alongside code; future library updates must not change this task.
    for (const relative of ['.vibisual/video/libs', '.vibisual/video/libs.json']) {
      const target = `${namespace}${relative}`;
      if (!fs.existsSync(safePath(target)) && fs.existsSync(safePath(relative))) copyTree(relative, target);
    }
  }
  const remap = (relative: string): string | undefined => {
    const normalized = relative.replace(/\\/g, '/');
    for (const [from, to] of mappings) if (normalized.startsWith(`${from}/`)) return `${to}${normalized.slice(from.length)}`;
    return undefined;
  };
  const assets: Record<string, VideoAsset> = {};
  for (const [key, original] of Object.entries(source.assets)) {
    const asset = structuredClone(original);
    const relative = asset.source.kind === 'file' ? asset.source.path : asset.source.output;
    const relocated = remap(relative);
    if (relocated) assets[key] = { ...asset, source: { kind: 'file', path: relocated } };
    else if (asset.source.kind === 'file' && relative.replace(/\\/g, '/').startsWith(IMMUTABLE_ASSETS)) assets[key] = asset;
    else if (asset.kind === 'font') {
      const relativeFile = path.relative(root, path.resolve(root, relative)).replace(/\\/g, '/');
      copyTree(relativeFile, `${namespace}${relativeFile}`);
      assets[key] = { ...asset, source: { kind: 'file', path: `${namespace}${relativeFile}` } };
    } else {
      // Project files and external-generator outputs are mutable. Import a fixed copy, retaining timeline IDs.
      const imported = importProjectAsset(root, relative);
      assets[key] = { ...asset, source: imported.source };
    }
  }
  const { derivedFrom: _origin, ...snapshot } = structuredClone(source);
  const now = Date.now();
  return { ...snapshot, assets, id, title, version: 1, createdAt: now, updatedAt: now };
}
