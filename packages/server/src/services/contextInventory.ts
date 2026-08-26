/**
 * §5.5 #17-28 — **컨텍스트 주입원 통제**의 계측·판정 층.
 *
 * 이 파일이 답하는 질문은 하나다: *"지금 이 세션의 프롬프트에 무엇이, 얼마나 실리는가."*
 *
 * 규율 셋(§5.5 #17-28):
 *  · **매번 읽는다** — 목록은 고정 표가 아니라 그때그때의 파일·조립 결과다. 프로젝트가 다르면 다르고,
 *    세션이 다르면 다르다. 하드코딩된 것은 "무엇을 끌 수 있는가"의 어휘(`CONTEXT_SOURCE_IDS`)뿐이다.
 *  · **여기가 최종** — 다른 화면(플러그인 창·에이전트 설정)에서 켜져 있어도 여기서 끄면 안 실린다.
 *    판정은 `resolveContextEnabled` 한 곳에서만 하고, 서버(주입)와 클라(표시)가 그것을 함께 쓴다.
 *  · **못 끄는 것은 못 끈다고 말한다** — Claude Code 내부 프롬프트처럼 손댈 수 없는 줄은 계측만 하고
 *    토글을 잠근다. 끌 수 있는 척하면 사용자는 껐다고 믿는데 프롬프트에는 계속 실린다.
 *
 * 파일 접근은 전부 "없으면 조용히 건너뛴다" — 계측 실패가 프롬프트 조립이나 화면을 막으면 안 된다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AgentConfig,
  ContextInventory,
  ContextOverrides,
  ContextSourceChild,
  ContextSourceItem,
} from '@vibisual/shared';
import {
  AVAILABLE_AGENT_TOOLS,
  CONTEXT_SOURCE_IDS,
  CONTEXT_SPAWN_SWITCHES,
  GIT_STATUS_ESTIMATE,
  SYSTEM_PROMPT_ESTIMATE,
  TOOL_SCHEMA_ESTIMATE,
  estimateTokens,
  resolveContextEnabled,
} from '@vibisual/shared';

// ─── 파일 탐색 (전부 실패에 관대) ───

/** 파일 한 장 읽기 — 없거나 못 읽으면 null. 큰 파일도 그대로 읽는다(지시 파일은 수십 KB 규모). */
function readFileSafe(p: string): { text: string; mtime: number } | null {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return null;
    return { text: fs.readFileSync(p, 'utf8'), mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}

/** 디렉터리 목록 — 없으면 빈 배열. */
function listDirSafe(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** 파일 한 장을 내역 한 줄로. 없으면 null. */
function childFromFile(title: string, p: string): ContextSourceChild | null {
  const f = readFileSafe(p);
  if (!f) return null;
  return { title, path: p, chars: f.text.length, tokens: estimateTokens(f.text), updatedAt: f.mtime };
}

/**
 * YAML 프론트매터에서 `name`·`description` 만 뽑는다.
 *
 * 스킬·커맨드·서브에이전트 정의는 **본문 전체가 아니라 이 두 줄만** 프롬프트에 실린다(본문은 호출될 때
 * 읽힌다). 파일 크기로 재면 실제보다 몇 배 크게 잡히므로 실리는 부분만 잰다.
 */
function readFrontmatterBlurb(p: string): { blurb: string; mtime: number } | null {
  const f = readFileSafe(p);
  if (!f) return null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(f.text);
  if (!m || !m[1]) {
    // 프론트매터가 없으면 첫 줄(제목)만 실린다고 본다 — 없는 것보다 낫고 과대평가하지 않는다.
    const first = f.text.split(/\r?\n/, 1)[0] ?? '';
    return { blurb: first, mtime: f.mtime };
  }
  const front = m[1];
  const keep: string[] = [];
  for (const line of front.split(/\r?\n/)) {
    if (/^\s*(name|description|argument-hint|model|tools)\s*:/i.test(line)) keep.push(line.trim());
  }
  return { blurb: keep.join('\n'), mtime: f.mtime };
}

/** `.claude/<sub>` 두 자리(프로젝트·사용자)를 함께 훑는 공통 경로 목록. */
function claudeDirs(projectPath: string, home: string, sub: string): { root: string; scope: string }[] {
  const out: { root: string; scope: string }[] = [];
  if (projectPath) out.push({ root: path.join(projectPath, '.claude', sub), scope: 'project' });
  if (home) out.push({ root: path.join(home, '.claude', sub), scope: 'user' });
  return out;
}

/**
 * 자동으로 로드되는 지시 파일 — 프로젝트 루트에서 위로 훑고(3단계), 사용자 홈 것도 함께.
 * "읽으라고 적힌 파일"(docs/rules 등)은 자동 로드가 아니므로 넣지 않는다 — 여기 있는 줄은 전부
 * **실제로 매 세션 실리는 것**이어야 한다.
 */
export function scanInstructionFiles(projectPath: string, cwd: string, home = os.homedir()): ContextSourceChild[] {
  const out: ContextSourceChild[] = [];
  const seen = new Set<string>();
  const names = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md'];

  const roots: string[] = [];
  for (const start of [cwd, projectPath]) {
    if (!start) continue;
    let dir = start;
    for (let i = 0; i < 4; i += 1) {
      if (!roots.includes(dir)) roots.push(dir);
      const parent = path.dirname(dir);
      if (!parent || parent === dir) break;
      dir = parent;
    }
  }
  if (home) roots.push(path.join(home, '.claude'));

  for (const root of roots) {
    for (const name of names) {
      const p = path.join(root, name);
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      const child = childFromFile(name, p);
      if (!child) continue;
      seen.add(key);
      out.push(child);
    }
  }
  return out;
}

/** Claude Code 자동 기억 폴더 이름 규칙 — 경로의 영숫자 아닌 글자를 전부 `-` 로 바꾼 슬러그. */
export function autoMemorySlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * 자동 기억(MEMORY.md 색인 + 그 폴더). 세션 컨텍스트에 실리는 것은 **색인 한 장**이고
 * 개별 기억 파일은 필요할 때 읽힌다 — 그래서 색인만 재고 나머지는 개수로만 알린다.
 */
export function scanAutoMemory(cwd: string, memoryDirOverride?: string, home = os.homedir()): {
  children: ContextSourceChild[];
  fileCount: number;
  dir: string;
} {
  const dir = memoryDirOverride
    ? memoryDirOverride
    : path.join(home, '.claude', 'projects', autoMemorySlug(cwd), 'memory');
  const children: ContextSourceChild[] = [];
  const index = childFromFile('MEMORY.md', path.join(dir, 'MEMORY.md'));
  if (index) children.push(index);
  const fileCount = listDirSafe(dir).filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md')).length;
  return { children, fileCount, dir };
}

/** `.claude/skills/<name>/SKILL.md` 의 설명 줄. 프로젝트·사용자 두 자리를 함께 훑는다. */
export function scanSkills(projectPath: string, home = os.homedir()): ContextSourceChild[] {
  const out: ContextSourceChild[] = [];
  for (const { root, scope } of claudeDirs(projectPath, home, 'skills')) {
    for (const entry of listDirSafe(root)) {
      if (!entry.isDirectory()) continue;
      const p = path.join(root, entry.name, 'SKILL.md');
      const fm = readFrontmatterBlurb(p);
      if (!fm) continue;
      out.push({
        title: `${entry.name} (${scope})`,
        path: p,
        chars: fm.blurb.length,
        tokens: estimateTokens(fm.blurb),
        updatedAt: fm.mtime,
      });
    }
  }
  return out;
}

/** `.claude/commands/**\/*.md` 의 설명 줄(한 단계 하위 폴더까지). */
export function scanCommands(projectPath: string, home = os.homedir()): ContextSourceChild[] {
  const out: ContextSourceChild[] = [];
  const push = (p: string, title: string): void => {
    const fm = readFrontmatterBlurb(p);
    if (!fm) return;
    out.push({ title, path: p, chars: fm.blurb.length, tokens: estimateTokens(fm.blurb), updatedAt: fm.mtime });
  };
  for (const { root, scope } of claudeDirs(projectPath, home, 'commands')) {
    for (const entry of listDirSafe(root)) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        push(path.join(root, entry.name), `/${entry.name.replace(/\.md$/i, '')} (${scope})`);
      } else if (entry.isDirectory()) {
        for (const sub of listDirSafe(path.join(root, entry.name))) {
          if (!sub.isFile() || !sub.name.toLowerCase().endsWith('.md')) continue;
          push(path.join(root, entry.name, sub.name), `/${entry.name}:${sub.name.replace(/\.md$/i, '')} (${scope})`);
        }
      }
    }
  }
  return out;
}

