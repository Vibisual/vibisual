import { useEffect, useState } from 'react';
import type { ExternalPathInfo, WorkspacePathInfo, WorkspacePathKind } from '@vibisual/shared';

/**
 * §5.5 #17-27 ⑬ 경로의 정체를 디스크에 묻는다(`GET /api/workspace-path` — 파일 → 편집창, 폴더 → 탐색기, 404 → 평문).
 * 가상 리스트가 자주 다시 마운트하므로 결과를 **모듈**에 캐시하고 동시 요청을 합쳐 경로당 한 번만 묻는다(⑬ (e), §9).
 */

/** 판정 결과 — `'missing'` 은 "디스크에 없다"를 **캐시에 남기기 위한** 값이다(다시 묻지 않는다). */
export type ResolvedPathKind = WorkspacePathKind | 'missing';

export interface ResolvedWorkspacePath {
  kind: ResolvedPathKind;
  /** 폴더 열기(`POST /api/open-node-folder`)에 그대로 실어 보낼 절대 경로. `'missing'` 이면 빈 문자열. */
  absPath: string;
  /**
   * ⑬ (h) — **눌러서 실행할 수 있는 것인가**(서버가 디스크를 보고 정한 값).
   * 참이면 화면은 편집창·탐색기 대신 #17-20 ④ 실행 세션으로 간다.
   */
  executable: boolean;
}

const MISSING: ResolvedWorkspacePath = { kind: 'missing', absPath: '', executable: false };

/** 한 창(세션)에서 다룰 만한 경로 수의 넉넉한 상한 — 넘으면 통째로 비운다(LRU 를 둘 만큼 비싼 값이 아니다). */
const CACHE_MAX = 4000;

const cache = new Map<string, ResolvedWorkspacePath>();
const inflight = new Map<string, Promise<ResolvedWorkspacePath>>();

function cacheKey(root: string, relPath: string): string {
  // 루트가 다르면 같은 상대 경로도 다른 파일이다 — 줄바꿈으로 갈라 키를 만든다(경로에 들어갈 수 없는 문자).
  return [root, relPath].join('\n');
}

async function fetchPathKind(root: string, relPath: string): Promise<ResolvedWorkspacePath> {
  try {
    const res = await fetch(
      `/api/workspace-path?root=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`,
    );
    if (!res.ok) return MISSING;
    const info = (await res.json()) as WorkspacePathInfo;
    if (info.kind !== 'file' && info.kind !== 'directory') return MISSING;
    return { kind: info.kind, absPath: info.absPath, executable: info.executable === true };
  } catch {
    // 서버가 잠깐 끊긴 경우도 "열 수 없다" 로 같다 — 화면은 평문으로 두고 사용자를 막지 않는다.
    return MISSING;
  }
}

/**
 * 이미 알고 있으면 그 값을, 모르면 한 번 물어보고 캐시에 넣는다.
 * 컴포넌트 밖에서도 쓸 수 있게(테스트·미리 채우기) 훅과 분리해 둔다.
 */
export function resolveWorkspacePath(root: string, relPath: string): Promise<ResolvedWorkspacePath> {
  const key = cacheKey(root, relPath);
  const known = cache.get(key);
  if (known) return Promise.resolve(known);

  const running = inflight.get(key);
  if (running) return running;

  const promise = fetchPathKind(root, relPath).then((resolved) => {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, resolved);
    inflight.delete(key);
    return resolved;
  });
  inflight.set(key, promise);
  return promise;
}

/**
 * 경로 후보 하나의 정체. 아직 모르면 `null`(그 사이 화면은 평문 그대로 — 깜빡임이 없다).
 *
 * `relPath` 가 null 이면(후보가 아니거나 코드 블록 안이면) 아무것도 묻지 않는다.
 */
