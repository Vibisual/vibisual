/**
 * §5.13 (R) 프로젝트 안의 미디어 바이트에 닿는 창구 — 영상·음악 앱·3D 뷰어가 같은 URL 규약을 쓰게 한다(앱마다 조립하면 서버 가드가 바뀔 때 따로 고친다).
 * 서버가 Range 요청에 206 으로 답하므로 구간을 집는 `fetch` 소비자(Mediabunny `UrlSource` 등)는 필요한 부분만 받는다.
 * §5.13 40-1 — 읽기 도우미(`fetchWorkspaceMediaBlob`·`workspaceMediaSize`·`fetchWorkspaceMediaHead`)는 패키지 앱에서 흘려 받는 주소(`workspaceMediaStreamUrl`)로 받는다 —
 * 상대 주소는 IPC 를 타 응답 전체가 메인 메모리를 지나간다.
 * §5.1 #2-1 (A) — 경로는 **루트 기준 상대 경로** 또는 **절대경로**(프로젝트 밖, 지금 버블로 떠 있는 파일). 앞에 `/` 를 붙인 상대 경로는 쓰지 않는다(POSIX 에선 절대경로다).
 */
import { WORKSPACE_MEDIA_PATH, isWorkspaceMediaFile, normalizePathShape } from '@vibisual/shared';

import { isPackagedDesktop } from '../transport/packaged.js';

/**
 * 이 경로가 **절대경로**인가 — Windows 드라이브(`C:/`·`C:\`) · UNC(`\\server`·`//server`) · POSIX 루트(`/`).
 * 모양만 본다(케이스를 접지 않는다) — 어느 OS 에서 돌든 세 모양을 다 알아본다.
 */
export function isAbsoluteMediaPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]/.test(p);
}

/**
 * 서버에 실을 루트·경로. 상대 경로는 그대로이고, **절대경로는 그 파일의 폴더 + 이름**으로 푼다 — 서버는 루트 기준으로만
 * 풀고(앞 `/` 를 떼어 루트 아래에 다시 붙인다), 루트 밖은 그 파일이 지금 버블로 떠 있을 때만 연다(`resolveWorkspaceMediaRead`).
 */
export function workspaceMediaQuery(root: string, relPath: string): { readonly root: string; readonly path: string } {
  if (!isAbsoluteMediaPath(relPath)) return { root, path: relPath };
  const shaped = normalizePathShape(relPath);
  const cut = shaped.lastIndexOf('/');
  const dir = shaped.slice(0, cut);
  // 드라이브 루트(`C:`)·POSIX 루트(폴더 이름이 빈 것)는 구분자를 남긴다 — 떼면 `C:` 는 "그 드라이브의 현재 폴더"라는 다른 뜻이다.
  return { root: dir === '' || /^[A-Za-z]:$/.test(dir) ? `${dir}/` : dir, path: shaped.slice(cut + 1) };
}

/**
 * 그 파일의 바이트를 가리키는 URL. **`fetch` 에 쓴다**(Range 요청 포함).
 *
 * ⚠ 엘리먼트(`<img src>`·`<video src>`)에 바로 걸지 않는다 — 패키지 앱(file://)에서 엘리먼트가 스스로 내는
 * `/api/…` 요청은 IPC 를 타지 않아 조용히 빈다(§5.13 (R-5)). 그림이 필요하면 {@link fetchWorkspaceMediaBlob}.
 */
export function workspaceMediaUrl(root: string, relPath: string): string {
  const query = workspaceMediaQuery(root, relPath);
  return `${WORKSPACE_MEDIA_PATH}?root=${encodeURIComponent(query.root)}&path=${encodeURIComponent(query.path)}`;
}

/**
 * §5.13 40-1 — **읽기 전용** 바이트 주소. 패키지 앱이면 미디어 갈래(`vibproxy://proxy/api/workspace-media?…`)로 흘려 받는다 — 메인이 1MB 조각으로 당겨 보내고
 * 받는 쪽이 끊으면 멈춘다. 그 갈래는 미디어 표에 있는 형식만 내므로(같은 출처의 프리뷰 페이지도 닿는 길이다) 표 밖은 일반 주소다.
 * 웹·모바일은 상대 주소 그대로(진짜 HTTP 라 이미 흐른다). 쓰기(PUT)·구간을 묶어 읽는 소비자는 이 주소가 아니라 `workspaceMediaUrl` 을 쓴다.
 * @param packaged 시험용 — 기본은 지금 판(패키지 앱인가).
 */
export function workspaceMediaStreamUrl(root: string, relPath: string, packaged: boolean = isPackagedDesktop()): string {
  const url = workspaceMediaUrl(root, relPath);
  return packaged && isWorkspaceMediaFile(relPath) ? `vibproxy://proxy${url}` : url;
}

/**
 * 읽기 요청 한 번 — 흘려 받는 주소로 먼저 묻고, 그 길이 **던지면**(전송 실패 — 답이 온 실패는 그대로 돌려준다) 그 한 번만 일반 주소(`workspaceMediaUrl`)로
 * 다시 묻는다. 끊은 요청(`signal`)은 다시 묻지 않는다.
 */
async function fetchWorkspaceMediaRead(root: string, relPath: string, init?: RequestInit): Promise<Response> {
  const plain = workspaceMediaUrl(root, relPath);
  const stream = workspaceMediaStreamUrl(root, relPath);
  if (stream === plain) return fetch(plain, init);
  try {
    return await fetch(stream, init);
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    return fetch(plain, init);
  }
}

