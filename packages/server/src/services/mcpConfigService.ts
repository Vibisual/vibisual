/**
 * §5.5 #17-20 ⑥ v4.74 — 에이전트에 MCP 디버그 도구를 꽂아 주는 층.
 *
 * 우리는 디버거를 만들지 않는다. 이미 있는 MCP 서버(`@debugmcp/mcp-debugger`,
 * `chrome-devtools-mcp`, 언리얼 MCP, LLDB MCP)를 **스폰되는 claude 세션에 연결만** 해 준다.
 *
 * 왜 사용자 레포의 `.mcp.json` 을 쓰지 않는가:
 *   - 그 파일은 사용자 저장소에 커밋되는 자산이다. 우리가 임의로 쓰면 공개 저장소를 오염시킨다.
 *   - 켬/끔은 **에이전트 단위**(`AgentConfig.mcpServers`)라 레포 단위 파일과 축이 다르다.
 * 그래서 `~/.vibisual/mcp/<해시>.json` 에 우리 것만 쓰고 CLI 에 `--mcp-config` 로 건넨다.
 * 해시는 켠 서버 목록에서 나오므로 같은 조합은 같은 파일을 재사용한다(스폰마다 쓰지 않는다).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findMcpPreset } from '@vibisual/shared';

import { logger } from '../logger.js';

/** 생성 파일이 사는 곳 — 사용자 레포 밖(`~/.vibisual`), CMD rules 폴더와 같은 자리. */
function mcpDir(): string {
  return path.join(os.homedir(), '.vibisual', 'mcp');
}

/**
 * 켠 프리셋 id 목록 → `--mcp-config` 에 넘길 파일 경로 + `--allowedTools` 에 넣을 도구 패턴.
 *
 * 알 수 없는 id 는 조용히 건너뛴다 — 옛 설정에 남은 id 가 스폰 자체를 깨뜨리면 안 된다.
 * 쓸 것이 하나도 없거나 파일을 못 쓰면 null(=MCP 인자 없이 평소대로 스폰).
 */
export function prepareMcpConfig(serverIds: readonly string[] | undefined): { configPath: string; allowedTools: string[] } | null {
  if (!serverIds || serverIds.length === 0) return null;

  // 순서가 달라도 같은 조합이면 같은 파일이 되도록 정렬 + 중복 제거.
  const ids = [...new Set(serverIds)].sort();
  const servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  const allowedTools: string[] = [];

  for (const id of ids) {
    const preset = findMcpPreset(id);
    if (!preset) continue;
    servers[preset.id] = {
      command: preset.command,
      args: [...preset.args],
      ...(preset.env ? { env: { ...preset.env } } : {}),
    };
    // 서버 이름만 주면 그 서버의 도구 전체가 열린다 — 도구 하나하나를 열거하면 서버가
    // 도구를 늘릴 때마다 우리가 따라가야 한다.
    allowedTools.push(`mcp__${preset.id}`);
  }

  if (Object.keys(servers).length === 0) return null;

  const body = JSON.stringify({ mcpServers: servers }, null, 2);
  const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12);
  const dir = mcpDir();
  const configPath = path.join(dir, `${hash}.json`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    // 같은 내용이면 다시 쓰지 않는다(스폰마다 디스크를 건드리지 않게).
    let current: string | null = null;
    try {
      current = fs.readFileSync(configPath, 'utf8');
    } catch {
      current = null;
    }
    if (current !== body) fs.writeFileSync(configPath, body, 'utf8');
    return { configPath, allowedTools };
  } catch (err) {
    logger.warn(`[mcp-config] write failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