/** `.claude/agents/*.md` — 서브에이전트 정의. 설명이 Agent 도구 설명에 실린다. */
export function scanSubagentDefs(projectPath: string, home = os.homedir()): ContextSourceChild[] {
  const out: ContextSourceChild[] = [];
  for (const { root, scope } of claudeDirs(projectPath, home, 'agents')) {
    for (const entry of listDirSafe(root)) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const p = path.join(root, entry.name);
      const fm = readFrontmatterBlurb(p);
      if (!fm) continue;
      out.push({
        title: `${entry.name.replace(/\.md$/i, '')} (${scope})`,
        path: p,
        chars: fm.blurb.length,
        tokens: estimateTokens(fm.blurb),
        updatedAt: fm.mtime,
      });
    }
  }
  return out;
}

/** 훅이 등록된 settings.json 들 — 프롬프트 글자는 아니지만 **매 턴 맥락을 넣는 통로**라 목록에 세운다. */
export function scanHookSettings(projectPath: string, home = os.homedir()): ContextSourceChild[] {
  const out: ContextSourceChild[] = [];
  const files = [
    { title: 'settings.json (project)', p: path.join(projectPath, '.claude', 'settings.json') },
    { title: 'settings.local.json (project)', p: path.join(projectPath, '.claude', 'settings.local.json') },
    { title: 'settings.json (user)', p: path.join(home, '.claude', 'settings.json') },
  ];
  for (const f of files) {
    const raw = readFileSafe(f.p);
    if (!raw) continue;
    let hookCount = 0;
    try {
      const parsed = JSON.parse(raw.text) as { hooks?: Record<string, unknown[]> };
      for (const arr of Object.values(parsed.hooks ?? {})) {
        if (Array.isArray(arr)) hookCount += arr.length;
      }
    } catch {
      hookCount = 0;
    }
    if (hookCount === 0) continue;
    out.push({ title: `${f.title} — ${hookCount}`, path: f.p, chars: 0, tokens: 0, updatedAt: raw.mtime });
  }
  return out;
}

