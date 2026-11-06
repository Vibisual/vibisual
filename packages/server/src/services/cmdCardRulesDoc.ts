import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCmdCardGuide, buildCmdCardCommonGuide, CMD_CARD_GUIDE_KINDS } from '@vibisual/shared';
import { logger } from '../logger.js';

let ensured: { dir: string; ready: boolean } | undefined;

/** Keep generated protocols outside projects; incomplete writes retain the inline fallback. */
export function ensureCmdCardRulesDocs(home = os.homedir()): string | undefined {
  const dir = path.join(home, '.vibisual', 'rules', 'cards-v1', 'cmd');
  if (ensured?.dir === dir) return ensured.ready ? dir.replace(/\\/g, '/') : undefined;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const kind of ['common', ...CMD_CARD_GUIDE_KINDS] as const) {
      const file = path.join(dir, `${kind}.md`);
      const body = kind === 'common' ? buildCmdCardCommonGuide() : buildCmdCardGuide(kind);
      let current: string | undefined;
      try { current = fs.readFileSync(file, 'utf8'); } catch { /* Missing guides are generated below. */ }
      if (current !== body) fs.writeFileSync(file, body, 'utf8');
    }
    ensured = { dir, ready: true };
    return dir.replace(/\\/g, '/');
  } catch (error) {
    logger.warn(`[cmd-card-rules] write failed: ${error instanceof Error ? error.message : String(error)}`);
    ensured = { dir, ready: false };
    return undefined;
  }
}

export function resetCmdCardRulesDocsCache(): void {
  ensured = undefined;
}
