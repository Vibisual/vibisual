/** §5.13 (V) 37-20 — 읽기 전용 코드 보기가 읽는 컴포지션 원본. 쓰는 길은 없다(`GET` 하나 — 고치는 것은 바깥 에디터·에이전트). */
import fs from 'node:fs';
import type { Express } from 'express';
import { isPathWithin } from '@vibisual/shared';
import { compositionFolderAbs, listCompositionWebFiles, resolveInsideProject } from './composition.js';
import { COMPOSITION_SCAN_MAX_BYTES } from '../constants.js';
import { compositionFolderOf, isProjectRelativePath, toPosixPath } from '../composition/paths.js';
import type { VideoService } from './videoService.js';

export interface SourceRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly service: VideoService;
}

/** 코드 칸이 글로 보일 수 있는 형식(그림·글꼴은 뺀다). */
const SOURCE_TEXT_EXTENSIONS: readonly string[] = ['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg'];

export function isSourceTextFile(p: string): boolean {
  const s = p.toLowerCase();
  const dot = s.lastIndexOf('.');
  return dot >= 0 && SOURCE_TEXT_EXTENSIONS.includes(s.slice(dot));
}

/** 상한까지만 읽는다(넘으면 `truncated`). 못 읽으면 null. */
function readSourceText(file: string): { text: string; bytes: number; truncated: boolean } | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    if (st.size <= COMPOSITION_SCAN_MAX_BYTES) return { text: fs.readFileSync(file, 'utf8'), bytes: st.size, truncated: false };
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(COMPOSITION_SCAN_MAX_BYTES);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return { text: buf.subarray(0, n).toString('utf8'), bytes: st.size, truncated: true };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function mountSourceRoutes(app: Express, deps: SourceRoutesDeps): void {
  const { project, service } = deps;
  /**
   * `GET /doc/:docId/source?project=&assetId=&file=` — 그 문서의 컴포지션 소재 폴더 안 글 파일 하나. `file`(프로젝트 기준 경로)이 없으면 소재의 HTML.
   * 폴더 밖·글이 아닌 형식은 404(내주기 `/content` 와 같은 뿌리 규칙 — 실제 경로로 본다).
   */
  app.get('/doc/:docId/source', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const doc = service.readDoc(p, req.params.docId);
    if (!doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const assetId = typeof req.query['assetId'] === 'string' ? req.query['assetId'] : '';
    const asset = doc.assets[assetId];
    if (!asset || asset.kind !== 'composition' || asset.source.kind !== 'file') {
      res.status(404).json({ ok: false, error: 'unknown composition asset' });
      return;
    }
    const htmlRel = toPosixPath(asset.source.path);
    const folder = compositionFolderAbs(p, htmlRel);
    if (!folder) { res.status(404).json({ ok: false, error: 'the composition folder is not inside the project' }); return; }
    const wanted = typeof req.query['file'] === 'string' && req.query['file'].trim() !== '' ? toPosixPath(req.query['file'].trim()) : htmlRel;
    if (!isProjectRelativePath(wanted) || !isSourceTextFile(wanted)) { res.status(404).json({ ok: false, error: 'not a readable source file' }); return; }
    const abs = resolveInsideProject(p, wanted);
    if (!abs || abs === folder || !isPathWithin(abs, folder, process.platform)) { res.status(404).json({ ok: false, error: 'the file is outside the composition folder' }); return; }
    const read = readSourceText(abs);
    if (!read) { res.status(404).json({ ok: false, error: 'the file could not be read' }); return; }
    const folderRel = compositionFolderOf(htmlRel);
    const files = listCompositionWebFiles(folder).filter(isSourceTextFile).map((rel) => `${folderRel}/${rel}`);
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      path: wanted,
      text: read.text,
      bytes: read.bytes,
      truncated: read.truncated,
      contentHash: asset.contentHash ?? null,
      // 소재의 HTML 을 맨 앞에(줄 연결이 있는 파일).
      files: [htmlRel, ...files.filter((rel) => rel !== htmlRel)],
    });
  });
}