// ─── 인벤토리 조립 ───

/** 우리가 프롬프트에 조립해 넣는 조각 하나(호출부가 실제로 만든 문자열 그대로). */
export interface MeasuredPart {
  id: string;
  /** 이 턴에 실제로 조립된 본문. 빈 문자열이면 "해당 없음"(예: 엣지가 하나도 없음). */
  text: string;
  /** 실측 이름이 필요한 줄(플러그인 등). 없으면 `labelKey` 로 번역해 표시. */
  title?: string;
  detail?: string;
  /**
   * 기본 켜짐 여부를 직접 정한다. 생략하면 **본문이 있으면 켜짐**(빈 블록 = 해당 없음).
   * 글자 수로 잴 수 없는 통로 스위치(훅 경로 등)만 이것을 쓴다 — 그 줄은 0자여도 켜져 있는 게 맞다.
   */
  defaultEnabled?: boolean;
}

export interface InventoryInput {
  agentId: string;
  subAgentId?: string;
  projectKey: string;
  projectPath: string;
  cwd: string;
  /** 우리가 조립하는 블록들 — 호출부(프롬프트를 실제로 만드는 곳)가 잰 그대로 넘긴다. */
  parts: MeasuredPart[];
  agentConfig?: AgentConfig;
  overrides?: ContextOverrides;
  /** 자동 기억 폴더 override(에이전트 설정이 기억 범위를 바꿨을 때). */
  memoryDir?: string;
  /** 테스트 주입용 홈 디렉터리. */
  home?: string;
}

