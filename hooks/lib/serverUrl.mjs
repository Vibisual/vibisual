/**
 * hooks/lib/serverUrl.mjs — Vibisual dev 서버 base URL 결정 (CommonJS-free, no deps).
 *
 * 우선순위:
 *  1) 환경변수 VIBISUAL_SERVER_URL (예: http://localhost:4801)
 *  2) cwd 기준 git root의 .vibisual/dev-server.json {port}
 *  3) fallback http://localhost:4800
 *
 * 같은 worktree에서 작업 중인 Claude Code 훅이 자기 트리의 dev 서버를 가리키도록.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FALLBACK = 'http://localhost:4800';

export function resolveServerUrl() {
  const env = process.env.VIBISUAL_SERVER_URL;
  if (env && env.length > 0) return env.replace(/\/+$/, '');

  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const markerPath = join(gitRoot, '.vibisual', 'dev-server.json');
    const raw = readFileSync(markerPath, 'utf-8');
    const marker = JSON.parse(raw);
    if (typeof marker.port === 'number') {
      return `http://localhost:${marker.port}`;
    }
  } catch {
    /* 파일 없거나 git root 없으면 fallback */
  }

  return FALLBACK;
}
