import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MemoServerHost } from '../host.js';

export function testHost(): { root: string; host: MemoServerHost; dispose: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-test-'));
  let aiEnabled = true;
  const host: MemoServerHost = {
    resolveProjectPath: value => value === root ? root : null,
    resolveWorkspacePath: (project, relative) => {
      const abs = path.resolve(project, relative); const rel = path.relative(project, abs);
      return rel.startsWith('..') || path.isAbsolute(rel) ? null : { abs, rel };
    },
    atomicWriteFile: (file, data) => {
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, data, 'utf8'); fs.renameSync(`${file}.tmp`, file);
    },
    warn: () => undefined,
    getAppAIEnabled: () => aiEnabled,
    setAppAIEnabled: async (enabled) => { aiEnabled = enabled; },
    resolveAppContext: (project, id) => id === project ? { kind: 'project', id, label: 'Project', excerpt: '' } : null,
    textTaskStatus: async () => ({ state: 'available', provider: 'Test' }),
    runTextTask: async () => ({ state: 'failed', text: '' }),
  };
  return { root, host, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}