export function useWorkspacePathKind(root: string | null, relPath: string | null): ResolvedWorkspacePath | null {
  const key = root !== null && relPath !== null ? cacheKey(root, relPath) : null;
  // 캐시가 채워졌을 때 다시 그리기 위한 방아쇠 — 값 자체는 모듈 캐시가 들고 있다.
  const [, bump] = useState(0);

  useEffect(() => {
    if (key === null || root === null || relPath === null) return undefined;
    if (cache.has(key)) return undefined;

    let alive = true;
    void resolveWorkspacePath(root, relPath).then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => { alive = false; };
  }, [key, root, relPath]);

  return key === null ? null : cache.get(key) ?? null;
}

/** 테스트 전용 — 모듈 캐시를 비운다(테스트끼리 판정 결과가 새지 않게). */
export function clearWorkspacePathCache(): void {
  cache.clear();
  inflight.clear();
}

// ⑬ (d) 루트 밖 절대 경로 — 같은 캐시 규약으로 `GET /api/external-path` 에 묻는다. 답에 `executable` 이 **없다**(탐색기 한 갈래뿐이라 알면 갈래가 는다).

/** 루트 밖 경로 판정 결과. `'missing'` 은 "디스크에 없다"를 캐시에 남기기 위한 값이다. */
export interface ResolvedExternalPath {
  kind: ResolvedPathKind;
  /** `POST /api/reveal-path` 에 그대로 실어 보낼 절대 경로. `'missing'` 이면 빈 문자열. */
  absPath: string;
}

const EXTERNAL_MISSING: ResolvedExternalPath = { kind: 'missing', absPath: '' };

const externalCache = new Map<string, ResolvedExternalPath>();
const externalInflight = new Map<string, Promise<ResolvedExternalPath>>();

async function fetchExternalPathKind(absPath: string): Promise<ResolvedExternalPath> {
  try {
    const res = await fetch(`/api/external-path?path=${encodeURIComponent(absPath)}`);
    if (!res.ok) return EXTERNAL_MISSING;
    const info = (await res.json()) as ExternalPathInfo;
    if (info.kind !== 'file' && info.kind !== 'directory') return EXTERNAL_MISSING;
    return { kind: info.kind, absPath: info.absPath };
  } catch {
    return EXTERNAL_MISSING;
  }
}

/** 이미 알고 있으면 그 값을, 모르면 한 번 물어보고 캐시에 넣는다(위 `resolveWorkspacePath` 와 같은 규약). */
export function resolveExternalPath(absPath: string): Promise<ResolvedExternalPath> {
  const known = externalCache.get(absPath);
  if (known) return Promise.resolve(known);

  const running = externalInflight.get(absPath);
  if (running) return running;

  const promise = fetchExternalPathKind(absPath).then((resolved) => {
    if (externalCache.size >= CACHE_MAX) externalCache.clear();
    externalCache.set(absPath, resolved);
    externalInflight.delete(absPath);
    return resolved;
  });
  externalInflight.set(absPath, promise);
  return promise;
}

/** 루트 밖 경로 후보 하나의 정체. 아직 모르면 `null`(그 사이 화면은 평문 그대로 — 깜빡임이 없다). */
export function useExternalPathKind(absPath: string | null): ResolvedExternalPath | null {
  const [, bump] = useState(0);

  useEffect(() => {
    if (absPath === null) return undefined;
    if (externalCache.has(absPath)) return undefined;

    let alive = true;
    void resolveExternalPath(absPath).then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => { alive = false; };
  }, [absPath]);

  return absPath === null ? null : externalCache.get(absPath) ?? null;
}

/** 루트 밖 경로를 **시스템 탐색기에 보여준다**(파일이면 상위 폴더에서 선택). 실패는 화면을 막지 않는다. */
export function revealExternalPath(absPath: string): void {
  void fetch('/api/reveal-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ absPath }),
  }).catch(() => { /* 열기 실패는 화면을 막지 않는다 — `openFolderByPath` 와 같은 규약. */ });
}

/** 테스트 전용 — 루트 밖 경로 캐시를 비운다. */
export function clearExternalPathCache(): void {
  externalCache.clear();
  externalInflight.clear();
}
