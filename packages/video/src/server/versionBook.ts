/**
 * §5.13 (Y) 40-7 ② — 문서 판 기억. 패키지 앱의 서버는 창 스레드라 창마다 2~5초로 오는 `/version` 에서 동기 읽기·훑기를 하면 창이 멈춘다 —
 * 기억한 판으로 답하고, 비동기 `stat`(크기 + 수정 시각)이 바뀔 때만 다시 읽는다(`/content` 도 이 기억). 서버가 적으면(`noteWrite`) 기억을 바꾸고,
 * 그때와 하는 일이 바뀔 때(`noteActivity`) 지켜보는 창에 알린다(`notify` — 기존 방송). 폴링은 끊겼을 때의 안전망이다. 지문 재기는 `/version` 을 물은 문서(`watched`)만.
 */
import fs from 'node:fs';
import { pathKey, type PlatformName } from '@vibisual/shared';

import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc } from '../types.js';

export interface DocVersionInfo {
  readonly id: string;
  readonly title: string;
  readonly version: number;
  readonly updatedAt: number;
  readonly duration: number;
}

export type VersionEventKind = 'doc-version' | 'activity';

export interface VersionBookOptions {
  /** 문서 파일 자리. */
  readonly fileOf: (projectPath: string, docId: string) => string;
  /** 읽은 글 → 문서(검증 포함 — 틀리면 null). */
  readonly parse: (text: string, docId: string) => VideoDoc | null;
  /** 판이 오르거나 지금 하는 일이 바뀌었다 — 그 문서를 지켜보는 창에(프로젝트 이름마다 한 번). */
  readonly notify?: (event: { project: string; kind: VersionEventKind; key: string; version?: number }) => void;
  readonly now?: () => number;
  readonly platform?: PlatformName;
}

export interface VersionEntry {
  readonly projectPath: string;
  readonly docId: string;
  doc: VideoDoc;
  info: DocVersionInfo;
  mtimeMs: number;
  size: number;
  /** `/version` 으로 마지막으로 물은 시각(0 = 아직 아무도 지켜보지 않는다). */
  polledAt: number;
  /** 마지막으로 쓴 시각(물음·`/content` — 오래 안 쓰면 기억을 비운다). */
  usedAt: number;
  /** 물을 때 쓴 프로젝트 이름들 — 알림에 싣는다(창은 이름으로 REST 를 부른다). */
  readonly names: Set<string>;
  /** 컴포지션 소재 → 마지막으로 살핀 지문(바뀌었는데 다시 적을 것이 없던 지문은 거듭 살피지 않는다). */
  readonly examined: Map<string, string>;
  refreshing: boolean;
}

/** 이만큼(ms) 아무도 쓰지 않은 기억은 비운다. */
export const VERSION_BOOK_IDLE_MS = 10 * 60_000;

export function versionInfoOf(doc: VideoDoc): DocVersionInfo {
  return { id: doc.id, title: doc.title, version: doc.version, updatedAt: doc.updatedAt, duration: resolveTimeline(doc).duration };
}

export class VersionBook {
  private readonly entries = new Map<string, VersionEntry>();
  /** 같은 문서를 동시에 다시 읽지 않는다(여러 창이 같은 순간에 묻는다). */
  private readonly reading = new Map<string, Promise<VersionEntry | null>>();

  constructor(private readonly opts: VersionBookOptions) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private key(projectPath: string, docId: string): string {
    return `${pathKey(projectPath, this.opts.platform ?? process.platform)}\u0000${docId}`;
  }

  /** 지금 문서(파일이 그대로면 기억한 것). 없거나 못 읽으면 null. */
  async doc(projectPath: string, docId: string): Promise<VideoDoc | null> {
    return (await this.entry(projectPath, docId))?.doc ?? null;
  }

  /** `/version` — 판만. 물은 이름을 기억하고 "지켜보는 중"으로 적는다. */
  async version(projectPath: string, docId: string, name: string): Promise<DocVersionInfo | null> {
    const entry = await this.entry(projectPath, docId);
    if (!entry) return null;
    entry.polledAt = this.now();
    if (name !== '') entry.names.add(name);
    return entry.info;
  }

