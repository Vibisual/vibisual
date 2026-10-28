import * as fs from 'node:fs';
import * as path from 'node:path';
import { CODEX_HOOKS_FILENAME, isPathWithin } from '@vibisual/shared';
import type {
  CodexAgentsDocEntry,
  CodexHookEntry,
  CodexInventory,
  CodexMcpServerEntry,
  CodexPluginEntry,
  CodexSkillEntry,
  CodexSkillSource,
  PlatformName,
} from '@vibisual/shared';
import { codexHome, runCodexCli } from './codexCli.js';
import { isOurCodexHookCommand } from './codexHookInstaller.js';
import { logger } from '../logger.js';
import { sharingPaths, skillRoots } from './skillSharingPaths.js';

/**
 * §5.25 (M) — 코덱스가 실제로 들고 있는 것(MCP·컨텍스트 주입원·스킬·훅·플러그인)을 **읽기만** 한다.
 * §5.19 (G) 의 "CLI 에 매인 항목은 감춘다"를 코덱스에 적용하지 않는다 — 코덱스에는 다섯이 다 있어, 감추면 사용자가 깔아 둔 것을 못 본다.
 * 고치지 않는다: 코덱스 홈과 CLI 공개 인터페이스에서 읽기만 하고 설치·제거·켜고 끄기 손잡이는 없다(예외는 `hooks.json` 안 우리 항목뿐 — §5.25 (I)).
 * 비밀값을 담지 않는다: MCP 의 `env`·`bearer_token_env_var`·`http_headers` 는 읽고 버린다(스냅샷이 WS 로 흘러 로그·백업에 남는다).
 * 한 갈래가 실패해도 나머지는 채운다 — 코덱스가 없는 기계에서도 `codex mcp list` 만 실패하고 `~/.codex/skills` 는 읽힐 수 있다.
 */

/** `SKILL.md` 에서 설명 한 줄을 읽을 때 앞에서 몇 줄까지 보는가. 파일 전체를 파싱하지 않는다. */
const SKILL_DOC_SCAN_LINES = 40;
/** 스킬 폴더에서 설명을 찾을 파일 이름(먼저 있는 것을 쓴다). */
const SKILL_DOC_FILENAMES = ['SKILL.md', 'skill.md', 'README.md'] as const;
/** 코덱스의 프로젝트 규칙 파일 — 클로드의 `CLAUDE.md` 자리다. */
const CODEX_AGENTS_FILENAME = 'AGENTS.md';
/** 스킬 폴더 이름. */
const CODEX_SKILLS_DIRNAME = 'skills';
/**
 * §5.25 (M-1) — 코덱스가 기본으로 얹는 스킬 자리(`~/.codex/skills/.system/`).
 * 홈 스킬 폴더 안에 있지만 `readCodexSkillsIn` 은 점 폴더를 건너뛰므로 따로 읽는다(빠지면 `imagegen`·`skill-creator` 같은 기본 스킬이 안 보인다).
 */
const CODEX_SYSTEM_SKILLS_DIRNAME = '.system';
/** 플러그인 캐시 뿌리. 그 아래는 `<장터>/<플러그인>/<버전>/skills/<이름>/` 이다. */
const CODEX_PLUGIN_CACHE_SEGMENTS = ['plugins', 'cache'] as const;
/** 플러그인 캐시를 훑을 때 내려갈 최대 깊이. 장터·플러그인·버전 세 칸이면 닿는다. */
const CODEX_PLUGIN_SCAN_DEPTH = 3;
/** `codex debug prompt-input` 한 번에 주는 시간. 세션 문맥을 조립하므로 목록 조회보다 넉넉히. */
const CODEX_PROMPT_INPUT_TIMEOUT_MS = 45_000;
/** CLI 한 번 호출에 주는 시간. 목록 조회라 짧게 — 넘으면 그 갈래만 비고 나머지는 뜬다. */
const CODEX_INVENTORY_TIMEOUT_MS = 15_000;

