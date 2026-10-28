import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

// Secrets / env injection — SCENARIO.md §3.7. server 코어가 main 과 같은 프로세스라 main 의 process.env 가 곧 server 의 env 다.
// dev 는 셸 env 가 이미 있어 할 일이 없고, packaged 는 셸 env 가 없어 userData/secrets.json(flat JSON)의 모든 키를 process.env 로 머지한다.
// userData 는 앱 인스턴스 설정 + secrets + 오토업데이터 상태 전용(프로젝트 데이터는 <projectPath>/.vibisual — §3.5).

const SECRETS_FILENAME = 'secrets.json';

export interface LoadedSecrets {
  source: 'userData' | 'none';
  path: string;
  env: Record<string, string>;
}

/** packaged 모드용 secrets.json 을 읽어 env 맵으로 돌려준다. dev 모드는 셸 env 를 쓰므로 'none'. */
export function loadSecrets(): LoadedSecrets {
  const userDataDir = app.getPath('userData');
  const secretsPath = join(userDataDir, SECRETS_FILENAME);
  if (!existsSync(secretsPath)) {
    return { source: 'none', path: secretsPath, env: {} };
  }
  try {
    const text = readFileSync(secretsPath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn(`[secrets] ${secretsPath} must be a JSON object — ignoring.`);
      return { source: 'none', path: secretsPath, env: {} };
    }
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') env[k] = String(v);
      // Nested / null values silently skipped — env vars must be flat strings.
    }
    return { source: 'userData', path: secretsPath, env };
  } catch (err) {
    console.warn(`[secrets] failed to read ${secretsPath}: ${String(err)}`);
    return { source: 'none', path: secretsPath, env: {} };
  }
}
