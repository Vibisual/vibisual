/**
 * §5.5 #17-31 — "지금 이 프로젝트에서 쓸 수 있는 MCP" 인벤토리 + 켜고 끄기.
 *
 * #17-20 ⑥(`mcpConfigService`)은 **우리가 아는 프리셋 4종**을 스폰 인자에 실어 주는 축이고,
 * 여기는 그보다 넓다 — 사용자가 `claude mcp add` 로 직접 붙인 것까지 포함해 **Claude Code 의
 * 실제 설정을 매번 읽어** 한 목록으로 세운다. 우리 나름의 "켜짐" 개념을 새로 만들지 않는 것이
 * 이 모듈의 유일한 규율이다(화면과 실제가 갈리면 토글은 거짓말이 된다).
 *
 * 읽는 곳:
 *   - `~/.claude.json` 최상위 `mcpServers`             → 글로벌(user) 범위
 *   - `~/.claude.json` `projects[<경로>].mcpServers`    → 로컬(이 프로젝트) 범위
 *   - `<루트>/.mcp.json`                                → 프로젝트 범위(레포 자산 — 읽기만)
 *   - `MCP_SERVER_PRESETS`                              → 프리셋(#17-20 ⑥)
 *
 * 켜짐/꺼짐 판정(CLI 실행본 실측):
 *   - `~/.claude.json` `projects[<경로>].disabledMcpServers` → **범위 무관** 끔 목록(= `/mcp disable`)
 *   - `.mcp.json` 승인축 `enabledMcpjsonServers`/`disabledMcpjsonServers`/`enableAllProjectMcpServers`
 *   - `settings.json` 계열의 `deniedMcpServers` → 정책 차단(우리가 풀지 않는다)
 *
 * 쓰는 곳은 **`~/.claude.json` 의 그 프로젝트 엔트리 하나뿐**이다(§5.5 #17-31 ④).
 * 디스크가 SSOT 라 상태를 들지 않는다 — 캐시·broadcast·checkpoint 미관여.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  McpInventory,
  McpRequirement,
  McpServerEntry,
  McpServerScope,
  McpServerState,
  McpServerTransport,
} from '@vibisual/shared';
import { MCP_SERVER_PRESETS } from '@vibisual/shared';

import { logger } from '../logger.js';

import { parseJsonc } from './runConfigScanner.js';
import { atomicWriteFileSync } from './statePersistence.js';

/**
 * 읽을 파일의 상한. `~/.claude.json` 은 프로젝트가 쌓이면 수 MB 까지 자라므로 설정 파일치고는
 * 넉넉히 잡는다(이보다 크면 우리가 아는 그 파일이 아니다 = 읽지 않는다).
 */
const CONFIG_FILE_MAX_BYTES = 16 * 1024 * 1024;

/** 한 서버의 원문 정의(설정 파일에 적힌 그대로). 모르는 필드는 건드리지 않는다. */
interface RawServerDef {
  type?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > CONFIG_FILE_MAX_BYTES) return null;
    // 남이 주석을 달아 둔 설정 파일을 통째로 "없음" 으로 만들지 않는다(#17-20 ② 의 관용 파서 재사용).
    const parsed = parseJsonc(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `~/.claude.json` — Claude Code 의 사용자 상태 파일(프로젝트별 엔트리가 여기 산다). */
export function claudeJsonPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

/** `~/.claude/settings.json` — 사용자 설정(정책·승인 키). */
function userSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/** 관리자(managed) 설정 — 플랫폼별 고정 위치. 없으면 없는 대로 둔다. */
function managedSettingsPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env['PROGRAMDATA'] ?? 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json');
  }
  if (process.platform === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-settings.json';
  }
  return '/etc/claude-code/managed-settings.json';
}

