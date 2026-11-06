import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskUserQuestionRequest, PermissionRequest } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import { restorePendingPrompts } from './pendingPrompts.js';

const fetchMock = vi.fn<typeof fetch>();
const permission = (id: string) => ({ requestId: id, agentId: `agent-${id}`, subAgentId: `session-${id}` } as PermissionRequest);
const question = (id: string) => ({ requestId: id, agentId: `agent-${id}`, subAgentId: `session-${id}`, items: [] } as unknown as AskUserQuestionRequest);
function pending() {
  let resolve!: (r: Response) => void;
  return { promise: new Promise<Response>((done) => { resolve = done; }), reply: (body: unknown, status = 200) => resolve(new Response(JSON.stringify(body), { status })) };
}
async function flush(): Promise<void> { await new Promise((done) => setTimeout(done, 0)); }
beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  useGraphStore.setState({ pendingPermissions: {}, pendingAskQuestions: {}, permissionSendFailures: {}, askQuestionSendFailures: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('pending prompt reconciliation', () => {
  it('keeps WS additions, removes resolved ids, and replaces untouched stale cards in both queues', async () => {
    const p = pending(); const q = pending();
    fetchMock.mockReturnValueOnce(p.promise).mockReturnValueOnce(q.promise);
    useGraphStore.getState().addPendingPermission(permission('stale'));
    restorePendingPrompts();
    useGraphStore.getState().addPendingPermission(permission('live'));
    useGraphStore.getState().addPendingAskQuestion(question('live'));
    // Resolution can arrive before this client has ever seen the request.
    useGraphStore.getState().removePendingPermission('resolved');
    useGraphStore.getState().removePendingAskQuestion('resolved');
    p.reply({ ok: true, pending: [permission('server'), permission('resolved')] });
    q.reply({ ok: true, pending: [question('server'), question('resolved')] });
    await flush();
    expect(Object.keys(useGraphStore.getState().pendingPermissions).sort()).toEqual(['live', 'server']);
    expect(Object.keys(useGraphStore.getState().pendingAskQuestions).sort()).toEqual(['live', 'server']);
  });

  it('an earlier reconnect response cannot replace the latest reconnect', async () => {
    const oldP = pending(); const oldQ = pending(); const newP = pending(); const newQ = pending();
    fetchMock.mockReturnValueOnce(oldP.promise).mockReturnValueOnce(oldQ.promise).mockReturnValueOnce(newP.promise).mockReturnValueOnce(newQ.promise);
    restorePendingPrompts(); restorePendingPrompts();
    newP.reply({ ok: true, pending: [permission('new')] }); newQ.reply({ ok: true, pending: [question('new')] }); await flush();
    oldP.reply({ ok: true, pending: [permission('old')] }); oldQ.reply({ ok: true, pending: [question('old')] }); await flush();
    expect(Object.keys(useGraphStore.getState().pendingPermissions)).toEqual(['new']);
    expect(Object.keys(useGraphStore.getState().pendingAskQuestions)).toEqual(['new']);
  });

  it('an answered question stays removed when a pending snapshot arrives late', async () => {
    const p = pending(); const q = pending();
    fetchMock.mockReturnValueOnce(p.promise).mockReturnValueOnce(q.promise).mockResolvedValueOnce(new Response('{"ok":true}'));
    useGraphStore.getState().addPendingAskQuestion(question('answered'));
    restorePendingPrompts();
    await useGraphStore.getState().respondAskQuestion('answered', []);
    p.reply({ ok: true, pending: [] }); q.reply({ ok: true, pending: [question('answered')] }); await flush();
    expect(useGraphStore.getState().pendingAskQuestions).toEqual({});
  });

  it('a permission resolved by WS is not restored by a late invalid-choice response', async () => {
    const post = pending(); fetchMock.mockReturnValueOnce(post.promise);
    useGraphStore.getState().addPendingPermission(permission('p'));
    const result = useGraphStore.getState().respondPermission('p', 'allow_once');
    useGraphStore.getState().removePendingPermission('p');
    post.reply({}, 400); await result;
    expect(useGraphStore.getState().pendingPermissions).toEqual({});
  });

  it('a genuinely rejected permission choice is restored and can be retried once', async () => {
    const post = pending(); fetchMock.mockReturnValueOnce(post.promise);
    useGraphStore.getState().addPendingPermission(permission('p'));
    const first = useGraphStore.getState().respondPermission('p', 'allow_once');
    const duplicate = useGraphStore.getState().respondPermission('p', 'allow_once');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    post.reply({}, 400); expect(await first).toBe(false); await duplicate;
    expect(useGraphStore.getState().pendingPermissions.p).toBeDefined();
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}'));
    await useGraphStore.getState().respondPermission('p', 'allow_once');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('an in-flight answer remains hidden during a reconnect and is submitted only once', async () => {
    const post = pending(); const p = pending(); const q = pending();
    fetchMock.mockReturnValueOnce(post.promise).mockReturnValueOnce(p.promise).mockReturnValueOnce(q.promise);
    useGraphStore.getState().addPendingAskQuestion(question('q'));
    const first = useGraphStore.getState().respondAskQuestion('q', []);
    restorePendingPrompts();
    p.reply({ ok: true, pending: [] }); q.reply({ ok: true, pending: [question('q')] }); await flush();
    expect(useGraphStore.getState().pendingAskQuestions).toEqual({});
    await useGraphStore.getState().respondAskQuestion('q', []);
    expect(fetchMock.mock.calls.filter(([,init]) => init?.method === 'POST')).toHaveLength(1);
    post.reply({ ok: true }); await first;
  });
});

describe('answers that do not reach the server', () => {
  const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  const gets = () => fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST').map(([url]) => String(url));

  it.each([
    ['server error', () => Promise.resolve(new Response('{"ok":false}', { status: 500 }))],
    ['network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)('a deny after a %s comes back with its reason and is checked against the server list', async (_label, reply) => {
    const p = pending(); const q = pending();
    fetchMock.mockImplementationOnce(reply).mockReturnValueOnce(p.promise).mockReturnValueOnce(q.promise);
    useGraphStore.getState().addPendingPermission(permission('p'));
    expect(await useGraphStore.getState().respondPermission('p', 'reject_once', 'wrong path')).toBe(false);
    expect(useGraphStore.getState().pendingPermissions.p).toBeDefined();
    expect(useGraphStore.getState().permissionSendFailures.p).toEqual({ error: 'unconfirmed', reason: 'wrong path' });
    expect(gets()).toEqual(['/api/permission-pending', '/api/ask-user-question/pending']);
    p.reply({ ok: true, pending: [permission('p')] }); q.reply({ ok: true, pending: [] }); await flush();
    expect(useGraphStore.getState().pendingPermissions.p).toBeDefined();
    expect(useGraphStore.getState().permissionSendFailures.p?.error).toBe('unconfirmed');
    // Nothing is resent until the user answers the restored card.
    expect(posts()).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}'));
    expect(await useGraphStore.getState().respondPermission('p', 'reject_once', 'wrong path')).toBe(true);
    expect(posts()).toHaveLength(2);
    expect(useGraphStore.getState().pendingPermissions).toEqual({});
    expect(useGraphStore.getState().permissionSendFailures).toEqual({});
  });

  it('a lost response for an answer the server applied does not keep the card', async () => {
    const p = pending(); const q = pending();
    fetchMock.mockRejectedValueOnce(new TypeError('network connection was lost'))
      .mockReturnValueOnce(p.promise).mockReturnValueOnce(q.promise);
    useGraphStore.getState().addPendingPermission(permission('p'));
    expect(await useGraphStore.getState().respondPermission('p', 'reject_once')).toBe(false);
    p.reply({ ok: true, pending: [] }); q.reply({ ok: true, pending: [] }); await flush();
    expect(useGraphStore.getState().pendingPermissions).toEqual({});
    expect(useGraphStore.getState().permissionSendFailures).toEqual({});
  });

  it('a card resolved over WS while the failed POST was in flight stays closed', async () => {
    const post = pending(); fetchMock.mockReturnValueOnce(post.promise);
    useGraphStore.getState().addPendingPermission(permission('p'));
    const result = useGraphStore.getState().respondPermission('p', 'reject_once');
    useGraphStore.getState().removePendingPermission('p');
    post.reply({ ok: false }, 500);
    expect(await result).toBe(true);
    expect(useGraphStore.getState().pendingPermissions).toEqual({});
    expect(useGraphStore.getState().permissionSendFailures).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a refused answer (4xx) comes back as rejected without a server re-check, and 404 stays closed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":false}', { status: 403 }));
    useGraphStore.getState().addPendingPermission(permission('p'));
    expect(await useGraphStore.getState().respondPermission('p', 'allow_always')).toBe(false);
    expect(useGraphStore.getState().permissionSendFailures.p).toEqual({ error: 'rejected', reason: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(new Response('{"ok":false}', { status: 404 }));
    expect(await useGraphStore.getState().respondPermission('p', 'allow_once')).toBe(true);
    expect(useGraphStore.getState().pendingPermissions).toEqual({});
    expect(useGraphStore.getState().permissionSendFailures).toEqual({});
  });

  it.each([
    ['400', () => Promise.resolve(new Response('{"ok":false}', { status: 400 })), 'rejected', 0],
    ['500', () => Promise.resolve(new Response('{"ok":false}', { status: 500 })), 'unconfirmed', 2],
    ['network failure', () => Promise.reject(new TypeError('Failed to fetch')), 'unconfirmed', 2],
  ] as const)('a question answer after %s comes back with the chosen answers', async (_label, reply, error, rechecks) => {
    const p = pending(); const q = pending();
    fetchMock.mockImplementationOnce(reply).mockReturnValueOnce(p.promise).mockReturnValueOnce(q.promise);
    useGraphStore.getState().addPendingAskQuestion(question('q'));
    const answers = [{ selectedLabels: ['Yes'], note: 'go ahead' }];
    expect(await useGraphStore.getState().respondAskQuestion('q', answers)).toBe(false);
    expect(useGraphStore.getState().pendingAskQuestions.q).toBeDefined();
    expect(useGraphStore.getState().askQuestionSendFailures.q).toEqual({ error, answers });
    expect(gets()).toHaveLength(rechecks);
  });

  it('a question already answered elsewhere (404) is not revived', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":false}', { status: 404 }));
    useGraphStore.getState().addPendingAskQuestion(question('q'));
    expect(await useGraphStore.getState().respondAskQuestion('q', [])).toBe(true);
    expect(useGraphStore.getState().pendingAskQuestions).toEqual({});
    expect(useGraphStore.getState().askQuestionSendFailures).toEqual({});
  });
});
