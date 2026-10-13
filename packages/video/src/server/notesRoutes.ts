/**
 * §5.13 (V) 37-7 — 메모 핀 저장소와 REST(앱 라우트 — `/api/app/vibistudio/…`).
 *
 * - `GET    /doc/:docId/notes?project=` — 목록
 * - `POST   /doc/:docId/notes { project, t, x, y, text, itemId?, chapterId?, element? }` — 꽂기(사람만)
 * - `PATCH  /doc/:docId/notes/:noteId { project, status?, text?, passId?, reply? }` — 에이전트는 `fixed`·`reply` 만
 * - `DELETE /doc/:docId/notes/:noteId?project=` — 사람만(자동 삭제는 없다 — (K))
 *
 * 자리: `<project>/.vibisual/video/notes/<docId>.json` — 원자적 쓰기(`AppServerHost.atomicWriteFile`). 프로젝트 안에만 산다
 * (§3.5). 쓰기는 읽고 → 고치고 → 쓰기 한 벌이라 한 프로세스 안에서 순서대로 돈다(Express 처리기는 동기).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';

import { VIDEO_NOTES_DIR } from '../constants.js';
import {
  NOTE_REPLY_MAX_CHARS,
  NOTE_TEXT_MAX_CHARS,
  NOTES_MAX_PER_DOC,
  isNoteStatus,
  isSafeNoteId,
  type NotesFile,
  type VideoNote,
} from '../notes.js';
import { isAgentRequest, rejectAgent } from './guards.js';

export interface NotesHost {
  atomicWriteFile(filePath: string, data: string): void;
}

const EMPTY: NotesFile = { schemaVersion: 1, seq: 1, notes: [] };

let noteSeq = 0;
function newNoteId(): string {
  noteSeq = (noteSeq + 1) % 1_000_000;
  return `note-${Date.now().toString(36)}-${noteSeq.toString(36)}`;
}

function clamp01(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function optionalId(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(v) ? v : undefined;
}

export class VideoNotesStore {
  constructor(private readonly host: () => NotesHost) {}

  file(projectPath: string, docId: string): string {
    return path.join(projectPath, '.vibisual', ...VIDEO_NOTES_DIR.split('/'), `${docId}.json`);
  }

  read(projectPath: string, docId: string): NotesFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file(projectPath, docId), 'utf8')) as Partial<NotesFile>;
      const notes = Array.isArray(parsed.notes) ? parsed.notes.filter((n): n is VideoNote => !!n && typeof n === 'object' && isSafeNoteId((n as VideoNote).id)) : [];
      const seq = typeof parsed.seq === 'number' && parsed.seq > 0 ? parsed.seq : notes.reduce((m, n) => Math.max(m, n.n + 1), 1);
      return { schemaVersion: 1, seq, notes };
    } catch {
      return EMPTY;
    }
  }

  private write(projectPath: string, docId: string, file: NotesFile): void {
    const target = this.file(projectPath, docId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    this.host().atomicWriteFile(target, JSON.stringify(file, null, 2));
  }

  add(projectPath: string, docId: string, input: Omit<VideoNote, 'id' | 'n' | 'status' | 'createdAt' | 'updatedAt'>): VideoNote | null {
    const current = this.read(projectPath, docId);
    if (current.notes.length >= NOTES_MAX_PER_DOC) return null;
    const now = Date.now();
    const note: VideoNote = { ...input, id: newNoteId(), n: current.seq, status: 'open', createdAt: now, updatedAt: now };
    this.write(projectPath, docId, { schemaVersion: 1, seq: current.seq + 1, notes: [...current.notes, note] });
    return note;
  }

  update(projectPath: string, docId: string, noteId: string, patch: Partial<Pick<VideoNote, 'status' | 'text' | 'passId' | 'reply'>>): VideoNote | null {
    const current = this.read(projectPath, docId);
    const at = current.notes.findIndex((n) => n.id === noteId);
    const prev = current.notes[at];
    if (at < 0 || !prev) return null;
    const next: VideoNote = { ...prev, ...patch, updatedAt: Date.now() };
    const notes = current.notes.slice();
    notes[at] = next;
    this.write(projectPath, docId, { ...current, notes });
    return next;
  }

  /** 바퀴 보고의 `notesFixed` — 그 메모들을 '고침'으로(닫힌 것은 그대로 둔다). */
  markFixed(projectPath: string, docId: string, noteIds: readonly string[], passId: string): number {
    const current = this.read(projectPath, docId);
    const wanted = new Set(noteIds);
    let changed = 0;
    const now = Date.now();
    const notes = current.notes.map((n) => {
      if (!wanted.has(n.id) || n.status === 'closed' || n.status === 'fixed') return n;
      changed += 1;
      return { ...n, status: 'fixed' as const, passId: n.passId ?? passId, updatedAt: now };
    });
    if (changed > 0) this.write(projectPath, docId, { ...current, notes });
    return changed;
  }

  remove(projectPath: string, docId: string, noteId: string): boolean {
    const current = this.read(projectPath, docId);
    if (!current.notes.some((n) => n.id === noteId)) return false;
    this.write(projectPath, docId, { ...current, notes: current.notes.filter((n) => n.id !== noteId) });
    return true;
  }
}

