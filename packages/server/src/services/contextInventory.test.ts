/**
 * §5.5 #17-28 v4.96 — 주입원 계측·게이트 테스트.
 *
 * 이 기능의 유일한 실패 방식은 **화면과 프롬프트가 다른 말을 하는 것**이라, 여기서 못 박는 것도 그것이다:
 * ① 층 우선순위(세션 > 프로젝트 > 기본), ② 끈 줄은 실제로 빠진다(합계도 함께 줄어든다),
 * ③ 못 끄는 줄은 오버라이드가 있어도 안 꺼진다, ④ 아무것도 안 껐으면 스위치가 하나도 안 나간다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContextOverrides } from '@vibisual/shared';
import { CONTEXT_SOURCE_IDS } from '@vibisual/shared';
import {
  autoMemorySlug,
  buildContextInventory,
  buildSpawnContextSwitches,
  collectInventoryFilePaths,
  isContextSourceOn,
  normalizeFsPath,
  readContextSourceFile,
  scanCommands,
  scanInstructionFiles,
  scanSkills,
  type MeasuredPart,
} from './contextInventory.js';

let root = '';
let home = '';

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-ctx-'));
  home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, '.claude', 'skills', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.claude', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });

  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), '# Project rules\nalways be kind\n', 'utf8');
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# User rules\n', 'utf8');
  fs.writeFileSync(
    path.join(proj, '.claude', 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: does a demo thing\n---\n\n# body that is not injected\n'.repeat(1),
    'utf8',
  );
  fs.writeFileSync(path.join(proj, '.claude', 'commands', 'go.md'), '---\ndescription: go somewhere\n---\nbody\n', 'utf8');
});

afterAll(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 정리 실패는 무시 */ }
});

const projectPath = (): string => path.join(root, 'proj');

function parts(): MeasuredPart[] {
  return [
    { id: CONTEXT_SOURCE_IDS.agentRules, text: 'x'.repeat(100) },
    { id: CONTEXT_SOURCE_IDS.edges, text: '' },
    { id: CONTEXT_SOURCE_IDS.goal, text: 'y'.repeat(40) },
    { id: `plugin:ssot-drift`, text: 'z'.repeat(60), title: 'ssot-drift' },
  ];
}

function build(overrides?: ContextOverrides, subAgentId?: string) {
  return buildContextInventory({
    agentId: 'agent-1',
    ...(subAgentId ? { subAgentId } : {}),
    projectKey: 'proj',
    projectPath: projectPath(),
    cwd: projectPath(),
    parts: parts(),
    ...(overrides ? { overrides } : {}),
    home,
  });
}

describe('scan — 매번 읽어서 만든다', () => {
  it('자동 로드되는 지시 파일을 프로젝트와 사용자 두 자리에서 찾는다', () => {
    const found = scanInstructionFiles(projectPath(), projectPath(), home);
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.every((c) => c.tokens > 0)).toBe(true);
  });

  it('스킬은 프론트매터 설명 줄만 잰다 (본문은 호출될 때 읽히므로)', () => {
    const skills = scanSkills(projectPath(), home);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.chars).toBeLessThan(80); // 파일 전체가 아니라 두 줄 남짓
    expect(skills[0]!.title).toContain('demo');
  });

  it('커맨드도 같은 규칙으로 잰다', () => {
    const cmds = scanCommands(projectPath(), home);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.title).toContain('/go');
  });

  it('자동 기억 폴더 슬러그는 영숫자 아닌 글자를 전부 하이픈으로 바꾼다', () => {
    expect(autoMemorySlug('C:\\Users\\dev\\x')).toBe('C--Users-dev-x'); // privacy-ok — 가상 경로 픽스처
  });
});

