/** §5.13 (T) — 코드 컴포지션 만들기·탐침과 샌드박스 iframe 이 여는 콘텐츠 내주기. */
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type Request } from 'express';
import { MOBILE_CONTENT_BASE_HEADER, isMobileContentBase, isPathWithin, pathKey } from '@vibisual/shared';
import { assetWithProbe, compositionAssetId, compositionRoots, needsCues, probeComposition, resolveInsideProject, vibisualRel } from './composition.js';
import type { VersionBook } from './versionBook.js';
import { taskCopyNamespaceOf } from './taskCopyPaths.js';
import { VIDEO_COMPOSITIONS_DIR, compositionCsp, compositionMimeType, compositionRuntimeScript, compositionSeed, compositionSkeleton, injectCompositionRuntime, isCompositionWebFile, isProjectRelativePath, safeCompositionName, toPosixPath, type CompositionRuntimeStyle, type VideoAsset, type VideoDoc } from '../index.js';
import type { AppServerHost } from '../host.js';
import type { VideoHistoryStore } from './historyStore.js';
import { readLibsFile } from './libsRoutes.js';
import { libInjection } from '../libs.js';
import { parseCompositionMeta } from '../composition/meta.js';
import type { VideoService } from './videoService.js';
import { numQuery, isSafeId } from './routeSupport.js';

export interface CompositionRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly host: () => AppServerHost;
  readonly service: VideoService;
  readonly history: VideoHistoryStore;
  readonly versions: VersionBook;
}

/** §5.13 (T-3) — 문서 없이 기본 자리(`compositions/`)·라이브러리 자리만 내주는 주소의 문서 칸. */
const NO_DOC = '_';

/** §5.13 (Y) 40-7 ② — `/content` 가 판마다 다시 풀지 않는 컴포지션 뿌리(폴더를 옮기면 `CONTENT_ROOTS_TTL_MS` 안에 다시 푼다). */
const CONTENT_ROOTS_TTL_MS = 30_000;
const contentRoots = new Map<string, { version: number; roots: string[]; at: number }>();

function contentRootsFor(projectPath: string, doc: VideoDoc | null, revId: string | null): string[] {
  // 판(되돌아보기) 문서는 기억하지 않는다 — 드물고, 판마다 다르다.
  if (revId) return compositionRoots(projectPath, doc);
  const key = `${pathKey(projectPath, process.platform)}\u0000${doc?.id ?? NO_DOC}`;
  const version = doc?.version ?? -1;
  const known = contentRoots.get(key);
  if (known && known.version === version && Date.now() - known.at < CONTENT_ROOTS_TTL_MS) return known.roots;
  const roots = compositionRoots(projectPath, doc);
  contentRoots.set(key, { version, roots, at: Date.now() });
  if (contentRoots.size > 256) contentRoots.delete(contentRoots.keys().next().value as string);
  return roots;
}

/**
 * §5.13 (T-3) ③ — CSP 출처 목록: 그 문서의 컴포지션 콘텐츠 앞머리(경로까지). 패키지 앱은 `vibproxy://proxy` 로,
 * 다른 접속(웹·모바일 모드)은 요청이 들어온 호스트로 연다 — 두 갈래를 다 적는다.
 */
function contentSources(req: Request, projectRaw: string, docId: string): string[] {
  const prefix = `${req.baseUrl}/content/${encodeURIComponent(projectRaw)}/${encodeURIComponent(docId)}/`;
  const sources = [`vibproxy://proxy${prefix}`];
  const hostHeader = req.get('host');
  const base = contentBaseOf(req);
  // 권한 경로는 HTTPS 리스너에서만 오지만 코어에는 http 로 재디스패치된다. 포트가 붙은 http 출처는 CSP 가 https 요청과 맞춰 주지 않는다.
  if (hostHeader) sources.push(`${base === '' ? req.protocol : 'https'}://${hostHeader}${base}${prefix}`);
  return sources;
}

/** §5.13 (T-3) — 모바일 리스너가 권한 경로로 넘겼으면 그 앞머리(아니면 빈 문자열). 프레임은 쿠키가 없어 CSP·심의 절대 주소도 같은 경로를 타야 한다. */
function contentBaseOf(req: Request): string {
  const base = req.get(MOBILE_CONTENT_BASE_HEADER);
  return base !== undefined && isMobileContentBase(base) ? base : '';
}

