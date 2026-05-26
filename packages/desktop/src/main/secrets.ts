import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

// Secrets / env injection — SCENARIO.md §3.7.
//
// in-process 모델에선 server 코어가 Electron main 과 같은 프로세스에서 돌므로 main 의
// process.env 가 곧 server 의 env 다.
//   - dev   (`pnpm dev:desktop`): Electron 을 띄운 셸의 env 가 이미 process.env 에 들어 있다.
//     ANTHROPIC_API_KEY 등은 그대로 읽힌다 — 이 모듈이 할 일 없음.
//   - packaged (.exe / .dmg / .AppImage): 아이콘 더블클릭엔 셸 env 가 없다. secrets 는
//        app.getPath('userData') / secrets.json
//     에 사용자가 둔다. flat JSON 객체이며 모든 키가 main 의 process.env 로 머지된다.
//
// 프로젝트 데이터(§3.5)는 userData 에 저장하지 않는다 — 여전히 <projectPath>/.vibisual.
// userData 는 앱 인스턴스 설정 + secrets + 오토업데이터 상태 전용.

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
