import fs from 'node:fs';
import path from 'node:path';

const LOG_DIR = path.resolve(process.cwd(), '../../.vibisual/logs');
const LOG_FILE = path.join(LOG_DIR, 'bubble-lifecycle.txt');

let initialized = false;
function ensureInit(): void {
  if (initialized) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `\n\n===== SERVER START ${new Date().toISOString()} =====\n`);
    initialized = true;
  } catch {
    initialized = true;
  }
}

export function dbg(tag: string, data?: unknown): void {
  ensureInit();
  const ts = new Date().toISOString();
  const line = data === undefined
    ? `[${ts}] ${tag}\n`
    : `[${ts}] ${tag} ${JSON.stringify(data, (_k, v) => v instanceof Set ? [...v] : v)}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
}