/** §5.13 (V) 37-5 — 미리보기의 props 덮어쓰기(base64url JSON, 상한 안 · 평범한 객체만). 아니면 null. */
const PROPS_OVERRIDE_MAX_CHARS = 24_000;
function decodePropsOverride(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > PROPS_OVERRIDE_MAX_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** §5.13 (V) 37-10 — 심에 넘길 스타일(글꼴·로고는 내주기 주소로 바꾼다 — 라이브러리 뿌리 안이라 CSP 가 연다). */
function runtimeStyle(style: NonNullable<VideoDoc['style']>, prefix: string): CompositionRuntimeStyle {
  const url = (rel: string | undefined): string | undefined =>
    rel && isProjectRelativePath(rel) ? prefix + toPosixPath(rel).split('/').filter((s) => s !== '').map(encodeURIComponent).join('/') : undefined;
  const fontUrl = url(style.fontFile);
  const logoUrl = url(style.logo);
  return {
    accent: style.accent,
    bg: style.bg,
    fg: style.fg,
    muted: style.muted,
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(fontUrl ? { fontUrl } : {}),
    ...(logoUrl ? { logoUrl } : {}),
  };
}

/** §5.13 (V) 37-3 — 그 판이 남긴 파일 내용(덩어리) 경로. 그 판에 없는 파일이면 null(지금 디스크의 것을 쓴다). */
function revisionBlob(history: VideoHistoryStore, projectPath: string, docId: string, revId: string, rel: string): string | null {
  const manifest = history.readManifest(projectPath, docId, revId);
  const sha = manifest?.files[rel];
  if (!sha) return null;
  const blob = history.blobPath(projectPath, docId, sha);
  return blob && fs.existsSync(blob) ? blob : null;
}

const CONTENT_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  // 불투명 출처 프레임이 고전 스크립트·그림을 읽는 데는 필요 없지만, 글꼴·모듈처럼 CORS 를 타는 요청이 막히지 않게.
  'Access-Control-Allow-Origin': '*',
};

