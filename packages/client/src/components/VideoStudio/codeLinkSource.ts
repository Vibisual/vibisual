import { scanSourceTags, type SourceIndex } from '@vibisual/video';

import { readCompositionSource, type CompositionSourceEnvelope } from './videoApi.js';

/**
 * §5.13 (V) 37-20 — 코드 칸과 줄 찾기가 함께 쓰는 원본 한 장(읽기 전용). 열쇠에 소재의 지문(`contentHash`)이 들어 있어 바깥에서 파일을 고치면
 * 다음 물음이 새로 읽는다 — 따로 감시하지 않는다(판본 감시가 지문을 문서에 적는다).
 */
export interface LoadedSource {
  /** 프로젝트 기준 경로(`/` 구분). */
  readonly path: string;
  /** 줄 끝을 `\n` 하나로 맞춘 글(줄 번호가 에디터와 같게). */
  readonly text: string;
  readonly lineCount: number;
  readonly bytes: number;
  readonly truncated: boolean;
  /** 그 컴포지션 폴더의 글 파일들(HTML 먼저). */
  readonly files: readonly string[];
  /** HTML 이면 줄 연결 색인(요소는 HTML 에만 적힌다). 그 밖의 파일은 null. */
  readonly index: SourceIndex | null;
}

/** 기억해 두는 원본 수 — 문서 하나의 컴포지션 몇 장이면 넉넉하다. */
const SOURCE_CACHE_MAX = 8;

/** 경로의 끝 두 마디(`intro/index.html`) — 같은 이름의 `index.html` 들을 가른다. */
export function shortPath(path: string): string {
  return path.split('/').filter((seg) => seg !== '').slice(-2).join('/');
}

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

/** 줄 끝을 `\n` 으로(CRLF·홀로 선 CR) — 강조·줄 세기·색인이 같은 줄을 본다. */
export function normalizeNewlines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

function toLoaded(env: CompositionSourceEnvelope): LoadedSource {
  const text = normalizeNewlines(env.text);
  // 시작 태그 한 번 훑기 — 원본이 바뀔 때만(지문 열쇠), 프레임마다 돌지 않는다.
  const index = isHtmlPath(env.path) ? scanSourceTags(text) : null;
  let lineCount = 1;
  if (index) lineCount = index.lineCount;
  else for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) lineCount += 1;
  return { path: env.path, text, lineCount, bytes: env.bytes, truncated: env.truncated, files: env.files, index };
}

export interface SourceCache {
  /** `file` 이 null 이면 그 소재의 HTML. */
  load(project: string, docId: string, assetId: string, file: string | null, contentHash: string): Promise<LoadedSource>;
  /** 이미 다 읽은 것만 곧바로(읽는 중이거나 없으면 null — 기다리지 않는다). */
  peek(project: string, docId: string, assetId: string, file: string | null, contentHash: string): LoadedSource | null;
  clear(): void;
}

export function createSourceCache(read?: typeof readCompositionSource, max: number = SOURCE_CACHE_MAX): SourceCache {
  const entries = new Map<string, Promise<LoadedSource>>();
  const done = new WeakMap<Promise<LoadedSource>, LoadedSource>();
  const keyOf = (project: string, docId: string, assetId: string, file: string | null, contentHash: string): string => [project, docId, assetId, file ?? '', contentHash].join('\u0000');
  return {
    load(project, docId, assetId, file, contentHash) {
      const key = keyOf(project, docId, assetId, file, contentHash);
      const known = entries.get(key);
      if (known) {
        // 방금 쓴 것을 맨 뒤로(오래 안 쓴 것부터 버린다).
        entries.delete(key);
        entries.set(key, known);
        return known;
      }
      const pending = (read ?? readCompositionSource)(project, docId, assetId, file ?? undefined).then(toLoaded);
      pending.then((source) => { done.set(pending, source); }, () => undefined);
      // 실패는 기억하지 않는다 — 다음에 다시 읽는다.
      pending.catch(() => { if (entries.get(key) === pending) entries.delete(key); });
      entries.set(key, pending);
      while (entries.size > max) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      return pending;
    },
    peek(project, docId, assetId, file, contentHash) {
      const pending = entries.get(keyOf(project, docId, assetId, file, contentHash));
      return pending ? done.get(pending) ?? null : null;
    },
    clear() { entries.clear(); },
  };
}
