// Steps shared by the e2e stories — the first-run walk and the canvas gestures a person makes.
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from 'playwright-core';
import { answerFolderPicker, folderPickerCalls, type Sandbox } from './harness';

/** Polls `fn` until it returns a truthy value — for file-system and call-log conditions the page cannot see. */
export async function until<T>(what: string, fn: () => T | Promise<T>, timeoutMs = 60_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out: ${what}${last ? ` (${String(last)})` : ''}`);
}

export const visible = (l: Locator, timeout = 20_000) => l.first().waitFor({ state: 'visible', timeout });
export const bubble = (p: Page, id: string) => p.locator(`.react-flow__node[data-id="${id}"]`);
export const isActive = async (node: Locator) => (await node.locator('.animate-pulse-ring').count()) > 0;
export const isCompleted = async (node: Locator) => (await node.locator('.bubble-body.border-cyan-400').count()) > 0
  || (await node.locator('[data-agent-card-status="completed"]').count()) > 0;
export const firstLine = async (l: Locator) => (await l.innerText()).split('\n')[0]!.trim();

/** Calls the app's own REST surface from the renderer (its fetch is routed over IPC to the in-process server). */
export async function api<T = any>(p: Page, method: string, url: string, body?: unknown): Promise<T> {
  return p.evaluate(async ({ method: m, url: u, body: b }) => {
    const res = await fetch(u, { method: m, ...(b === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }) });
    return res.json();
  }, { method, url, body });
}

/** Engine chooser → Claude setup gate (leaves by itself) → folder gate → the project tab is open. */
export async function firstRunToProject(app: ElectronApplication, p: Page, s: Sandbox): Promise<void> {
  await visible(p.getByRole('button', { name: /^Claude Code/ }));
  await p.getByRole('button', { name: /^Claude Code/ }).first().click();
  await until('setup gate closes without a click', async () => (await p.getByText('Install Claude Code', { exact: true }).count()) === 0, 20_000);
  await visible(p.getByText('Choose a project folder'), 20_000);
  await answerFolderPicker(app, s.project);
  await p.getByRole('button', { name: 'Choose Folder' }).click();
  await until('folder picker launched by the server route', async () => (await folderPickerCalls(app)) > 0, 20_000);
  await visible(p.locator(`[data-tab-key="p:${path.basename(s.project)}"]`), 30_000);
  await until('folder gate closed', async () => (await p.getByText('Choose a project folder').count()) === 0, 20_000);
}

/** Right-click empty canvas and pick a top-level row by its visible name (rows also carry a one-line hint). */
export async function canvasMenu(p: Page, at: { x: number; y: number }, row: RegExp): Promise<Locator> {
  await p.locator('main .react-flow__pane').click({ button: 'right', position: at });
  const item = p.locator('button').filter({ hasText: row }).first();
  await visible(item);
  return item;
}

/** Right-click empty canvas → engine submenu → "Create … Agent". Returns the new bubble's id and label. */
export async function createAgent(p: Page, engine: 'Claude' | 'Codex', at: { x: number; y: number }): Promise<{ id: string; label: string }> {
  const nodes = p.locator('.react-flow__node[data-id^="agent-"]');
  const before = new Set(await nodes.evaluateAll((els) => els.map((e) => e.getAttribute('data-id'))));
  await p.locator('main .react-flow__pane').click({ button: 'right', position: at });
  // The engine row is a submenu trigger whose accessible name also carries its one-line description.
  const row = p.locator('button[aria-haspopup="menu"]').filter({ hasText: new RegExp(`^${engine}`) }).first();
  await visible(row);
  await row.hover();
  await row.click().catch(() => undefined);
  const item = `Create ${engine} Agent`;
  await p.getByRole('button', { name: item }).or(p.getByRole('menuitem', { name: item })).first().click();
  const id = await until(`${engine} bubble appears`, async () => {
    const ids = await nodes.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    return ids.find((x) => x !== null && !before.has(x)) ?? null;
  }, 20_000);
  return { id, label: await firstLine(bubble(p, id)) };
}

/** Double-click the bubble, type into its IDE input and press Run. */
export async function sendCommand(p: Page, id: string, text: string): Promise<void> {
  await bubble(p, id).dblclick();
  const input = p.locator(`textarea[data-ide-input="${id}"]`);
  await visible(input);
  await input.fill(text);
  await p.getByRole('button', { name: 'Run', exact: true }).click();
}

export async function closeIde(p: Page, id: string): Promise<void> {
  await p.keyboard.press('Escape');
  await until('IDE overlay closed', async () => (await p.locator(`textarea[data-ide-input="${id}"]`).count()) === 0, 10_000)
    .catch(() => undefined);
}
