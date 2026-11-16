import { createHash, randomUUID } from 'node:crypto';
import { MEMO } from '../config.js';
import type { MemoAIJob, MemoNote } from '../types.js';
import { buildMemoPrompt, parseAIResult } from './aiValidation.js';
import { identifier, MemoError, object, text } from './errors.js';
import type { MemoStore } from './store.js';

export class MemoAI {
  private readonly running = new Set<string>();
  constructor(readonly store: MemoStore) {}
  private allowed(root: string, notes: MemoNote[]): void {
    if (!this.store.settings(root).aiEnabled) throw new MemoError('ai-disabled', 409);
    for (const note of notes) {
      const current = this.store.get(root, note.id);
      if (current.aiExcluded || current.deletedAt !== null) throw new MemoError('ai-excluded', 409);
    }
  }
  private read(root: string, id: unknown): MemoAIJob {
    const key = identifier(id, 'job');
    const job = this.store.disk.read(root, `jobs/${key}.json`, value => {
      const row = object(value);
      if (row['id'] !== key || !Array.isArray(row['sources']) || typeof row['state'] !== 'string') throw new MemoError('storage-corrupt', 500);
      return row as unknown as MemoAIJob;
    });
    if (!job) throw new MemoError('job-unavailable', 404);
    return job;
  }
  get(root: string, id: unknown): MemoAIJob {
    const job = this.read(root, id);
    this.allowed(root, job.sources);
    if (job.state === 'running' && !this.running.has(`${root}/${job.id}`)) {
      job.state = 'checking'; job.error = 'execution-unknown'; job.updatedAt = Date.now();
      this.store.disk.write(root, `jobs/${job.id}.json`, job);
    }
    return job;
  }
  list(root: string): MemoAIJob[] {
    if (!this.store.settings(root).aiEnabled) return [];
    const names = this.store.disk.names(root, 'jobs').filter(name => /^job-[a-zA-Z0-9-]+\.json$/.test(name)).sort().reverse().slice(0, MEMO.jobMax);
    const jobs: MemoAIJob[] = [];
    for (const name of names) {
      try { jobs.push(this.get(root, name.slice(0, -5))); }
      catch (error) { if (!(error instanceof MemoError) || !['ai-excluded', 'note-unavailable'].includes(error.code)) throw error; }
    }
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }
  start(root: string, raw: unknown): MemoAIJob {
    const input = object(raw);
    const requestId = identifier(input['requestId'], 'req');
    if (!Array.isArray(input['ids']) || input['ids'].length < 1 || input['ids'].length > MEMO.selectionMax) throw new MemoError('selection-limit');
    const ids = [...new Set(input['ids'].map(id => identifier(id, 'memo')))];
    const sources = ids.map(id => this.store.get(root, id));
    this.allowed(root, sources);
    if (sources.reduce((size, note) => size + note.body.length + note.title.length, 0) > MEMO.inputMax) throw new MemoError('ai-input-too-long', 413);
    const mode = input['mode'] === 'organize' ? 'organize' : input['mode'] === 'ask' ? 'ask' : null;
    const provider = input['provider'] === 'codex' ? 'codex' : 'claude';
    if (!mode || (mode === 'organize' && sources.length !== 1)) throw new MemoError('invalid-request');
    const question = mode === 'ask' ? text(input['question'], MEMO.questionMax).trim() : '';
    if (mode === 'ask' && !question) throw new MemoError('question-required');
    // Reserve argv space even for Windows quoting; never shorten escaped source text.
    if (JSON.stringify(buildMemoPrompt(sources, mode, question)).length > MEMO.promptMax) throw new MemoError('ai-input-too-long', 413);
    const key = createHash('sha256').update(JSON.stringify({ mode, question, provider, sources: sources.map(note => [note.id, note.version]) })).digest('hex');
    const existing = this.list(root);
    const replay = existing.find(job => job.requestId === requestId);
    if (replay) { if (replay.key !== key) throw new MemoError('request-conflict', 409); return replay; }
    const checking = existing.find(job => job.key === key && ['running', 'checking'].includes(job.state));
    if (checking && !(checking.state === 'checking' && input['regenerate'] === true)) return checking;
    const cached = existing.find(job => job.key === key && job.state === 'completed');
    if (cached && input['regenerate'] !== true) return cached;
    if (this.running.size >= 2) throw new MemoError('ai-busy', 409);
    const now = Date.now();
    const job: MemoAIJob = { id: `job-${now.toString(36)}-${randomUUID()}`, key, requestId, mode, provider, question, state: 'running', createdAt: now,
      updatedAt: now, sources, result: null, error: '' };
    this.store.disk.write(root, `jobs/${job.id}.json`, job);
    this.running.add(`${root}/${job.id}`);
    void this.execute(root, job);
    return job;
  }
  private async execute(root: string, job: MemoAIJob): Promise<void> {
    try {
      this.allowed(root, job.sources);
      const response = await this.store.host.runTextTask(buildMemoPrompt(job.sources, job.mode, job.question), job.provider);
      this.allowed(root, job.sources);
      job.state = response.state;
      if (response.hostTaskId) job.hostTaskId = response.hostTaskId;
      if (response.usage) job.usage = response.usage;
      if (response.state === 'completed') job.result = parseAIResult(response.text, job.sources);
      else job.error = response.state === 'checking' ? 'execution-unknown' : response.state;
    } catch (error) { job.state = 'failed'; job.error = error instanceof MemoError ? error.code : 'ai-failed'; }
    finally {
      job.updatedAt = Date.now();
      try { this.store.disk.write(root, `jobs/${job.id}.json`, job); }
      catch (error) { this.store.host.warn(`[memo] Cannot persist AI result: ${String(error)}`); }
      this.running.delete(`${root}/${job.id}`);
    }
  }
  apply(root: string, id: unknown, raw: unknown): MemoNote {
    const input = object(raw);
    const job = this.get(root, id);
    if (job.state !== 'completed' || !job.result || job.mode !== 'organize') throw new MemoError('result-unavailable', 409);
    const source = job.sources[0];
    if (!source) throw new MemoError('result-unavailable', 409);
    const current = this.store.get(root, source.id);
    const requestId = identifier(input['requestId'], 'req');
    if (current.requestId === requestId) return current;
    if (current.version !== source.version || input['baseVersion'] !== current.version) throw new MemoError('source-changed', 409);
    if (!Array.isArray(input['fields']) || !input['fields'].length || input['fields'].some(field => !['title', 'body', 'tags', 'tasks'].includes(String(field)))) throw new MemoError('invalid-request');
    const fields = input['fields']; const result = job.result;
    const updated: MemoNote = { ...current, version: current.version + 1, updatedAt: Date.now(), author: 'ai' };
    if (fields.includes('title') && result.title) updated.title = result.title;
    if (fields.includes('body') && result.summary) updated.body = result.summary;
    if (fields.includes('tags')) updated.tags = [...new Set([...current.tags, ...result.tags])];
    if (fields.includes('tasks')) updated.tasks = [...current.tasks, ...result.tasks.filter(task => !current.tasks.some(existing => existing.text === task.text))
      .map(task => ({ id: `task-${randomUUID()}`, text: task.text, checked: false }))];
    if (updated.tags.length > MEMO.tagMax || updated.tasks.length > MEMO.taskMax) throw new MemoError('invalid-request');
    return this.store.commit(root, updated, requestId);
  }
}
