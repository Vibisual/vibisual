import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoTextResult } from '../types.js';
import { MEMO } from '../config.js';
import { MemoAI } from './ai.js';
import { parseAIResult } from './aiValidation.js';
import { MemoStore } from './store.js';
import { testHost } from './testHost.js';
const clean: (() => void)[] = []; afterEach(() => clean.splice(0).forEach(fn => fn()));
const req = (): string => `req-${randomUUID()}`;
function setup() { const env = testHost(); clean.push(env.dispose); const store = new MemoStore(env.host); return { ...env, store, ai: new MemoAI(store) }; }
const settled = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)); };

describe('source-bounded AI jobs', () => {
  it('persists a real request snapshot, joins duplicate runs, and reuses verified output', async () => {
    const { root, host, store, ai } = setup(); const note = store.create(root, { requestId: req(), body: '담당자는 미정입니다.' });
    let done!: (value: MemoTextResult) => void;
    host.runTextTask = vi.fn(() => new Promise(resolve => { done = resolve; }));
    const payload = { requestId: req(), mode: 'organize', ids: [note.id] };
    const job = ai.start(root, payload); expect(ai.start(root, { ...payload, requestId: req() }).id).toBe(job.id);
    const quote = note.body;
    done({ state: 'completed', text: JSON.stringify({ title: quote, tags: [], tasks: [], claims: [{ kind: 'decision', text: quote, citations: [{ noteId: note.id, version: 1, quote }] }] }), usage: { input_tokens: 12 }, hostTaskId: 'host-id' });
    await settled();
    expect(ai.get(root, job.id).state).toBe('completed'); expect(ai.get(root, job.id).result?.claims[0]?.citations[0]?.start).toBe(0);
    expect(ai.start(root, { ...payload, requestId: req() }).id).toBe(job.id); expect(host.runTextTask).toHaveBeenCalledTimes(1);
    expect(new MemoAI(new MemoStore(host)).get(root, job.id).sources[0]?.body).toBe(quote);
    const applied = ai.apply(root, job.id, { requestId: req(), baseVersion: 1, fields: ['title'] });
    expect(applied.title).toBe(quote); expect(applied.body).toBe(quote); expect(store.version(root, note.id, 1).title).toBe('');
  });
  it('rejects invented dates or owners even when a real citation is supplied', () => {
    const { root, store } = setup(); const note = store.create(root, { requestId: req(), body: '담당자는 미정입니다.' });
    const raw = JSON.stringify({ claims: [{ kind: 'decision', text: '담당자는 김민수입니다.', citations: [{ noteId: note.id, version: 1, quote: note.body }] }] });
    expect(() => parseAIResult(raw, [note])).toThrow('unsupported-claim');
  });
  it('rejects quotes from another note/version and never trusts model offsets', () => {
    const { root, store } = setup(); const note = store.create(root, { requestId: req(), body: '첫 문장.\n정확한 근거.' });
    const citation = { noteId: note.id, version: 1, quote: '정확한 근거.', start: 999, end: 1000 };
    const parsed = parseAIResult(JSON.stringify({ claims: [{ kind: 'decision', text: '정확한 근거.', citations: [citation] }] }), [note]);
    expect(parsed.claims[0]?.citations[0]?.start).toBe(note.body.indexOf('정확한 근거.'));
    expect(() => parseAIResult(JSON.stringify({ claims: [{ kind: 'decision', text: '정확한 근거.', citations: [{ ...citation, version: 2 }] }] }), [note])).toThrow('invalid-source');
  });
  it('blocks excluded, trashed and globally disabled notes before host execution', async () => {
    const { root, host, store, ai } = setup(); host.runTextTask = vi.fn();
    const excluded = store.create(root, { requestId: req(), body: '검색에는 남습니다.', aiExcluded: true });
    expect(() => ai.start(root, { requestId: req(), mode: 'ask', question: '질문', ids: [excluded.id] })).toThrow('ai-excluded');
    await store.setSettings(root, { aiEnabled: false });
    expect(() => ai.start(root, { requestId: req(), mode: 'ask', question: '질문', ids: [excluded.id] })).toThrow('ai-disabled');
    expect(host.runTextTask).not.toHaveBeenCalled(); expect(store.list(root, { q: '검색' })).toHaveLength(1);
  });
  it('preserves source snapshots and blocks application after the original changes', async () => {
    const { root, host, store, ai } = setup(); const note = store.create(root, { requestId: req(), body: '원래 결정' });
    host.runTextTask = async () => ({ state: 'completed', text: JSON.stringify({ claims: [{ kind: 'decision', text: note.body, citations: [{ noteId: note.id, version: 1, quote: note.body }] }] }) });
    const job = ai.start(root, { requestId: req(), mode: 'organize', ids: [note.id] }); await settled();
    store.save(root, note.id, { requestId: req(), baseVersion: 1, body: '더 새로운 결정' });
    expect(ai.get(root, job.id).sources[0]?.body).toBe('원래 결정');
    expect(() => ai.apply(root, job.id, { requestId: req(), baseVersion: 2, fields: ['body'] })).toThrow('source-changed');
  });
  it('retains drafts under limits and treats lost running jobs as uncertain without executing again', async () => {
    const { root, host, store, ai } = setup(); const note = store.create(root, { requestId: req(), body: 'keep me' });
    host.runTextTask = vi.fn(async () => ({ state: 'limited', text: '' }));
    const limited = ai.start(root, { requestId: req(), mode: 'organize', ids: [note.id] }); await settled();
    expect(ai.get(root, limited.id).state).toBe('limited'); expect(store.get(root, note.id).body).toBe('keep me');
    host.runTextTask = vi.fn(() => new Promise(() => undefined));
    const pending = ai.start(root, { requestId: req(), mode: 'ask', question: '결정은?', ids: [note.id] });
    const restored = new MemoAI(store); expect(restored.get(root, pending.id).state).toBe('checking');
    expect(restored.start(root, { requestId: req(), mode: 'ask', question: '결정은?', ids: [note.id] }).id).toBe(pending.id);
    expect(host.runTextTask).toHaveBeenCalledTimes(1);
  });
  it('rejects excess source length without silently shortening input', () => {
    const { root, store, ai } = setup(); const note = store.create(root, { requestId: req(), body: '가'.repeat(MEMO.inputMax + 1) });
    expect(() => ai.start(root, { requestId: req(), mode: 'organize', ids: [note.id] })).toThrow('ai-input-too-long');
  });
  it('checks quoted transport length before execution, preserving the complete original', () => {
    const { root, host, store, ai } = setup(); host.runTextTask = vi.fn();
    const body = '"'.repeat(13_000); const note = store.create(root, { requestId: req(), body });
    expect(() => ai.start(root, { requestId: req(), mode: 'organize', ids: [note.id] })).toThrow('ai-input-too-long');
    expect(host.runTextTask).not.toHaveBeenCalled(); expect(store.get(root, note.id).body).toBe(body);
  });
});
