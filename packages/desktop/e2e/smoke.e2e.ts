// Whole-app smoke on a brand-new profile, one continuous story:
// first-run gates → pick a folder → create agent bubbles → first command (fake engine, real hooks, real approval
// card) → bubble goes active then completed → the same for Codex → quit → relaunch → the project and bubbles return.
// The fake engines follow the official CLI contracts (fake-engine/official-cli.mjs, the app-server docs), so a spawn
// shape the real CLI would reject fails here first.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ElectronApplication, Page } from 'playwright-core';
import { answerFolderPicker, folderPickerCalls, createSandbox, engineCalls, launch, mainWindow, quit, readJson, waitForReveal, type Sandbox } from './harness';
import { bubble, closeIde, createAgent, firstLine, isActive, isCompleted, sendCommand, until, visible } from './flows';

const PROMPT = 'e2e-first-command: create the greeting file';
const CODEX_PROMPT = 'e2e-codex-command: add the codex note';
const s: Sandbox = createSandbox('first-command.json');
const artifacts = process.env.VIBISUAL_E2E_ARTIFACTS ? path.resolve(process.env.VIBISUAL_E2E_ARTIFACTS) : path.join(s.root, 'artifacts');
let app: ElectronApplication | null = null;
let page: Page | null = null;
let agentId = '';
let agentLabel = '';
let codexId = '';
let codexLabel = '';

function note(message: string): void {
  process.stdout.write(`[e2e] ${message}\n`);
}

async function snapshot(name: string): Promise<void> {
  fs.mkdirSync(artifacts, { recursive: true });
  await page?.screenshot({ path: path.join(artifacts, `${name}.png`) }).catch(() => undefined);
}

function collectArtifacts(): void {
  fs.mkdirSync(artifacts, { recursive: true });
  const copy = (from: string, to: string) => {
    if (fs.existsSync(from)) fs.cpSync(from, path.join(artifacts, to), { recursive: true });
  };
  copy(path.join(s.userData, 'logs'), 'logs');
  copy(s.stateDir, 'engine-state');
  copy(path.join(s.home, '.claude', 'settings.json'), 'claude-settings.json');
  copy(path.join(s.project, '.vibisual', 'save'), 'project-save');
  copy(path.join(s.home, '.vibisual', 'app-state.json'), 'app-state.json');
  note(`artifacts: ${artifacts}`);
}

// One story: once a step fails, the later steps would only report the same failure again.
let broken = '';
beforeEach((ctx) => {
  if (broken) ctx.skip();
});
afterEach((ctx) => {
  if (ctx.task.result?.state === 'fail' && !broken) broken = ctx.task.name;
});

afterAll(async () => {
  if (app) {
    await snapshot('final');
    // A failed step can leave a turn running, and quitting then asks for confirmation — do not wait on it forever.
    const proc = app.process();
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    if (proc.exitCode === null) proc.kill();
  }
  collectArtifacts();
});

