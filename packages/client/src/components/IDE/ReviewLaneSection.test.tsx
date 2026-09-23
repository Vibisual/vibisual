import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewRequest } from '@vibisual/shared';
import { ReviewLaneSection } from './ReviewLaneSection.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: { error?: string }) => `${key}${values?.error ?? ''}` }) }));
let view: ReactTestRenderer | undefined;
const fetchMock = vi.fn<typeof fetch>();
function review(id: string): ReviewRequest {
  return { id, projectName: 'fixture', agentId: 'agent', subAgentId: `session-${id}`, worktreePath: '/fixture', files: [], diff: '', status: 'pending', decisions: [], createdAt: 1, updatedAt: 1 };
}
function render(id: string): void {
  act(() => { if (view) view.update(<ReviewLaneSection review={review(id)} />); else view = create(<ReviewLaneSection review={review(id)} />); });
}
function pending() {
  let resolve!: (r: Response) => void;
  return { promise: new Promise<Response>((done) => { resolve = done; }), reply: () => resolve(new Response('{"ok":false,"error":"old-review-error"}', { status: 409 })) };
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });
describe('review decision UI ownership', () => {
  it('coalesces two same-frame decisions into one request', async () => {
    const out = pending(); fetchMock.mockReturnValue(out.promise); render('a');
    const approve = view!.root.findByProps({ title: 'ide.reviewLane.approveTitle' });
    act(() => { approve.props.onClick(); approve.props.onClick(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => out.reply());
  });
  it('a late decision failure cannot disable or annotate a different review', async () => {
    const old = pending(); fetchMock.mockReturnValueOnce(old.promise); render('a');
    act(() => view!.root.findByProps({ title: 'ide.reviewLane.approveTitle' }).props.onClick());
    render('b');
    expect(view!.root.findByProps({ title: 'ide.reviewLane.approveTitle' }).props.disabled).toBe(false);
    await act(async () => old.reply());
    expect(JSON.stringify(view!.toJSON())).not.toContain('old-review-error');
  });
});