/** 경로 비교용 정규화 — 대소문자·구분자·끝 구분자를 지운다(같은 폴더의 다른 표기를 하나로 본다). */
function normalizePathKey(p: string): string {
  return p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * `~/.claude.json` 의 `projects` 에서 이 프로젝트를 가리키는 **모든** 키.
 *
 * 실측상 같은 폴더가 `C:/…` 와 `C:\…` 두 표기로 함께 들어 있다. 한쪽만 보면 있는 서버가
 * 없다고 나오고, 한쪽만 고치면 토글이 없던 일이 된다.
 */
function findProjectKeys(projects: Record<string, unknown>, projectPath: string): string[] {
  const want = normalizePathKey(projectPath);
  return Object.keys(projects).filter((k) => normalizePathKey(k) === want);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** stdio / http / sse 판정 — `type` 이 있으면 그대로, 없으면 `url` 유무로 가른다. */
function detectTransport(def: RawServerDef): McpServerTransport {
  const t = typeof def.type === 'string' ? def.type.toLowerCase() : '';
  if (t === 'http' || t === 'sse' || t === 'stdio') return t;
  return typeof def.url === 'string' && def.url.length > 0 ? 'http' : 'stdio';
}

/**
 * 실행 파일이 PATH 에 있는가. Windows 는 확장자가 없으면 못 찾으므로 `PATHEXT` 까지 본다.
 * 경로가 들어 있는 명령(`./x`, `C:\x\y.exe`)은 PATH 를 훑지 않고 그 자리만 확인한다.
 */
function commandExists(command: string, memo: Map<string, boolean>): boolean {
  const cached = memo.get(command);
  if (cached !== undefined) return cached;

  const exts = process.platform === 'win32'
    ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];

  const hit = (base: string): boolean => {
    try {
      if (fs.existsSync(base) && fs.statSync(base).isFile()) return true;
    } catch {
      /* 접근 불가 경로는 없는 것으로 본다 */
    }
    return exts.some((ext) => fs.existsSync(base + ext.toLowerCase()) || fs.existsSync(base + ext));
  };

  let found = false;
  try {
    if (command.includes('/') || command.includes('\\')) {
      found = hit(command);
    } else {
      const dirs = (process.env['PATH'] ?? process.env['Path'] ?? '').split(path.delimiter).filter(Boolean);
      found = dirs.some((d) => {
        try {
          return hit(path.join(d, command));
        } catch {
          return false;
        }
      });
    }
  } catch {
    found = false;
  }
  memo.set(command, found);
  return found;
}

/** 값이 비었거나 환경변수 참조가 풀리지 않은 항목의 **이름**들(값은 담지 않는다 — 비밀이다). */
function unresolvedEnvKeys(env: unknown): string[] {
  const rec = asRecord(env);
  if (!rec) return [];
  const out: string[] = [];
  const REF = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/;
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v !== 'string' || v.trim().length === 0) {
      out.push(k);
      continue;
    }
    const m = REF.exec(v);
    if (m && !process.env[m[1] ?? '']) out.push(k);
  }
  return out;
}

/** 정책 거부 목록(`deniedMcpServers`)에서 이름만 추린다 — 명령·URL 패턴 대조까지는 하지 않는다. */
function deniedNames(settings: Record<string, unknown>): string[] {
  const list = settings['deniedMcpServers'];
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    const n = rec?.['serverName'];
    if (typeof n === 'string' && n.length > 0) out.push(n);
  }
  return out;
}

/** 설정 병합 결과 — `managed > settings.local > settings > user` 를 합집합으로 본다. */
interface MergedSettings {
  enabledMcpjson: Set<string>;
  disabledMcpjson: Set<string>;
  enableAllProject: boolean;
  denied: Set<string>;
  files: string[];
}

function mergeSettings(projectPath: string): MergedSettings {
  const files = [
    managedSettingsPath(),
    path.join(projectPath, '.claude', 'settings.local.json'),
    path.join(projectPath, '.claude', 'settings.json'),
    userSettingsPath(),
  ];
  const merged: MergedSettings = {
    enabledMcpjson: new Set<string>(),
    disabledMcpjson: new Set<string>(),
    enableAllProject: false,
    denied: new Set<string>(),
    files,
  };
  for (const file of files) {
    const s = readJsonObject(file);
    if (!s) continue;
    for (const n of asStringArray(s['enabledMcpjsonServers'])) merged.enabledMcpjson.add(n);
    for (const n of asStringArray(s['disabledMcpjsonServers'])) merged.disabledMcpjson.add(n);
    if (s['enableAllProjectMcpServers'] === true) merged.enableAllProject = true;
    for (const n of deniedNames(s)) merged.denied.add(n);
  }
  return merged;
}

/** 한 서버 정의 → 화면 한 줄. 상태·요구조건은 부르는 쪽이 판정해 넘긴다. */
function toEntry(
  name: string,
  def: RawServerDef,
  scope: McpServerScope,
  sourceFile: string,
  state: McpServerState,
  requirements: McpRequirement[],
  toggleable: boolean,
): McpServerEntry {
  const envRec = asRecord(def.env);
  return {
    id: `${scope}:${name}`,
    name,
    scope,
    transport: detectTransport(def),
    state,
    ...(typeof def.command === 'string' ? { command: def.command } : {}),
    ...(Array.isArray(def.args) ? { args: def.args.filter((a): a is string => typeof a === 'string') } : {}),
    ...(typeof def.url === 'string' ? { url: def.url } : {}),
    ...(envRec ? { envKeys: Object.keys(envRec) } : {}),
    sourceFile,
    requirements,
    toggleable,
  };
}

