import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInfo, QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';
import { SUB_STREAM_ARCHIVE_SUFFIX } from '@vibisual/shared';
import { appendEvent, flushAll, subStreamsDir } from './streamBufferStore.js';
import { parseConversationSearchTerms, searchSessionConversations } from './sessionConversationSearch.js';

let root: string;
let project: ProjectInfo;
let dir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-search-'));
  project = { name: 'search-project', path: root } as ProjectInfo;
  dir = subStreamsDir(project, 'agent-a');
  fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  flushAll();
  fs.rmSync(root, { recursive: true, force: true });
});

function event(id: string, content: string, extra: Partial<SubAgentStreamEvent> = {}): SubAgentStreamEvent {
  return { id, parentAgentId: 'agent-a', subAgentId: 'sub-a', timestamp: 10, eventType: 'text', content, ...extra };
}

function command(text: string, extra: Partial<QueuedCommand> = {}): QueuedCommand {
  return { id: 'cmd-a', subAgentId: 'sub-a', text, timestamp: 1, status: 'completed', ...extra };
}

function search(terms: string[], commands: QueuedCommand[] = []) {
  return searchSessionConversations({ agentId: 'agent-a', projects: [project], subIds: ['sub-a'], commands, terms });
}

function write(events: SubAgentStreamEvent[], archive = false): void {
  fs.writeFileSync(path.join(dir, archive ? `sub-a${SUB_STREAM_ARCHIVE_SUFFIX}` : 'sub-a.jsonl'),
    events.map((item) => JSON.stringify(item)).join('\n') + '\n');
}

