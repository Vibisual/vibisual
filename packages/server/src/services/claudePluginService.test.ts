/**
 * §5.5 #17-33 — CLI 출력 → 인벤토리 변환 테스트.
 *
 * 이 층이 깨지면 목록이 통째로 비는데, 화면에서 그것은 **"플러그인이 없다"와 구별되지 않는다**.
 * 그래서 진짜 `claude plugin list --json --available` 이 뱉은 모양(실측 2026-08-19, CLI 2.1.235)
 * 그대로 고정한다 — 필드 이름 하나가 바뀌면 여기서 먼저 터진다.
 */
import { describe, expect, it } from 'vitest';

import { parsePluginListOutput } from './claudePluginService.js';

const HERE = 'C:\\work\\projects\\vibisual';

/** 실측 출력의 모양 그대로(필드 구성·경로 생김새). 경로 문자열만 가공값으로 바꿨다. */
const REAL_OUTPUT = JSON.stringify({
  installed: [
    {
      id: 'claude-code-harness@claude-code-harness-marketplace',
      version: '3.17.1',
      scope: 'user',
      enabled: false,
      installPath: 'C:\\work\\home\\.claude\\plugins\\cache\\claude-code-harness-marketplace\\claude-code-harness\\3.17.1',
      installedAt: '2026-04-09T03:02:21.985Z',
      lastUpdated: '2026-04-09T03:02:21.985Z',
    },
    {
      id: 'code-review@claude-plugins-official',
      version: 'unknown',
      scope: 'project',
      enabled: false,
      installPath: 'C:\\work\\home\\.claude\\plugins\\cache\\claude-plugins-official\\code-review\\unknown',
      installedAt: '2026-03-29T06:03:50.840Z',
      lastUpdated: '2026-04-20T06:08:43.966Z',
      // 실측: 드라이브 문자가 소문자다. 정규화가 없으면 이 줄이 엉뚱한 묶음으로 간다.
      projectPath: 'c:\\work\\projects\\other-app',
    },
    {
      id: 'mine@claude-plugins-official',
      version: '1.0.0',
      scope: 'project',
      enabled: true,
      projectPath: HERE,
    },
  ],
  available: [
    {
      pluginId: '42crunch-api-security-testing@claude-plugins-official',
      name: '42crunch-api-security-testing',
      description: 'Automate API security directly in Claude Code',
      marketplaceName: 'claude-plugins-official',
      source: { source: 'git-subdir', url: 'https://github.com/x/y.git' },
      installCount: 2575,
    },
    {
      pluginId: 'mine@claude-plugins-official',
      name: 'mine',
      marketplaceName: 'claude-plugins-official',
      installCount: 10,
    },
    {
      pluginId: 'harness@claude-code-harness-marketplace',
      name: 'harness',
      marketplaceName: 'claude-code-harness-marketplace',
      installCount: 99999,
    },
  ],
});

describe('parsePluginListOutput', () => {
  it('설치본을 자리별로 갈라 세운다 — 글로벌 / 이 프로젝트 / 다른 프로젝트', () => {
    const inv = parsePluginListOutput(REAL_OUTPUT, HERE);
    expect(inv.installed).toHaveLength(3);

    const byId = Object.fromEntries(inv.installed.map((p) => [p.id, p]));
    expect(byId['claude-code-harness@claude-code-harness-marketplace']?.placement).toBe('global');
    // 소문자 드라이브라도 남의 프로젝트는 남의 프로젝트다.
    expect(byId['code-review@claude-plugins-official']?.placement).toBe('other-project');
    expect(byId['mine@claude-plugins-official']?.placement).toBe('this-project');
  });

  it('id 에서 이름과 마켓을 갈라 준다', () => {
    const inv = parsePluginListOutput(REAL_OUTPUT, HERE);
    const harness = inv.installed.find((p) => p.id.startsWith('claude-code-harness@'));
    expect(harness?.name).toBe('claude-code-harness');
    expect(harness?.marketplace).toBe('claude-code-harness-marketplace');
  });

  it('켜짐은 CLI 의 enabled 를 그대로 따른다 — 깔림과 켜짐은 다르다', () => {
    const inv = parsePluginListOutput(REAL_OUTPUT, HERE);
    // 실측에서 깔린 7개가 전부 꺼져 있었다. 이 둘을 뭉개면 화면이 거짓말을 한다.
    expect(inv.installed.filter((p) => p.enabled).map((p) => p.id)).toEqual(['mine@claude-plugins-official']);
  });

  it('마켓 줄은 설치 여부를 달고, 많이 쓰는 것부터 선다', () => {
    const inv = parsePluginListOutput(REAL_OUTPUT, HERE);
    expect(inv.market.map((p) => p.name)).toEqual(['harness', '42crunch-api-security-testing', 'mine']);
    expect(inv.market.find((p) => p.name === 'mine')?.installed).toBe(true);
    expect(inv.market.find((p) => p.name === 'harness')?.installed).toBe(false);
  });

  it('마켓플레이스 목록은 available 을 접어서 센다 — CLI 를 또 부르지 않는다', () => {
    const inv = parsePluginListOutput(REAL_OUTPUT, HERE);
    expect(inv.marketplaces).toEqual([
      { name: 'claude-plugins-official', pluginCount: 2 },
      { name: 'claude-code-harness-marketplace', pluginCount: 1 },
    ]);
  });

  it('--available 없이 부른 배열 모양도 받는다(CLI 판본이 갈려도 안 깨지게)', () => {
    const arrayOnly = JSON.stringify([
      { id: 'a@m', version: '1', scope: 'user', enabled: true },
    ]);
    const inv = parsePluginListOutput(arrayOnly, HERE);
    expect(inv.installed).toHaveLength(1);
    expect(inv.installed[0]?.placement).toBe('global');
    expect(inv.market).toEqual([]);
  });

  it('앞뒤에 경고 한 줄이 섞여도 본문만 읽는다', () => {
    const noisy = `warning: something\n${REAL_OUTPUT}\n`;
    expect(parsePluginListOutput(noisy, HERE).installed).toHaveLength(3);
  });

  it('id 가 없는 칸은 줄을 세우지 않는다', () => {
    const bad = JSON.stringify({ installed: [{ scope: 'user' }, null, 'nope'], available: [] });
    expect(parsePluginListOutput(bad, HERE).installed).toEqual([]);
  });

  it('읽을 수 없는 출력은 빈 목록이 아니라 사유를 남긴다', () => {
    const inv = parsePluginListOutput('not json at all', HERE);
    expect(inv.unavailable).toBeTruthy();
    expect(inv.installed).toEqual([]);
  });

  it('모르는 scope 는 글로벌로 떨어뜨린다 — 목록에서 사라지지 않게', () => {
    const odd = JSON.stringify({ installed: [{ id: 'x@m', scope: 'weird', enabled: false }], available: [] });
    const inv = parsePluginListOutput(odd, HERE);
    expect(inv.installed[0]?.scope).toBe('user');
    expect(inv.installed[0]?.placement).toBe('global');
  });
});