describe('inventory — 기본값', () => {
  it('내용이 있는 조각만 기본 켜짐이고, 빈 조각은 꺼짐으로 선다', () => {
    const inv = build();
    const rules = inv.items.find((i) => i.id === CONTEXT_SOURCE_IDS.agentRules)!;
    const edges = inv.items.find((i) => i.id === CONTEXT_SOURCE_IDS.edges)!;
    expect(rules.enabled).toBe(true);
    expect(edges.enabled).toBe(false);
    expect(edges.tokens).toBe(0);
  });

  it('끌 수 없는 줄은 잠긴 성격으로 선다', () => {
    const inv = build();
    expect(inv.items.find((i) => i.id === CONTEXT_SOURCE_IDS.systemPrompt)!.control).toBe('none');
    expect(inv.items.find((i) => i.id === CONTEXT_SOURCE_IDS.toolSchemas)!.control).toBe('external');
    expect(inv.items.find((i) => i.id === CONTEXT_SOURCE_IDS.claudeMd)!.control).toBe('spawn');
  });

  it('합계는 켜진 것만 따로 센다', () => {
    const inv = build();
    expect(inv.enabledTokens).toBeGreaterThan(0);
    expect(inv.totalTokens).toBeGreaterThanOrEqual(inv.enabledTokens);
  });
});

describe('오버라이드 — 여기가 최종', () => {
  const off: ContextOverrides = {
    projects: { proj: { [CONTEXT_SOURCE_IDS.agentRules]: false } },
    sessions: {},
    updatedAt: 1,
  };

  it('프로젝트 층에서 끄면 꺼지고 합계에서도 빠진다', () => {
    const on = build();
    const inv = build(off);
    const rules = inv.items.find((i) => i.id === CONTEXT_SOURCE_IDS.agentRules)!;
    expect(rules.enabled).toBe(false);
    expect(rules.overrideScope).toBe('project');
    expect(inv.enabledTokens).toBeLessThan(on.enabledTokens);
  });

  it('세션 층이 프로젝트 층을 이긴다', () => {
    const both: ContextOverrides = {
      projects: { proj: { [CONTEXT_SOURCE_IDS.agentRules]: false } },
      sessions: { 'sub-1': { [CONTEXT_SOURCE_IDS.agentRules]: true } },
      updatedAt: 1,
    };
    expect(build(both, 'sub-1').items.find((i) => i.id === CONTEXT_SOURCE_IDS.agentRules)!.overrideScope).toBe('session');
    expect(build(both, 'sub-1').items.find((i) => i.id === CONTEXT_SOURCE_IDS.agentRules)!.enabled).toBe(true);
    // 다른 세션은 프로젝트 층을 그대로 따른다.
    expect(build(both, 'sub-2').items.find((i) => i.id === CONTEXT_SOURCE_IDS.agentRules)!.enabled).toBe(false);
  });

  it('끌 수 없는 줄은 오버라이드가 있어도 안 꺼진다 (끌 수 있는 척 ❌)', () => {
    const bogus: ContextOverrides = {
      projects: { proj: { [CONTEXT_SOURCE_IDS.systemPrompt]: false } },
      sessions: {},
      updatedAt: 1,
    };
    const item = build(bogus).items.find((i) => i.id === CONTEXT_SOURCE_IDS.systemPrompt)!;
    expect(item.enabled).toBe(true);
    expect(item.overrideScope).toBeUndefined();
  });

  it('개별 플러그인도 한 줄로 서고 따로 끌 수 있다', () => {
    const inv = build({ projects: { proj: { 'plugin:ssot-drift': false } }, sessions: {}, updatedAt: 1 });
    const p = inv.items.find((i) => i.id === 'plugin:ssot-drift')!;
    expect(p.category).toBe('plugins');
    expect(p.enabled).toBe(false);
  });
});

