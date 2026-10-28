import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AgentMemoryScope } from '@vibisual/shared';
import { logger } from '../logger.js';

/**
 * §5.3 — 에이전트 자기 기억·Fast·Thinking 을 실은 스폰 설정 파일 한 장의 단일 창구. 헤드리스 `claude -p`(주 스레드)는 서브에이전트 `memory:`
 * 프론트매터가 아니라 `autoMemoryDirectory` 로 에이전트마다 기억을 가른다. `--settings` 는 사용자 설정과는 병합되지만 두 번 주면 뒤엣것이 통째로 덮는다(실측) —
 * 키마다 파일을 나누지 말고 `SettingsBody` 에 한 줄 더한다. Fast(`fastMode`)는 헤드리스에서 이 `flagSettings` 층 opt-in 만 인정된다.
 * Fast 는 켤 때만, 사고(`alwaysThinkingEnabled`)는 끌 때만 키를 만든다 — 사용자 settings 값을 덮지 않는다.
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
  home = os.homedir(),
): string | null {
  const seg = safeSegment(agentName);
  if (scope === 'user') return path.join(home, '.claude', 'agent-memory', seg);
  if (!projectRoot) return null; // 프로젝트 범위인데 루트를 모르면 아무것도 하지 않는다.
  const dirName = scope === 'local' ? 'agent-memory-local' : 'agent-memory';
  return path.join(projectRoot, '.claude', dirName, seg);
}

/**
 * §5.10 (O) — 화면·주입원 표가 묻는 이 에이전트의 자동 기억 폴더. `undefined`/`'off'` 면 `undefined`(기본은 레포 공용 폴더, 끔은 폴더 없음).
 * 나머지는 `resolveAgentMemoryDir` 와 같은 답이어야 한다 — 따로 조립하면 화면이 엉뚱한 폴더를 센다.
 */
export function resolveAgentMemoryDirOverride(
  memory: AgentMemoryScope | undefined,
  agentName: string,
  projectRoot: string | undefined,
  home = os.homedir(),
): string | undefined {
  if (!memory || memory === 'off') return undefined;
  return resolveAgentMemoryDir(memory, agentName, projectRoot, home) ?? undefined;
}

export interface AgentSettingsPlan {
  /** `--settings` 로 넘길 파일 경로. 담을 키가 하나도 없으면 없다. */
  settingsPath?: string;
  /** 스폰 env 에 얹을 항목. 기억 `'off'` 면 자동 기억을 끄는 변수 한 줄. */
  env?: Record<string, string>;
}

/** 이 에이전트를 위해 조립할 settings 키들. 한 장으로 합쳐 나간다. */
interface SettingsBody {
  /** §5.3 — 이 에이전트 전용 자동 기억 폴더. */
  autoMemoryDirectory?: string;
  /** §4 (Fast 모드) — 헤드리스 스폰이 Fast 를 쓰려면 반드시 이 층에 있어야 하는 opt-in. */
  fastMode?: boolean;
  /** §4 (Thinking on/off) — 확장 사고를 끄는 유일한 창구. 키가 없거나 true 면 지원 모델에서 자동으로 켜지므로(설치본 스키마) 끌 때만 `false` 를 적는다. */
  alwaysThinkingEnabled?: boolean;
}

export interface AgentSettingsInput {
  /** `AgentConfig.memory` — undefined 면 기억 쪽은 아무것도 하지 않는다(레포 공용 기억 유지). */
  memory?: AgentMemoryScope;
  /** `AgentConfig.fastMode` — true 일 때만 키가 실린다. */
  fastMode?: boolean;
  /** `AgentConfig.thinking` — **false 일 때만** 키가 실린다(undefined/true = 켬 = 무개입). */
  thinking?: boolean;
  /** 기억 폴더 이름이 될 에이전트 식별자. */
  agentName: string;
  /** 프로젝트 루트(= 스폰 cwd). `'project'`/`'local'` 범위에서만 쓰인다. */
  projectRoot?: string;
}

/** `null` 이면 아무것도 붙이지 않는다. 파일을 못 써도 `null` — 설정 파일 실패가 스폰을 막으면 안 된다. */
export function prepareAgentSettings(input: AgentSettingsInput): AgentSettingsPlan | null {
  const { memory, fastMode, thinking, agentName, projectRoot } = input;
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

  // 사고는 **반대 방향의 같은 규율**이다 — 기본이 켬이라 껐을 때만 키를 만든다.
  //   켬일 때 `true` 를 써 넣으면 사용자가 자기 `~/.claude/settings.json` 에서 꺼 둔 것을
  //   우리가 조용히 되켜는 셈이 된다(그쪽이 우리 화면에는 보이지 않는 층이라 더 나쁘다).
  if (thinking === false) body.alwaysThinkingEnabled = false;

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
