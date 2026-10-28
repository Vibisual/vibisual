/**
 * §5.13 (V) 37-7 — 메모 핀(순수). 시각·자리는 화면 비율 0~1. 에이전트가 고치면 `fixed`, 사람이 확인하면 `closed`(목록엔 남는다).
 * 서버가 `.vibisual/video/notes/<docId>.json` 에 원자적으로 쓰고, 자동 삭제는 없다((K)).
 */

export type NoteStatus = 'open' | 'sent' | 'fixed' | 'closed';

export const NOTE_STATUSES: readonly NoteStatus[] = ['open', 'sent', 'fixed', 'closed'];

export interface VideoNote {
  /** `note-<시각36>-<순번36>` — 파일·주소에 그대로 쓰는 안전한 id. */
  readonly id: string;
  /** 사람이 보는 번호(문서 안에서 1 부터 — 지워도 다시 쓰지 않는다). */
  readonly n: number;
  /** 시각(초, 문서 기준). */
  readonly t: number;
  /** 화면 비율 자리(0~1). */
  readonly x: number;
  readonly y: number;
  readonly itemId?: string;
  readonly chapterId?: string;
  /** 그 자리 요소(컴포지션 안 경로) — 가리키기와 같은 판정. */
  readonly element?: string;
  readonly text: string;
  readonly status: NoteStatus;
  /** 맡긴 바퀴. */
  readonly passId?: string;
  /** 에이전트의 답(고친 뒤 한 줄). */
  readonly reply?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface NotesFile {
  readonly schemaVersion: 1;
  /** 다음 번호(지운 번호를 다시 쓰지 않는다). */
  readonly seq: number;
  readonly notes: readonly VideoNote[];
}

/** 메모 글 상한(글자) — 한 핀에 긴 글은 문맥 블록을 부풀린다. */
export const NOTE_TEXT_MAX_CHARS = 1000;
/** 에이전트 답 상한(글자). */
export const NOTE_REPLY_MAX_CHARS = 400;
/** 한 문서의 메모 수 상한 — 넘으면 새 핀을 거절한다(사람이 닫힌 것을 지우면 다시 꽂힌다). */
export const NOTES_MAX_PER_DOC = 500;

export function isSafeNoteId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

export function isNoteStatus(v: unknown): v is NoteStatus {
  return typeof v === 'string' && (NOTE_STATUSES as readonly string[]).includes(v);
}

/** 아직 사람 손을 기다리는 메모(열림·보냄·고침). 닫힌 것은 목록의 아래 칸에 남는다. */
export function isActiveNote(note: VideoNote): boolean {
  return note.status !== 'closed';
}
