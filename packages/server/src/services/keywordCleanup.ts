// v1.96 one-shot migration: removes legacy keyword payload from old checkpoints. Safe to delete after v2.0.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadAppState } from './appState.js';
import { logger } from '../logger.js';

const MARKER_FILE = path.join(os.homedir(), '.vibisual', 'keyword-cleanup-done');
const TARGET_FILES = [
  '.vibisual/keyword-graph.db',
  '.vibisual/keyword-graph.db-wal',
  '.vibisual/keyword-graph.db-shm',
  '.vibisual/keyword-index.md',
];

export function runKeywordCleanupOnce(): void {
  try {
    if (fs.existsSync(MARKER_FILE)) return;
  } catch { /* fall through */ }

  let removed = 0;
  try {
    const state = loadAppState();
    for (const projectPath of state.openProjects) {
      for (const rel of TARGET_FILES) {
        const full = path.join(projectPath, rel);
        try {
          fs.unlinkSync(full);
          removed += 1;
        } catch { /* not present — ignore */ }
      }
    }
  } catch (err) {
    logger.debug(`keywordCleanup: scan failed: ${String(err)}`);
  }

  try {
    fs.mkdirSync(path.dirname(MARKER_FILE), { recursive: true });
    fs.writeFileSync(MARKER_FILE, `v1.96 cleanup completed at ${new Date().toISOString()}\n`);
  } catch (err) {
    logger.debug(`keywordCleanup: marker write failed: ${String(err)}`);
    return;
  }

  if (removed > 0) {
    logger.info(`keywordCleanup: removed ${removed} legacy keyword data file(s) (v1.96 §5.8)`);
  }
}
