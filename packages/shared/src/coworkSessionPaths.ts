/**
 * Claude Cowork 로컬 세션의 **디스크 규약** — 경로 계산 한 곳(순수 함수).
 *
 * ## 왜 별도 경로가 필요한가
 *
 * Cowork 는 Claude Code 와 같은 코어로 돌지만(실측: 호스트
 * `%LOCALAPPDATA%/claude-cli-nodejs/Cache/…-outputs/mcp-logs-cowork/` 에 CLI 캐시가 남는다),
 * **설정 홈을 호스트 `~/.claude` 가 아니라 세션마다 따로 잡는다**. 그 물증은 두 줄이다 —
 * 호스트 `~/.claude/projects/` 에 Cowork slug 가 **0건**인데 트랜스크립트는 분명히 남아 있고,
 * 그 자리가 `<세션디렉터리>/.claude/projects/…` 다.
 *
 * 그래서 우리 훅(`~/.claude/settings.json`)이 Cowork 에서 한 번도 발화하지 않았다
 * (anthropics/claude-code#63360 은 "not planned" 로 닫혔고, 근본 원인은 #40495
 * "sandbox platform mismatch breaks all settings resolution"). **훅 기능이 없는 것이 아니라
 * 우리 settings.json 을 볼 일이 없는 자리에 있는 것**이므로, 그 세션의 설정 홈에 같은 블록을
 * 심으면 같은 코어가 같은 훅을 쏜다.
 *
 * ## 디스크 모양 (실측 — `%LOCALAPPDATA%/Claude/Logs/main.log`)
 *
 * ```
 * <root>/<orgId>/<userId>/<sessionId>/
 *   .claude/                    ← 이 세션의 설정 홈. settings.json·projects·sessions 가 여기 산다
 *   outputs/                    ← 이 세션의 cwd (호스트 CLI 캐시 slug 가 이 경로로 찍힌다)
 *   audit.jsonl                 ← Cowork 전용(초기화·비용·레이트리밋)
 * ```
 *
 * `<root>` 는 **두 이름이 공존**한다 — Anthropic 이 `local-agent-mode-sessions` 를
 * `claude-code-sessions` 로 옮기는 중이고, 이 기계에서 실제로 둘 다 로그에 찍혔다.
 * 한쪽만 보면 이름이 바뀐 시점을 기준으로 앞뒤 어느 한쪽 사용자가 통째로 안 보인다.
 *
 * ⚠️ shared 는 브라우저에서도 로드되므로 `node:path`·`process.platform` 을 쓰지 않는다.
 * 경로는 forward slash 로 만든다 — Windows 의 `fs` 도 그대로 받는다(pathCase 와 같은 규약).
 */

import type { PlatformName } from './pathCase.js';
import { normalizePathShape } from './pathCase.js';

/**
 * Cowork 세션 루트 디렉터리 이름 — **둘 다 본다**.
 *
 * 새 이름이 앞이다(새로 생기는 세션이 그쪽이라 대개 첫 번째에서 걸린다).
 * 목록에 한 줄 더하는 것 말고 다른 손댈 곳이 없어야 한다 — 이름이 또 바뀌면 여기만 고친다.
 */
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
 * 경로 조각을 forward slash 로 잇는다 — 빈 조각·중복 슬래시를 만들지 않는다.
 *
 * **조각 안의 백슬래시도 접는다.** Windows 의 `%APPDATA%` 는 `C:\Users\…\Roaming` 꼴로 오므로,
 * 끝 구분자만 벗기면 `C:\Users\…\Roaming/Claude` 라는 섞인 경로가 나온다. 그 값이 Map 키·Set 키로
 * 쓰이면 같은 디렉터리가 두 개로 갈린다(훅을 두 번 심거나, 심은 것을 못 알아본다).
 * 모양 정규화는 `pathCase.normalizePathShape` 한 곳이 소유한다 — UNC 선행 `\\` 와 드라이브 루트의
 * 끝 슬래시를 살려 주는 경계 조건이 거기 이미 들어 있다.
 */
function join(...parts: (string | undefined)[]): string {
  const joined = parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((p) => p.replace(/[\\/]+$/, ''))
    .join('/');
  return normalizePathShape(joined);
}

/**
 * Claude Desktop 의 사용자 데이터 디렉터리(`…/Claude`).
 *
 * **플랫폼을 인자로 받는다** — 함수 안에서 `process.platform` 을 읽으면 Windows 개발기에서
 * mac·linux 가지가 영영 실행되지 않아 검증할 방법이 사라진다(멀티플랫폼 규칙 4축: 홈·설정 디렉터리).
 *
 * - win32: `%APPDATA%/Claude` (Electron 의 `app.getPath('userData')` 규약)
 * - darwin: `~/Library/Application Support/Claude`
 * - linux 등: `$XDG_CONFIG_HOME/Claude` 또는 `~/.config/Claude`
 *
 * Claude Desktop 은 현재 linux 배포본이 없지만 **경로 규약은 적어 둔다** — 분기를 비워 두면
 * 나중에 나왔을 때 "리눅스에서만 조용히 0건"이 되고, 그건 앱이 죽은 것과 화면에서 구별되지 않는다.
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

/**
 * 세션 디렉터리가 루트 아래 **몇 겹**에 있는가 — `<root>/<orgId>/<userId>/<sessionId>`.
 *
 * 탐색을 이 깊이로 **못 박는다.** 상수가 없으면 "적당히 재귀"가 되는데, 그 아래에는 세션마다
 * `.claude/projects/…` 가 통째로 들어 있어 사용자 기계에서 수만 개 디렉터리를 훑게 된다.
 */
export const COWORK_SESSION_DEPTH = 3;

/**
 * 세션 디렉터리 이름인가 — `local-<uuid>` 또는 맨 `<uuid>`.
 *
 * 실측된 이름은 `local-29ba2755-f6ed-4d05-8804-2a075d39eae6` 꼴이다(`local-` 은 "로컬 세션"이라는
 * 뜻이고 클라우드 세션은 애초에 이 기계에 아무것도 남기지 않는다). 접두사 없는 형태도 받아 둔다 —
 * 못 받으면 조용히 0건이 되는 쪽이라, 넓게 받고 **아래 `.claude` 존재로 한 번 더 거르는** 편이 안전하다.
 */
export function isCoworkSessionDirName(name: string): boolean {
  return /^(local-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name);
}

/** 이 Cowork 세션의 **설정 홈** — 우리 훅을 심을 자리이자 세션 JSON·트랜스크립트가 사는 곳. */
export function coworkConfigHome(sessionDir: string): string {
  return join(sessionDir, '.claude');
}

/**
 * 이 Cowork 세션의 작업 디렉터리(cwd).
 *
 * §5.7 #24 (b) cwd-프로젝트 일치 판정이 이 경로를 본다. Cowork 세션의 cwd 는 사용자의 프로젝트
 * 폴더가 아니라 이 `outputs` 라서, **연결된 폴더에서 일해도 프로젝트 버블에는 붙지 않는다** —
 * 그 귀속은 세션 JSON 의 `cwd` 가 아니라 훅 payload 의 `cwd` 가 정한다(호출부 주석 참조).
 */
export function coworkSessionOutputsDir(sessionDir: string): string {
  return join(sessionDir, 'outputs');
}
