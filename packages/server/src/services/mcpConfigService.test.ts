/** §5.5 #17-20 ⑥ — MCP 연결 층 시험: 켠 것이 없으면 인자 무변경 · 모르는 id 무해 · 우리 폴더에만 쓰기 · 같은 조합은 같은 파일. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MCP_SERVER_PRESETS } from '@vibisual/shared';

import { prepareMcpConfig } from './mcpConfigService.js';

const firstPreset = MCP_SERVER_PRESETS[0];

describe('prepareMcpConfig', () => {
  it('켠 것이 없으면 null — 스폰 인자에 아무것도 더하지 않는다', () => {
    expect(prepareMcpConfig(undefined)).toBeNull();
    expect(prepareMcpConfig([])).toBeNull();
  });

  it('모르는 id 뿐이면 null (옛 설정이 스폰을 깨뜨리지 않는다)', () => {
    expect(prepareMcpConfig(['no-such-server'])).toBeNull();
  });

  it('아는 것만 골라 파일에 쓰고 도구 패턴을 돌려준다', () => {
    expect(firstPreset).toBeDefined();
    const result = prepareMcpConfig([firstPreset!.id, 'no-such-server']);
    expect(result).not.toBeNull();
    expect(result!.allowedTools).toEqual([`mcp__${firstPreset!.id}`]);

    const body = JSON.parse(fs.readFileSync(result!.configPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(Object.keys(body.mcpServers)).toEqual([firstPreset!.id]);
    expect(body.mcpServers[firstPreset!.id]?.command).toBe(firstPreset!.command);
    expect(body.mcpServers).not.toHaveProperty('no-such-server');
  });

  it('사용자 레포가 아니라 `~/.vibisual/mcp` 아래에만 쓴다', () => {
    const result = prepareMcpConfig([firstPreset!.id]);
    const expectedDir = path.join(os.homedir(), '.vibisual', 'mcp');
    expect(path.dirname(result!.configPath)).toBe(expectedDir);
  });

  it('순서가 달라도 같은 조합이면 같은 파일을 재사용한다', () => {
    if (MCP_SERVER_PRESETS.length < 2) return;
    const a = MCP_SERVER_PRESETS[0]!.id;
    const b = MCP_SERVER_PRESETS[1]!.id;
    const first = prepareMcpConfig([a, b]);
    const second = prepareMcpConfig([b, a]);
    expect(first!.configPath).toBe(second!.configPath);
    // 중복을 넣어도 같은 결과.
    expect(prepareMcpConfig([a, b, a])!.configPath).toBe(first!.configPath);
  });
});
