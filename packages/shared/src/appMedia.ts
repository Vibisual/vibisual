/**
 * §5.13 (Y) 40-1 — 내부 앱 미디어를 IPC 없이 흘려 보내는 계약. IPC 는 본문을 통째로 문자열로 싣고(164MB 에 메인 1.5초) 구간 요청을 끊어도 다 건너와,
 * 경로 모양 하나로 갈라 vibproxy 가 조각으로 보낸다. 어느 파일인가는 앱 서버, 어떻게 보낼지는 코어 몫 — 이 파일은 앱 이름을 모른다. 순수 함수만(§3.4).
 */

/** 앱 미디어 경로의 마지막 마디: `/api/app/<앱id>/media?…`. */
export const APP_MEDIA_SEGMENT = 'media';

/**
 * **코어** 미디어 창구(`GET /api/workspace-media?root=&path=`). 패키지 앱은 이 경로의 읽기도 같은 미디어 갈래로 흘려 보낸다(응답 조립이
 * 같다). 어느 파일인지는 서버 라우트와 같은 판정이 답하고, 미디어 표에 있는 형식만 낸다(`isWorkspaceMediaFile`).
 */
export const WORKSPACE_MEDIA_PATH = '/api/workspace-media';

const APP_MEDIA_PATH_RE = /^\/api\/app\/([a-z0-9][a-z0-9-]{0,40})\/media$/;

/** 경로(pathname — 쿼리·해시를 뗀 것)가 내부 앱의 미디어 파일 요청인가. */
export function isAppMediaPath(pathname: string): boolean {
  return APP_MEDIA_PATH_RE.test(pathname);
}

/** 앱 미디어 경로의 앱 id. 그 모양이 아니면 null. */
export function appIdOfMediaPath(pathname: string): string | null {
  const m = APP_MEDIA_PATH_RE.exec(pathname);
  return m ? m[1] ?? null : null;
}

/**
 * 한 번에 당겨 읽는 조각(바이트). 너무 잘게 쪼개면 조각마다 메인 스레드를 거친다(바쁜 메인에서 조각 하나가 수십 ms 늦을 수
 * 있다). 1MB 면 첫 프레임까지 열 조각 남짓이고, 끊으면 그 자리에서 멈춘다(실측 — 300KB 만 읽고 끊으면 3MB 에서 멈춤).
 */
export const APP_MEDIA_STREAM_CHUNK_BYTES = 1 << 20;

/** 구간 해석 결과. `full` 은 구간 없음 또는 읽을 수 없는 머리(RFC 9110 — 무시하고 전체를 낸다). */
export type ByteRangeResult =
  | { readonly kind: 'full' }
  | { readonly kind: 'range'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' };

/**
 * `Range` 머리를 해석한다 — 한 구간만(`bytes=a-b` · `bytes=a-` · `bytes=-n`). 여러 구간·모양이 틀린 머리는 무시하고
 * 전체(200)를 낸다. 시작이 파일 끝을 넘으면 416. `end` 는 포함 끝(마지막 바이트 위치)이며 파일 끝으로 잘린다.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRangeResult {
  if (header === null || header === undefined) return { kind: 'full' };
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return { kind: 'full' };
  const rawStart = m[1] ?? '';
  const rawEnd = m[2] ?? '';
  if (rawStart === '' && rawEnd === '') return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };
  if (rawStart === '') {
    // 접미 구간 — 끝에서 n 바이트.
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(size - 1, Number(rawEnd));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: 'full' };
  if (start >= size) return { kind: 'unsatisfiable' };
  if (end < start) return { kind: 'full' };
  return { kind: 'range', start, end };
}

/** 같은 파일인지 가르는 약한 지문 — 크기 + 수정 시각(ms). 내용이 바뀌면(덮어쓰기) 달라진다. */
export function mediaEtag(size: number, mtimeMs: number): string {
  return `W/"${Math.max(0, Math.floor(size))}-${Math.max(0, Math.round(mtimeMs))}"`;
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', flac: 'audio/flac',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  bmp: 'image/bmp', svg: 'image/svg+xml',
};

/** 확장자로 정한 형식(모르면 `application/octet-stream` — 내용을 짐작하지 않는다, `nosniff` 와 함께 낸다). */
export function mediaContentType(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  const ext = dot < 0 ? '' : filePath.slice(dot + 1).toLowerCase();
  return MEDIA_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * §5.13 (Y) 40-7 ② — 앱 서버 몫이 열린 창에 알리는 사건(`app_event` 방송의 본문). 코어는 뜻을 모르고 그대로 나른다.
 * 예: 문서 판이 올랐다(`kind: 'doc-version'`, `key` = 문서 id).
 */
export interface AppEventPayload {
  readonly appId: string;
  /** 그 사건이 일어난 프로젝트(앱이 해석한 루트 경로). */
  readonly project: string;
  readonly kind: string;
  readonly key: string;
  readonly version?: number;
}
