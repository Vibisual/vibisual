/**
 * §4 (도구 목록 템플릿) — shared `agentToolTemplates.ts` 의 목록 규약과 선택 판정 고정 시험.
 *
 * shared 에는 러너가 없어 그 목록을 쓰는 화면(에이전트 설정 창) 옆에서 돌린다.
 * 이 목록이 틀리는 방향은 조용하다 — 템플릿에 `AVAILABLE_AGENT_TOOLS` 밖 이름이 끼면 CLI 가 모르는
 * 도구를 받고, 읽기 전용에 쓰기 도구가 끼면 이름과 달리 파일을 고친다. 둘 다 화면에는 멀쩡히 보인다.
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_TOOL_TEMPLATE_CUSTOM,
  AGENT_TOOL_TEMPLATES,
  AVAILABLE_AGENT_TOOLS,
  DEFAULT_AGENT_CONFIG,
  findAgentToolTemplate,
  matchAgentToolTemplate,
  resolveAgentToolTemplate,
} from '@vibisual/shared';

const locales = import.meta.glob('../../i18n/locales/*.json', { import: 'default', eager: true }) as Record<string, {
  panel: { agentConfig: { toolTemplate?: Record<string, unknown> } };
}>;

const WRITES = ['Write', 'Edit', 'NotebookEdit'];
const SHELLS = ['Bash', 'PowerShell'];
// 스키마를 불러와야 부를 수 있는 설치본이 있는 도구 — 이 중 하나라도 실으면 ToolSearch 를 함께 싣는다.
const DEFERRED = ['WebSearch', 'WebFetch', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'Agent', 'ListAgents', 'SendMessage', 'TaskOutput', 'TaskStop'];

function tmpl(id: string): readonly string[] {
  const found = findAgentToolTemplate(id);
  if (!found) throw new Error(`template ${id} missing`);
  return found.tools;
}

describe('AGENT_TOOL_TEMPLATES — 목록 규약', () => {
  it('id 는 겹치지 않고 커스텀 자리를 쓰지 않는다', () => {
    const ids = AGENT_TOOL_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(AGENT_TOOL_TEMPLATE_CUSTOM);
  });

  it('모든 목록은 AVAILABLE_AGENT_TOOLS 의 부분집합이며 그 순서를 따르고 중복이 없다', () => {
    for (const t of AGENT_TOOL_TEMPLATES) {
      expect(t.tools.length).toBeGreaterThan(0);
      expect(new Set(t.tools).size).toBe(t.tools.length);
      for (const tool of t.tools) expect(AVAILABLE_AGENT_TOOLS).toContain(tool);
      const idx = t.tools.map((tool) => AVAILABLE_AGENT_TOOLS.indexOf(tool));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  it('두 템플릿이 같은 집합이면 선택기가 뒤의 것을 영영 못 보여 준다', () => {
    const keys = AGENT_TOOL_TEMPLATES.map((t) => [...t.tools].sort().join(','));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('셸은 쌍으로 싣는다 — 한쪽만 실으면 OS 에 따라 명령을 못 돌린다', () => {
    for (const t of AGENT_TOOL_TEMPLATES) {
      const has = SHELLS.map((s) => t.tools.includes(s));
      expect(has[0]).toBe(has[1]);
    }
  });

  it('지연 로딩 도구를 싣는 템플릿은 ToolSearch 를 함께 싣는다', () => {
    for (const t of AGENT_TOOL_TEMPLATES) {
      if (t.tools.some((tool) => DEFERRED.includes(tool))) expect(t.tools).toContain('ToolSearch');
    }
  });

  it('읽기 전용은 쓰기·실행이 없고, 리뷰·웹 조사·조율자는 파일 쓰기 도구가 없다', () => {
    for (const tool of [...WRITES, ...SHELLS]) expect(tmpl('readOnly')).not.toContain(tool);
    for (const id of ['review', 'research', 'orchestrate']) {
      for (const tool of WRITES) expect(tmpl(id)).not.toContain(tool);
    }
    expect(tmpl('research')).not.toContain('Bash');
    expect(tmpl('docs')).not.toContain('Bash');
  });

  it('구현 작업은 읽기·쓰기·실행을 모두 갖고, 위임은 조율자에게만 있다', () => {
    for (const tool of ['Read', 'Write', 'Edit', 'Bash', 'PowerShell']) expect(tmpl('implement')).toContain(tool);
    expect(tmpl('implement')).not.toContain('Agent');
    expect(tmpl('orchestrate')).toContain('Agent');
  });

  it('전체 템플릿은 새 에이전트의 기본값과 같은 집합이다 — 기본 설정을 열면 "전체 도구"로 보인다', () => {
    expect(matchAgentToolTemplate(DEFAULT_AGENT_CONFIG.tools)).toBe('all');
  });
});

describe('matchAgentToolTemplate / resolveAgentToolTemplate — 선택 판정', () => {
  it('순서·중복과 무관하게 같은 집합이면 그 템플릿이다', () => {
    expect(matchAgentToolTemplate(['LSP', 'Grep', 'Read', 'Glob', 'Read'])).toBe('readOnly');
    expect(matchAgentToolTemplate(['Read', 'Glob'])).toBeNull();
    expect(matchAgentToolTemplate([])).toBeNull();
  });

  it('아직 안 골랐으면 목록만 보고 계산한다', () => {
    expect(resolveAgentToolTemplate([...tmpl('review')], undefined)).toBe('review');
    expect(resolveAgentToolTemplate(['Read'], undefined)).toBe(AGENT_TOOL_TEMPLATE_CUSTOM);
  });

  it('커스텀을 골랐으면 목록이 우연히 템플릿과 같아도 커스텀으로 남는다', () => {
    expect(resolveAgentToolTemplate([...tmpl('readOnly')], AGENT_TOOL_TEMPLATE_CUSTOM)).toBe(AGENT_TOOL_TEMPLATE_CUSTOM);
  });

  it('템플릿을 고른 뒤 칩을 하나 고치면 그 템플릿이 아니다', () => {
    expect(resolveAgentToolTemplate([...tmpl('docs')], 'docs')).toBe('docs');
    expect(resolveAgentToolTemplate(tmpl('docs').filter((t) => t !== 'Edit'), 'docs')).toBe(AGENT_TOOL_TEMPLATE_CUSTOM);
  });

  it('고른 템플릿과 달라졌지만 다른 템플릿과 같아지면 그쪽으로 보인다', () => {
    const intoReadOnly = tmpl('review').filter((t) => !SHELLS.includes(t));
    expect(resolveAgentToolTemplate(intoReadOnly, 'review')).toBe('readOnly');
  });

  it('모르는 pick 은 목록으로 계산한다', () => {
    expect(resolveAgentToolTemplate([...tmpl('all')], 'gone')).toBe('all');
  });
});

describe('도구 템플릿 문자열 — 동적 키라 정적 스캔에 안 잡힌다', () => {
  it('12개 로케일 모두 템플릿마다 이름·설명이 있고, 개수 보간은 전체 템플릿에만 있다', () => {
    const files = Object.entries(locales);
    expect(files.length).toBe(12);
    for (const [file, json] of files) {
      const block = json.panel.agentConfig.toolTemplate as Record<string, { name?: string; desc?: string } | string> | undefined;
      expect(block, file).toBeTruthy();
      expect(typeof block!.label, file).toBe('string');
      expect(block!.option, file).toContain('{{index}}');
      expect(block!.option, file).toContain('{{name}}');
      for (const id of [AGENT_TOOL_TEMPLATE_CUSTOM, ...AGENT_TOOL_TEMPLATES.map((t) => t.id)]) {
        const entry = block![id] as { name?: string; desc?: string } | undefined;
        expect(entry?.name, `${file} ${id}.name`).toBeTruthy();
        expect(entry?.desc, `${file} ${id}.desc`).toBeTruthy();
        expect(entry!.desc!.includes('{{total}}'), `${file} ${id}.desc`).toBe(id === 'all');
      }
    }
  });
});