/**
 * §5.4 #36 (F) — 그 파일을 **`fetch` 로** 통째로 받는다. 못 받으면(끊은 것 포함) `null`.
 *
 * 타입은 서버가 붙인 `Content-Type` 그대로라(그림 형식은 SVG 까지 표에 있다) `URL.createObjectURL` 로 만든 주소를
 * `<img>` 에 걸면 패키지 앱에서도 그려진다. 바이트는 흘려 받아 blob 으로 쌓인다(§5.13 40-1 — JS 배열로 모으지 않는다).
 */
export async function fetchWorkspaceMediaBlob(
  root: string,
  relPath: string,
  opts: { readonly signal?: AbortSignal } = {},
): Promise<Blob | null> {
  try {
    const res = await fetchWorkspaceMediaRead(root, relPath, opts.signal ? { signal: opts.signal } : undefined);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/**
 * §5.4 #36 (F) — 그 파일의 크기(bytes). 첫 1바이트만 구간 요청해 `Content-Range` 의 끝값으로 읽는다(통째로 받지 않는다).
 * 통째로 받을지 정하기 전에 묻는 자리다. 모르면 `null`.
 */
export async function workspaceMediaSize(root: string, relPath: string): Promise<number | null> {
  try {
    const res = await fetchWorkspaceMediaRead(root, relPath, { headers: { Range: 'bytes=0-0' } });
    let size: number | null = null;
    if (res.status === 206) {
      const total = /\/(\d+)\s*$/.exec(res.headers.get('Content-Range') ?? '');
      size = total ? Number(total[1]) : null;
    } else if (res.ok) {
      const len = Number(res.headers.get('Content-Length'));
      size = Number.isFinite(len) && len >= 0 ? len : null;
    }
    // 구간을 무시하고 통째로 오는 서버라도 본문을 끝까지 받지 않는다.
    try { await res.body?.cancel(); } catch { /* 이미 다 받은 본문 */ }
    return size;
  } catch {
    return null;
  }
}

/**
 * §5.1 #2-1 (G) ① — 그 파일의 **앞부분만**(`bytes` 바이트, 끝이 닫힌 구간 요청). 그림 머리에서 가로×세로를 읽어 통째로
 * 받을지 정하는 자리다. 구간을 무시하고 통째로 오는 응답은 앞부분만 잘라 쓰고 나머지는 받지 않는다. 못 받으면 `null`.
 */
export async function fetchWorkspaceMediaHead(root: string, relPath: string, bytes: number): Promise<Uint8Array | null> {
  const want = Math.max(1, Math.floor(bytes));
  try {
    const res = await fetchWorkspaceMediaRead(root, relPath, { headers: { Range: `bytes=0-${want - 1}` } });
    if (!res.ok && res.status !== 206) return null;
    if (res.status === 206 || !res.body) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.length > want ? buf.subarray(0, want) : buf;
    }
    // 200 통째 응답 — 앞부분만 읽고 끊는다.
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    while (got < want) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      parts.push(value);
      got += value.length;
    }
    try { await reader.cancel(); } catch { /* 이미 끝났다 */ }
    const out = new Uint8Array(Math.min(got, want));
    let at = 0;
    for (const p of parts) {
      if (at >= out.length) break;
      const take = Math.min(p.length, out.length - at);
      out.set(p.subarray(0, take), at);
      at += take;
    }
    return out;
  } catch {
    return null;
  }
}

/** 편집 결과를 **새 파일로** 쓴다. 이름이 이미 있으면 `exists` — 덮어쓰지 않는다(§5.13 (R-4)). */
export async function writeWorkspaceMedia(
  root: string,
  relPath: string,
  bytes: Uint8Array,
): Promise<{ ok: true; path: string } | { ok: false; error: 'exists' | 'failed' }> {
  try {
    const res = await fetch(workspaceMediaUrl(root, relPath), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Blob([bytes as unknown as BlobPart]),
    });
    if (res.status === 409) return { ok: false, error: 'exists' };
    if (!res.ok) return { ok: false, error: 'failed' };
    const body = (await res.json()) as { path?: string };
    return { ok: true, path: body.path ?? relPath };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/** 경로에서 파일 이름만. 구분자는 둘 다 받는다(에이전트가 적어 준 경로는 형태가 섞인다). */
export function mediaFileName(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? relPath;
}

/** 그 파일이 있는 폴더(루트 기준 상대). 루트 바로 아래면 빈 문자열. */
export function mediaDirName(relPath: string): string {
  const norm = relPath.replace(/\\/g, '/');
  const cut = norm.lastIndexOf('/');
  return cut < 0 ? '' : norm.slice(0, cut);
}

/**
 * 편집 결과를 저장할 이름을 만든다 — `clip.wav` → `clip-edit.wav` → `clip-edit-2.wav` …
 *
 * 원본을 덮어쓰지 않는다는 규약(§5.13 (R-4))을 화면이 아니라 여기서 지킨다. `n` 은 저장이
 * `exists` 로 거절될 때마다 하나씩 올린다.
 */
export function editedMediaPath(relPath: string, ext: string, n: number): string {
  const dir = mediaDirName(relPath);
  const name = mediaFileName(relPath);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const suffix = n <= 1 ? '-edit' : `-edit-${n}`;
  const fileName = `${base}${suffix}${ext}`;
  return dir === '' ? fileName : `${dir}/${fileName}`;
}
