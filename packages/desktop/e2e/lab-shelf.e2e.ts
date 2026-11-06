// Agent Lab and Script Shelf on a new profile, outside debug mode: both are on the canvas menu, open their panels,
// a shelf shell row runs in the project on every OS, edits survive closing the panel, and both come back after a restart.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ElectronApplication, Page } from 'playwright-core';
import { createSandbox, launch, mainWindow, quit, waitForReveal, type Sandbox } from './harness';
import { bubble, canvasMenu, firstRunToProject, until, visible } from './flows';

const s: Sandbox = createSandbox('first-command.json');
const artifacts = process.env.VIBISUAL_E2E_ARTIFACTS ? path.join(path.resolve(process.env.VIBISUAL_E2E_ARTIFACTS), 'lab-shelf') : path.join(s.root, 'artifacts');
let app: ElectronApplication | null = null;
let page: Page | null = null;
let labId = '';
let shelfId = '';
const LAB_TASK = 'Add a README section about installing';
const SHELF_LABEL = 'Say ok';
const SHELF_COMMAND = 'echo shelf-e2e-ok';

async function snapshot(name: string): Promise<void> {
  fs.mkdirSync(artifacts, { recursive: true });
  await page?.screenshot({ path: path.join(artifacts, `${name}.png`) }).catch(() => undefined);
}

let broken = '';
beforeEach((ctx) => {
  if (broken) ctx.skip();
});
afterEach((ctx) => {
  if (ctx.task.result?.state === 'fail' && !broken) broken = ctx.task.name;
});
afterAll(async () => {
  if (!app) return;
  await snapshot('final');
  const proc = app.process();
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
  if (proc.exitCode === null) proc.kill();
  if (fs.existsSync(path.join(s.userData, 'logs'))) fs.cpSync(path.join(s.userData, 'logs'), path.join(artifacts, 'logs'), { recursive: true });
  process.stdout.write(`[e2e] lab-shelf artifacts: ${artifacts}\n`);
});

const LAB_AT = { x: 160, y: 140 };
const shelfAt = async (p: Page) => ({ x: (await p.locator('main .react-flow__pane').boundingBox())!.width - 300, y: 140 });
const labTask = (p: Page) => p.getByPlaceholder(/^Write the job once/);
const shelfPanel = (p: Page) => p.locator('div.fixed').filter({ has: p.getByRole('button', { name: '+ Shell command' }) }).first();
/** The play bubble stays debug-only, so its absence on the same menu proves these runs are outside debug mode. */
const playRow = (p: Page) => p.locator('button').filter({ hasText: /^Play bubble/ });

async function createFromMenu(p: Page, at: { x: number; y: number }, row: RegExp, nodeClass: string): Promise<string> {
  const item = await canvasMenu(p, at, row);
  expect(await playRow(p).count()).toBe(0);
  const before = await p.locator(nodeClass).count();
  await item.click();
  await until(`${nodeClass} appears`, async () => (await p.locator(nodeClass).count()) > before, 20_000);
  return (await p.locator(nodeClass).last().getAttribute('data-id'))!;
}

describe('agent lab and script shelf without debug mode', () => {
  it('lab: on the canvas menu, makes a bubble, and its panel keeps the task', async () => {
    app = await launch(s);
    page = await mainWindow(app);
    expect(['ready', 'settle-cap']).toContain(await waitForReveal(s));
    await firstRunToProject(app, page, s);
    const p = page;
    labId = await createFromMenu(p, LAB_AT, /^Agent Lab/, '.react-flow__node-labNode');
    // Canvas bubbles keep gliding (physics), so Playwright's stability wait never settles — press where it is now.
    await bubble(p, labId).dblclick({ force: true });
    await visible(labTask(p));
    await labTask(p).fill(LAB_TASK);
    await labTask(p).blur();
    await snapshot('01-lab-panel');
    await p.keyboard.press('Escape');
    await until('lab panel closed', async () => (await labTask(p).count()) === 0, 10_000);
  });

  it('shelf: a new shell row opens for editing, keeps every typed key, and runs in the project', async () => {
    const p = page!;
    shelfId = await createFromMenu(p, await shelfAt(p), /^Script shelf/, '.react-flow__node-shelfNode');
    await bubble(p, shelfId).dblclick({ force: true });
    const panel = shelfPanel(p);
    await visible(panel.getByText(/^No items yet/));
    await panel.getByRole('button', { name: '+ Shell command' }).click();
    // The new row is already open — no extra click to find the editor.
    const command = panel.getByPlaceholder(/^Shell command to run/);
    await visible(command);
    // Real keystrokes: a field bound straight to the server value rewinds keys typed before the reply lands.
    await command.pressSequentially(SHELF_COMMAND, { delay: 10 });
    expect(await command.inputValue()).toBe(SHELF_COMMAND);
    await panel.getByRole('button', { name: 'Run', exact: true }).click();
    await visible(panel.getByText('Succeeded', { exact: true }), 30_000);
    await visible(panel.locator('pre').filter({ hasText: 'shelf-e2e-ok' }));
    // The row preview is drawn from the server copy, so this is the saved command, not the draft.
    await visible(panel.getByText(SHELF_COMMAND, { exact: true }));
    await snapshot('02-shelf-run');
  });

  it('shelf: an edit still in its field is saved when the panel closes with Esc', async () => {
    const p = page!;
    const panel = shelfPanel(p);
    await panel.getByPlaceholder('Name', { exact: true }).fill(SHELF_LABEL);
    await p.keyboard.press('Escape');
    await until('shelf panel closed', async () => (await shelfPanel(p).count()) === 0, 10_000);
    await visible(bubble(p, shelfId).getByText(SHELF_LABEL, { exact: true }), 10_000);
    await snapshot('03-shelf-canvas');
  });

  it('relaunch: both bubbles come back outside debug mode, with what was typed', async () => {
    await quit(app!);
    app = await launch(s);
    page = await mainWindow(app);
    expect(['ready', 'settle-cap']).toContain(await waitForReveal(s));
    const p = page;
    await visible(p.locator(`[data-tab-key="p:${path.basename(s.project)}"]`), 30_000);
    await visible(bubble(p, labId), 30_000);
    await visible(bubble(p, shelfId).getByText(SHELF_LABEL, { exact: true }), 30_000);
    await bubble(p, labId).dblclick({ force: true });
    await visible(labTask(p));
    expect(await labTask(p).inputValue()).toBe(LAB_TASK);
    await snapshot('04-restored');
  });
});
