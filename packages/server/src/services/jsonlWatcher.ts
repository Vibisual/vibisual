/**
 * Layer 2: watches `~/.claude/projects/*.jsonl` mtime — backup liveness when the SessionStart hook (Layer 1) isn't installed.
 * Signals: `onActivity(sessionId, cwd)` · `onIdle` (IDLE_THRESHOLD) · `onDead` (DEAD_THRESHOLD, final removal).
 */

import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../logger.js';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/** A JSONL edit within this window = still active. */
export const JSONL_ACTIVE_THRESHOLD_MS = 30_000;
/** No edits for this long = idle (visible but greyed). */
export const JSONL_IDLE_THRESHOLD_MS = 60_000;
/** No edits for this long = dead (removal candidate). */
export const JSONL_DEAD_THRESHOLD_MS = 120_000;

export interface JsonlEvent {
  sessionId: string;
  cwd: string;
  jsonlPath: string;
  mtimeMs: number;
}

export interface JsonlWatcherCallbacks {
  onActivity: (evt: JsonlEvent) => void;
}

/** Parse ~/.claude/projects/{slug}/{sessionId}.jsonl → { sessionId, cwd-ish slug } */
function parseJsonlPath(filePath: string): { sessionId: string; slug: string } | null {
  const norm = path.normalize(filePath);
  const base = path.basename(norm);
  if (!base.endsWith('.jsonl')) return null;
  const sessionId = base.slice(0, -'.jsonl'.length);
  const slug = path.basename(path.dirname(norm));
  if (!sessionId || !slug) return null;
  return { sessionId, slug };
}

/** The slug collapses `:`, `/`, `\`, `_` to `-` — not reversible. Returns the raw slug; callers get the real cwd from the SessionStart hook or discoverSessions. */
function slugToBestGuessCwd(slug: string): string {
  // We keep it as the slug string — sessionLifecycle will cross-reference with
  // sessionCwds populated by hook events / discoverSessions.
  return slug;
}

export class JsonlWatcher {
  private watcher: FSWatcher | null = null;
  private callbacks: JsonlWatcherCallbacks;

  constructor(callbacks: JsonlWatcherCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.watcher) return;
    if (!fs.existsSync(PROJECTS_DIR)) {
      logger.warn(`JsonlWatcher: ${PROJECTS_DIR} does not exist — skip`);
      return;
    }

    this.watcher = chokidar.watch(path.join(PROJECTS_DIR, '*', '*.jsonl'), {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 150 },
      depth: 2,
    });

    this.watcher.on('add', (filePath) => this.emit(filePath));
    this.watcher.on('change', (filePath) => this.emit(filePath));
    this.watcher.on('error', (err) => logger.warn('JsonlWatcher error', err));

    logger.info(`JsonlWatcher started: ${PROJECTS_DIR}`);
  }

  stop(): void {
    if (!this.watcher) return;
    this.watcher.close().catch((err) => logger.warn('JsonlWatcher close failed', err));
    this.watcher = null;
  }

  private emit(filePath: string): void {
    const parsed = parseJsonlPath(filePath);
    if (!parsed) return;
    try {
      const stat = fs.statSync(filePath);
      this.callbacks.onActivity({
        sessionId: parsed.sessionId,
        cwd: slugToBestGuessCwd(parsed.slug),
        jsonlPath: filePath,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // file might have been rotated — skip
    }
  }
}