/** 우리 조립 블록의 i18n 키 — 화면 제목이자 "이게 무엇인지"의 유일한 표기. */
const PART_LABEL_KEYS: Record<string, string> = {
  [CONTEXT_SOURCE_IDS.skillsPrefix]: 'ide.context.src.skillsPrefix',
  [CONTEXT_SOURCE_IDS.agentRules]: 'ide.context.src.agentRules',
  [CONTEXT_SOURCE_IDS.edges]: 'ide.context.src.edges',
  [CONTEXT_SOURCE_IDS.feedback]: 'ide.context.src.feedback',
  [CONTEXT_SOURCE_IDS.intentFirst]: 'ide.context.src.intentFirst',
  [CONTEXT_SOURCE_IDS.cardCommon]: 'ide.context.src.cardCommon',
  [CONTEXT_SOURCE_IDS.cardReport]: 'ide.context.src.cardReport',
  [CONTEXT_SOURCE_IDS.cardQuestion]: 'ide.context.src.cardQuestion',
  [CONTEXT_SOURCE_IDS.cardReview]: 'ide.context.src.cardReview',
  [CONTEXT_SOURCE_IDS.goal]: 'ide.context.src.goal',
  [CONTEXT_SOURCE_IDS.brainCards]: 'ide.context.src.brainCards',
  [CONTEXT_SOURCE_IDS.brainTopics]: 'ide.context.src.brainTopics',
  [CONTEXT_SOURCE_IDS.brainRules]: 'ide.context.src.brainRules',
  [CONTEXT_SOURCE_IDS.hookEnforcement]: 'ide.context.src.hookEnforcement',
  [CONTEXT_SOURCE_IDS.plugins]: 'ide.context.src.plugins',
};

/** 우리 조립 블록의 분류 — 대부분 `vibisual` 이지만 기억·플러그인은 제 분류로 간다. */
function partCategory(id: string): ContextSourceItem['category'] {
  if (id.startsWith('plugin:') || id === CONTEXT_SOURCE_IDS.plugins) return 'plugins';
  if (id.startsWith('vibisual.brain')) return 'memory';
  return 'vibisual';
}

/** 자식 줄들의 합 — 부모 줄의 글자·토큰·최근 수정 시각. */
function sumChildren(children: ContextSourceChild[]): { chars: number; tokens: number; updatedAt?: number } {
  let chars = 0;
  let tokens = 0;
  let updatedAt: number | undefined;
  for (const c of children) {
    chars += c.chars;
    tokens += c.tokens;
    if (c.updatedAt && (!updatedAt || c.updatedAt > updatedAt)) updatedAt = c.updatedAt;
  }
  return { chars, tokens, ...(updatedAt ? { updatedAt } : {}) };
}

/**
 * 주입원 전수 목록을 만든다. **읽기 전용** — 아무것도 바꾸지 않는다.
 *
 * `parts` 는 호출부가 이 턴에 실제로 조립한 문자열이라 화면과 프롬프트가 어긋날 수 없고,
 * 나머지(지시 파일·스킬·커맨드…)는 여기서 그때그때 디스크를 훑어 잰다.
 */