export interface NotesRouteDeps {
  project(raw: unknown): string | null;
  docExists(projectPath: string, docId: string): boolean;
  readonly notes: VideoNotesStore;
}

export function mountNotesRoutes(app: Express, deps: NotesRouteDeps): void {
  const { notes } = deps;
  const docOk = (projectPath: string, docId: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(docId) && deps.docExists(projectPath, docId);

  app.get('/doc/:docId/notes', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    if (!docOk(p, req.params.docId)) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    res.json({ ok: true, notes: notes.read(p, req.params.docId).notes });
  });

  app.post('/doc/:docId/notes', (req, res) => {
    if (rejectAgent(req, res, 'Notes are pinned by the user. Fix them and list their ids in "notesFixed" of the pass report.')) return;
    const body = req.body as { project?: unknown; t?: unknown; x?: unknown; y?: unknown; text?: unknown; itemId?: unknown; chapterId?: unknown; element?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    if (!docOk(p, docId)) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const x = clamp01(body.x);
    const y = clamp01(body.y);
    const t = typeof body.t === 'number' && Number.isFinite(body.t) ? Math.max(0, body.t) : null;
    if (x === null || y === null || t === null) { res.status(400).json({ ok: false, error: 't, x, y are required (x, y in 0..1)' }); return; }
    const itemId = optionalId(body.itemId);
    const chapterId = optionalId(body.chapterId);
    const element = typeof body.element === 'string' && body.element.trim() !== '' ? body.element.slice(0, 400) : undefined;
    const note = notes.add(p, docId, {
      t, x, y,
      text: text(body.text, NOTE_TEXT_MAX_CHARS),
      ...(itemId ? { itemId } : {}),
      ...(chapterId ? { chapterId } : {}),
      ...(element ? { element } : {}),
    });
    if (!note) { res.status(409).json({ ok: false, error: 'too many notes — delete closed ones first' }); return; }
    res.json({ ok: true, note });
  });

  app.patch('/doc/:docId/notes/:noteId', (req, res) => {
    const body = req.body as { project?: unknown; status?: unknown; text?: unknown; passId?: unknown; reply?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const { docId, noteId } = req.params;
    if (!docOk(p, docId) || !isSafeNoteId(noteId)) { res.status(404).json({ ok: false, error: 'unknown doc or note' }); return; }
    const agent = isAgentRequest(req);
    const patch: { -readonly [K in 'status' | 'text' | 'passId' | 'reply']?: VideoNote[K] } = {};
    if (body.status !== undefined) {
      if (!isNoteStatus(body.status)) { res.status(400).json({ ok: false, error: "status must be 'open', 'sent', 'fixed' or 'closed'" }); return; }
      // 에이전트는 '고침'만 — 닫는 것(확인)·다시 여는 것은 사람의 결정이다.
      if (agent && body.status !== 'fixed') { res.status(403).json({ ok: false, error: 'renderer-only', hint: 'Agents may only mark a note fixed (status "fixed") and add a reply.' }); return; }
      patch.status = body.status;
    }
    if (body.reply !== undefined) {
      const reply = text(body.reply, NOTE_REPLY_MAX_CHARS);
      if (reply !== '') patch.reply = reply;
    }
    if (!agent) {
      if (body.text !== undefined) patch.text = text(body.text, NOTE_TEXT_MAX_CHARS);
      if (typeof body.passId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.passId)) patch.passId = body.passId;
    }
    const note = notes.update(p, docId, noteId, patch);
    if (!note) { res.status(404).json({ ok: false, error: 'unknown note' }); return; }
    res.json({ ok: true, note });
  });

  app.delete('/doc/:docId/notes/:noteId', (req, res) => {
    if (rejectAgent(req, res, 'Only the user deletes notes.')) return;
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const { docId, noteId } = req.params;
    if (!docOk(p, docId) || !isSafeNoteId(noteId)) { res.status(404).json({ ok: false, error: 'unknown doc or note' }); return; }
    res.json({ ok: notes.remove(p, docId, noteId) });
  });
}
