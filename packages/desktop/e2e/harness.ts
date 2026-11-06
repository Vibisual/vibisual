// Launches the built desktop app (out/main/index.cjs) as a brand-new user: its own userData, HOME, APPDATA and PATH,
// with the fake engines first on PATH. Nothing here may touch the developer's real profile — every path the app can
// write resolves under one scratch root (os.homedir() follows HOME/USERPROFILE; userData follows --user-data-dir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { installFakeEngines } from './fake-engine/install.mjs';

const require = createRequire(import.meta.url);
export const DESKTOP_ROOT = path.resolve(__dirname, '..');
export const MAIN_ENTRY = path.join(DESKTOP_ROOT, 'out', 'main', 'index.cjs');

export interface Sandbox {
  root: string;
  home: string;
  userData: string;
  binDir: string;
  stateDir: string;
  project: string;
  scenarioFile: string;
}

/** One scratch root per run. The project folder sits outside any git repo so registration does not climb. */
export function createSandbox(scenario: string): Sandbox {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'vib-e2e-'));
  const s: Sandbox = {
    root,
    home: path.join(root, 'home'),
    userData: path.join(root, 'user-data'),
    binDir: path.join(root, 'bin'),
    stateDir: path.join(root, 'engine-state'),
    project: path.join(root, 'workspace', 'e2e-project'),
    scenarioFile: path.join(__dirname, 'fake-engine', 'scenarios', scenario),
  };
  for (const dir of [s.home, s.userData, s.project]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(s.project, 'README.md'), '# e2e project\n');
  installFakeEngines({ binDir: s.binDir, stateDir: s.stateDir, scenarioFile: s.scenarioFile });
  // Auto-update would fetch the real engine into ~/.vibisual/cli-engines and outrank the fake on PATH. It is a
  // per-user setting the app reads at load, so the fixture writes it the way the Options window would.
  fs.mkdirSync(path.join(s.home, '.vibisual'), { recursive: true });
  fs.writeFileSync(path.join(s.home, '.vibisual', 'user-defaults.json'), JSON.stringify({
    claudeAutoUpdate: { enabled: false },
    codexAutoUpdate: { enabled: false },
  }));
  return s;
}