/**
 * `codex mcp list --json` 출력 → 목록.
 * 모르는 모양이면 빈 배열이다 — 코덱스가 필드를 바꿔도 지어낸 값을 띄우지 않는다(화면은 "아직 못 읽었다"고 말한다).
 */
export function parseCodexMcpList(raw: string): CodexMcpServerEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: CodexMcpServerEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec['name'] === 'string' ? rec['name'].trim() : '';
    if (!name) continue;

    const transportRec = rec['transport'];
    const transport =
      transportRec && typeof transportRec === 'object'
        ? String((transportRec as Record<string, unknown>)['type'] ?? '').trim()
        : typeof transportRec === 'string'
          ? transportRec.trim()
          : '';

    const entry: CodexMcpServerEntry = {
      name,
      transport: transport || 'unknown',
      // 코덱스가 말 안 하면 켜진 것으로 읽지 않는다 — 꺼진 서버를 켜졌다고 하는 쪽이 더 나쁜 거짓말이다.
      enabled: rec['enabled'] === true,
    };

    const reason = rec['disabled_reason'];
    if (typeof reason === 'string' && reason.trim()) entry.disabledReason = reason.trim();
    const auth = rec['auth_status'];
    if (typeof auth === 'string' && auth.trim()) entry.authStatus = auth.trim();

    // 어디에 붙는가만 적는다. `env`·`env_vars`·`bearer_token_env_var`·`http_headers` 는 읽지 않는다.
    if (transportRec && typeof transportRec === 'object') {
      const t = transportRec as Record<string, unknown>;
      const url = typeof t['url'] === 'string' ? t['url'].trim() : '';
      const command = typeof t['command'] === 'string' ? t['command'].trim() : '';
      const target = url || command;
      if (target) entry.target = target;
    }
    out.push(entry);
  }
  return out;
}

/**
 * `codex plugin list --json` 출력(`{ installed, available }`) → 목록. 깔린 것을 앞에 두고, 같은 `pluginId` 가 양쪽에 있으면 깔린 쪽만 남긴다.
 * `--available` 은 일부러 안 준다 — 없으면 깔린 것만 온다(실측 11개, 장터 전체는 40개 넘음). 두 칸을 다 읽는 것은 코덱스가 `available` 을 채워 보내는 날을 위해서다.
 */
export function parseCodexPluginList(raw: string): CodexPluginEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const root = parsed as Record<string, unknown>;

  const seen = new Set<string>();
  const out: CodexPluginEntry[] = [];
  for (const bucket of ['installed', 'available'] as const) {
    const list = root[bucket];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const id = typeof rec['pluginId'] === 'string' ? rec['pluginId'].trim() : '';
      const name = typeof rec['name'] === 'string' ? rec['name'].trim() : '';
      const key = id || name;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const entry: CodexPluginEntry = {
        name: name || id,
        installed: rec['installed'] === true,
        enabled: rec['enabled'] === true,
      };
      const marketplace = rec['marketplaceName'];
      if (typeof marketplace === 'string' && marketplace.trim()) entry.marketplace = marketplace.trim();
      const version = rec['version'];
      if (typeof version === 'string' && version.trim()) entry.version = version.trim();
      const source = rec['source'];
      if (source && typeof source === 'object') {
        const p = (source as Record<string, unknown>)['path'];
        if (typeof p === 'string' && p.trim()) entry.path = p.trim();
      }
      out.push(entry);
    }
  }
  return out;
}

