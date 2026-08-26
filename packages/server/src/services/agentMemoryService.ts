import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AgentMemoryScope } from '@vibisual/shared';
import { logger } from '../logger.js';

/**
 * §5.3 v4.89 — 커스텀 에이전트의 **자기 기억** 배선.
 *
 * `AgentConfig.memory` 는 v4.89 이전까지 타입에만 있고 아무도 읽지 않는 죽은 필드였다. Claude Code
 * 의 서브에이전트 `memory:` 프론트매터와 같은 뜻을 우리 스폰 경로(헤드리스 `claude -p` = **주 스레드**)
 * 에서 내려면, 프론트매터가 아니라 `autoMemoryDirectory` 설정을 에이전트마다 다르게 줘야 한다.
 *
 * `--settings` 로 들어간 값은 사용자 설정 계층과 **병합**되므로 이 파일 한 장으로 사용자 설정을
 * 지우지 않고 필요한 키만 바꿔 끼울 수 있다. `prepareMcpConfig` 와 같은 방식(내용 해시 파일명 +
 * 같은 내용이면 다시 쓰지 않음)이라 새 인프라를 들이지 않는다.
 *
 * §4 (Fast 모드) — 이 파일이 기억 전용이 아니게 된 이유.
 *   Fast 모드는 CLI 플래그가 없고 settings 키(`fastMode`)로만 켜지는데, 헤드리스 스폰은 CLI 가
 *   Agent SDK 세션으로 분류해 **`--settings` 가 만드는 `flagSettings` 층으로 들어온 opt-in 만**
 *   인정한다. 그런데 `--settings` 는 **두 번 주면 병합이 아니라 뒤엣것이 앞엣것을 통째로 덮는다**
 *   (실측). 그래서 기억용 한 장 + Fast 용 한 장으로 나눌 수 없고, 이 모듈이 **설정 파일 한 장을
 *   조립하는 단일 창구**가 된다. 새 settings 키가 필요해지면 여기 `SettingsBody` 에 한 줄 더한다.
 */

/** 생성 파일이 사는 곳 — 사용자 레포 밖(`~/.vibisual`), MCP 생성 파일과 같은 자리. */
function memorySettingsDir(): string {
  return path.join(os.homedir(), '.vibisual', 'agent-memory-settings');
}

/** 폴더 이름으로 쓸 수 있게 좁힌다 — 경로 구분자·상위 이동(..)을 지운다. */
function safeSegment(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 64);
  return cleaned || 'agent';
}

/**
 * 범위 → 기억 폴더 절대경로. Claude Code 서브에이전트 문서의 `memory` 스코프 배치를 그대로 따른다.
 * `'off'` 는 폴더가 없다(자동 기억을 끄는 쪽이라 호출부가 환경변수로 처리).
 */
export function resolveAgentMemoryDir(
  scope: Exclude<AgentMemoryScope, 'off'>,
  agentName: string,
  projectRoot: string | undefined,
): string | null {
  const seg = safeSegment(agentName);
  if (scope === 'user') return path.join(os.homedir(), '.claude', 'agent-memory', seg);
  if (!projectRoot) return null; // 프로젝트 범위인데 루트를 모르면 아무것도 하지 않는다.
  const dirName = scope === 'local' ? 'agent-memory-local' : 'agent-memory';
  return path.join(projectRoot, '.claude', dirName, seg);
}

export interface AgentSettingsPlan {
  /** `--settings` 로 넘길 파일 경로. 담을 키가 하나도 없으면 없다. */
  settingsPath?: string;
  /** 스폰 env 에 얹을 항목. 기억 `'off'` 면 자동 기억을 끄는 변수 한 줄. */
  env?: Record<string, string>;
}

/** 이 에이전트를 위해 조립할 settings 키들. 한 장으로 합쳐 나간다. */
interface SettingsBody {
  /** §5.3 v4.89 — 이 에이전트 전용 자동 기억 폴더. */
  autoMemoryDirectory?: string;
  /** §4 (Fast 모드) — 헤드리스 스폰이 Fast 를 쓰려면 반드시 이 층에 있어야 하는 opt-in. */
  fastMode?: boolean;
}

export interface AgentSettingsInput {
  /** `AgentConfig.memory` — undefined 면 기억 쪽은 아무것도 하지 않는다(레포 공용 기억 유지). */
  memory?: AgentMemoryScope;
  /** `AgentConfig.fastMode` — true 일 때만 키가 실린다. */
  fastMode?: boolean;
  /** 기억 폴더 이름이 될 에이전트 식별자. */
  agentName: string;
  /** 프로젝트 루트(= 스폰 cwd). `'project'`/`'local'` 범위에서만 쓰인다. */
  projectRoot?: string;
}

/**
 * 이 에이전트의 설정 파일(+env)을 준비한다.
 *
 * 반환이 `null` 이면 **아무것도 하지 않는다**(= 종전 동작 그대로). 파일을 못 쓰는 경우에도 `null` 을
 * 돌려 스폰 자체는 평소대로 되게 한다 — 설정 파일 실패가 작업을 막으면 안 된다.
 */
export function prepareAgentSettings(input: AgentSettingsInput): AgentSettingsPlan | null {
  const { memory, fastMode, agentName, projectRoot } = input;
  const body: SettingsBody = {};
  const env: Record<string, string> = {};

  if (memory === 'off') {
    env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'] = '1';
  } else if (memory) {
    const dir = resolveAgentMemoryDir(memory, agentName, projectRoot);
    // 프로젝트 범위인데 루트를 모르면 기억 쪽만 건너뛴다 — Fast 는 그와 무관하게 실릴 수 있어야 한다.
    if (dir) body.autoMemoryDirectory = dir;
  }

  // Fast 는 켰을 때만 키를 만든다. false 를 명시로 써 넣으면 사용자 설정의 true 를 덮어 버린다.
  if (fastMode) body.fastMode = true;

  const hasEnv = Object.keys(env).length > 0;
  if (Object.keys(body).length === 0) return hasEnv ? { env } : null;

  const serialized = JSON.stringify(body, null, 2);
  const hash = crypto.createHash('sha1').update(serialized).digest('hex').slice(0, 12);
  const settingsPath = path.join(memorySettingsDir(), `${hash}.json`);

  try {
    fs.mkdirSync(memorySettingsDir(), { recursive: true });
    // 기억 폴더 자체도 미리 만들어 둔다 — 첫 세션이 "폴더 없음"으로 아무것도 못 쓰는 일 방지.
    if (body.autoMemoryDirectory) fs.mkdirSync(body.autoMemoryDirectory, { recursive: true });

    let current: string | null = null;
    try {
      current = fs.readFileSync(settingsPath, 'utf8');
    } catch {
      current = null;
    }
    if (current !== serialized) fs.writeFileSync(settingsPath, serialized, 'utf8');
    return hasEnv ? { settingsPath, env } : { settingsPath };
  } catch (err) {
    logger.warn(`[agent-settings] write failed: ${err instanceof Error ? err.message : String(err)}`);
    return hasEnv ? { env } : null;
  }
}
