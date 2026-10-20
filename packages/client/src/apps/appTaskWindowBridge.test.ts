import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { matchesTaskWindow, prepareOutsideTaskWindow, registerTaskWindowResponder } from './appTaskWindowBridge.js';

class Channel {
  static all = new Set<Channel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) { Channel.all.add(this); }
  postMessage(data: unknown): void { for (const other of Channel.all) if (other !== this && other.name === this.name) queueMicrotask(() => other.onmessage?.({ data } as MessageEvent)); }
  close(): void { Channel.all.delete(this); this.onmessage = null; }
}
const cleanups: Array<() => void> = [];
beforeEach(() => { vi.stubGlobal('BroadcastChannel', Channel); });
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); Channel.all.clear(); vi.unstubAllGlobals(); });
const target = { appId: 'app', projectId: 'C:/project', ref: 'source', bubbleId: 'bubble' };

it('saves the matching detached editor and returns its freshly published target', async () => {
  let current = target;
  const prepare = vi.fn(async () => { current = { ...target, ref: 'saved-source' }; return true; });
  cleanups.push(registerTaskWindowResponder(() => current, prepare));
  expect(await prepareOutsideTaskWindow(target)).toEqual({ ref: 'saved-source', file: undefined });
  expect(prepare).toHaveBeenCalledOnce();
  expect(Channel.all.size).toBe(1);
});
it('does not accept a disk fallback when the live save is rejected', async () => {
  cleanups.push(registerTaskWindowResponder(() => target, async () => false));
  await expect(prepareOutsideTaskWindow(target)).rejects.toThrow('app-task-save-failed');
});
it('times out rather than silently copying an unrelated or unavailable window', async () => {
  const prepare = vi.fn(async () => true);
  cleanups.push(registerTaskWindowResponder(() => ({ ...target, projectId: 'C:/other' }), prepare));
  await expect(prepareOutsideTaskWindow(target, 5)).rejects.toThrow('app-task-save-timeout');
  expect(prepare).not.toHaveBeenCalled();
});
it('matches a document opened with or without its older export and never mixes projects', () => {
  expect(matchesTaskWindow(target, { ...target, file: 'old.glb', bubbleId: undefined })).toBe(true);
  expect(matchesTaskWindow(target, { ...target, projectId: 'D:/project' })).toBe(false);
});