export function buildContextInventory(input: InventoryInput): ContextInventory {
  const home = input.home ?? os.homedir();
  const items: ContextSourceItem[] = [];
  const scopeKeys = { projectKey: input.projectKey, subAgentId: input.subAgentId };

  /** 오버라이드까지 얹어 한 줄을 완성한다 — 최종 판정은 여기 한 곳뿐이다. */
  const push = (item: Omit<ContextSourceItem, 'enabled' | 'overrideScope'>): void => {
    const resolved = resolveContextEnabled(input.overrides, scopeKeys, item.id, item.defaultEnabled);
    items.push({
      ...item,
      enabled: item.control === 'none' ? item.defaultEnabled : resolved.enabled,
      ...(item.control !== 'none' && resolved.scope ? { overrideScope: resolved.scope } : {}),
    });
  };

  // ① 우리가 조립하는 블록 — 이 턴의 실제 문자열을 그대로 잰다.
  for (const part of input.parts) {
    const chars = part.text.length;
    const labelKey = PART_LABEL_KEYS[part.id];
    push({
      id: part.id,
      category: partCategory(part.id),
      ...(labelKey ? { labelKey } : {}),
      title: part.title ?? part.id,
      ...(part.detail ? { detail: part.detail } : {}),
      chars,
      tokens: estimateTokens(part.text),
      control: 'session',
      // 이 턴에 실제로 내용이 나온 것만 기본 켜짐 — 빈 블록은 "해당 없음"이라 켜 두어도 0자다.
      defaultEnabled: part.defaultEnabled ?? chars > 0,
    });
  }

  // ② 지시 파일 (CLAUDE.md 계열).
  const instr = scanInstructionFiles(input.projectPath, input.cwd, home);
  const instrSum = sumChildren(instr);
  push({
    id: CONTEXT_SOURCE_IDS.claudeMd,
    category: 'instructions',
    labelKey: 'ide.context.src.claudeMd',
    title: 'CLAUDE.md',
    detail: instr.map((c) => c.title).join(', '),
    chars: instrSum.chars,
    tokens: instrSum.tokens,
    control: 'spawn',
    defaultEnabled: instr.length > 0,
    ...(instrSum.updatedAt ? { updatedAt: instrSum.updatedAt } : {}),
    children: instr,
  });

  // ③ 자동 기억(MEMORY.md 색인).
  const mem = scanAutoMemory(input.cwd, input.memoryDir, home);
  const memSum = sumChildren(mem.children);
  push({
    id: CONTEXT_SOURCE_IDS.autoMemory,
    category: 'memory',
    labelKey: 'ide.context.src.autoMemory',
    title: 'MEMORY.md',
    detail: `${mem.fileCount} · ${mem.dir}`,
    path: mem.dir,
    chars: memSum.chars,
    tokens: memSum.tokens,
    control: 'spawn',
    defaultEnabled: mem.children.length > 0 && input.agentConfig?.memory !== 'off',
    ...(memSum.updatedAt ? { updatedAt: memSum.updatedAt } : {}),
    children: mem.children,
  });

  // ④ 스킬 · 슬래시 커맨드 — 스위치가 하나(`--disable-slash-commands`)이므로 **한 줄**로 세우고
  //    내역에서 스킬과 커맨드를 갈라 보여 준다. 두 줄로 갈라 놓고 같은 스위치를 걸면
  //    "하나만 껐는데 둘 다 꺼지는" 거짓말이 된다.
  const skills = scanSkills(input.projectPath, home);
  const commands = scanCommands(input.projectPath, home);
  const slashChildren = [...skills, ...commands];
  const slashSum = sumChildren(slashChildren);
  push({
    id: CONTEXT_SOURCE_IDS.slashCommands,
    category: 'skills',
    labelKey: 'ide.context.src.skills',
    title: 'Skills',
    detail: `${skills.length} + ${commands.length}`,
    chars: slashSum.chars,
    tokens: slashSum.tokens,
    control: 'spawn',
    defaultEnabled: slashChildren.length > 0,
    warnKey: 'ide.context.warn.slashCommands',
    ...(slashSum.updatedAt ? { updatedAt: slashSum.updatedAt } : {}),
    children: slashChildren,
  });

  // ⑤ 내장(번들) 스킬 — 실행본 안에 있어 잴 수 없다. 줄의 값은 숫자가 아니라 **스위치**다.
  push({
    id: CONTEXT_SOURCE_IDS.bundledSkills,
    category: 'skills',
    labelKey: 'ide.context.src.bundledSkills',
    title: 'Bundled skills',
    chars: 0,
    tokens: 0,
    estimated: true,
    control: 'spawn',
    defaultEnabled: true,
  });

  // ⑥ 서브에이전트 정의 — Agent 도구 설명에 실린다. 끄는 스위치가 없어 계측만.
  const agents = scanSubagentDefs(input.projectPath, home);
  const agentsSum = sumChildren(agents);
  push({
    id: CONTEXT_SOURCE_IDS.subagentDefs,
    category: 'skills',
    labelKey: 'ide.context.src.subagentDefs',
    title: 'Subagents',
    detail: String(agents.length),
    chars: agentsSum.chars,
    tokens: agentsSum.tokens,
    control: 'none',
    defaultEnabled: agents.length > 0,
    ...(agentsSum.updatedAt ? { updatedAt: agentsSum.updatedAt } : {}),
    children: agents,
  });

  // ⑦ 워크플로 · git 지시 — 환경변수 스위치가 있어 끌 수 있다(양은 어림값).
  push({
    id: CONTEXT_SOURCE_IDS.workflows,
    category: 'skills',
    labelKey: 'ide.context.src.workflows',
    title: 'Workflows',
    chars: 0,
    tokens: 0,
    estimated: true,
    control: 'spawn',
    defaultEnabled: true,
  });
  push({
    id: CONTEXT_SOURCE_IDS.gitInstructions,
    category: 'system',
    labelKey: 'ide.context.src.gitInstructions',
    title: 'Git',
    chars: 0,
    tokens: GIT_STATUS_ESTIMATE,
    estimated: true,
    control: 'spawn',
    defaultEnabled: true,
  });

  // ⑦ 도구 정의 — 목록은 에이전트 설정이 주인이라 여기서는 계측 + 그쪽으로 안내.
  const toolCount = input.agentConfig?.tools?.length ?? AVAILABLE_AGENT_TOOLS.length;
  const toolRatio = AVAILABLE_AGENT_TOOLS.length > 0
    ? Math.min(1, toolCount / AVAILABLE_AGENT_TOOLS.length)
    : 1;
  push({
    id: CONTEXT_SOURCE_IDS.toolSchemas,
    category: 'tools',
    labelKey: 'ide.context.src.toolSchemas',
    title: 'Tools',
    detail: String(toolCount),
    chars: 0,
    tokens: Math.round(TOOL_SCHEMA_ESTIMATE * toolRatio),
    estimated: true,
    control: 'external',
    hintKey: 'ide.context.hint.tools',
    defaultEnabled: toolCount > 0,
  });

  // ⑧ MCP 서버 — 켜면 도구가 더 붙는다. 주인은 에이전트 설정.
  const mcpCount = input.agentConfig?.mcpServers?.length ?? 0;
  push({
    id: CONTEXT_SOURCE_IDS.mcp,
    category: 'tools',
    labelKey: 'ide.context.src.mcp',
    title: 'MCP',
    detail: String(mcpCount),
    chars: 0,
    tokens: 0,
    estimated: true,
    control: 'external',
    hintKey: 'ide.context.hint.mcp',
    defaultEnabled: mcpCount > 0,
  });

  // ⑨ 훅 — 글자는 0이지만 매 턴 맥락이 드나드는 통로다. 끄면 화면이 멎으므로 주의를 단다.
  const hooks = scanHookSettings(input.projectPath, home);
  push({
    id: CONTEXT_SOURCE_IDS.hooks,
    category: 'system',
    labelKey: 'ide.context.src.hooks',
    title: 'Hooks',
    detail: hooks.map((h) => h.title).join(', '),
    chars: 0,
    tokens: 0,
    estimated: true,
    control: 'external',
    hintKey: 'ide.context.hint.hooks',
    warnKey: 'ide.context.warn.hooks',
    defaultEnabled: hooks.length > 0,
    children: hooks,
  });

  // ⑩ Claude Code 시스템 프롬프트 — 우리가 손댈 수 없다. 어림값으로 계측만.
  push({
    id: CONTEXT_SOURCE_IDS.systemPrompt,
    category: 'system',
    labelKey: 'ide.context.src.systemPrompt',
    title: 'System prompt',
    chars: 0,
    tokens: SYSTEM_PROMPT_ESTIMATE,
    estimated: true,
    control: 'none',
    defaultEnabled: true,
  });

  let totalTokens = 0;
  let enabledTokens = 0;
  for (const it of items) {
    totalTokens += it.tokens;
    if (it.enabled) enabledTokens += it.tokens;
  }

  return {
    agentId: input.agentId,
    ...(input.subAgentId ? { subAgentId: input.subAgentId } : {}),
    projectPath: input.projectPath,
    cwd: input.cwd,
    at: Date.now(),
    items,
    totalTokens,
    enabledTokens,
  };
}