/** Child env: only the sandbox is reachable. Variables that would point the app at the real profile are dropped. */
export function sandboxEnv(s: Sandbox, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const drop = new Set(['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'VIBISUAL_HOME',
    'VIBISUAL_SERVER_URL', 'VIBISUAL_SKIP_HOOK_INSTALL', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']);
  const env: NodeJS.ProcessEnv = {};
  let pathValue = '';
  for (const [k, v] of Object.entries(base)) {
    if (drop.has(k.toUpperCase()) || v === undefined) continue;
    if (k.toLowerCase() === 'path') {
      pathValue = v;
      continue;
    }
    env[k] = v;
  }
  const appData = path.join(s.home, 'AppData', 'Roaming');
  const localAppData = path.join(s.home, 'AppData', 'Local');
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(localAppData, { recursive: true });
  return {
    ...env,
    PATH: [s.binDir, pathValue].filter(Boolean).join(path.delimiter),
    HOME: s.home,
    USERPROFILE: s.home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    // The launchers set these too; a launcher the app unwraps (Windows .cmd) skips its `set` lines.
    VIBISUAL_FAKE_ENGINE_STATE: s.stateDir,
    VIBISUAL_FAKE_ENGINE_SCENARIO: s.scenarioFile,
  };
}

export async function launch(s: Sandbox): Promise<ElectronApplication> {
  if (!fs.existsSync(MAIN_ENTRY)) throw new Error(`build first: ${MAIN_ENTRY} is missing (pnpm build)`);
  const executablePath = require('electron') as unknown as string;
  // `-r` loads the test-only preload into the main process ahead of the app (the same switch Playwright's own loader uses).
  const args = ['-r', path.join(__dirname, 'main-preload.cjs'), MAIN_ENTRY, `--user-data-dir=${s.userData}`];
  // GitHub's Linux runners have no setuid sandbox helper; the installed-app smoke passes the same switch.
  if (process.platform === 'linux') args.push('--no-sandbox');
  // macOS: 서명 없는 앱의 키체인 읽기(safeStorage·쿠키 암호화)가 확인 창을 띄워 무인 러너에서 스플래시째 멈춘다 — 시험용 가짜 키체인.
  if (process.platform === 'darwin') args.push('--use-mock-keychain');
  return _electron.launch({ executablePath, args, env: sandboxEnv(s) as Record<string, string>, cwd: s.root, timeout: 90_000 });
}

/** The main renderer, not the splash (data: URL) nor an overlay/detached window. */
export async function mainWindow(app: ElectronApplication, timeoutMs = 90_000): Promise<Page> {
  const isMain = (p: Page) => /\/out\/renderer\/index\.html(?:$|[?#](?!.*(?:overlay|detached)=1))/.test(p.url().replace(/\\/g, '/'));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = app.windows().find(isMain);
    if (found) return found;
    await app.waitForEvent('window', { timeout: Math.max(1, deadline - Date.now()) }).catch(() => undefined);
  }
  throw new Error(`main window did not open; windows: ${app.windows().map((w) => w.url()).join(', ')}`);
}

/** `ready`/`settle-cap` reveal = renderer reported its first screen; forced/hard-cap is a failure (installed-smoke.cjs). */
export async function waitForReveal(s: Sandbox, timeoutMs = 90_000): Promise<string> {
  const log = path.join(s.userData, 'logs', 'main-stall.log');
  const deadline = Date.now() + timeoutMs;
  let text = '';
  while (Date.now() < deadline) {
    try {
      text = fs.readFileSync(log, 'utf8');
    } catch {
      text = '';
    }
    const reveals = [...text.matchAll(/startup main window revealed \((\w[\w-]*),/g)].map((m) => m[1]);
    if (reveals.length > 0) return reveals[reveals.length - 1]!;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`main window was never revealed:\n${text}`);
}

/** Parsed fake-engine call log (one JSON object per line). */
export function engineCalls(s: Sandbox, engine: 'claude' | 'codex' = 'claude'): Record<string, any>[] {
  try {
    return fs.readFileSync(path.join(s.stateDir, `${engine}-calls.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Folder pickers are OS processes the server spawns via child_process.execFile; answer them from the main process. */
export async function answerFolderPicker(app: ElectronApplication, folder: string): Promise<void> {
  const how = await app.evaluate((_electron, dir) => {
    const req = (globalThis as any).__vibE2eRequire;
    if (typeof req !== 'function') return 'no-require (main-preload.cjs did not load)';
    const cp = req('node:child_process');
    const g = globalThis as any;
    if (!g.__vibE2eOriginalExecFile) g.__vibE2eOriginalExecFile = cp.execFile;
    const original = g.__vibE2eOriginalExecFile;
    cp.execFile = function patched(file: string, args: unknown, ...rest: any[]) {
      const list = Array.isArray(args) ? args.map(String) : [];
      const isPicker = (file === 'powershell' && list.includes('-STA'))
        || (file === 'osascript' && list.some((a) => a.includes('choose folder')))
        || (file === 'zenity' && list.includes('--directory'))
        || (file === 'kdialog' && list.includes('--getexistingdirectory'));
      if (!isPicker) return original.call(this, file, args, ...rest);
      const cb = rest.find((x) => typeof x === 'function');
      g.__vibE2ePickerCalls = (g.__vibE2ePickerCalls ?? 0) + 1;
      setTimeout(() => cb?.(null, `${dir}\n`, ''), 50);
      return { pid: 0, kill() {}, on() { return this; } };
    };
    return 'patched';
  }, folder);
  if (how !== 'patched') throw new Error(`could not patch the folder picker in the main process (${how})`);
}

/** How many folder-picker launches the patch answered — proves the click reached the server route. */
export async function folderPickerCalls(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => Number((globalThis as any).__vibE2ePickerCalls ?? 0));
}

export async function quit(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  const exited = new Promise<void>((resolve) => {
    if (proc.exitCode !== null) resolve();
    else proc.once('exit', () => resolve());
  });
  await app.evaluate(({ app: electronApp }) => { electronApp.quit(); }).catch(() => undefined);
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('app did not exit within 30s')), 30_000))]);
}

export function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