  private entry(projectPath: string, docId: string): Promise<VersionEntry | null> {
    const key = this.key(projectPath, docId);
    const pending = this.reading.get(key);
    if (pending) return pending;
    const run = this.load(projectPath, docId, key).finally(() => { if (this.reading.get(key) === run) this.reading.delete(key); });
    this.reading.set(key, run);
    return run;
  }

  private async load(projectPath: string, docId: string, key: string): Promise<VersionEntry | null> {
    const file = this.opts.fileOf(projectPath, docId);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      this.entries.delete(key);
      return null;
    }
    if (!stat.isFile()) { this.entries.delete(key); return null; }
    const cached = this.entries.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      cached.usedAt = this.now();
      return cached;
    }
    let text: string;
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch {
      return cached ?? null;
    }
    const doc = this.opts.parse(text, docId);
    if (!doc) return cached ?? null;
    const current = this.entries.get(key);
    // 읽는 사이 이 서버가 더 새 판을 적었으면(`noteWrite`) 그 판이 이긴다 — 옛 글로 덮지 않는다.
    if (current && current.doc.version > doc.version) return current;
    const before = current?.info.version;
    const entry: VersionEntry = current ?? {
      projectPath, docId, doc, info: versionInfoOf(doc), mtimeMs: stat.mtimeMs, size: stat.size,
      polledAt: 0, usedAt: this.now(), names: new Set(), examined: new Map(), refreshing: false,
    };
    entry.doc = doc;
    entry.info = versionInfoOf(doc);
    entry.mtimeMs = stat.mtimeMs;
    entry.size = stat.size;
    entry.usedAt = this.now();
    this.entries.set(key, entry);
    // 밖에서 파일이 바뀌었다(다른 프로세스·되돌리기) — 지켜보는 다른 창에도 알린다.
    if (before !== undefined && before !== doc.version) this.announce(entry, 'doc-version');
    return entry;
  }

  /** 이 서버가 문서를 적었다 — 기억을 그 판으로 바꾸고(파일 시각은 뒤에서 잰다) 지켜보는 창에 알린다. */
  noteWrite(projectPath: string, doc: VideoDoc): void {
    const entry = this.entries.get(this.key(projectPath, doc.id));
    if (!entry) return;
    const before = entry.info.version;
    entry.doc = doc;
    entry.info = versionInfoOf(doc);
    // 다음 물음이 파일을 다시 잴 때까지는 모르는 값 — 아래 stat 이 먼저 오면 그것으로(그 사이 또 적혔으면 버린다).
    entry.mtimeMs = -1;
    entry.size = -1;
    void fs.promises.stat(this.opts.fileOf(projectPath, doc.id)).then((stat) => {
      if (entry.doc !== doc) return;
      entry.mtimeMs = stat.mtimeMs;
      entry.size = stat.size;
    }, () => undefined);
    if (doc.version !== before) this.announce(entry, 'doc-version');
  }

  /** 지금 하는 일(바퀴·만지는 장면)이 바뀌었다. */
  noteActivity(projectPath: string, docId: string): void {
    const entry = this.entries.get(this.key(projectPath, docId));
    if (entry) this.announce(entry, 'activity');
  }

  /** 최근 `windowMs` 안에 `/version` 으로 물은 문서들. */
  watched(windowMs: number): VersionEntry[] {
    const now = this.now();
    return [...this.entries.values()].filter((entry) => entry.polledAt > 0 && now - entry.polledAt <= windowMs);
  }

  /** 오래 안 쓴 기억을 비운다. */
  prune(idleMs: number = VERSION_BOOK_IDLE_MS): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (now - Math.max(entry.usedAt, entry.polledAt) > idleMs) this.entries.delete(key);
  }

  /** 시험 전용 — 기억한 수. */
  size(): number {
    return this.entries.size;
  }

  private announce(entry: VersionEntry, kind: VersionEventKind): void {
    const notify = this.opts.notify;
    if (!notify || entry.polledAt === 0) return;
    for (const project of entry.names) {
      try {
        notify({ project, kind, key: entry.docId, ...(kind === 'doc-version' ? { version: entry.info.version } : {}) });
      } catch { /* 알림 실패가 저장을 막지 않는다 */ }
    }
  }
}
