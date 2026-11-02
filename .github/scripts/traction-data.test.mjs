import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { aggregate, collectReleases, makeEvidence, validateRepository, validateTraffic } from './traction-data.mjs';

const when = '2026-11-02T09:00:00.000Z';
const repo = { stargazers_count: 1, forks_count: 2, subscribers_count: 0, open_issues_count: 3 };
const asset = (id, filename, downloads = 0) => ({
  id, name: filename, download_count: downloads, created_at: when, updated_at: when,
});
const release = (id, assets = [asset(id, `app-${id}.exe`, 1)]) => ({
  id, tag_name: `v1.0.${id}`, draft: false, prerelease: false, created_at: when, published_at: when, assets,
});

test('collects past the old 20-page boundary and requires the terminal page', async () => {
  const requested = [];
  const result = await collectReleases(async (page) => {
    requested.push(page);
    return page <= 21 ? [release(page)] : [];
  }, { perPage: 1, maxPages: 30 });
  assert.equal(result.releases.length, 21);
  assert.equal(result.pages, 22);
  assert.equal(requested.at(-1), 22);
});

test('rejects incomplete, malformed and shifting pagination', async () => {
  await assert.rejects(collectReleases(async (page) => [release(page)], { perPage: 1, maxPages: 2 }), /incomplete/);
  await assert.rejects(collectReleases(async () => ({ items: { message: 'limited' }, hasNext: false })), /Invalid release page/);
  await assert.rejects(collectReleases(async () => [release(1)], { perPage: 1 }), /Duplicate release/);
  await assert.rejects(collectReleases(async (page) => {
    if (page === 2) throw new Error('HTTP 503');
    return [release(1)];
  }, { perPage: 1 }), /HTTP 503/);
  await assert.rejects(collectReleases(async () => [release(1), release(2, [asset(1, 'same.exe')])]), /Duplicate asset/);
  await assert.rejects(collectReleases(async () => [{ ...release(1), assets: undefined }]), /Missing assets/);
});

test('follows an explicit next link even when a page is short', async () => {
  const result = await collectReleases(async (page) => ({ items: [release(page)], hasNext: page === 1 }));
  assert.deepEqual(result.releases.map((r) => r.id), [1, 2]);
  await assert.rejects(collectReleases(async () => ({ items: [], hasNext: true })), /Empty release page/);
});