describe('spawn 스위치 — 끈 것만 나간다', () => {
  it('아무것도 안 껐으면 인자도 환경변수도 없다 (종전과 동일한 스폰)', () => {
    expect(buildSpawnContextSwitches(undefined, { projectKey: 'proj' })).toEqual({ args: [], env: {} });
    const noop: ContextOverrides = { projects: { proj: {} }, sessions: {}, updatedAt: 1 };
    expect(buildSpawnContextSwitches(noop, { projectKey: 'proj' })).toEqual({ args: [], env: {} });
  });

  it('CLAUDE.md 를 끄면 환경변수가, 스킬을 끄면 CLI 인자가 나간다', () => {
    const o: ContextOverrides = {
      projects: { proj: { [CONTEXT_SOURCE_IDS.claudeMd]: false, [CONTEXT_SOURCE_IDS.slashCommands]: false } },
      sessions: {},
      updatedAt: 1,
    };
    const sw = buildSpawnContextSwitches(o, { projectKey: 'proj' });
    expect(sw.env['CLAUDE_CODE_DISABLE_CLAUDE_MDS']).toBe('1');
    expect(sw.args).toContain('--disable-slash-commands');
  });

  it('세션 층이 프로젝트 층을 이겨 다시 켤 수 있다', () => {
    const o: ContextOverrides = {
      projects: { proj: { [CONTEXT_SOURCE_IDS.autoMemory]: false } },
      sessions: { 'sub-1': { [CONTEXT_SOURCE_IDS.autoMemory]: true } },
      updatedAt: 1,
    };
    expect(buildSpawnContextSwitches(o, { projectKey: 'proj' }).env['CLAUDE_CODE_DISABLE_AUTO_MEMORY']).toBe('1');
    expect(buildSpawnContextSwitches(o, { projectKey: 'proj', subAgentId: 'sub-1' }).env).toEqual({});
  });
});

describe('§5.5 #17-28 ⑦ 상세창 — 지금 실리는 파일만 열린다', () => {
  it('인벤토리의 자식 파일 경로를 모두 모은다', () => {
    const allowed = collectInventoryFilePaths(build());
    expect(allowed.has(normalizeFsPath(path.join(projectPath(), 'CLAUDE.md')))).toBe(true);
    expect(allowed.has(normalizeFsPath(path.join(home, '.claude', 'CLAUDE.md')))).toBe(true);
    expect(allowed.has(normalizeFsPath(path.join(projectPath(), '.claude', 'skills', 'demo', 'SKILL.md')))).toBe(true);
  });

  it('목록에 있는 파일은 그 내용을 그대로 돌려준다', () => {
    const allowed = collectInventoryFilePaths(build());
    const read = readContextSourceFile(path.join(projectPath(), 'CLAUDE.md'), allowed, 10_000);
    expect(read?.text).toContain('always be kind');
    expect(read?.truncated).toBe(false);
  });

  it('상한을 넘으면 앞부분만 담되 글자 수는 전체를 말한다', () => {
    const allowed = collectInventoryFilePaths(build());
    const read = readContextSourceFile(path.join(projectPath(), 'CLAUDE.md'), allowed, 5);
    expect(read?.text.length).toBe(5);
    expect(read?.truncated).toBe(true);
    expect(read?.chars).toBeGreaterThan(5);
  });

  it('목록에 없는 파일은 존재해도 열지 않는다 — 아무 파일이나 읽는 창구가 아니다', () => {
    const outsider = path.join(root, 'secret.txt');
    fs.writeFileSync(outsider, 'do not read me', 'utf8');
    const allowed = collectInventoryFilePaths(build());
    expect(readContextSourceFile(outsider, allowed, 10_000)).toBeNull();
  });
});

describe('게이트 — 프롬프트 경로가 쓰는 판정', () => {
  it('오버라이드가 없으면 기본값을 그대로 따른다', () => {
    expect(isContextSourceOn(undefined, { projectKey: 'proj' }, CONTEXT_SOURCE_IDS.goal)).toBe(true);
    expect(isContextSourceOn(undefined, { projectKey: 'proj' }, CONTEXT_SOURCE_IDS.goal, false)).toBe(false);
  });

  it('다른 프로젝트의 오버라이드는 이 프로젝트에 새지 않는다', () => {
    const o: ContextOverrides = {
      projects: { other: { [CONTEXT_SOURCE_IDS.goal]: false } },
      sessions: {},
      updatedAt: 1,
    };
    expect(isContextSourceOn(o, { projectKey: 'proj' }, CONTEXT_SOURCE_IDS.goal)).toBe(true);
    expect(isContextSourceOn(o, { projectKey: 'other' }, CONTEXT_SOURCE_IDS.goal)).toBe(false);
  });
});
