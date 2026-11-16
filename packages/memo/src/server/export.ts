import { zip, type Zippable } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import { MEMO } from '../config.js';
import type { MemoNote } from '../types.js';
import { MemoAssets, safeName } from './assets.js';
import { MemoError } from './errors.js';
import type { MemoStore } from './store.js';

/** 원본 첨부가 글·판본·AI 기록 몫의 자리까지 채우지 않게 남겨 두는 여유. */
const TEXT_RESERVE = 16 * 1024 * 1024;
export function markdown(note: MemoNote): string {
  const title = note.title || note.body.split('\n')[0] || note.id;
  const lines = [`# ${title}`, '', note.body, '', ...note.tasks.map(task => `- [${task.checked ? 'x' : ' '}] ${task.text}`), '',
    ...note.attachments.map(asset => `[${asset.name.replace(/[\[\]]/g, '_')}](../attachments/${asset.id}-${safeName(asset.name)})`), '',
    note.tags.map(tag => `#${tag}`).join(' ')];
  if (note.context) lines.push('', `Context: ${note.context.label} (${note.context.id})`, '', note.context.excerpt);
  return lines.join('\n');
}
export async function exportMemos(store: MemoStore, root: string): Promise<Uint8Array> {
  const notes = [...store.list(root, {}), ...store.list(root, { view: 'trash' })];
  const files: Zippable = {};
  let total = 0;
  const add = (file: string, value: string | Uint8Array): void => {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    total += bytes.length;
    if (total > MEMO.exportMax) throw new MemoError('export-too-large', 413);
    // Stored ZIP avoids compression work on Electron's main thread.
    files[file] = [bytes, { level: 0 }];
  };
  const assets = new MemoAssets(store); const seen = new Set<string>();
  const omittedAttachments: { id: string; noteId: string; name: string; size: number; path: string }[] = [];
  for (const note of notes) {
    add(`notes/${note.id}.md`, markdown(note));
    for (let version = 1; version <= note.version; version++) {
      await new Promise<void>(resolve => setImmediate(resolve));
      const previous = store.version(root, note.id, version);
      add(`versions/${note.id}/${version}.json`, JSON.stringify(previous));
      for (const asset of previous.attachments) {
        if (seen.has(asset.id)) continue;
        seen.add(asset.id);
        const original = assets.locate(root, note.id, asset.id, version);
        // ZIP 은 메모리에서 만든다. 상한을 넘기는 원본은 빼고 디스크 위치를 적어, 큰 영상 하나가 글 반출까지 막지 않게 한다.
        if (total + original.size > MEMO.exportMax - TEXT_RESERVE) {
          omittedAttachments.push({ id: asset.id, noteId: note.id, name: original.name, size: original.size, path: path.relative(root, original.file).split(path.sep).join('/') });
        } else add(`attachments/${asset.id}-${safeName(original.name)}`, fs.readFileSync(original.file));
      }
    }
  }
  for (const name of store.disk.names(root, 'jobs').filter(name => /^job-[a-zA-Z0-9-]+\.json$/.test(name))) {
    const job = store.disk.read(root, `jobs/${name}`, value => value);
    if (job) add(`jobs/${name}`, JSON.stringify(job));
  }
  add('manifest.json', JSON.stringify({ format: 'vibisual-memo', version: 1, exportedAt: Date.now(), notes, omittedAttachments, settings: store.settings(root) }, null, 2));
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (error, result) => { if (error) reject(error); else resolve(result); });
  });
}
