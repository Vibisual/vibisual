import { MEMO } from '../config.js';
import type { MemoAttachment, MemoContext, MemoNote, MemoTask } from '../types.js';
import { identifier, MemoError, object, text } from './errors.js';

export function noteData(raw: unknown): MemoNote {
  const value = object(raw);
  identifier(value['id'], 'memo');
  if (!Number.isSafeInteger(value['version']) || Number(value['version']) < 1 || typeof value['body'] !== 'string'
    || !Array.isArray(value['attachments']) || !Array.isArray(value['tasks']) || !Array.isArray(value['tags'])
    || typeof value['createdAt'] !== 'number' || typeof value['updatedAt'] !== 'number') throw new MemoError('storage-corrupt', 500);
  return value as unknown as MemoNote;
}
export function tags(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MEMO.tagMax) throw new MemoError('invalid-tags');
  return [...new Set(raw.map(tag => text(tag, MEMO.tagLength).trim()).filter(Boolean))];
}
export function tasks(raw: unknown): MemoTask[] {
  if (!Array.isArray(raw) || raw.length > MEMO.taskMax) throw new MemoError('invalid-tasks');
  return raw.map(item => {
    const row = object(item);
    return { id: identifier(row['id'], 'task'), text: text(row['text'], MEMO.questionMax), checked: row['checked'] === true };
  });
}
export function attachmentData<T extends MemoAttachment = MemoAttachment>(raw: unknown): T {
  const value = object(raw);
  identifier(value['id'], 'asset');
  if (typeof value['name'] !== 'string' || typeof value['mime'] !== 'string' || !Number.isSafeInteger(value['size'])) throw new MemoError('storage-corrupt', 500);
  return value as unknown as T;
}
export function contextPatch(raw: unknown): { id: string; excerpt: string } | null {
  if (raw === null) return null;
  const value = object(raw);
  return { id: text(value['id'], MEMO.questionMax), excerpt: text(value['excerpt'] ?? '', MEMO.inputMax) };
}
export function restoreFields(note: MemoNote): Pick<MemoNote, 'title' | 'body' | 'tags' | 'tasks' | 'context' | 'attachments'> {
  return { title: note.title, body: note.body, tags: note.tags, tasks: note.tasks, context: note.context, attachments: note.attachments };
}
export function validContext(context: MemoContext | null, project: string): MemoContext | null {
  if (!context || (context.kind === 'project' && context.id !== project)) return null;
  return context;
}
