/**
 * workspaceMedia.ts — §5.13 (R) 프로젝트 안의 **미디어 바이트에 닿는 창구**.
 *
 * 영상 앱·음악 앱·3D 뷰어가 같은 URL 규약을 쓰게 하기 위한 자리다. 앱마다 자기 쿼리를 조립하면
 * 루트·경로를 실어 보내는 방식이 앱마다 갈리고, 서버 가드가 바뀔 때 세 곳을 따로 고치게 된다.
 *
 * 파일을 통째로 읽어 오지 않아도 된다 — 서버가 Range 요청에 206 으로 답하므로, 구간을 집어 가는 `fetch`
 * 소비자(Mediabunny `UrlSource` 등)는 필요한 부분만 받는다.
 */

/**
 * 그 파일의 바이트를 가리키는 URL. **`fetch` 에 쓴다**(Range 요청 포함).
 *
 * ⚠ 엘리먼트(`<img src>`·`<video src>`)에 바로 걸지 않는다 — 패키지 앱(file://)에서 엘리먼트가 스스로 내는
 * `/api/…` 요청은 IPC 를 타지 않아 조용히 빈다(§5.13 (R-5)). 그림이 필요하면 {@link fetchWorkspaceMediaBlob}.
 */
export function workspaceMediaUrl(root: string, relPath: string): string {
  return `/api/workspace-media?root=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`;
}

/**
 * §5.4 #36 (F) — 그 파일을 **`fetch` 로** 통째로 받는다. 못 받으면 `null`.
 *
 * 타입은 서버가 붙인 `Content-Type` 그대로라(그림 형식은 SVG 까지 표에 있다) `URL.createObjectURL` 로 만든 주소를
 * `<img>` 에 걸면 패키지 앱에서도 그려진다.
 */
export async function fetchWorkspaceMediaBlob(root: string, relPath: string): Promise<Blob | null> {
  try {
    const res = await fetch(workspaceMediaUrl(root, relPath));
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
    const res = await fetch(workspaceMediaUrl(root, relPath), { headers: { Range: 'bytes=0-0' } });
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