/**
 * 그 서버를 실제로 쓰기까지 남은 일. **읽어서** 판정한다(추측을 확신처럼 굴지 않는다).
 *
 * "적용은 다음 세션부터" 는 여기 넣지 않는다 — 모든 꺼진 줄에 똑같이 붙어 패널 발치의 안내와
 * 같은 말을 N번 반복하게 되고, 호박색 줄은 "손볼 게 있다" 는 뜻이라 꺼 둔 줄에 오해를 만든다.
 * 그 한마디는 패널 발치에서 **한 번만** 한다(#17-31 ⑤).
 */
function buildRequirements(
  def: RawServerDef,
  transport: McpServerTransport,
  state: McpServerState,
  denied: boolean,
  memo: Map<string, boolean>,
): McpRequirement[] {
  const reqs: McpRequirement[] = [];
  if (denied) reqs.push({ kind: 'policy' });
  if (state === 'pending') reqs.push({ kind: 'approval' });

  if (transport === 'stdio' && typeof def.command === 'string' && def.command.length > 0) {
    if (!commandExists(def.command, memo)) reqs.push({ kind: 'missing-command', detail: def.command });
  }
  const missingEnv = unresolvedEnvKeys(def.env);
  if (missingEnv.length > 0) reqs.push({ kind: 'missing-env', detail: missingEnv.join(', ') });

  if (transport !== 'stdio') reqs.push({ kind: 'auth' });
  return reqs;
}

/**
 * 이 프로젝트의 MCP 인벤토리. 매 호출마다 디스크를 다시 읽는다(캐시 ❌ — 새로고침이 곧 재조회).
 *
 * @param presetIds 이 에이전트가 켜 둔 프리셋 id(`AgentConfig.mcpServers`). 없으면 프리셋은 전부 꺼짐으로 뜬다.
 */
export function scanMcpInventory(projectPath: string, presetIds?: readonly string[]): McpInventory {
  const memo = new Map<string, boolean>();
  const servers: McpServerEntry[] = [];
  const settings = mergeSettings(projectPath);
  const scanned: string[] = [];

  const claudeJson = claudeJsonPath();
  const root = readJsonObject(claudeJson);
  scanned.push(claudeJson);

  const projects = asRecord(root?.['projects']) ?? {};
  const projectEntries = findProjectKeys(projects, projectPath)
    .map((k) => asRecord(projects[k]))
    .filter((e): e is Record<string, unknown> => !!e);

  // 범위 무관 끔 목록(= `/mcp disable`). 표기가 갈린 엔트리가 여럿이면 합집합으로 본다.
  const disabledNames = new Set<string>();
  for (const e of projectEntries) {
    for (const n of asStringArray(e['disabledMcpServers'])) disabledNames.add(n);
    for (const n of asStringArray(e['enabledMcpjsonServers'])) settings.enabledMcpjson.add(n);
    for (const n of asStringArray(e['disabledMcpjsonServers'])) settings.disabledMcpjson.add(n);
  }

  const add = (name: string, def: RawServerDef, scope: McpServerScope, sourceFile: string): void => {
    const denied = settings.denied.has(name);
    let state: McpServerState;
    if (denied || disabledNames.has(name)) {
      state = 'disabled';
    } else if (scope === 'project') {
      if (settings.disabledMcpjson.has(name)) state = 'disabled';
      else if (settings.enabledMcpjson.has(name) || settings.enableAllProject) state = 'enabled';
      else state = 'pending';
    } else {
      state = 'enabled';
    }
    const transport = detectTransport(def);
    servers.push(
      toEntry(name, def, scope, sourceFile, state, buildRequirements(def, transport, state, denied, memo), !denied),
    );
  };

  // ① 글로벌(user) — 모든 프로젝트에서 보인다.
  for (const [name, def] of Object.entries(asRecord(root?.['mcpServers']) ?? {})) {
    const rec = asRecord(def);
    if (rec) add(name, rec as RawServerDef, 'global', claudeJson);
  }

  // ② 로컬 — 이 프로젝트 엔트리에만 적힌 것.
  for (const entry of projectEntries) {
    for (const [name, def] of Object.entries(asRecord(entry['mcpServers']) ?? {})) {
      const rec = asRecord(def);
      // 같은 이름이 여러 표기 엔트리에 들어 있어도 줄은 하나여야 한다.
      if (rec && !servers.some((s) => s.scope === 'local' && s.name === name)) {
        add(name, rec as RawServerDef, 'local', claudeJson);
      }
    }
  }

  // ③ 프로젝트 — 레포에 커밋되는 `.mcp.json`(읽기 전용).
  const mcpJson = path.join(projectPath, '.mcp.json');
  scanned.push(mcpJson);
  const projectFile = readJsonObject(mcpJson);
  for (const [name, def] of Object.entries(asRecord(projectFile?.['mcpServers']) ?? {})) {
    const rec = asRecord(def);
    if (rec) add(name, rec as RawServerDef, 'project', mcpJson);
  }

  // ④ 프리셋 — 파일이 아니라 `AgentConfig.mcpServers` 가 진실이다(#17-20 ⑥).
  const enabledPresets = new Set(presetIds ?? []);
  for (const preset of MCP_SERVER_PRESETS) {
    const def: RawServerDef = {
      command: preset.command,
      args: [...preset.args],
      ...(preset.env ? { env: preset.env } : {}),
    };
    const state: McpServerState = enabledPresets.has(preset.id) ? 'enabled' : 'disabled';
    const entry = toEntry(
      preset.id,
      def,
      'preset',
      'MCP_SERVER_PRESETS',
      state,
      buildRequirements(def, 'stdio', state, false, memo),
      true,
    );
    entry.presetId = preset.id;
    entry.docsUrl = preset.docsUrl;
    if (preset.requiresKey) entry.requiresKey = preset.requiresKey;
    servers.push(entry);
  }

  scanned.push(...settings.files);

  return {
    projectPath,
    servers,
    // 없는 파일까지 적으면 "어디를 봤는지"가 아니라 "무엇이 없는지"가 되어 읽는 사람이 헷갈린다.
    scanned: scanned.filter((f) => fs.existsSync(f)),
    autoApproveProject: settings.enableAllProject,
    scannedAt: Date.now(),
  };
}

