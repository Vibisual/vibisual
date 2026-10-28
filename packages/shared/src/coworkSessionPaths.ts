/**
 * Claude Cowork 로컬 세션의 디스크 규약(순수 경로 계산). Cowork 는 설정 홈을 세션마다 따로 잡아(실측) 호스트 settings.json 훅이 안 돈다
 * — 그 세션 설정 홈에 같은 블록을 심는다(claude-code#63360·#40495).
 * 모양(실측): `<root>/<orgId>/<userId>/<sessionId>/` 아래 `.claude/`(설정 홈) · `outputs/`(cwd) · `audit.jsonl`. `<root>` 는 이전 중인 두 이름이 공존해 둘 다 본다.
 * shared 라 `node:path`·`process.platform` 없이 forward slash 로 만든다(Windows `fs` 도 받는다).
 */

import type { PlatformName } from './pathCase.js';
import { normalizePathShape } from './pathCase.js';

/** Cowork 세션 루트 이름 — 둘 다 본다(새 이름 먼저). 또 바뀌면 여기만 고친다. */
export const COWORK_SESSION_DIR_NAMES = [
  'claude-code-sessions',
  'local-agent-mode-sessions',
] as const;

/** `coworkSessionRootDirs` 가 읽는 환경변수 — 인자로 받는다(테스트에서 세 OS 를 다 돌리기 위해). */
export interface CoworkPathEnv {
  /** Windows 로밍 앱데이터. 없으면 `USERPROFILE` 로 조립한다. */
  APPDATA?: string | undefined;
  USERPROFILE?: string | undefined;
  /** POSIX 홈. */
  HOME?: string | undefined;
  /** linux 설정 홈 재정의(XDG). */
  XDG_CONFIG_HOME?: string | undefined;
}

/**
 * 경로 조각을 forward slash 로 잇는다. 조각 안 백슬래시도 접는다 — `%APPDATA%` 와 섞인 경로가 키가 되면 같은 디렉터리가 둘로 갈린다.
 * 정규화는 `pathCase.normalizePathShape` 몫(UNC·드라이브 루트 경계 포함).
 */
function join(...parts: (string | undefined)[]): string {
  const joined = parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((p) => p.replace(/[\\/]+$/, ''))
    .join('/');
  return normalizePathShape(joined);
}

/**
 * Claude Desktop 사용자 데이터 디렉터리(플랫폼은 인자 — 멀티플랫폼 4축). win32 `%APPDATA%/Claude` · darwin `~/Library/Application Support/Claude` · linux `$XDG_CONFIG_HOME` 또는 `~/.config`.
 * linux 배포본은 없지만 분기를 비우지 않는다(나오면 조용히 0건이 된다).
 */
export function claudeDesktopUserDataDir(
  platform: PlatformName,
  env: CoworkPathEnv,
): string | null {
  if (platform === 'win32') {
    const roaming = env.APPDATA ?? (env.USERPROFILE ? join(env.USERPROFILE, 'AppData/Roaming') : undefined);
    return roaming ? join(roaming, 'Claude') : null;
  }
  if (platform === 'darwin') {
    return env.HOME ? join(env.HOME, 'Library/Application Support/Claude') : null;
  }
  const config = env.XDG_CONFIG_HOME ?? (env.HOME ? join(env.HOME, '.config') : undefined);
  return config ? join(config, 'Claude') : null;
}

/**
 * Cowork 세션 루트 후보들(`<userData>/<이름>`). 존재 확인은 하지 않는다 — 순수 함수라
 * 디스크를 만지지 않으며, 호출부가 `existsSync` 로 거른다.
 */
export function coworkSessionRootDirs(platform: PlatformName, env: CoworkPathEnv): string[] {
  const base = claudeDesktopUserDataDir(platform, env);
  if (!base) return [];
  return COWORK_SESSION_DIR_NAMES.map((name) => join(base, name));
}

/** 세션 디렉터리 깊이(`<root>/<orgId>/<userId>/<sessionId>`). 탐색을 여기 못 박는다 — 재귀하면 세션마다 든 `.claude/projects` 까지 수만 개를 훑는다. */
export const COWORK_SESSION_DEPTH = 3;

/** 세션 디렉터리 이름인가 — `local-<uuid>`(실측) 또는 맨 `<uuid>`. 못 받으면 조용히 0건이라 넓게 받고 `.claude` 존재로 한 번 더 거른다. */
export function isCoworkSessionDirName(name: string): boolean {
  return /^(local-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name);
}

/** 이 Cowork 세션의 **설정 홈** — 우리 훅을 심을 자리이자 세션 JSON·트랜스크립트가 사는 곳. */
export function coworkConfigHome(sessionDir: string): string {
  return join(sessionDir, '.claude');
}

/** Cowork 세션의 cwd(프로젝트가 아니라 `outputs` — §5.7 #24 (b) 일치 판정이 본다). 프로젝트 귀속은 훅 payload 의 `cwd` 가 정한다(호출부 주석). */
export function coworkSessionOutputsDir(sessionDir: string): string {
  return join(sessionDir, 'outputs');
}