/** `SKILL.md` 에서 설명 한 줄: 앞머리(`---` 사이)의 `description:` → 없으면 첫 본문 줄 → 둘 다 없으면 `undefined`(화면은 이름만 적는다 — 설명을 지어내지 않는다). */
export function parseCodexSkillDescription(raw: string): string | undefined {
  const lines = raw.split(/\r?\n/, SKILL_DOC_SCAN_LINES);
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (i === 0 && line === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line === '---') {
        inFrontmatter = false;
        continue;
      }
      const m = /^description\s*:\s*(.+)$/i.exec(line);
      if (m) {
        const value = (m[1] ?? '').trim().replace(/^["']|["']$/g, '').trim();
        if (value) return value;
      }
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    return line;
  }
  return undefined;
}

/**
 * 스킬 폴더 목록 — 폴더가 곧 스킬이다(코덱스가 그렇게 읽는다).
 * 경로를 인자로 받는다: 홈 판정은 `codexCli` 몫이고, 시험이 진짜 홈 대신 임시 폴더로 돈다.
 * §5.25 (M-1) — `source` 도 인자로 받는다. 홈·시스템·플러그인 세 자리가 모양이 같아 같은 스캔을 쓰고, 어느 루트인지는 부르는 쪽이 안다.
 */
export function readCodexSkillsIn(
  skillsDir: string,
  source: CodexSkillSource = 'user',
  pluginName?: string,
): CodexSkillEntry[] {
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: CodexSkillEntry[] = [];
  for (const dirent of names) {
    if (!dirent.isDirectory()) continue;
    const name = dirent.name;
    // 점으로 시작하는 폴더는 스킬이 아니라 도구가 쓰는 자리다(`.git` 등).
    //   `.system` 은 스킬이 **맞지만** 이 스캔의 대상이 아니라 따로 읽는다(출처가 다르다).
    if (name.startsWith('.')) continue;
    const dir = path.join(skillsDir, name);
    const entry: CodexSkillEntry = { name, path: dir, source };
    if (pluginName) entry.pluginName = pluginName;
    for (const filename of SKILL_DOC_FILENAMES) {
      let raw: string;
      try {
        raw = fs.readFileSync(path.join(dir, filename), 'utf8');
      } catch {
        continue;
      }
      const description = parseCodexSkillDescription(raw);
      if (description) entry.description = description;
      break;
    }
    out.push(entry);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * §5.25 (M-1) — 플러그인 캐시 안의 스킬(`<캐시>/<장터>/<플러그인>/<버전>/skills/<이름>/`).
 * 캐시에 옛 버전이 남으므로 플러그인마다 한 버전만 쓴다(폴더 이름 정렬의 끝 — 버전 문자열을 우리가 해석해 비교하지 않는다).
 * `prompt-input` 이 실패했을 때의 차선이다 — 꺼 둔 플러그인의 캐시도 남으므로 정본은 코덱스가 신고한 목록이다.
 */
export function readCodexPluginSkillsIn(cacheRoot: string): CodexSkillEntry[] {
  const out: CodexSkillEntry[] = [];
  const listDirs = (dir: string): string[] => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort();
    } catch {
      return [];
    }
  };
  for (const marketplace of listDirs(cacheRoot)) {
    const marketDir = path.join(cacheRoot, marketplace);
    for (const plugin of listDirs(marketDir)) {
      const pluginDir = path.join(marketDir, plugin);
      const versions = listDirs(pluginDir);
      // 버전이 없는 모양(플러그인 폴더 바로 아래 `skills/`)도 받는다 — 캐시 배치는 코덱스 몫이라
      //   한 모양만 고집하면 그쪽이 바꾼 날 목록이 통째로 빈다.
      const candidates = versions.length > 0
        ? [path.join(pluginDir, versions[versions.length - 1] ?? ''), pluginDir]
        : [pluginDir];
      for (const base of candidates) {
        const found = readCodexSkillsIn(path.join(base, CODEX_SKILLS_DIRNAME), 'plugin', plugin);
        if (found.length > 0) {
          out.push(...found);
          break; // 한 플러그인은 한 자리에서만 — 버전 폴더와 그 부모를 겹쳐 세지 않는다.
        }
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * §5.25 (M-1) — `codex debug prompt-input` 이 신고한 **모델이 실제로 보는 스킬 목록**(정본).
 * 폴더 스캔은 "디스크에 있는 것"이고 이 화면이 답할 것은 "이 대화에 실리는 것"이다(실측 2026-09-08 · `codex-cli 0.152.1`: 신고 15개, 홈 스캔 3개).
 * 출력은 developer 메시지 안 `<skills_instructions>` 블록이고 두 부분을 읽는다:
 * (1) 루트 표 — ``- `r0` = `C:/Users/<you>/.codex/skills` `` 꼴(짧은 이름 → 절대경로). (2) 항목 줄 — `- <이름>: <설명> (file: r1/imagegen/SKILL.md)` 꼴.
 * 모르는 모양이면 빈 배열 — 호출자가 폴더 스캔으로 떨어진다.
 */
export function parseCodexPromptInputSkills(
  raw: string,
  home: string,
  platform: PlatformName = process.platform,
  userSkillRoots: readonly string[] = [],
): CodexSkillEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // 블록을 찾는다. 어느 메시지에 실릴지는 코덱스가 정하므로 전부 훑는다.
  let block: string | null = null;
  for (const message of parsed) {
    if (!message || typeof message !== 'object') continue;
    const content = (message as Record<string, unknown>)['content'];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as Record<string, unknown>)['text'];
      if (typeof text === 'string' && text.includes('<skills_instructions>')) block = text;
    }
  }
  if (block === null) return [];

  // (1) 루트 표.
  const roots = new Map<string, string>();
  for (const m of block.matchAll(/^-\s+`([^`]+)`\s*=\s*`([^`]+)`\s*$/gm)) {
    const key = m[1];
    const value = m[2];
    if (key && value) roots.set(key, value);
  }

  /**
   * 홈 아래 자리들. `path.join` 을 쓰지 않는다 — 이 프로세스 OS 의 규칙으로 이어, 리눅스 CI 에서 win 경로를 이으면 판정이 무너진다(실측).
   * 세 OS 를 한 개발기에서 재려면 forward slash 로 직접 잇는다 — `isPathWithin` 이 어차피 그렇게 접어 비교한다.
   */
  const joinUnder = (base: string, ...segments: string[]): string =>
    [base.replace(/[\\/]+$/, ''), ...segments].join('/');
  const homeSkills = joinUnder(home, CODEX_SKILLS_DIRNAME);
  const systemSkills = joinUnder(homeSkills, CODEX_SYSTEM_SKILLS_DIRNAME);
  const cacheRoot = joinUnder(home, ...CODEX_PLUGIN_CACHE_SEGMENTS);

  /**
   * 절대경로 하나가 어느 출처인지. 판정은 `isPathWithin(child, root, platform)` 하나에 맡긴다(멀티플랫폼 1축) — `startsWith` 로 바꾸면 셋이 깨진다:
   * ① 구분자 — 코덱스는 루트 표를 `C:/…` 로 적고 `path.join` 은 win 에서 `\` 를 쓴다.
   * ② 대소문자 — win·mac(APFS 기본)은 접어야 하고 linux 는 접으면 안 된다(`pathKey` 가 안다). 어긋나면 직접 넣은 스킬이 `plugin` 칸으로 떨어진다(실측).
   * ③ 경계 — 형제 폴더 `skills-backup` 이 `skills` 로 읽힌다(실측).
   */
  const sourceOf = (abs: string): { source: CodexSkillSource; pluginName?: string } => {
    if (isPathWithin(abs, systemSkills, platform)) return { source: 'system' };
    if (isPathWithin(abs, homeSkills, platform)) return { source: 'user' };
    if (isPathWithin(abs, cacheRoot, platform)) {
      // 캐시 바로 아래 두 칸은 `<장터>/<플러그인>` 이다 — 뒤 칸이 사람이 아는 이름.
      //   여기서만 문자열을 자르므로 구분자를 편 뒤에 센다(케이스는 건드리지 않는다 —
      //   이 값은 비교 키가 아니라 **화면에 그대로 적힐 플러그인 이름**이다).
      const flat = abs.replace(/\\/g, '/');
      const cacheFlat = cacheRoot.replace(/\\/g, '/');
      const rest = flat.slice(cacheFlat.length).replace(/^\/+/, '').split('/');
      const pluginName = rest[1];
      return pluginName ? { source: 'plugin', pluginName } : { source: 'plugin' };
    }
    // Project/user .agents/skills are user-authored too. Cache/system classification wins above.
    if (userSkillRoots.some((root) => isPathWithin(abs, root, platform))) return { source: 'user' };
    // 홈도 알려진 사용자 경로도 캐시도 아닌 자리 — 출처를 넘겨짚지 않는다.
    return { source: 'plugin' };
  };

  /**
   * (2) 항목 줄. 이름은 `documents:documents` 처럼 접두가 붙기도 한다 — 뒤 칸이 스킬 이름이다.
   * 한 줄 안에서만 읽는다(`[^\n]`) — 줄을 넘나들면 위 루트 표 줄이 이름 자리로 빨려 들어와 ``` `r0` = `C ``` 같은 스킬이 생긴다(실제로 났다).
   */
  const out: CodexSkillEntry[] = [];
  const seen = new Set<string>();
  for (const m of block.matchAll(/^-[ \t]+([^:\n]+):[ \t]*([^\n]*?)[ \t]*\(file:[ \t]*([^)\n]+)\)[ \t]*$/gm)) {
    const rawName = (m[1] ?? '').trim();
    const description = (m[2] ?? '').trim();
    const file = (m[3] ?? '').trim();
    // 루트 표 줄은 항목이 아니다 — 백틱으로 감싼 짧은 이름이 오면 건너뛴다.
    if (rawName.startsWith('`')) continue;
    if (!rawName || !file) continue;
    const name = rawName.includes(':') ? (rawName.split(':').pop() ?? rawName).trim() : rawName;
    if (!name) continue;

    // 짧은 경로(`r1/imagegen/SKILL.md`)를 절대경로로 편다. 루트를 모르면 그 항목은 버린다 —
    //   경로를 지어내면 화면의 "여기 있다"가 거짓이 된다.
    const slash = file.indexOf('/');
    const rootKey = slash > 0 ? file.slice(0, slash) : '';
    const rel = slash > 0 ? file.slice(slash + 1) : '';
    const rootPath = roots.get(rootKey);
    if (!rootPath || !rel) continue;
    // 스킬 자리는 `SKILL.md` 가 아니라 그것을 담은 폴더다(코덱스가 폴더를 스킬로 읽는다).
    // 여기서도 `path.join`/`path.dirname` 을 쓰지 않는다 — 코덱스가 신고한 경로라 호스트 규칙으로 다루면 win 경로를 리눅스에서 재는 시험이 성립하지 않는다(`joinUnder` 와 같은 이유).
    const full = joinUnder(rootPath, rel);
    const cut = full.replace(/[\\/]+$/, '').lastIndexOf('/');
    const dir = cut > 0 ? full.slice(0, cut) : full;

    // 같은 이름이 다른 자리에 둘 있을 수 있다(실측: `spreadsheets` 가 둘) — 자리까지 봐야 가른다.
    const key = name + '\u0000' + dir;
    if (seen.has(key)) continue;
    seen.add(key);

    const { source, pluginName } = sourceOf(dir);
    const entry: CodexSkillEntry = { name, path: dir, source };
    if (description) entry.description = description;
    if (pluginName) entry.pluginName = pluginName;
    out.push(entry);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** 파일 하나를 `AGENTS.md` 항목으로. 없으면 `exists: false` 로 **자리는 남긴다** — "없다"도 정보다. */
function readAgentsDocAt(scope: CodexAgentsDocEntry['scope'], file: string): CodexAgentsDocEntry {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return {
      scope,
      path: file,
      exists: true,
      bytes: Buffer.byteLength(raw, 'utf8'),
      lines: raw.split(/\r?\n/).length,
    };
  } catch {
    return { scope, path: file, exists: false };
  }
}

/**
 * 코덱스 규칙 문서 두 자리 — 홈(`~/.codex/AGENTS.md`)과 지금 프로젝트(`<cwd>/AGENTS.md`).
 * 클로드 주입원 목록을 빌려 쓰지 않는다 — 자리는 같아도 내용이 달라, 이 대화에 실리지 않는 것이 뜬다.
 */
export function readCodexAgentsDocsIn(home: string, projectCwd: string | null): CodexAgentsDocEntry[] {
  const out: CodexAgentsDocEntry[] = [readAgentsDocAt('home', path.join(home, CODEX_AGENTS_FILENAME))];
  if (projectCwd) out.push(readAgentsDocAt('project', path.join(projectCwd, CODEX_AGENTS_FILENAME)));
  return out;
}

/**
 * `hooks.json` 원문 → 훅 한 줄씩.
 * 남의 훅도 보여 준다(우리 것만 그리면 사용자 훅이 사라진 줄 안다) — `ours` 로 갈라 적고 손대지 않는다(§5.25 (I)).
 */
export function parseCodexHookEntries(raw: string, handlerPath: string | null): CodexHookEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const hooks = (parsed as Record<string, unknown>)['hooks'];
  if (!hooks || typeof hooks !== 'object') return [];

  const out: CodexHookEntry[] = [];
  for (const [event, blocks] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const inner = (block as Record<string, unknown>)['hooks'];
      if (!Array.isArray(inner)) continue;
      for (const hook of inner) {
        if (!hook || typeof hook !== 'object') continue;
        const command = (hook as Record<string, unknown>)['command'];
        if (typeof command !== 'string' || !command.trim()) continue;
        out.push({
          event,
          command: command.trim(),
          ours: handlerPath ? isOurCodexHookCommand(command, handlerPath) : false,
        });
      }
    }
  }
  return out;
}

