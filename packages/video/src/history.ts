/**
 * §5.13 (V) 37-3 — 판 기록·바퀴의 모양과 되돌리기 연산 (순수).
 *
 * 판 기록은 **바퀴**(AI 에게 한 번 맡긴 것)와 **사용자가 찍은 저장점** 단위로 남는다. 서버가 파일로 쓰고(원자적 쓰기 —
 * `.vibisual/video/history/<docId>/`), 스튜디오가 세로 구슬 줄로 그린다. 자동 삭제는 없다((K)) — 지우기는 사용자가 목록에서.
 *
 * 되돌리기는 새 문서를 통째로 쓰는 것이 아니라 **편집 연산**이다(`restoreOps`) — 판본·낙관적 잠금·진단 경로를 그대로
 * 지나고, 되돌림도 새 판본이 된다. 클라(되돌리기 단추)와 서버(판으로 돌아가기)가 이 한 벌을 쓴다.
 */

import type { VideoDoc, VideoDocOp } from './types.js';

/** 판의 종류. */
export type HistoryKind = 'pass-start' | 'pass-end' | 'checkpoint' | 'restore' | 'render';

/** 누가 만든 판인가 — 루프백 유입(에이전트)이면 AI. */
export type HistoryAuthor = 'user' | 'ai';

export interface HistoryEntry {
  /** `rev-<시각36>-<순번36>` — 파일 이름에 그대로 쓰는 안전한 id. */
  readonly id: string;
  readonly kind: HistoryKind;
  readonly by: HistoryAuthor;
  /** 그 판의 문서 판본. */
  readonly docVersion: number;
  readonly createdAt: number;
  readonly passId?: string;
  /** 사람이 붙인 이름(저장점) 또는 자동 이름 열쇠. */
  readonly label?: string;
  /** 요약 — 바퀴 끝 보고의 요약, 되돌림이면 어느 판으로. */
  readonly summary?: string;
  /** 맡기기 직전 판이면 그때 보낸 요청(앞부분). */
  readonly request?: string;
  /** 되돌림이면 돌아간 판. */
  readonly restoredFrom?: string;
  /** 렌더한 판이면 결과 파일(프로젝트 기준). */
  readonly render?: { readonly file: string; readonly jobId: string };
  /** 정지 화면이 구워져 있나(`<id>.png`). */
  readonly hasStill?: boolean;
}

export interface HistoryIndex {
  readonly schemaVersion: 1;
  readonly entries: readonly HistoryEntry[];
}

/** 바퀴 끝 보고(`POST /doc/:id/pass`). */
export interface PassReport {
  readonly summary: string;
  readonly suggestions: readonly string[];
  readonly warnings: readonly string[];
  /** 고친 메모 id 들(§5.13 (V) 37-7). */
  readonly notesFixed: readonly string[];
  readonly reportedAt: number;
}

/** 바퀴 하나 — 스튜디오가 요청마다 만든 `passId`. */
export interface PassRecord {
  readonly id: string;
  readonly startedAt: number;
  /** 맡기기 직전 판. */
  readonly startRev?: string;
  readonly startVersion: number;
  readonly request?: string;
  /** 바퀴의 성격 — 기획·짓기·고치기·갈래(§5.13 (V) 37-4·37-14). */
  readonly mode?: string;
  readonly chapterId?: string;
  readonly status: 'open' | 'done';
  readonly endedAt?: number;
  readonly endRev?: string;
  readonly report?: PassReport;
  /** 이 바퀴의 이름으로 들어온 판본들(패치 본문 `passId`). */
  readonly versions: readonly number[];
  /** 마지막으로 만진 장면(패치 본문 `focus`). */
  readonly focus?: string;
  readonly lastPatchAt?: number;
}

export interface PassesFile {
  readonly schemaVersion: 1;
  readonly passes: readonly PassRecord[];
}

/** 지금 하는 일 — 판본 응답(`GET /doc/:id/version`)에 실린다. */
export interface DocActivity {
  readonly passId: string;
  readonly focus?: string;
  readonly at: number;
  readonly status: 'open' | 'done';
}

/** 안전한 판·바퀴 id 인가(파일 이름에 쓴다). */
export function isSafeHistoryId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

/**
 * 지금 문서를 `target` 의 내용으로 되돌리는 연산. 판본·id·만든 시각은 서버의 것이 그대로 이긴다(내용만 옮긴다).
 * 트랙·소재·장면·제목·판형·fps·씨앗·스타일이 대상이다.
 */
export function restoreOps(current: VideoDoc, target: VideoDoc): VideoDocOp[] {
  const snapshot = structuredClone(target);
  const ops: VideoDocOp[] = [
    ...current.tracks.map((track): VideoDocOp => ({ op: 'removeTrack', trackId: track.id })),
    ...Object.keys(current.assets).map((assetId): VideoDocOp => ({ op: 'removeAsset', assetId })),
    ...Object.values(snapshot.assets).map((asset): VideoDocOp => ({ op: 'setAsset', asset })),
    ...snapshot.tracks.map((track): VideoDocOp => ({ op: 'addTrack', track })),
    {
      op: 'setDoc',
      patch: {
        title: snapshot.title,
        size: snapshot.size,
        fps: snapshot.fps,
        // JSON cannot send undefined. A missing seed has the same deterministic seed as zero.
        ...(snapshot.seed !== undefined || current.seed !== undefined ? { seed: snapshot.seed ?? 0 } : {}),
        ...(snapshot.style !== undefined ? { style: snapshot.style } : current.style !== undefined ? { style: null } : {}),
      },
    },
  ];
  if ((current.chapters?.length ?? 0) > 0 || (snapshot.chapters?.length ?? 0) > 0) {
    ops.push({ op: 'setChapters', chapters: snapshot.chapters ?? [] });
  }
  return ops;
}