/** 배열에서 값을 넣거나 빼고, 비면 키 자체를 지운다(우리 흔적을 남기지 않는다 — ④). */
function setInList(entry: Record<string, unknown>, key: string, name: string, present: boolean): void {
  const cur = asStringArray(entry[key]);
  const next = present ? (cur.includes(name) ? cur : [...cur, name]) : cur.filter((n) => n !== name);
  if (next.length === 0) delete entry[key];
  else entry[key] = next;
}

/**
 * 켜기/끄기 — 쓰는 곳은 `~/.claude.json` 의 그 프로젝트 엔트리 하나뿐이다(§5.5 #17-31 ④).
 *
 * `.mcp.json`·`.claude/settings*.json` 은 읽기만 한다. 파싱이 안 되거나 최상위가 객체가 아니면
 * **쓰지 않는다** — 남의 상태 파일을 망가뜨리는 것보다 토글이 안 되는 편이 낫다.
 */
export function setMcpServerEnabled(
  projectPath: string,
  scope: McpServerScope,
  name: string,
  enabled: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (scope === 'preset') {
    // 프리셋의 진실은 `AgentConfig.mcpServers` 다 — 그 통로(PUT /api/agent-config)를 쓴다.
    return { ok: false, reason: 'preset scope is toggled through agent config' };
  }

  const file = claudeJsonPath();
  const root = readJsonObject(file);
  if (!root) return { ok: false, reason: 'cannot read ~/.claude.json' };

  if (!asRecord(root['projects'])) root['projects'] = {};
  const projectsRec = asRecord(root['projects']);
  if (!projectsRec) return { ok: false, reason: 'projects is not an object' };

  let keys = findProjectKeys(projectsRec, projectPath);
  if (keys.length === 0) {
    // 아직 이 프로젝트로 claude 를 띄운 적이 없는 경우 — 그때만 새로 만든다.
    const fresh = path.resolve(projectPath);
    projectsRec[fresh] = {};
    keys = [fresh];
  }

  for (const key of keys) {
    const entry = asRecord(projectsRec[key]);
    if (!entry) continue;
    // 범위 무관 끔 목록(= `/mcp disable` 이 쓰는 그 배열).
    setInList(entry, 'disabledMcpServers', name, !enabled);
    if (scope === 'project') {
      // `.mcp.json` 서버는 켜기가 곧 승인이다.
      setInList(entry, 'enabledMcpjsonServers', name, enabled);
      setInList(entry, 'disabledMcpjsonServers', name, !enabled);
    }
  }

  try {
    atomicWriteFileSync(file, `${JSON.stringify(root, null, 2)}\n`);
    return { ok: true };
  } catch (err) {
    logger.warn(`[mcp-inventory] write failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, reason: 'write failed' };
  }
}
