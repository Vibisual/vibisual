/**
 * hooks/install.ts — Auto-register Vibisual hooks in ~/.claude/settings.json
 *
 * Reads the user's Claude Code settings, deep-merges our hook configuration
 * without overwriting existing hooks, and writes back.
 *
 * Run with: npx tsx hooks/install.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HookEntry {
  type: string;
  command: string;
  timeout: number;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Marker substring used to detect existing Vibisual hooks */
const VIBISUAL_MARKER = 'vibisual';

const HOOK_EVENT_NAMES = ['PreToolUse', 'PostToolUse', 'Notification', 'Stop'] as const;
const SESSION_START_EVENT = 'SessionStart' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProjectRoot(): string {
  // This script lives at <PROJECT_ROOT>/hooks/install.ts
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);

  // On Windows, URL pathname starts with /C:/... — strip leading slash
  const normalised = process.platform === 'win32'
    ? scriptDir.replace(/^\/([A-Za-z]:)/, '$1')
    : scriptDir;

  return path.resolve(normalised, '..');
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function getSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function readSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  const raw = fs.readFileSync(settingsPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('settings.json root is not a JSON object');
  }

  return parsed as ClaudeSettings;
}

function buildHookCommand(projectRoot: string): string {
  const handlerPath = toForwardSlashes(path.join(projectRoot, 'hooks', 'handler.mjs'));
  return `node ${handlerPath}`;
}

function buildSessionStartCommand(projectRoot: string): string {
  const handlerPath = toForwardSlashes(
    path.join(projectRoot, 'hooks', 'session-start-handler.mjs'),
  );
  return `node ${handlerPath}`;
}

function buildMatcherEntry(command: string): HookMatcher {
  return {
    matcher: '*',
    hooks: [
      {
        type: 'command',
        command,
        timeout: 5,
      },
    ],
  };
}

/**
 * Returns the index of an existing Vibisual hook matcher inside the array,
 * or -1 if none is found.
 */
function findVibisualIndex(matchers: HookMatcher[]): number {
  return matchers.findIndex((m) =>
    m.hooks.some((h) => h.command.toLowerCase().includes(VIBISUAL_MARKER)),
  );
}

function mergeHooks(
  settings: ClaudeSettings,
  toolUseCommand: string,
  sessionStartCommand: string,
): { updated: string[]; added: string[] } {
  if (settings.hooks === undefined) {
    settings.hooks = {};
  }

  const updated: string[] = [];
  const added: string[] = [];

  const registerEvent = (eventName: string, command: string): void => {
    const existing = settings.hooks![eventName];
    if (!Array.isArray(existing)) {
      settings.hooks![eventName] = [buildMatcherEntry(command)];
      added.push(eventName);
      return;
    }
    const idx = findVibisualIndex(existing);
    if (idx >= 0) {
      existing[idx] = buildMatcherEntry(command);
      updated.push(eventName);
    } else {
      existing.push(buildMatcherEntry(command));
      added.push(eventName);
    }
  };

  for (const eventName of HOOK_EVENT_NAMES) registerEvent(eventName, toolUseCommand);
  registerEvent(SESSION_START_EVENT, sessionStartCommand);

  return { updated, added };
}

function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeSettings(settingsPath: string, settings: ClaudeSettings): void {
  ensureDirectoryExists(settingsPath);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const projectRoot = getProjectRoot();
  const settingsPath = getSettingsPath();
  const toolUseCommand = buildHookCommand(projectRoot);
  const sessionStartCommand = buildSessionStartCommand(projectRoot);

  console.log(`Vibisual project root:    ${toForwardSlashes(projectRoot)}`);
  console.log(`Settings file:            ${settingsPath}`);
  console.log(`Tool-use hook command:    ${toolUseCommand}`);
  console.log(`SessionStart hook command: ${sessionStartCommand}`);
  console.log('');

  let settings: ClaudeSettings;

  try {
    settings = readSettings(settingsPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: failed to parse ${settingsPath}`);
    console.error(`       ${message}`);
    console.error('');
    console.error('Fix the JSON manually or delete the file and re-run this script.');
    process.exit(1);
  }

  const { updated, added } = mergeHooks(settings, toolUseCommand, sessionStartCommand);

  try {
    writeSettings(settingsPath, settings);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: failed to write ${settingsPath}`);
    console.error(`       ${message}`);
    process.exit(1);
  }

  // Report results
  if (added.length > 0) {
    console.log(`Added hooks:   ${added.join(', ')}`);
  }
  if (updated.length > 0) {
    console.log(`Updated hooks: ${updated.join(', ')}`);
  }

  console.log('');
  console.log('Vibisual hooks installed successfully.');
  console.log('Restart Claude Code for changes to take effect.');
}

main();
