import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BashHistoryList } from './BashHistoryList.js';
import type { CommandHistoryRow } from './commandAppHistory.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../../hooks/usePopupDismiss.js', () => ({ useBackdropDismiss: () => ({}) }));

let renderer: ReactTestRenderer | undefined;
beforeEach(() => { vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() }); });
afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = undefined;
  vi.unstubAllGlobals();
});

function render(rows: CommandHistoryRow[]): void {
  act(() => {
    if (renderer) renderer.update(<BashHistoryList rows={rows} />);
    else renderer = create(<BashHistoryList rows={rows} />);
  });
}

describe('command history detail', () => {
  it('updates an open running record when the same command completes', () => {
    const row: CommandHistoryRow = { key: 'owner:run', entry: { id: 'run', command: 'build', timestamp: 1, status: 'running' } };
    render([row]);
    act(() => { renderer!.root.findByType('button').props.onClick(); });
    expect(JSON.stringify(renderer!.toJSON())).toContain('panel.bashHistory.waitingForOutput');
    render([{ ...row, entry: { ...row.entry, status: 'error', output: 'build failed', endedAt: 100, outputTruncated: true } }]);
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain('build failed');
    expect(text).toContain('panel.bashHistory.status.error');
    expect(text).toContain('panel.bashHistory.outputTruncated');
    expect(text).not.toContain('panel.bashHistory.waitingForOutput');
  });

  it('does not select a colliding tool id from another session or retain evicted output', () => {
    const rows: CommandHistoryRow[] = [
      { key: 'first:run', entry: { id: 'run', command: 'first command', timestamp: 1 } },
      { key: 'second:run', entry: { id: 'run', command: 'second command', timestamp: 1 } },
    ];
    render(rows);
    act(() => { renderer!.root.findAllByType('button')[1]!.props.onClick(); });
    expect(renderer!.root.findByType('pre').children.join('')).toContain('second command');
    render([rows[0]!]);
    expect(renderer!.root.findAllByType('pre')).toHaveLength(0);
  });
});