class CodexInventoryService {
  private cached: CodexInventory | null = null;
  /** 이 캐시를 읽은 폴더. 다섯 갈래 중 `agentsDocs` 만 프로젝트마다 다르다(`<cwd>/AGENTS.md`) — 기억하지 않으면 탭을 옮긴 뒤 옆 프로젝트의 `AGENTS.md` 를 보여 준다. */
  private cachedCwd: string | null = null;
  /** 아직 한 번도 안 읽었는지(`null` 프로젝트로 읽은 것과 구별). */
  private everRead = false;

  /** A user imported a skill; subsequent reads must discover the new files. */
  invalidate(): void {
    this.cached = null;
    this.cachedCwd = null;
    this.everRead = false;
  }

  /** 이 폴더 기준으로 읽어 둔 것. 다른 폴더로 읽은 캐시는 돌려주지 않는다(null) — 호출자가 `refresh` 한다. */
  getFor(projectCwd: string | null): CodexInventory | null {
    if (!this.everRead || this.cachedCwd !== projectCwd) return null;
    return this.cached;
  }

  /** 폴더와 무관한 최신 캐시(스냅샷 주입용). 없으면 null. */
  get(): CodexInventory | null {
    return this.cached;
  }

  /**
   * 다섯 갈래를 다시 읽는다. 한 갈래가 실패해도 throw 하지 않는다 — 그 갈래만 비고 사유가 `errors` 에 남는다.
   * `projectCwd` 는 `AGENTS.md` 를 찾을 프로젝트 폴더(없으면 홈 것만). `handlerPath` 는 우리 훅 판정용 서명 — 없으면 모든 훅이 남의 것으로 읽힌다(안전한 쪽).
   */
  async refresh(projectCwd: string | null, handlerPath: string | null): Promise<CodexInventory> {
    const home = codexHome();
    const userRoots = skillRoots(sharingPaths({ codexHome: home }), 'codex', projectCwd).map((root) => root.dir);
    const errors: NonNullable<CodexInventory['errors']> = {};

    // 세 CLI 호출은 서로를 기다릴 이유가 없다 — 각각 조회 한 번이고 실패도 따로 난다.
    //   `debug prompt-input` 은 세션 문맥을 조립하므로 목록 조회보다 시간을 넉넉히 준다.
    //   §5.25 (M-1) — 스킬 목록은 이 호출이 정본이고, 실패하면 아래에서 폴더 스캔으로 떨어진다.
    const [mcp, plugin, promptInput] = await Promise.all([
      runCodexCli(['mcp', 'list', '--json'], CODEX_INVENTORY_TIMEOUT_MS),
      runCodexCli(['plugin', 'list', '--json'], CODEX_INVENTORY_TIMEOUT_MS),
      runCodexCli(
        ['debug', 'prompt-input'],
        CODEX_PROMPT_INPUT_TIMEOUT_MS,
        projectCwd ? { cwd: projectCwd } : {},
      ),
    ]);

    let mcpServers: CodexMcpServerEntry[] = [];
    if (mcp.failure || mcp.code !== 0) {
      errors.mcp = mcp.failure ?? `exit ${String(mcp.code)}`;
    } else {
      mcpServers = parseCodexMcpList(mcp.out);
    }

    let plugins: CodexPluginEntry[] = [];
    if (plugin.failure || plugin.code !== 0) {
      errors.plugins = plugin.failure ?? `exit ${String(plugin.code)}`;
    } else {
      plugins = parseCodexPluginList(plugin.out);
    }

    /**
     * §5.25 (M-1) — 스킬은 코덱스가 신고한 목록(`debug prompt-input`)이 정본이다(홈 폴더만 읽으면 실측 15개 중 3개만 보였다).
     * 그 호출이 실패한 기계에서만 세 자리를 직접 훑어 차선을 만들고, 둘 다 실패하면 `errors.skills` 가 사유를 적는다.
     */
    let skills: CodexSkillEntry[] = [];
    let skillsFromReport = false;
    if (!promptInput.failure && promptInput.code === 0) {
      skills = parseCodexPromptInputSkills(promptInput.out, home, process.platform, userRoots);
      skillsFromReport = skills.length > 0;
    }
    if (!skillsFromReport) {
      const homeSkillsDir = path.join(home, CODEX_SKILLS_DIRNAME);
      skills = [
        ...userRoots.flatMap((root) => readCodexSkillsIn(root, 'user')),
        ...readCodexSkillsIn(path.join(homeSkillsDir, CODEX_SYSTEM_SKILLS_DIRNAME), 'system'),
        ...readCodexPluginSkillsIn(path.join(home, ...CODEX_PLUGIN_CACHE_SEGMENTS)),
      ].sort((a, b) => a.name.localeCompare(b.name));
      // 정본을 못 읽은 사실은 남긴다 — 목록이 비었을 때만. 차선으로 뭔가 찾았으면 화면은 조용하다
      //   (사용자가 볼 것은 스킬 목록이지 우리 내부 갈래가 아니다).
      if (skills.length === 0 && (promptInput.failure || promptInput.code !== 0)) {
        errors.skills = promptInput.failure ?? `exit ${String(promptInput.code)}`;
      }
    }
    const agentsDocs = readCodexAgentsDocsIn(home, projectCwd);

    let hooks: CodexHookEntry[] = [];
    try {
      hooks = parseCodexHookEntries(fs.readFileSync(path.join(home, CODEX_HOOKS_FILENAME), 'utf8'), handlerPath);
    } catch {
      // 훅 파일이 없는 것은 흔한 정상 상태다(한 번도 안 켠 사용자) — 사유를 남기지 않는다.
      hooks = [];
    }

    this.cached = {
      mcpServers,
      skills,
      plugins,
      hooks,
      agentsDocs,
      checkedAt: Date.now(),
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
    };
    this.cachedCwd = projectCwd;
    this.everRead = true;
    logger.info(
      `[codexInventory] mcp=${String(mcpServers.length)} skills=${String(skills.length)} `
      + `plugins=${String(plugins.length)} hooks=${String(hooks.length)}`,
    );
    return this.cached;
  }
}

export const codexInventoryService = new CodexInventoryService();