test('rejects invalid counts without coercing or clamping them', async () => {
  for (const value of [-1, 0.5, NaN, Infinity, '2', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(collectReleases(async () => [release(1, [{ ...asset(1, 'app.exe'), download_count: value }])]), /nonnegative safe integer/);
  }
  const result = await collectReleases(async () => [release(1, [asset(1, 'app.exe', 0)])]);
  assert.equal(result.releases[0].assets[0].download_count, 0);
  assert.throws(() => validateRepository({ ...repo, forks_count: '2' }), /nonnegative safe integer/);
  assert.throws(() => aggregate([release(1, [asset(1, 'a.exe', Number.MAX_SAFE_INTEGER), asset(2, 'b.exe', 1)])]), /nonnegative safe integer/);
});

test('skips drafts and retains public prereleases with explicit unknown audience metrics', async () => {
  const input = [
    { id: 1, draft: true, assets: [{ download_count: 'private data is ignored' }] },
    { ...release(2), prerelease: true },
    release(3),
  ];
  const { releases, pages } = await collectReleases(async () => input);
  const evidence = makeEvidence({ repository: 'owner/repo', repo, releases, pages, collectionStartedAt: when, observedAt: when });
  assert.deepEqual(evidence.releases.map((r) => r.id), [2, 3]);
  assert.deepEqual(evidence.audience, { verifiedInstallations: null, activeUsers: null });
  assert.equal(evidence.releases[0].prerelease, true);
  assert.equal(evidence.releases[0].assets[0].created_at, when);
});

test('separates packages, update metadata, blockmaps and other assets without deductions', () => {
  const assets = [
    asset(1, 'app.exe', 1), asset(2, 'app.msi', 2), asset(3, 'app.dmg', 3),
    asset(4, 'app-mac.zip', 4), asset(5, 'app.pkg', 5), asset(6, 'app.AppImage', 6),
    asset(7, 'app.deb', 7), asset(8, 'app.rpm', 8), asset(9, 'app.snap', 9),
    asset(10, 'latest.yml', 10), asset(11, 'latest.yaml', 11), asset(12, 'app.exe.blockmap', 12),
    asset(13, 'SHA256SUMS.txt', 13), asset(14, 'source.zip', 14),
  ];
  assert.deepEqual(aggregate([release(1, assets)]), {
    windows: 3, macos: 12, linux: 30, meta: 21, blockmap: 12, other: 27, total: 45, all: 105,
  });
});

test('invalid optional traffic is distinguishable from a measured zero', () => {
  const measured = { count: 0, uniques: 0, views: [{ timestamp: when, count: 0, uniques: 0 }] };
  assert.equal(validateTraffic(measured, 'views'), measured);
  assert.throws(() => validateTraffic({ ...measured, views: [{ timestamp: when, count: -1, uniques: 0 }] }, 'views'));
  assert.throws(() => validateTraffic({ count: 0, uniques: 0 }, 'views'));
});

const script = fileURLToPath(new URL('./traction-snapshot.mjs', import.meta.url));
function runCollector(out, releases, { failPage = 0, traffic = false } = {}) {
  // No network or credentials: exercise the actual CLI with an injected GitHub JSON transport.
  // Generate a full page inside the child so Windows' command-line limit cannot fake a failure.
  const responseExpression = failPage > 1
    ? `Array.from({ length: 100 }, (_, i) => ({ ...${JSON.stringify(release(1, []))}, id: i + 1, tag_name: 'v1.0.' + i }))`
    : JSON.stringify(releases);
  const mock = `
    const NativeDate = Date;
    globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [${JSON.stringify(when)}])); }
      static now() { return NativeDate.parse(${JSON.stringify(when)}); }
    };
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('/traffic/')) return new Response('{}', { status: 403 });
      if (url.pathname.endsWith('/releases')) {
        if (Number(url.searchParams.get('page')) === ${failPage}) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify(${responseExpression}));
      }
      return new Response(JSON.stringify(${JSON.stringify(repo)}));
    };
  `;
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mock)}`, script, out], {
    encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: '', METRICS_TOKEN: traffic ? 'fixture-token' : '', REPO: 'fixture/repo' },
  });
  assert.ifError(result.error);
  return result;
}

test('CLI preserves history, updates definitions, writes reproducible archives, and refuses overwrite', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-metrics-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const oldRow = '2026-11-01,1,2,0,3,1,45,3,12,30,21,v1.0.1,45,,,,\r';
  fs.writeFileSync(path.join(out, 'traction.csv'), `date,legacy\n${oldRow}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), 'old lower-bound claim');
  const result = runCollector(out, [release(1, [asset(1, 'app.exe', 4), asset(2, 'latest.yml', 10)])]);
  assert.equal(result.status, 0, result.stderr);
  const archivePath = path.join(out, 'snapshots', '2026-11-02T09-00-00-000Z.json');
  const archived = fs.readFileSync(archivePath, 'utf8');
  assert.equal(fs.readFileSync(path.join(out, 'latest.json'), 'utf8'), archived);
  const snapshot = JSON.parse(archived);
  assert.equal(snapshot.totals.allAssetDownloads, 14);
  assert.equal(snapshot.totals.packageDownloads, 4);
  assert.equal(snapshot.audience.verifiedInstallations, null);
  assert.ok(fs.readFileSync(path.join(out, 'traction.csv'), 'utf8').includes(`${oldRow}\n`));
  assert.match(fs.readFileSync(path.join(out, 'README.md'), 'utf8'), /not a lower bound/);
  assert.equal(runCollector(out, [release(1)]).status, 1);
  assert.equal(fs.readFileSync(archivePath, 'utf8'), archived);
});

test('CLI leaves every output untouched when data is invalid or pagination fails', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-metrics-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, 'traction.csv'), 'existing history');
  const cases = [
    { releases: [release(1, [asset(1, 'app.exe', -1)])] },
    { releases: Array.from({ length: 100 }, (_, i) => release(i + 1)), options: { failPage: 2 } },
  ];
  for (const entry of cases) {
    const result = runCollector(out, entry.releases, entry.options);
    assert.notEqual(result.status, 0);
    assert.deepEqual(fs.readdirSync(out), ['traction.csv']);
    assert.equal(fs.readFileSync(path.join(out, 'traction.csv'), 'utf8'), 'existing history');
  }
});