export function mountCompositionRoutes(app: Express, deps: CompositionRoutesDeps): void {
  const { project, host, service, history, versions } = deps;
  /**
   * §5.13 (T-5) — 기본 자리에 뼈대 `index.html`(meta 셋 + `@keyframes`·`__vibi.seek` 예시)을 만든다. `docId` 면 소재까지 올린다.
   * 지름길일 뿐이다 — 에이전트가 파일을 직접 써도 된다.
   */
  app.post('/composition', (req, res) => {
    const body = req.body as {
      project?: unknown; name?: unknown; title?: unknown; docId?: unknown;
      duration?: unknown; width?: unknown; height?: unknown;
    };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = typeof body.docId === 'string' && body.docId !== '' ? body.docId : null;
    const doc = docId ? service.readDoc(p, docId) : null;
    if (docId && !doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }

    const rawName = typeof body.name === 'string' && body.name.trim() !== '' ? body.name : 'comp';
    const base = safeCompositionName(rawName);
    const parent = path.join(p, '.vibisual', ...VIDEO_COMPOSITIONS_DIR.split('/'));
    let folder = base;
    for (let i = 2; fs.existsSync(path.join(parent, folder)) && i < 1000; i += 1) folder = `${base}-${i}`;
    const dirAbs = path.join(parent, folder);
    try {
      fs.mkdirSync(dirAbs, { recursive: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: `could not create the composition folder: ${String(err)}` });
      return;
    }
    const rel = `${vibisualRel(VIDEO_COMPOSITIONS_DIR)}/${folder}/index.html`;
    if (!resolveInsideProject(p, path.dirname(rel))) {
      res.status(400).json({ ok: false, error: 'the composition folder resolved outside the project' });
      return;
    }
    const width = typeof body.width === 'number' && body.width > 0 ? body.width : doc?.size.width ?? 1920;
    const height = typeof body.height === 'number' && body.height > 0 ? body.height : doc?.size.height ?? 1080;
    const title = typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : rawName;
    host().atomicWriteFile(path.join(dirAbs, 'index.html'), compositionSkeleton({
      title,
      width,
      height,
      ...(typeof body.duration === 'number' ? { duration: body.duration } : {}),
    }));

    if (!doc || !docId) {
      res.json({ ok: true, path: rel });
      return;
    }
    const probed = probeComposition(p, rel);
    if (!probed.ok) { res.status(500).json({ ok: false, error: probed.error, path: rel }); return; }
    let assetId = '';
    const updated = service.patchFresh(p, docId, (current) => {
      assetId = compositionAssetId(current, rel);
      const asset: VideoAsset = assetWithProbe({ id: assetId, kind: 'composition', source: { kind: 'file', path: rel } }, probed.probe);
      return [{ op: 'setAsset', asset }];
    });
    if (!updated) { res.status(409).json({ ok: false, error: 'the document changed — read it again', path: rel }); return; }
    res.json({ ok: true, path: rel, assetId, docVersion: updated.version });
  });

  /** §5.13 (T-5) — 탐침(창 없이 문자열만 읽는다). `docId` 를 주면 그 문서의 같은 경로 소재(없으면 새 소재)를 낙관적 잠금 경로로 채운다. */
  app.post('/composition/probe', (req, res) => {
    const body = req.body as { project?: unknown; path?: unknown; docId?: unknown; assetId?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    if (typeof body.path !== 'string' || body.path.trim() === '') {
      res.status(400).json({ ok: false, error: 'path required' });
      return;
    }
    const probed = probeComposition(p, body.path);
    if (!probed.ok) { res.status(400).json({ ok: false, error: probed.error }); return; }
    const probe = probed.probe;
    const docId = typeof body.docId === 'string' && body.docId !== '' ? body.docId : null;
    if (!docId) { res.json({ ok: true, ...probe }); return; }

    const requestedAssetId = typeof body.assetId === 'string' && body.assetId !== '' ? body.assetId : null;
    let assetId = '';
    const updated = service.patchFresh(p, docId, (doc) => {
      const samePath = Object.values(doc.assets).find((a) =>
        a.kind === 'composition' && a.source.kind === 'file' &&
        pathKey(toPosixPath(a.source.path), process.platform) === pathKey(probe.path, process.platform));
      const existing = (requestedAssetId ? doc.assets[requestedAssetId] : undefined) ?? samePath;
      const base: VideoAsset = existing ?? { id: compositionAssetId(doc, probe.path), kind: 'composition', source: { kind: 'file', path: probe.path } };
      assetId = base.id;
      return [{ op: 'setAsset', asset: assetWithProbe(base, probe) }];
    });
    if (!updated) { res.status(404).json({ ok: false, error: 'unknown doc or it kept changing' }); return; }
    // §5.13 (T-8) — 소스가 표지를 부르면 모으기 일감을 함께 건다(렌더 줄). 그 id 를 돌려준다.
    const written = updated.assets[assetId];
    const cueRun = written && needsCues(written) ? service.ensureCues(p, docId, written) : null;
    res.json({ ok: true, ...probe, assetId, docVersion: updated.version, ...(cueRun ? { cuesJobId: cueRun.jobId } : {}) });
  });

  /**
   * §5.13 (T-3) — 컴포지션 콘텐츠(샌드박스 iframe 이 여는 정적 파일만 — API 는 내지 않는다): `…/content/<프로젝트>/<문서 id 또는 _>/<경로>?item=<아이템 id>&v=<판>`.
   * 뿌리는 그 문서의 컴포지션 폴더 + 기본·라이브러리 자리만(그 밖 404), 알려진 웹 형식만(`nosniff`). CSP 는 응답 헤더 + 맨 앞 meta 두 겹,
   * HTML 이면 런타임 심과 그 아이템의 props·seed 를 맨 앞에 넣는다. 패키지 앱은 `vibproxy://proxy` 로 온다(코어 허용 목록은 앱 이름 없이 이 모양만 안다).
   */
  app.get('/content/:project/:docId/*', async (req, res) => {
    const notFound = (): void => {
      res.status(404).set('X-Content-Type-Options', 'nosniff').type('text/plain').send('not found');
    };
    try {
      await serveContent(req, res, notFound);
    } catch {
      if (!res.headersSent) notFound();
    }
  });

  /** 컴포지션 콘텐츠 한 건 — 문서는 판 기억에서(비동기), 뿌리는 판 단위로 기억한 것을 쓴다. */
  async function serveContent(req: Request<{ project: string; docId: string }>, res: express.Response, notFound: () => void): Promise<void> {
    const projectRaw = req.params.project;
    const p = project(projectRaw);
    // §5.13 (V) 37-3 — `<docId>@<revId>` 면 그 판의 문서와 **그 판의 코드**로 내준다(판 둘을 나란히 볼 때·판 정지 화면).
    //   판이 문서 칸(경로)에 있어야 컴포지션 안의 상대 주소(`app.js`)도 같은 판으로 풀린다.
    const docSegment = req.params.docId;
    const at = docSegment.indexOf('@');
    const docId = at < 0 ? docSegment : docSegment.slice(0, at);
    const revId = at < 0 ? null : docSegment.slice(at + 1);
    // 런타임은 express 4 라 `*` 가 params['0'] 로 온다. @types/express 5 는 이 모양을 몰라 unknown 을 거친다.
    const rel = toPosixPath(String((req.params as unknown as Record<string, string | undefined>)['0'] ?? ''));
    if (!p || !isProjectRelativePath(rel) || !isCompositionWebFile(rel)) { notFound(); return; }
    let doc: VideoDoc | null = null;
    if (docId !== NO_DOC) {
      // §5.13 (Y) 40-7 ② — 판 기억에서(파일이 그대로면 다시 읽지도 파싱하지도 않는다). 판(되돌아보기)은 종전 길.
      doc = revId ? history.readSnapshot(p, docId, revId) : (isSafeId(docId) ? await versions.doc(p, docId) : null);
      if (!doc) { notFound(); return; }
    }
    const revBlob = revId ? revisionBlob(history, p, docId, revId, rel) : null;
    const copyNamespace = taskCopyNamespaceOf(rel);
    const immutableRelative = copyNamespace ? rel.slice(copyNamespace.length) : '';
    // Code-relative references to imported immutable media keep working without copying the entire media library.
    const immutableFallback = immutableRelative.startsWith('.vibisual/video/assets/') ? resolveInsideProject(p, immutableRelative) : null;
    const abs = resolveInsideProject(p, rel) ?? immutableFallback ?? (revBlob ? path.resolve(p, rel) : null);
    if (!abs) { notFound(); return; }
    const roots = contentRootsFor(p, doc, revId);
    if (!roots.some((root) => abs !== root && isPathWithin(abs, root, process.platform))) { notFound(); return; }
    let isFile = revBlob !== null;
    if (!isFile) {
      try { isFile = fs.statSync(abs).isFile(); } catch { isFile = false; }
    }
    if (!isFile) { notFound(); return; }
    const mime = compositionMimeType(rel);
    if (!mime) { notFound(); return; }

    res.set(CONTENT_HEADERS);
    if (!mime.startsWith('text/html')) {
      res.type(mime);
      res.sendFile(revBlob ?? abs, { dotfiles: 'allow' });
      return;
    }

    // CSP 출처는 주소에 적힌 그대로의 문서 칸이다(판이면 `<docId>@<revId>` — 그 판의 상대 주소만 열린다).
    const csp = compositionCsp(contentSources(req, projectRaw, docSegment));
    const itemId = typeof req.query['item'] === 'string' ? req.query['item'] : '';
    const item = doc?.tracks.flatMap((track) => track.items).find((candidate) => candidate.id === itemId);
    // §5.13 (W) 38-7 — 문서에 없는 아이템(장면 정지 화면의 `__chapter-frame` 등)은 이 파일을 가리키는 컴포지션 소재로 크기·길이를 잡는다.
    const relKey = toPosixPath(rel);
    const asset = item?.assetId !== undefined
      ? doc?.assets[item.assetId]
      : Object.values(doc?.assets ?? {}).find((a) => a.kind === 'composition' && a.source.kind === 'file' && toPosixPath(a.source.path) === relKey);
    // §5.13 (V) 37-5 — 미리보기가 묶인 곳 없는 컴포지션을 새 값으로 다시 열 때만 오는 props(저장보다 앞선 낙관 값).
    const override = decodePropsOverride(req.query['props']);
    // §5.13 (V) 37-15 — 반응형 컴포지션은 선언 크기 대신 상자 크기를 받는다(무대가 `bw`·`bh` 로 준다).
    const responsive = asset?.responsive === true;
    const bw = numQuery(req.query['bw'], 0);
    const bh = numQuery(req.query['bh'], 0);
    const contentPrefix = `${contentBaseOf(req)}${req.baseUrl}/content/${encodeURIComponent(projectRaw)}/${encodeURIComponent(docSegment)}/`;
    const runtime = compositionRuntimeScript({
      props: override ?? item?.props ?? {},
      seed: compositionSeed(doc?.seed, itemId),
      itemId,
      fps: doc?.fps ?? 30,
      duration: asset?.duration ?? null,
      width: responsive && bw > 0 ? Math.round(bw) : asset?.width ?? doc?.size.width ?? 1920,
      height: responsive && bh > 0 ? Math.round(bh) : asset?.height ?? doc?.size.height ?? 1080,
      // §5.13 (V) 37-10 — 문서 스타일(모든 컴포지션에 같은 팔레트). 글꼴·로고는 같은 내주기 앞머리 아래 주소로.
      ...(doc?.style ? { style: runtimeStyle(doc.style, contentPrefix) } : {}),
    });
    let html: string;
    try { html = fs.readFileSync(revBlob ?? abs, 'utf8'); } catch { notFound(); return; }
    // §5.13 (T-6) — 들여놓은 라이브러리(`vibi:libs` 에 적은 이름)와 글꼴(늘 `@font-face`)을 심 뒤·컴포지션 스크립트 앞에 넣는다.
    const libs = readLibsFile(copyNamespace ? path.join(p, copyNamespace) : p).items;
    const extra = libs.length > 0
      ? libInjection(libs, parseCompositionMeta(html).libs ?? [], (rel) => contentPrefix + toPosixPath(`${copyNamespace ?? ''}${rel}`).split('/').filter((s) => s !== '').map(encodeURIComponent).join('/'))
      : '';
    res.set('Content-Security-Policy', csp);
    res.type(mime).send(injectCompositionRuntime(html, csp, runtime, extra));
  }
}