describe('whole app on a new profile (fake engines)', () => {
  it('first run: engine chooser → setup gate advances by itself → no login → folder gate', async () => {
    app = await launch(s);
    page = await mainWindow(app);
    page.on('console', (m) => {
      if (m.type() === 'error') note(`renderer console error: ${m.text().slice(0, 300)}`);
    });
    const reveal = await waitForReveal(s);
    note(`reveal: ${reveal}`);
    expect(['ready', 'settle-cap']).toContain(reveal);

    await visible(page.getByRole('button', { name: /^Claude Code/ }));
    await snapshot('01-engine-chooser');
    await page.getByRole('button', { name: /^Claude Code/ }).first().click();

    // An installed Claude must carry the user forward without pressing Continue. Gates stack (the folder
    // gate can already be mounted underneath), so the proof is the setup gate leaving on its own.
    const setupGate = page.getByText('Install Claude Code', { exact: true });
    await visible(page.getByText('Claude Code is ready', { exact: false }), 20_000);
    await snapshot('02-setup-ready');
    await until('setup gate closes without a click', async () => (await setupGate.count()) === 0, 15_000);
    await visible(page.getByText('Choose a project folder'), 20_000);
    expect(await page.getByText('Sign in to Claude').count()).toBe(0);
    await snapshot('03-folder-gate');

    const calls = engineCalls(s);
    expect(calls.some((c) => c.kind === 'invoke' && c.argv.includes('--version'))).toBe(true);
    expect(calls.some((c) => c.kind === 'invoke' && c.subcommand === 'auth')).toBe(true);
  });

  it('folder gate: the picked folder becomes the open project tab and canvas', async () => {
    const p = page!;
    await answerFolderPicker(app!, s.project);
    await p.getByRole('button', { name: 'Choose Folder' }).click();
    await until('folder picker launched by the server route', async () => (await folderPickerCalls(app!)) > 0, 20_000);
    await visible(p.locator(`[data-tab-key="p:${path.basename(s.project)}"]`), 30_000);
    await until('folder gate closed', async () => (await p.getByText('Choose a project folder').count()) === 0, 20_000);
    await visible(p.locator('main .react-flow'));
    await snapshot('04-project-open');
    const appState = readJson(path.join(s.home, '.vibisual', 'app-state.json'));
    const open = (appState.openProjects as string[]).map((x) => path.resolve(x));
    expect(open).toContain(path.resolve(s.project));
  });

  it('canvas: right-click creates a Claude agent bubble', async () => {
    // Empty canvas only — the project root and Trash bubbles sit around the centre and have their own menus.
    ({ id: agentId, label: agentLabel } = await createAgent(page!, 'Claude', { x: 160, y: 140 }));
    note(`agent ${agentId} "${agentLabel}"`);
    await snapshot('05-bubble-created');
    expect(agentId).toMatch(/^agent-/);
  });

  it('first command: fake engine runs with official flags, hooks reach the app, approval card gates Write', async () => {
    const p = page!;
    await sendCommand(p, agentId, PROMPT);
    await snapshot('06-command-sent');

    const turn = await until('engine spawned for the turn', () => engineCalls(s).find((c) => c.kind === 'turn' && c.matched === 'e2e-first-command'), 60_000);
    const invoke = engineCalls(s).find((c) => c.kind === 'invoke' && c.call === turn.call)!;
    note(`spawn flags: ${JSON.stringify(invoke.argv.filter((a: string) => a.startsWith('--')))}`);
    expect(invoke.unknownFlags).toEqual([]);
    expect(invoke.argv).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']));
    const printEntry = engineCalls(s).find((c) => c.kind === 'print' && c.call === turn.call)!;
    expect(printEntry.hookSources).toContain('user');
    expect(printEntry.vibisualEnv).toEqual(expect.arrayContaining(['VIBISUAL_OWNER_AGENT_ID', 'VIBISUAL_SUBAGENT_ID']));

    // Write needs approval in the default mode: PreToolUse command hook → handler.mjs → permission card.
    await visible(p.getByText('Permission required'), 30_000);
    await snapshot('07-approval-card');
    await p.getByRole('button', { name: /^Allow( once)?$/ }).first().click();
    await until('Write ran after approval', () => fs.existsSync(path.join(s.project, 'e2e-hello.txt')), 30_000);
    await until('fake parked mid-turn', () => engineCalls(s).some((c) => c.kind === 'waiting' && c.call === turn.call), 30_000);
    const pre = engineCalls(s).find((c) => c.kind === 'pre-tool' && c.tool === 'Write' && c.call === turn.call);
    expect(pre?.decision).toBe('allow');
    const http = engineCalls(s).filter((c) => c.kind === 'hook-http' && c.call === turn.call);
    expect(http.length).toBeGreaterThan(0);
    expect(http.every((h) => h.status === 200)).toBe(true);
  });

  it('bubble state: active while the turn runs, completed after the result', async () => {
    const p = page!;
    await closeIde(p, agentId);
    const node = bubble(p, agentId);
    await until('bubble shows active', () => isActive(node), 20_000);
    await snapshot('08-bubble-active');
    fs.writeFileSync(path.join(s.stateDir, 'release-first-command'), '');
    await until('turn result', () => engineCalls(s).some((c) => c.kind === 'result'), 30_000);
    await until('bubble shows completed', () => isCompleted(node), 30_000);
    await snapshot('09-bubble-completed');
  });

  it('codex: a Codex bubble runs its first turn through the fake app-server', async () => {
    const p = page!;
    const box = (await p.locator('main .react-flow__pane').boundingBox())!;
    ({ id: codexId, label: codexLabel } = await createAgent(p, 'Codex', { x: box.width - 220, y: 140 }));
    note(`codex agent ${codexId} "${codexLabel}"`);
    await sendCommand(p, codexId, CODEX_PROMPT);
    await snapshot('10-codex-sent');
    const turn = await until('codex app-server turn', () => engineCalls(s, 'codex').find((c) => c.kind === 'turn' && c.matched === 'e2e-codex-command'), 60_000);
    const invoke = engineCalls(s, 'codex').find((c) => c.kind === 'invoke' && c.call === turn.call)!;
    note(`codex argv: ${JSON.stringify(invoke.argv)}`);
    expect(invoke.argv).toContain('app-server');
    const methods = engineCalls(s, 'codex').filter((c) => c.call === turn.call && c.kind === 'request').map((c) => c.method);
    expect(methods).toEqual(expect.arrayContaining(['initialize', 'config/read', 'thread/start', 'turn/start']));
    await until('codex fileChange applied', () => fs.existsSync(path.join(s.project, 'e2e-codex.txt')), 30_000);
    await closeIde(p, codexId);
    const node = bubble(p, codexId);
    await until('codex bubble shows active', () => isActive(node), 20_000);
    fs.writeFileSync(path.join(s.stateDir, 'release-codex-command'), '');
    await until('codex turn completed', () => engineCalls(s, 'codex').some((c) => c.kind === 'result' && c.status === 'completed'), 30_000);
    await until('codex bubble shows completed', () => isCompleted(node), 30_000);
    await snapshot('11-codex-completed');
    expect(engineCalls(s, 'codex').filter((c) => c.kind === 'unsupported-method' || c.kind === 'unsupported-subcommand')).toEqual([]);
  });

  it('quit: state is flushed to disk and our hooks are taken back out of settings.json', async () => {
    await quit(app!);
    app = null;
    page = null;
    const save = path.join(s.project, '.vibisual', 'save');
    const identity = readJson(path.join(save, 'identity.json'));
    const ids = Object.values(identity.customAgents ?? {}).map((a: any) => a.id);
    expect(ids).toEqual(expect.arrayContaining([agentId, codexId]));
    const checkpoint = readJson(path.join(save, 'checkpoint.json'));
    expect(JSON.stringify(checkpoint.subAgents ?? {})).toContain('sessionId');
    const settingsFile = path.join(s.home, '.claude', 'settings.json');
    if (fs.existsSync(settingsFile)) expect(fs.readFileSync(settingsFile, 'utf8')).not.toContain('_vibisualManaged');
  });

  it('relaunch: no first-run gates, the project tab and both bubbles are restored', async () => {
    app = await launch(s);
    page = await mainWindow(app);
    expect(['ready', 'settle-cap']).toContain(await waitForReveal(s));
    const p = page;
    await visible(p.locator(`[data-tab-key="p:${path.basename(s.project)}"]`), 30_000);
    for (const [id, label] of [[agentId, agentLabel], [codexId, codexLabel]] as const) {
      await visible(bubble(p, id), 30_000);
      expect(await firstLine(bubble(p, id))).toBe(label);
    }
    for (const gate of ['Choose a project folder', 'Sign in to Claude', 'Install Claude Code']) {
      expect(await p.getByText(gate).count(), gate).toBe(0);
    }
    await snapshot('12-restored');
  });
});
