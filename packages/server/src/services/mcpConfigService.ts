/**
 * §5.5 #17-20 ⑥ — 스폰되는 claude 세션에 기존 MCP 디버그 서버(`chrome-devtools-mcp` 등)를 연결만 한다(디버거를 만들지 않는다).
 * 레포의 `.mcp.json` 은 쓰지 않는다(커밋되는 사용자 자산 · 켬/끔은 에이전트 단위) — `~/.vibisual/mcp/<해시>.json` 을 `--mcp-config` 로 넘긴다.
 * 해시는 켠 서버 목록에서 나와 같은 조합은 같은 파일을 쓴다.
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

/** 켠 프리셋 id → `--mcp-config` 파일 경로 + `--allowedTools` 패턴. 모르는 id 는 건너뛴다(옛 설정이 스폰을 깨지 않게). 쓸 것이 없거나 못 쓰면 null(평소대로 스폰). */
export interface StdioMcpServer { command: string; args: string[]; env?: Record<string, string> }

export function prepareMcpConfig(serverIds: readonly string[] | undefined, runtimeServers: Readonly<Record<string, StdioMcpServer>> = {}): { configPath: string; allowedTools: string[] } | null {
  if (!serverIds?.length && !Object.keys(runtimeServers).length) return null;

  // 순서가 달라도 같은 조합이면 같은 파일이 되도록 정렬 + 중복 제거.
  const ids = [...new Set(serverIds ?? [])].sort();
  const servers: Record<string, StdioMcpServer> = {};
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

  for (const id of Object.keys(runtimeServers).sort()) {
    const server = runtimeServers[id]!;
    servers[id] = { command: server.command, args: [...server.args], ...(server.env ? { env: { ...server.env } } : {}) };
    if (!allowedTools.includes(`mcp__${id}`)) allowedTools.push(`mcp__${id}`);
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
