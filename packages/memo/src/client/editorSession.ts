import type { MemoContext, MemoNote, MemoTask } from '../types.js';
import { errorCode, MemoAPI, MemoAPIError, requestId } from './api.js';

export interface MemoDraft { title: string; body: string; tags: string[]; tasks: MemoTask[]; context: MemoContext | null; pinned: boolean; aiExcluded: boolean }
function fields(note: MemoNote | null): MemoDraft {
  return { title: note?.title ?? '', body: note?.body ?? '', tags: note?.tags ?? [], tasks: note?.tasks ?? [], context: note?.context ?? null,
    pinned: note?.pinned ?? false, aiExcluded: note?.aiExcluded ?? false };
}
/** 서버가 커밋 전에 payload 자체를 거절한 오류: 같은 payload 를 다시 보내도 영원히 실패하므로 재시도 대상에서 뺀다. */
const REJECTED = new Set(['input-too-long', 'invalid-tags', 'invalid-tasks', 'invalid-request', 'context-unavailable']);
/** One ordered writer per editor. Failed writes keep their payload and all newer typing. */
export class MemoEditorSession {
  note: MemoNote | null = null;
  draft = fields(null);
  dirty = false;
  saving = false;
  composing = false;
  error = '';
  /** 다른 문서가 열릴 때만 오른다. 새 메모의 첫 저장(null -> id)은 같은 문서로 본다. */
  session = 0;
  private generation = 0;
  private inflight: Promise<boolean> | null = null;
  private pending: { generation: number; payload: MemoDraft & { requestId: string; baseVersion?: number } } | null = null;
  private side: Promise<void> | null = null;
  changed: () => void = () => undefined;
  constructor(readonly api: MemoAPI) {}
  reset(note: MemoNote | null): void {
    if (!note || note.id !== this.note?.id) this.session++;
    this.note = note; this.draft = fields(note); this.dirty = false; this.pending = null; this.error = ''; this.generation++; this.changed();
  }
  edit(patch: Partial<MemoDraft>): void {
    this.draft = { ...this.draft, ...patch }; this.generation++; this.dirty = true;
    if (REJECTED.has(this.error)) this.error = '';
    this.changed();
  }
  flush(): Promise<boolean> {
    if (this.composing) return Promise.resolve(false);
    if (this.inflight) return this.inflight;
    this.inflight = this.write().finally(() => { this.inflight = null; });
    return this.inflight;
  }
  private async write(): Promise<boolean> {
    this.saving = true; this.changed();
    try {
      while (this.dirty) {
        while (this.side) await this.side;
        this.pending ??= { generation: this.generation, payload: { ...this.draft, requestId: requestId(), ...(this.note ? { baseVersion: this.note.version } : {}) } };
        const pending = this.pending;
        const note = await this.api.request<MemoNote>(this.note ? `/notes/${this.note.id}` : '/notes', this.note ? 'PATCH' : 'POST', pending.payload);
        this.note = note; this.pending = null; this.error = '';
        if (pending.generation === this.generation) { this.dirty = false; this.draft = fields(note); }
        this.changed();
      }
      return true;
    } catch (error) {
      this.error = errorCode(error); if (REJECTED.has(this.error)) this.pending = null;
      return false;
    } finally { this.saving = false; this.changed(); }
  }
  /** 초안에 없는 필드(첨부)를 바꾸는 요청을 저장과 겹치지 않게 끼운다. 초안과 그 뒤 타이핑은 건드리지 않는다. */
  async sideWrite(run: (note: MemoNote) => Promise<MemoNote>): Promise<MemoNote> {
    while (this.inflight || this.side) await (this.inflight ?? this.side);
    const base = this.note;
    if (!base) throw new MemoAPIError('note-unavailable');
    let release = (): void => undefined;
    this.side = new Promise<void>(resolve => { release = resolve; });
    try {
      const note = await run(base);
      // 기다리던 저장이 새 판본을 기준으로 다시 만들어지게 한다.
      if (this.note?.id === note.id) { this.note = note; this.pending = null; }
      return note;
    } finally { this.side = null; release(); this.changed(); }
  }
  async keepCopy(): Promise<boolean> {
    try {
      const generation = this.generation;
      const copy = await this.api.request<MemoNote>('/notes', 'POST', { ...this.draft, requestId: requestId() });
      if (generation === this.generation) this.reset(copy);
      else { this.note = copy; this.pending = null; this.error = ''; this.dirty = true; return this.flush(); }
      return true;
    } catch (error) { this.error = errorCode(error); this.changed(); return false; }
  }
}
