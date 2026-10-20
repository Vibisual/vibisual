import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DDraftSaveInput, Vibi3DDraftWriteResult } from '@vibisual/shared';
import { ModelDraftAutosave } from './modelDraftAutosave.js';
import { ModelDraftApiError, type ModelDraftScope } from './modelDraftApi.js';

const human: ModelDraftScope = { projectId: '/project', key: 'doc:model', actor: 'human' };
const agent: ModelDraftScope = { ...human, actor: 'agent' };
const content = (value: number) => ({ fileName: 'Building', payload: { value }, links: [] });
function receipt(input: Vibi3DDraftSaveInput): Vibi3DDraftWriteResult {
  const version = input.expectedVersion + 1;
  return { draft: { ...input, version, createdAt: 1, updatedAt: version, links: input.links ?? [] }, version, savedVersion: version, replayed: false };
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(yes => { resolve = yes; }), resolve: value => resolve(value) };
}
afterEach(() => { vi.useRealTimers(); });

describe('model draft autosave durability', () => {
  it('retires a conflicting lane only after its complete backup has a durable receipt', async () => {
    const backup = { ...human, key: 'local:backup' };
    const save = vi.fn().mockImplementation(async (_project, input) => {
      if (input.key === human.key) throw new ModelDraftApiError('draft-version-conflict', 409);
      return receipt(input);
    });
    const writer = new ModelDraftAutosave({ save });
    writer.set(human, content(4));
    await expect(writer.flush(human)).rejects.toMatchObject({ code: 'draft-version-conflict' });
    expect(writer.retireAfterBackup(human, backup)).toBe(false);
    writer.set(backup, content(4));
    expect(writer.retireAfterBackup(human, backup)).toBe(false);
    await writer.flush(backup);
    expect(writer.retireAfterBackup(human, backup)).toBe(true);
    expect(writer.get(backup).draft?.payload).toEqual({ value: 4 });
    expect(writer.get(human).status).toBe('idle');
    writer.dispose();
  });

  it('preserves the old lane after failed, incomplete, different-actor or different-project backups', async () => {
    const backup = { ...human, key: 'local:backup' };
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementation(async (_project, input) => receipt(input));
    const writer = new ModelDraftAutosave({ save });
    writer.set(human, content(4)); writer.set(backup, content(4));
    await expect(writer.flush(backup)).rejects.toThrow('disk full');
    expect(writer.retireAfterBackup(human, backup)).toBe(false);
    await writer.retry(backup);
    expect(writer.retireAfterBackup(human, { ...backup, actor: 'agent' })).toBe(false);
    expect(writer.retireAfterBackup(human, { ...backup, projectId: 'another-project' })).toBe(false);
    expect(writer.retireAfterBackup(human, human)).toBe(false);
    writer.set(human, content(5));
    expect(writer.retireAfterBackup(human, backup)).toBe(false);
    expect(writer.get(human)).toMatchObject({ status: 'pending', editVersion: 2 });
    writer.dispose();
  });

  it('cannot retire an old lane while its original write is still in flight', async () => {
    const backup = { ...human, key: 'local:backup' };
    const pending = deferred<Vibi3DDraftWriteResult>();
    const save = vi.fn().mockImplementation(async (_project, input) => input.key === human.key ? pending.promise : receipt(input));
    const writer = new ModelDraftAutosave({ save });
    writer.set(human, content(4)); writer.set(backup, content(4));
    const originalWrite = writer.flush(human);
    await writer.flush(backup);
    expect(writer.retireAfterBackup(human, backup)).toBe(false);
    const call = save.mock.calls.find(([, input]) => input.key === human.key)!;
    pending.resolve(receipt(call[1])); await originalWrite;
    expect(writer.retireAfterBackup(human, backup)).toBe(true);
    writer.dispose();
  });

  it('debounces captures but flush saves immediately and reports saved only after acknowledgment', async () => {
    vi.useFakeTimers();
    const pending = deferred<Vibi3DDraftWriteResult>();
    const save = vi.fn().mockReturnValue(pending.promise);
    const writer = new ModelDraftAutosave({ save, debounceMs: 700 });
    writer.set(human, content(1));
    writer.set(human, content(2));
    await vi.advanceTimersByTimeAsync(699);
    expect(save).not.toHaveBeenCalled();
    const flushed = writer.flush(human);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1].payload).toEqual({ value: 2 });
    expect(writer.get(human).status).toBe('saving');
    pending.resolve(receipt(save.mock.calls[0]![1]));
    await flushed;
    expect(writer.get(human)).toMatchObject({ status: 'saved', version: 1, editVersion: 2, savedEditVersion: 2 });
    writer.dispose();
  });

  it('keeps an immutable request after a lost reply then saves newer edits in order', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('lost reply')).mockImplementation(async (_project, input) => receipt(input));
    const writer = new ModelDraftAutosave({ save });
    const first = content(1);
    writer.set(human, first);
    first.payload.value = 999;
    await expect(writer.flush(human)).rejects.toThrow('lost reply');
    const request = structuredClone(save.mock.calls[0]![1]);
    writer.set(human, content(2));
    expect(writer.get(human).status).toBe('error');
    await writer.retry(human);
    expect(save.mock.calls[1]![1]).toEqual(request);
    expect(request.payload).toEqual({ value: 1 });
    expect(save.mock.calls[2]![1]).toMatchObject({ expectedVersion: 1, payload: { value: 2 } });
    expect(save.mock.calls[2]![1].requestId).not.toBe(request.requestId);
    expect(writer.get(human)).toMatchObject({ status: 'saved', version: 2, savedEditVersion: 2 });
    writer.dispose();
  });

  it('drains edits made during an active flush and never flashes saved for the earlier response', async () => {
    const first = deferred<Vibi3DDraftWriteResult>();
    const second = deferred<Vibi3DDraftWriteResult>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const states: string[] = [];
    const writer = new ModelDraftAutosave({ save, onChange: (_scope, state) => { states.push(state.status); } });
    writer.set(human, content(1));
    const flushed = writer.flush(human);
    await Promise.resolve();
    writer.set(human, content(2));
    const close = writer.flush(human);
    first.resolve(receipt(save.mock.calls[0]![1]));
    await Promise.resolve(); await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(states).not.toContain('saved');
    expect(writer.get(human).savedEditVersion).toBe(1);
    second.resolve(receipt(save.mock.calls[1]![1]));
    await Promise.all([flushed, close]);
    expect(writer.get(human).status).toBe('saved');
    writer.dispose();
  });

  it('does not accept a receipt whose draft was replaced or deleted after a lost reply', async () => {
    const save = vi.fn().mockImplementation(async (_project, input) => ({ ...receipt(input), draft: null, version: 3, replayed: true }));
    const writer = new ModelDraftAutosave({ save });
    writer.set(human, content(1));
    await expect(writer.flush(human)).rejects.toMatchObject({ code: 'draft-version-conflict' });
    expect(writer.get(human)).toMatchObject({ status: 'error', version: 0, savedEditVersion: 0 });
    writer.dispose();
  });

  it('isolates human/agent and old/new sources while a failed lane cannot stop another from saving', async () => {
    const other = { ...human, key: 'doc:other' };
    const save = vi.fn().mockImplementation(async (_project, input) => {
      if (input.key === human.key && input.actor === human.actor) throw new ModelDraftApiError('draft-version-conflict', 409);
      return receipt(input);
    });
    const writer = new ModelDraftAutosave({ save });
    writer.set(human, content(1)); writer.set(agent, content(2)); writer.set(other, content(3));
    await expect(writer.flush()).rejects.toMatchObject({ code: 'draft-version-conflict' });
    expect(writer.get(human).status).toBe('error');
    expect(writer.get(agent)).toMatchObject({ status: 'saved', draft: { payload: { value: 2 } } });
    expect(writer.get(other)).toMatchObject({ status: 'saved', draft: { payload: { value: 3 } } });
    writer.dispose();
  });

  it('ignores stale hydration and never rebases outstanding local edits over a remote head', async () => {
    const writer = new ModelDraftAutosave({ save: vi.fn(async (_project, input) => receipt(input)) });
    expect(writer.hydrate(human, { draft: null, version: 3 })).toBe(true);
    expect(writer.hydrate(human, { draft: null, version: 2 })).toBe(false);
    writer.set(human, content(1));
    expect(writer.hydrate(human, { draft: null, version: 5 })).toBe(false);
    await writer.flush(human);
    expect(writer.get(human).version).toBe(4);
    writer.dispose();
  });

  it('keeps serialization failure visible even when an older in-flight save succeeds', async () => {
    const pending = deferred<Vibi3DDraftWriteResult>();
    const save = vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async (_project, input) => receipt(input));
    const writer = new ModelDraftAutosave({ save });
    writer.set(human, content(1));
    const flushed = writer.flush(human);
    await Promise.resolve();
    writer.fail(human, new Error('capture failed'));
    pending.resolve(receipt(save.mock.calls[0]![1]));
    await expect(flushed).rejects.toThrow('capture failed');
    await expect(writer.retry(human)).rejects.toThrow('capture failed');
    expect(writer.get(human).status).toBe('error');
    writer.set(human, content(3));
    await writer.flush(human);
    expect(writer.get(human)).toMatchObject({ status: 'saved', version: 2, draft: { payload: { value: 3 } } });
    writer.dispose();
  });
});
