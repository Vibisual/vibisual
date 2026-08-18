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
 * `--settings` 는 계층을 **병합**하므로(§5.10 v3.76 에서 확인) 이 파일 한 장으로 사용자 설정을
 * 지우지 않고 기억 폴더만 바꿔 끼울 수 있다. `prepareMcpConfig` 와 같은 방식(내용 해시 파일명 +
 * 같은 내용이면 다시 쓰지 않음)이라 새 인프라를 들이지 않는다.
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

export interface AgentMemoryPlan {
  /** `--settings` 로 넘길 파일 경로. `'off'` 면 없다. */
  settingsPath?: string;
  /** 스폰 env 에 얹을 항목. `'off'` 면 자동 기억을 끄는 변수 한 줄. */
  env?: Record<string, string>;
}

/**
 * 이 에이전트의 기억 설정을 준비한다.
 *
 * 반환이 `null` 이면 **아무것도 하지 않는다**(= 기본 동작인 레포 공용 기억 유지). 파일을 못 쓰는
 * 경우에도 `null` 을 돌려 스폰 자체는 평소대로 되게 한다 — 기억 설정 실패가 작업을 막으면 안 된다.
 */
export function prepareAgentMemory(
  scope: AgentMemoryScope | undefined,
  agentName: string,
  projectRoot: string | undefined,
): AgentMemoryPlan | null {
  if (!scope) return null;

  if (scope === 'off') {
    return { env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } };
  }

  const dir = resolveAgentMemoryDir(scope, agentName, projectRoot);
  if (!dir) return null;

  const body = JSON.stringify({ autoMemoryDirectory: dir }, null, 2);
  const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12);
  const settingsPath = path.join(memorySettingsDir(), `${hash}.json`);

  try {
    fs.mkdirSync(memorySettingsDir(), { recursive: true });
    // 기억 폴더 자체도 미리 만들어 둔다 — 첫 세션이 "폴더 없음"으로 아무것도 못 쓰는 일 방지.
    fs.mkdirSync(dir, { recursive: true });

    let current: string | null = null;
    try {
      current = fs.readFileSync(settingsPath, 'utf8');
    } catch {
      current = null;
    }
    if (current !== body) fs.writeFileSync(settingsPath, body, 'utf8');
    return { settingsPath };
  } catch (err) {
    logger.warn(`[agent-memory] write failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