describe('saved session conversation search', () => {
  it('finds old user prompts, saved final answers, and main-only prompts without a stream', async () => {
    const matches = await search(['시간경화', 'archived reply', 'main-only', 'silent'], [
      command('오래전에 사용자가 시간경화를 적었다', { result: 'Archived Reply' }),
      command('main-only', { id: 'cmd-main', subAgentId: null }),
      command('silent', { id: 'cmd-internal', silent: true }),
    ]);
    expect(matches).toEqual({ 'sub-a': ['시간경화', 'archived reply'], '': ['main-only'] });
  });

  it('finds old AI text in the archive and beyond the restored tail, including a word across the file boundary', async () => {
    write([event('archive-1', 'old answer'), event('archive-2', '시간')], true);
    write([event('live-1', '경화'), ...Array.from({ length: 2_100 }, (_, i) => event(`later-${i}`, 'later', { eventType: 'result' }))]);
    expect(await search(['old answer', '시간경화', 'later'])).toEqual({ 'sub-a': ['old answer', '시간경화', 'later'] });
  });

  it('finds pending events and invalidates the result when live or archive content changes', async () => {
    expect(await search(['pending', 'older'])).toEqual({});
    appendEvent(dir, event('pending', 'Pending'));
    expect(await search(['pending', 'older'])).toEqual({ 'sub-a': ['pending'] });
    write([event('older', 'Older')], true);
    expect(await search(['pending', 'older'])).toEqual({ 'sub-a': ['pending', 'older'] });
  });

  it('joins delta text with NFC and case folding but excludes tool, thinking, system and image content', async () => {
    write([
      event('nfc-1', '시간'), event('nfc-2', '경화 ABC'),
      event('tool', 'excluded', { eventType: 'tool_result' }),
      event('think', 'excluded', { eventType: 'thinking' }),
      event('system', 'excluded', { eventType: 'system' }),
      event('image', 'excluded', { imagePath: 'image.png' }),
    ]);
    expect(await search(['시간경화', 'abc', 'excluded'])).toEqual({ 'sub-a': ['시간경화', 'abc'] });
  });

  it('does not invent a word across different turns, speakers, tools or dispatched command boundaries', async () => {
    write([
      event('a1', 'turn', { turnId: 'a' }), event('a2', 'break', { turnId: 'b' }),
      event('b1', 'owner', { nestedUnderToolUseId: 'child' }), event('b2', 'break'),
      event('c1', 'tool'), event('c2', 'ignored', { eventType: 'tool_use' }), event('c3', 'break'),
      event('d1', 'time', { timestamp: 100 }), event('d2', 'break', { timestamp: 200 }),
    ]);
    expect(await search(['turnbreak', 'ownerbreak', 'toolbreak', 'timebreak'], [
      command('new turn', { timestamp: 150 }),
    ])).toEqual({});
  });

  it('keeps enough normalized suffix for long Korean phrases split into decomposed deltas', async () => {
    const phrase = '시간경화'.repeat(100);
    const decomposed = phrase.normalize('NFD');
    write(Array.from({ length: Math.ceil(decomposed.length / 7) }, (_, i) => event(`delta-${i}`, decomposed.slice(i * 7, (i + 1) * 7))));
    expect(await search([phrase])).toEqual({ 'sub-a': [phrase] });
  });

  it('keeps explicit same-turn chunks together when an old turn arrives after another command started', async () => {
    write([event('late-1', '시간', { turnId: 'old-turn', timestamp: 100 }),
      event('late-2', '경화', { turnId: 'old-turn', timestamp: 300 })]);
    expect(await search(['시간경화'], [command('next turn', { id: 'new-turn', timestamp: 200 })]))
      .toEqual({ 'sub-a': ['시간경화'] });
  });

  it('does not merge independent result records and ignores corrupt lines and another session', async () => {
    write([event('r1', 'result', { eventType: 'result' }), event('r2', 'break', { eventType: 'result' }),
      event('other', 'foreign', { subAgentId: 'sub-b' }),
      event('agent', 'foreign-agent', { parentAgentId: 'agent-b' }),
      event('before-foreign', 'split'), event('foreign-gap', 'ignored', { parentAgentId: 'agent-b' }),
      event('after-foreign', 'word')]);
    fs.appendFileSync(path.join(dir, 'sub-a.jsonl'), '{broken\n' + JSON.stringify(event('valid', 'valid')) + '\n');
    expect(await search(['resultbreak', 'foreign', 'foreign-agent', 'splitword', 'valid'])).toEqual({ 'sub-a': ['valid'] });
  });

  it('reports unreadable history as a failure, not a successful search with no matches', async () => {
    fs.mkdirSync(path.join(dir, 'sub-a.jsonl'));
    await expect(search(['word'])).rejects.toThrow();
  });

  it('closes every history file before the search resolves — Windows refuses to delete or replace an open file', async () => {
    write([event('archive-1', 'old answer')], true);
    write([event('live-1', 'new answer'), event('live-2', 'later')]);
    const opened: fs.ReadStream[] = [];
    const createReadStream = fs.createReadStream;
    const spy = vi.spyOn(fs, 'createReadStream').mockImplementation(((...args: Parameters<typeof fs.createReadStream>) => {
      const stream = createReadStream(...args);
      opened.push(stream);
      return stream;
    }) as typeof fs.createReadStream);
    try {
      // Stops early inside the live file, with a line still unread.
      expect(await search(['old answer', 'new answer'])).toEqual({ 'sub-a': ['old answer', 'new answer'] });
      expect(opened.filter((stream) => !stream.closed)).toHaveLength(0);
      // Reads both files to the end.
      expect(await search(['missing'])).toEqual({});
      expect(opened.filter((stream) => !stream.closed)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
    expect(opened).toHaveLength(4);
  });

  it('stops cancelled searches instead of returning partial success', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchSessionConversations({ agentId: 'agent-a', projects: [project], subIds: ['sub-a'], commands: [], terms: ['word'], signal: controller.signal })).rejects.toThrow();
  });
});

describe('search term validation', () => {
  it('normalizes whitespace, case and decomposed Unicode without silently truncating', () => {
    expect(parseConversationSearchTerms(JSON.stringify([' 시간경화 ', '시간경화', 'ABC', ' ']))).toEqual(['시간경화', 'abc']);
    expect(parseConversationSearchTerms('[]')).toEqual([]);
    for (const bad of [undefined, ['word'], '{}', '{', '[1]', JSON.stringify(Array(33).fill('a')), JSON.stringify(['a'.repeat(513)])]) {
      expect(parseConversationSearchTerms(bad)).toBeNull();
    }
  });
});