// ─── §5.5 #17-28 ⑦ 상세창이 쓰는 부분 (읽기 전용) ───

/**
 * 본문을 읽을 수 없는 줄 — Claude Code 실행본 안에 있어 우리가 열어 볼 파일이 없다.
 *
 * 화면은 이 줄들에서 **빈 칸 대신 "왜 못 보여 주는가"** 를 적는다. ③ 의 "끌 수 있는 척하지 않는다"와
 * 같은 원칙의 표시 쪽이다 — 없는 것을 있는 척하면 사용자는 화면을 못 믿게 된다.
 */
export const CONTEXT_UNREADABLE_SOURCE_IDS: ReadonlySet<string> = new Set<string>([
  CONTEXT_SOURCE_IDS.systemPrompt,
  CONTEXT_SOURCE_IDS.bundledSkills,
  CONTEXT_SOURCE_IDS.workflows,
  CONTEXT_SOURCE_IDS.gitInstructions,
  CONTEXT_SOURCE_IDS.toolSchemas,
  CONTEXT_SOURCE_IDS.mcp,
]);

/** 경로 대조 키 — Windows 는 대소문자를 가리지 않으므로 그쪽에서만 낮춘다. */
export function normalizeFsPath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * 지금 이 인벤토리가 **실제로 싣고 있는** 파일들의 절대경로.
 *
 * 상세창의 파일 열람은 이 목록하고만 대조해 열린다(⑤). 이 창의 권한은 "이미 프롬프트에 실리는 것을
 * 보여 주는 것"까지이며, 여기 없는 경로를 물으면 그냥 거절한다 — 아무 파일이나 읽는 창구가 되면 안 된다.
 */
