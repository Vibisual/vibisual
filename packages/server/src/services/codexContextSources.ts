import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONTEXT_SOURCE_IDS as IDS, estimateTokens, resolveContextEnabled,
  type ContextOverrides, type ContextScopeKeys, type ContextSourceChild, type ContextSourceItem,
} from '@vibisual/shared';
import { codexHome } from './codexCli.js';
import { readCodexEffectiveConfig, scanCodexConfigToml, TomlScanner, type TomlValue } from './codexConfigService.js';
import { codexInventoryService, readCodexSkillsIn, readCodexPluginSkillsIn } from './codexInventoryService.js';

export interface CodexContextSourceOptions {
  home?: string;
  userHome?: string;
}

type NativeItem = Omit<ContextSourceItem, 'enabled' | 'overrideScope' | 'scopeStates' | 'scopeOverrides'>;
type Entry = { keys: string[]; value: TomlValue };

function skillConfigTables(raw: string): TomlValue[] {
  const result: TomlValue[] = [];
  const headers = [...raw.matchAll(/^\s*\[\[\s*skills\.config\s*\]\]\s*(?:#.*)?$/gm)];
  for (const header of headers) {
    const start = header.index! + header[0].length;
    const rest = raw.slice(start);
    const next = /^\s*\[/m.exec(rest);
    const values: Record<string, TomlValue> = {};
    new TomlScanner(next ? rest.slice(0, next.index) : rest).scan((keys, value) => {
      if (keys.length === 1 && (keys[0] === 'path' || keys[0] === 'enabled')) values[keys[0]] = value;
    });
    if (typeof values.path === 'string') result.push(values);
  }
  return result;
}

function read(file: string): string | undefined {
  try { return fs.readFileSync(file, 'utf8'); } catch { return undefined; }
}

/** Reuse the existing trusted-project/profile precedence; never return raw config to the client. */
function nativeSettings(cwd: string, options: CodexContextSourceOptions): Map<string, TomlValue> {
  const effective = readCodexEffectiveConfig({ cwd, codexHomeDir: options.home ?? codexHome(), platform: process.platform });
  const files = [...new Set(effective.layers.filter((layer) => layer.source !== 'profile').map((layer) => layer.path))];
  const scans = files.map((file) => {
    const raw = read(file) ?? '';
    const entries: Entry[] = [];
    new TomlScanner(raw).scan((keys, value) => entries.push({ keys, value }));
    const skillConfig = skillConfigTables(raw);
    if (skillConfig.length) entries.push({ keys: ['skills', 'config'], value: skillConfig });
    return { entries, profile: scanCodexConfigToml(raw).profile };
  });
  const profile = scans.find((scan) => scan.profile)?.profile;
  const result = new Map<string, TomlValue>();
  const put = (keys: string[], value: TomlValue): void => {
    const key = JSON.stringify(keys);
    if (!result.has(key)) result.set(key, value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [child, v] of Object.entries(value)) put([...keys, child], v);
    }
  };
  if (profile) for (const scan of scans) for (const entry of scan.entries) {
    if (entry.keys[0] === 'profiles' && entry.keys[1] === profile) put(entry.keys.slice(2), entry.value);
  }
  for (const scan of scans) for (const entry of scan.entries) {
    if (entry.keys[0] !== 'profiles') put(entry.keys, entry.value);
  }
  return result;
}

function setting(settings: Map<string, TomlValue>, ...keys: string[]): TomlValue | undefined {
  return settings.get(JSON.stringify(keys));
}

function configuredNames(settings: Map<string, TomlValue>, head: string): string[] {
  return [...new Set([...settings.keys()].map((key) => JSON.parse(key) as string[])
    .filter((keys) => keys[0] === head && keys[1]).map((keys) => keys[1]!))];
}

function ancestors(cwd: string, markers: string[]): string[] {
  const dirs: string[] = [];
  let dir = path.resolve(cwd);
  for (;;) {
    dirs.push(dir);
    if (markers.some((marker) => fs.existsSync(path.join(dir, marker)))) return dirs.reverse();
    const parent = path.dirname(dir);
    if (parent === dir) return [path.resolve(cwd)];
    dir = parent;
  }
}

function fileChild(file: string, title = path.basename(file), text = read(file)): ContextSourceChild | undefined {
  if (text === undefined) return undefined;
  let updatedAt: number | undefined;
  try { updatedAt = fs.statSync(file).mtimeMs; } catch { /* File disappeared during measurement. */ }
  return { title, path: file, chars: text.length, tokens: estimateTokens(text), ...(updatedAt ? { updatedAt } : {}) };
}

function firstDoc(dir: string, fallback: string[] = []): ContextSourceChild | undefined {
  for (const name of ['AGENTS.override.md', 'AGENTS.md', ...fallback]) {
    const child = fileChild(path.join(dir, name));
    if (child?.chars) return child;
  }
  return undefined;
}

function source(id: string, label: string, category: ContextSourceItem['category'], control: ContextSourceItem['control'], children: ContextSourceChild[], defaultEnabled: boolean, detail?: string): NativeItem {
  return {
    id, title: label, labelKey: `ide.context.src.${label}`, category, control, children,
    chars: children.reduce((sum, child) => sum + child.chars, 0),
    tokens: children.reduce((sum, child) => sum + child.tokens, 0),
    defaultEnabled, estimated: true, ...(detail ? { detail } : {}),
  };
}

/** Only the developer string is exposed; credentials elsewhere in config.toml never become preview files. */
export function readCodexDeveloperInstructions(cwd: string, options: CodexContextSourceOptions = {}): string {
  const value = setting(nativeSettings(cwd, options), 'developer_instructions');
  return typeof value === 'string' ? value : '';
}

/** Skill sharing must respect the same disabled-skill settings as native context discovery. */
export function readCodexConfiguredSkills(cwd: string, options: CodexContextSourceOptions = {}): TomlValue | undefined {
  return setting(nativeSettings(cwd, options), 'skills', 'config');
}

export function readCodexContextText(cwd: string, sourceId: string, options: CodexContextSourceOptions = {}): string | undefined {
  return sourceId === IDS.codexDeveloperInstructions ? readCodexDeveloperInstructions(cwd, options) : undefined;
}

/** Local, read-only measurement. Runtime-owned blocks remain visible without pretending they can be disabled. */
export function readCodexContextSources(cwd: string, options: CodexContextSourceOptions = {}): NativeItem[] {
  const home = options.home ?? codexHome();
  const userHome = options.userHome ?? os.homedir();
  const settings = nativeSettings(cwd, options);
  const configuredMarkers = setting(settings, 'project_root_markers');
  const markers = Array.isArray(configuredMarkers) ? configuredMarkers.filter((x): x is string => typeof x === 'string') : ['.git'];
  const roots = markers.length ? ancestors(cwd, markers) : [path.resolve(cwd)];
  const configuredFallback = setting(settings, 'project_doc_fallback_filenames');
  const fallback = Array.isArray(configuredFallback) ? configuredFallback.filter((x): x is string => typeof x === 'string') : [];
  const projectDocs = roots.map((root) => firstDoc(root, fallback)).filter((child): child is ContextSourceChild => Boolean(child));
  const globalDoc = firstDoc(home);
  const cached = options.home || options.userHome ? null : codexInventoryService.getFor(cwd);
  const mcps = configuredNames(settings, 'mcp_servers');
  const plugins = configuredNames(settings, 'plugins');
  const disabledPluginNames = new Set(plugins.filter((name) => setting(settings, 'plugins', name, 'enabled') === false).map((name) => name.split('@')[0]));
  const configuredSkills = setting(settings, 'skills', 'config');
  const disabledSkills = new Set((Array.isArray(configuredSkills) ? configuredSkills : []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.enabled !== false || typeof entry.path !== 'string') return [];
    return [path.resolve(entry.path)];
  }));
  const skills = cached?.skills ?? [
    ...readCodexSkillsIn(path.join(home, 'skills')),
    ...readCodexSkillsIn(path.join(home, 'skills', '.system'), 'system'),
    ...readCodexSkillsIn(path.join(userHome, '.agents', 'skills')),
    ...roots.flatMap((root) => readCodexSkillsIn(path.join(root, '.agents', 'skills'))),
    ...readCodexPluginSkillsIn(path.join(home, 'plugins', 'cache')),
  ];
  const skillFiles = new Map<string, ContextSourceChild>();
  for (const skill of skills) {
    if (skill.pluginName && disabledPluginNames.has(skill.pluginName)) continue;
    const file = path.join(skill.path, 'SKILL.md');
    if (disabledSkills.has(path.resolve(file))) continue;
    const child = fileChild(file, skill.name, `${skill.name}: ${skill.description ?? ''}`);
    if (child && fs.existsSync(file)) skillFiles.set(path.resolve(file), child);
  }
  const developer = setting(settings, 'developer_instructions');
  const developerText = typeof developer === 'string' ? developer : '';
  const runtimeMcps = cached?.mcpServers.filter((mcp) => !mcps.includes(mcp.name)) ?? [];
  const runtimePlugins = cached?.plugins.filter((plugin) => plugin.installed && !plugins.includes(`${plugin.name}@${plugin.marketplace ?? ''}`)) ?? [];
  let hookEvents: string[] = [];
  try { hookEvents = Object.keys((JSON.parse(read(path.join(home, 'hooks.json')) ?? '{}') as { hooks?: object }).hooks ?? {}); } catch { /* Invalid hook file. */ }
  const items = [
    source(IDS.codexInstructions, 'codexInstructions', 'instructions', 'spawn', projectDocs, projectDocs.length > 0 && setting(settings, 'project_doc_max_bytes') !== 0),
    source(IDS.codexGlobalInstructions, 'codexGlobalInstructions', 'instructions', 'none', globalDoc ? [globalDoc] : [], Boolean(globalDoc)),
    source(IDS.codexSkills, 'codexSkills', 'skills', 'spawn', [...skillFiles.values()], setting(settings, 'skills', 'include_instructions') !== false),
    { ...source(IDS.codexDeveloperInstructions, 'codexDeveloperInstructions', 'instructions', 'spawn', [], Boolean(developerText)), chars: developerText.length, tokens: estimateTokens(developerText), estimated: false },
    source(IDS.codexCollaborationInstructions, 'codexCollaborationInstructions', 'system', 'spawn', [], setting(settings, 'include_collaboration_mode_instructions') !== false),
    source(IDS.codexMcp, 'codexMcp', 'tools', 'spawn', [], mcps.some((name) => setting(settings, 'mcp_servers', name, 'enabled') !== false), mcps.join(', ')),
    source(IDS.codexPlugins, 'codexPlugins', 'plugins', 'spawn', [], plugins.some((name) => setting(settings, 'plugins', name, 'enabled') !== false), plugins.join(', ')),
    source(IDS.codexRuntimeMcp, 'codexRuntimeMcp', 'tools', 'external', [], runtimeMcps.some((mcp) => mcp.enabled), runtimeMcps.map((mcp) => mcp.name).join(', ')),
    source(IDS.codexRuntimePlugins, 'codexRuntimePlugins', 'plugins', 'external', [], runtimePlugins.some((plugin) => plugin.enabled), runtimePlugins.map((plugin) => plugin.name).join(', ')),
    source(IDS.codexHooks, 'codexHooks', 'system', 'none', [], hookEvents.length > 0, hookEvents.join(', ')),
    source(IDS.codexSystemPrompt, 'codexSystemPrompt', 'system', 'none', [], true),
  ];
  return items;
}

/** Verified with `codex debug prompt-input`; no global config or shared instruction file is modified. */
export function buildCodexContextArgs(overrides: ContextOverrides | undefined, scope: ContextScopeKeys, cwd: string, options: CodexContextSourceOptions = {}): string[] {
  if (!overrides) return [];
  const args: string[] = [];
  const switches = [
    [IDS.codexInstructions, 'project_doc_max_bytes', '32768', '0'],
    [IDS.codexSkills, 'skills.include_instructions', 'true', 'false'],
    [IDS.codexDeveloperInstructions, 'developer_instructions', undefined, '""'],
    [IDS.codexCollaborationInstructions, 'include_collaboration_mode_instructions', 'true', 'false'],
  ] as const;
  for (const [id, key, on, off] of switches) {
    const resolved = resolveContextEnabled(overrides, scope, id, true);
    if (!resolved.scope) continue;
    if (!resolved.enabled) args.push('-c', `${key}=${off}`);
    else if (on !== undefined) {
      // An explicit ON preserves a user's configured project size unless it was disabled at zero.
      if (id === IDS.codexInstructions && setting(nativeSettings(cwd, options), 'project_doc_max_bytes') !== 0) continue;
      args.push('-c', `${key}=${on}`);
    }
  }
  // A whole-table CLI override merges into the existing configuration. Quoted dotted -c paths
  // do not: the CLI splits them naively, so names containing periods require an inline table.
  // ON inherits each entry's original enabled flag instead of enabling disabled integrations.
  for (const [id, table] of [[IDS.codexMcp, 'mcp_servers'], [IDS.codexPlugins, 'plugins']] as const) {
    if (resolveContextEnabled(overrides, scope, id, true).enabled) continue;
    const names = configuredNames(nativeSettings(cwd, options), table);
    if (names.length) args.push('-c', `${table}={${names.map((name) => `${JSON.stringify(name)}={enabled=false}`).join(',')}}`);
  }
  return args;
}
