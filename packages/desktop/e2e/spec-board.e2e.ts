// Spec board on a new profile, outside debug mode: requirements → acceptance criteria → chained task cards.
// Also pins what deleting a card means: the item becomes card-less again, re-making it restores the chain, and a
// spec change can be put into an existing card without replacing the agent.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ElectronApplication, Locator, Page } from 'playwright-core';
import { createSandbox, launch, mainWindow, waitForReveal, type Sandbox } from './harness';
import { api, bubble, canvasMenu, firstRunToProject, until, visible } from './flows';

const s: Sandbox = createSandbox('first-command.json');
const artifacts = process.env.VIBISUAL_E2E_ARTIFACTS ? path.join(path.resolve(process.env.VIBISUAL_E2E_ARTIFACTS), 'spec-board') : path.join(s.root, 'artifacts');
let app: ElectronApplication | null = null;
let page: Page | null = null;
let specId = '';
const CRITERIA = ['Login page accepts a valid account', 'Logout clears the session'];
let cards: string[] = [];

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
  process.stdout.write(`[e2e] spec-board artifacts: ${artifacts}\n`);
});

const panel = (p: Page) => p.locator('div.fixed').filter({ has: p.getByPlaceholder(/^What are you building/) }).first();
const edgesBetween = async (p: Page, source: string, target: string) => {
  const res = await api<{ data: Record<string, { sourceAgentId: string; targetAgentId: string }> }>(p, 'GET', '/api/task-edges');
  return Object.values(res.data ?? {}).filter((e) => e.sourceAgentId === source && e.targetAgentId === target).length;
};
const rulesOf = async (p: Page, agentId: string): Promise<string> => {
  const res = await api<any>(p, 'GET', `/api/agent-config/${agentId}`);
  return String(res?.config?.rules ?? res?.data?.rules ?? res?.rules ?? '');
};
const agentIds = (p: Page) => p.locator('.react-flow__node[data-id^="agent-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!));
/** Card bubbles shorten long labels in the middle, so new cards are found by id difference, not by text. */
async function newAgents(p: Page, before: readonly string[], count: number): Promise<string[]> {
  return until(`${count} new card(s)`, async () => {
    const fresh = (await agentIds(p)).filter((id) => !before.includes(id));
    return fresh.length >= count ? fresh : null;
  }, 20_000);
}
async function generateButton(p: Page, count: number): Promise<Locator> {
  const b = panel(p).getByRole('button', { name: `Create task cards (${count})` });
  await visible(b);
  return b;
}

describe('spec board without debug mode', () => {
  it('is on the canvas menu and makes a spec bubble', async () => {
    app = await launch(s);
    page = await mainWindow(app);
    expect(['ready', 'settle-cap']).toContain(await waitForReveal(s));
    await firstRunToProject(app, page, s);
    const before = await page.locator('.react-flow__node-specNode').count();
    await (await canvasMenu(page, { x: 160, y: 140 }, /^Spec Board/)).click();
    await until('spec bubble appears', async () => (await page!.locator('.react-flow__node-specNode').count()) > before, 20_000);
    specId = (await page.locator('.react-flow__node-specNode').last().getAttribute('data-id'))!;
    await snapshot('01-spec-bubble');
    expect(specId).toBeTruthy();
  });

  it('turns requirements and criteria into chained task cards', async () => {
    const p = page!;
    // Canvas bubbles keep gliding (physics), so Playwright's stability wait never settles — press where it is now.
    await bubble(p, specId).dblclick({ force: true });
    const body = p.getByPlaceholder(/^What are you building/);
    await visible(body);
    await body.fill('Users sign in and out of the dashboard.');
    await body.blur();
    const input = panel(p).getByPlaceholder('Acceptance criterion…');
    for (const text of CRITERIA) {
      await input.fill(text);
      await input.press('Enter');
      await visible(panel(p).getByText(text));
    }
    const before = await agentIds(p);
    await (await generateButton(p, 2)).click();
    const [a, b] = await newAgents(p, before, 2);
    // The chain runs in item order, so the edge direction tells which card is item 1.
    await until('one chain edge between the two cards', async () => (await edgesBetween(p, a!, b!)) + (await edgesBetween(p, b!, a!)) === 1, 10_000);
    cards = (await edgesBetween(p, a!, b!)) === 1 ? [a!, b!] : [b!, a!];
    expect(await rulesOf(p, cards[0]!)).toContain(CRITERIA[0]);
    expect(await rulesOf(p, cards[1]!)).toContain(CRITERIA[1]);
    await snapshot('02-cards');
  });

  it('a deleted card makes its item card-less; re-making it restores the chain', async () => {
    const p = page!;
    await p.keyboard.press('Escape');
    // The route trashes the card but its IPC reply currently comes back as a transport error, so judge by the canvas.
    await api(p, 'DELETE', `/api/bubble/${cards[0]}`).catch(() => undefined);
    await until('card 1 left the canvas', async () => (await bubble(p, cards[0]!).count()) === 0, 10_000);
    // Canvas bubbles keep gliding (physics), so Playwright's stability wait never settles — press where it is now.
    await bubble(p, specId).dblclick({ force: true });
    const before = await agentIds(p);
    await (await generateButton(p, 1)).click();
    const [fresh] = await newAgents(p, before, 1);
    expect(await rulesOf(p, fresh!)).toContain(CRITERIA[0]);
    await until('chain edge new card → card2', async () => (await edgesBetween(p, fresh!, cards[1]!)) === 1, 10_000);
    cards = [fresh, cards[1]!];
    await snapshot('03-remade');
  });

  it('a spec change shows on the card and "Update card" puts the new spec into it', async () => {
    const p = page!;
    const body = p.getByPlaceholder(/^What are you building/);
    await body.fill('Users sign in and out of the dashboard. Sessions expire after 30 minutes.');
    await body.blur();
    await visible(panel(p).getByText('Spec changed', { exact: true }), 10_000);
    await snapshot('04-stale');
    // Both cards were made from the old body, so both are stale; update each from its own row.
    expect(await panel(p).getByText('Spec changed', { exact: true }).count()).toBe(2);
    for (let left = 2; left > 0; left -= 1) {
      await panel(p).getByRole('button', { name: 'Update card' }).first().click();
      await until(`${left - 1} stale card(s) left`, async () => (await panel(p).getByText('Spec changed', { exact: true }).count()) === left - 1, 10_000);
    }
    for (const id of cards) {
      const rules = await rulesOf(p, id);
      expect(rules).toContain('30 minutes');
      // The spec section is replaced, never stacked.
      expect(rules.split('vibisual:spec-task:begin')).toHaveLength(2);
    }
    await snapshot('05-updated');
  });
});
