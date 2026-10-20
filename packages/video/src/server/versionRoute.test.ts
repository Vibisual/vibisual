import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * §5.13 (Y) 40-7 ② — R13 이 되돌아가지 않게(원문). `/version` 은 2~5초마다 창마다 오는 물음이다 — 그 처리기 안에서 동기로 문서를
 * 읽거나(`readDoc`) 컴포지션을 훑으면(`refreshCompositions` — 동기 realpath·readdir·stat) 패키지 앱의 창 스레드가 멈춘다. 그 일은
 * 판 기억(`versionBook`)과 지켜보는 문서만 2초마다 비동기로 재는 자리(`refreshWatchedCompositions`)가 한다.
 */
const routes = fs.readFileSync(new URL('./routes.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function handlerBody(signature: string): string {
  const at = routes.indexOf(signature);
  expect(at, `${signature} 처리기가 없다`).toBeGreaterThan(-1);
  const next = routes.indexOf('\n  app.', at + signature.length);
  return routes.slice(at, next < 0 ? undefined : next);
}

describe('§5.13 (Y) 40-7 ② — /version 처리기', () => {
  it('answers from the version book and touches no synchronous file system', () => {
    const body = handlerBody("app.get('/doc/:docId/version'");
    expect(body).toContain('versionBook.version(');
    expect(body).not.toContain('readDoc(');
    expect(body).not.toContain('refreshCompositions(');
    expect(body).not.toMatch(/\b\w+Sync\(/);
    expect(body).toContain('ensureVersionRefresher()');
  });

  it('the watcher re-probes only when an async fingerprint moved, and writes announce through the book', () => {
    const watcher = routes.slice(routes.indexOf('async function compositionsMoved'), routes.indexOf('/** §5.13 (Y) 40-7 ② — `/content`'));
    expect(watcher).toContain('compositionFingerprintAsync(');
    expect(watcher).toContain('entry.examined');
    expect(routes).toMatch(/h\(\)\.atomicWriteFile\(file, JSON\.stringify\(doc, null, 2\)\);[\s\S]{0,200}versionBook\.noteWrite\(projectPath, doc\);/);
  });

  it('/content takes the doc from the version book and the roots from the per-version memo', () => {
    const content = routes.slice(routes.indexOf('async function serveContent'), routes.indexOf('// ─── 스틸 · 프레임 띠 · 렌더 ───'));
    expect(content).toContain('await versionBook.doc(p, docId)');
    expect(content).toContain('contentRootsFor(p, doc, revId)');
    expect(content).not.toContain('videoService.readDoc(');
  });
});
