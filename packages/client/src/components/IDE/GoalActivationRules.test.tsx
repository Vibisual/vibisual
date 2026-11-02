import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_SOURCE_IDS } from '@vibisual/shared';
import type { ContextInventory, ContextSourceItem } from '@vibisual/shared';
import { GoalActivationRules } from './GoalActivationRules.js';
import { readContextInventory, writeContextOverride } from './contextInventoryApi.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./contextInventoryApi.js', () => ({ readContextInventory: vi.fn(), writeContextOverride: vi.fn() }));

const read = vi.mocked(readContextInventory);
const write = vi.mocked(writeContextOverride);
let view: ReactTestRenderer | undefined;
function inventory(own?: boolean): ContextInventory {
  const item: ContextSourceItem = {
    id: CONTEXT_SOURCE_IDS.goal, title: 'Goal', category: 'vibisual', control: 'session',
    chars: 0, tokens: 0, estimated: false, defaultEnabled: false, enabled: own ?? false,
    scopeStates: { project: own ?? false, agent: own ?? false, session: own ?? false },
    ...(own !== undefined ? { scopeOverrides: { project: own } } : {}),
  };
  return { agentId: 'agent', projectPath: '/project', cwd: '/project', at: 1, items: [item], totalTokens: 0, enabledTokens: 0 };
}
async function render(subAgentId: string | null = 'sub'): Promise<void> {
  await act(async () => {
    const element = <GoalActivationRules agentId="agent" subAgentId={subAgentId} />;
    if (view) view.update(element); else view = create(element);
  });
}
function scopeButton(scope: string) { return view!.root.findByProps({ 'data-goal-scope': scope }); }
beforeEach(() => { read.mockReset(); write.mockReset(); read.mockResolvedValue(inventory()); write.mockResolvedValue(); });
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; });

describe('goal activation rules', () => {
  it('can enable project rules without a selected session and cycles on, off, inherit', async () => {
    await render(null);
    expect(scopeButton('session').props.disabled).toBe(true);
    expect(scopeButton('project').props.disabled).toBe(false);
    for (const enabled of [true, false, null]) {
      read.mockResolvedValueOnce(inventory(enabled ?? undefined));
      await act(async () => scopeButton('project').props.onClick());
      expect(write).toHaveBeenLastCalledWith('agent', null, 'project', CONTEXT_SOURCE_IDS.goal, enabled);
    }
  });

  it('keeps the confirmed state and shows an error after a rejected save', async () => {
    await render();
    write.mockRejectedValueOnce(new Error('HTTP 500'));
    await act(async () => scopeButton('project').props.onClick());
    expect(view!.root.findByProps({ role: 'alert' }).children).toEqual(['ide.context.saveError']);
    expect(JSON.stringify(view!.toJSON())).toContain('ide.goal.disabledHint');
    expect(JSON.stringify(view!.toJSON())).not.toContain('ide.goal.enabledHint');
  });

  it('ignores a previous session save response after switching tabs', async () => {
    await render('old');
    let resolve!: () => void;
    write.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    act(() => scopeButton('project').props.onClick());
    await render('new');
    read.mockResolvedValueOnce(inventory(true));
    await act(async () => resolve());
    expect(JSON.stringify(view!.toJSON())).toContain('ide.goal.disabledHint');
    expect(JSON.stringify(view!.toJSON())).not.toContain('ide.goal.enabledHint');
  });
});
