import { MEMO } from '../config.js';
import type { MemoNote } from '../types.js';
import { errorCode, MemoAPIError, requestId, type MemoAPI } from './api.js';
import type { MediaPreview } from './mediaPreview.js';

export interface MemoUpload { id: string; noteId: string; name: string; size: number; sent: number; state: 'waiting' | 'sending' | 'failed'; error: string }
interface Job extends MemoUpload { file: File; requestId: string; preview?: MediaPreview | null; thumbSent: boolean; cancelled: boolean }
export type UploadCommit = (noteId: string, payload: Record<string, unknown>) => Promise<MemoNote>;

/** 클립보드 그림은 이름이 늘 같다. 붙인 시각으로 지어 목록에서 서로 구분되게 한다. */
export function pastedFile(file: File, now = new Date()): File {
  if (file.name !== 'image.png') return file;
  const two = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return new File([file], `capture-${stamp}.png`, { type: file.type, lastModified: file.lastModified });
}
/** 첨부 올리기 줄. 한 번에 한 파일씩 조각으로 보내고, 실패한 항목은 보낸 자리에서 다시 잇는다. */
export class MemoUploads {
  changed: () => void = () => undefined;
  private jobs: Job[] = [];
  private running = false;
  constructor(private readonly api: MemoAPI, private readonly commit: UploadCommit, private readonly preview: (file: File) => Promise<MediaPreview | null>) {}
  get items(): readonly MemoUpload[] { return this.jobs; }
  add(noteId: string, files: readonly File[]): void {
    for (const file of files) {
      this.jobs.push({ id: `up-${crypto.randomUUID()}`, noteId, name: file.name, size: file.size, sent: 0, state: 'waiting', error: '',
        file, requestId: requestId(), thumbSent: false, cancelled: false });
    }
    this.changed(); void this.run();
  }
  retry(id: string): void {
    const job = this.jobs.find(item => item.id === id && item.state === 'failed');
    if (!job) return;
    job.state = 'waiting'; job.error = ''; this.changed(); void this.run();
  }
  cancel(id: string): void {
    const job = this.jobs.find(item => item.id === id);
    if (!job) return;
    job.cancelled = true; this.jobs = this.jobs.filter(item => item !== job);
    // 보내는 중인 조각이 지운 파일을 다시 만들지 않게, 그 조각이 돌아온 뒤에 치운다(`run`).
    if (job.state !== 'sending') this.discard(job);
    this.changed();
  }
  stop(): void { for (const job of [...this.jobs]) this.cancel(job.id); }
  private discard(job: Job): void { void this.api.request(`/uploads/${job.id}`, 'DELETE').catch(() => undefined); }
  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.next(); job; job = this.next()) {
        job.state = 'sending'; this.changed();
        try { await this.send(job); if (!job.cancelled) this.jobs = this.jobs.filter(item => item !== job); }
        catch (error) { job.state = 'failed'; job.error = errorCode(error); }
        if (job.cancelled) this.discard(job);
        this.changed();
      }
    } finally { this.running = false; }
  }
  private next(): Job | undefined { return this.jobs.find(item => item.state === 'waiting'); }
  private async send(job: Job): Promise<void> {
    if (job.size === 0) throw new MemoAPIError('attachment-empty');
    if (job.size > MEMO.attachmentMax) throw new MemoAPIError('attachment-too-large');
    if (job.preview === undefined) job.preview = await this.preview(job.file).catch(() => null);
    let failures = 0;
    while (job.sent < job.size && !job.cancelled) {
      try {
        const received = await this.api.putChunk(job.id, job.file.slice(job.sent, job.sent + MEMO.uploadChunk), { offset: String(job.sent) });
        if (received <= job.sent) throw new MemoAPIError('upload-incomplete');
        job.sent = received; failures = 0;
      } catch (error) {
        if (++failures > MEMO.uploadRetries) throw error;
        const received = error instanceof MemoAPIError ? error.detail['received'] : undefined;
        // 서버가 받은 자리를 알려 주면 거기서 잇고, 끊긴 연결은 같은 조각을 다시 보낸다.
        if (errorCode(error) === 'upload-out-of-sync' && typeof received === 'number' && received <= job.size) job.sent = received;
        else if (errorCode(error) !== 'connection-failed') throw error;
      }
      this.changed();
    }
    if (job.cancelled) return;
    const preview = job.preview;
    if (preview?.thumb && !job.thumbSent) {
      // 미리보기는 없어도 첨부가 성립한다.
      await this.api.putChunk(job.id, preview.thumb, { part: 'thumb' }).catch(() => undefined); job.thumbSent = true;
    }
    if (job.cancelled) return;
    await this.commit(job.noteId, { requestId: job.requestId, uploadId: job.id, name: job.name, mime: job.file.type, size: job.size,
      width: preview?.width, height: preview?.height, duration: preview?.duration });
  }
}