export function collectInventoryFilePaths(inventory: ContextInventory): Set<string> {
  const out = new Set<string>();
  for (const item of inventory.items) {
    for (const child of item.children ?? []) {
      if (child.path) out.add(normalizeFsPath(child.path));
    }
  }
  return out;
}

/** 상세창에 실어 보낼 파일 한 장. 목록에 없거나 못 읽으면 null(= 화면은 "못 읽었다"로 그린다). */
export function readContextSourceFile(
  absPath: string,
  allowed: ReadonlySet<string>,
  maxChars: number,
): { text: string; chars: number; tokens: number; truncated: boolean; path: string } | null {
  if (!allowed.has(normalizeFsPath(absPath))) return null;
  const file = readFileSafe(absPath);
  if (!file) return null;
  return {
    text: file.text.length > maxChars ? file.text.slice(0, maxChars) : file.text,
    chars: file.text.length,
    tokens: estimateTokens(file.text),
    truncated: file.text.length > maxChars,
    path: absPath,
  };
}

// ─── 주입 게이트 (프롬프트 조립 경로가 쓰는 부분) ───

/**
 * 이 주입원이 지금 켜져 있는가. 오버라이드가 없으면 `defaultEnabled`(보통 true).
 *
 * 프롬프트 경로에서 **매 턴** 불리므로 파일을 읽지 않는다 — 메모리에 있는 사용자 뜻만 본다.
 */
export function isContextSourceOn(
  overrides: ContextOverrides | undefined,
  scope: { projectKey?: string | null; subAgentId?: string | null },
  sourceId: string,
  defaultEnabled = true,
): boolean {
  return resolveContextEnabled(overrides, scope, sourceId, defaultEnabled).enabled;
}

/**
 * `control: 'spawn'` 인 줄을 끄기 위해 이번 스폰에 얹을 CLI 인자·환경변수.
 *
 * 헤드리스 경로는 매 턴 새 프로세스라(`--resume` 도 새 spawn) 여기서 돌려준 값이 **다음 프롬프트부터**
 * 그대로 먹는다. 끈 것이 하나도 없으면 빈 결과라, 이 기능을 안 쓰는 사용자의 스폰은 종전과 완전히 같다.
 */
export function buildSpawnContextSwitches(
  overrides: ContextOverrides | undefined,
  scope: { projectKey?: string | null; subAgentId?: string | null },
): { args: string[]; env: Record<string, string> } {
  const args: string[] = [];
  const env: Record<string, string> = {};
  if (!overrides) return { args, env };
  for (const [sourceId, sw] of Object.entries(CONTEXT_SPAWN_SWITCHES)) {
    // 기본값은 "켜짐" — 사용자가 명시적으로 끈 것만 스위치를 건다.
    if (isContextSourceOn(overrides, scope, sourceId, true)) continue;
    if (sw.flag && !args.includes(sw.flag)) args.push(sw.flag);
    if (sw.env) env[sw.env] = '1';
  }
  return { args, env };
}
