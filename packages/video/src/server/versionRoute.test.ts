import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/** §5.13 (Y) 40-7 ② (R13) — `/version` 처리기 소스에 동기 `readDoc`·`refreshCompositions` 가 없는지 — 있으면 2~5초마다 패키지 앱의 창 스레드가 멈춘다. */
const read = (name: string): string => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const docRoutes = read('docRoutes.ts');
const videoServiceSource = read('videoService.ts');
const compositionRoutes = read('compositionRoutes.ts');

function handlerBody(signature: string): string {
  const at = docRoutes.indexOf(signature);
  expect(at, `${signature} 처리기가 없다`).toBeGreaterThan(-1);
  const next = docRoutes.indexOf('\n  app.', at + signature.length);
  return docRoutes.slice(at, next < 0 ? undefined : next);
}

describe('§5.13 (Y) 40-7 ② — /version 처리기', () => {
  it('answers from the version book and touches no synchronous file system', () => {
    const body = handlerBody("app.get('/doc/:docId/version'");
    expect(body).toContain('versions.version(');
    expect(body).not.toContain('readDoc(');
    expect(body).not.toContain('refreshCompositions(');
    expect(body).not.toMatch(/\b\w+Sync\(/);
    expect(body).toContain('ensureVersionRefresher()');
  });

  it('the watcher re-probes only when an async fingerprint moved, and writes announce through the book', () => {
    const watcher = videoServiceSource.slice(videoServiceSource.indexOf('async function compositionsMoved'), videoServiceSource.indexOf('export class VideoService'));
    expect(watcher).toContain('compositionFingerprintAsync(');
    expect(watcher).toContain('entry.examined');
    expect(videoServiceSource).toMatch(/h\(\)\.atomicWriteFile\(file, JSON\.stringify\(doc, null, 2\)\);[\s\S]{0,200}versionBook\.noteWrite\(projectPath, doc\);/);
  });

  it('/content takes the doc from the version book and the roots from the per-version memo', () => {
    const content = compositionRoutes.slice(compositionRoutes.indexOf('async function serveContent'));
    expect(content).toContain('await versions.doc(p, docId)');
    expect(content).toContain('contentRootsFor(p, doc, revId)');
    expect(content).not.toContain('service.readDoc(');
  });
});
