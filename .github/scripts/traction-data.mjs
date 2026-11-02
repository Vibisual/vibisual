// Public download evidence: validate the entire collection before any output is written.
export const API_VERSION = '2022-11-28';

export function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
}

function id(value, label) {
  count(value, label);
  if (value === 0) throw new Error(`${label} must be positive`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return value;
}

function name(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n,]/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

export function validateRepository(repo) {
  for (const key of ['stargazers_count', 'forks_count', 'subscribers_count', 'open_issues_count']) count(repo?.[key], key);
  return repo;
}

/** Preserve the CSV's historical package classification, including macOS update ZIPs. */
export function classify(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.blockmap')) return 'blockmap';
  if (n.endsWith('.yml') || n.endsWith('.yaml')) return 'meta';
  if (n.endsWith('.exe') || n.endsWith('.msi')) return 'windows';
  if (n.endsWith('.dmg') || n.endsWith('-mac.zip') || n.endsWith('.pkg')) return 'macos';
  if (n.endsWith('.appimage') || n.endsWith('.deb') || n.endsWith('.rpm') || n.endsWith('.snap')) return 'linux';
  return 'other';
}

export const isPackage = (kind) => ['windows', 'macos', 'linux'].includes(kind);

/** A full last page requires another request; a failed/capped collection is never accepted. */
export async function collectReleases(fetchPage, { perPage = 100, maxPages = 1000 } = {}) {
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100 || !Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('Invalid pagination limits');
  }
  const releases = [];
  const releaseIds = new Set();
  const assetIds = new Set();
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchPage(page, perPage);
    const batch = Array.isArray(response) ? response : response?.items;
    const hasNext = Array.isArray(response) ? false : response?.hasNext;
    if (typeof hasNext !== 'boolean') throw new Error(`Invalid pagination metadata on page ${page}`);
    if (!Array.isArray(batch) || batch.length > perPage) throw new Error(`Invalid release page ${page}`);
    if (hasNext && batch.length === 0) throw new Error(`Empty release page ${page} claims another page`);
    for (const release of batch) {
      id(release?.id, 'release.id');
      if (releaseIds.has(release.id)) throw new Error(`Duplicate release ${release.id}; pagination may have shifted`);
      releaseIds.add(release.id);
      if (typeof release.draft !== 'boolean') throw new Error('release.draft must be boolean');
      // Authenticated API responses can include drafts. They are not public evidence.
      if (release.draft) continue;
      name(release.tag_name, 'release.tag_name');
      if (typeof release.prerelease !== 'boolean') throw new Error('release.prerelease must be boolean');
      timestamp(release.created_at, 'release.created_at');
      timestamp(release.published_at, 'release.published_at');
      if (!Array.isArray(release.assets)) throw new Error(`Missing assets for ${release.tag_name}`);
      for (const asset of release.assets) {
        id(asset?.id, 'asset.id');
        if (assetIds.has(asset.id)) throw new Error(`Duplicate asset ${asset.id}`);
        assetIds.add(asset.id);
        name(asset.name, 'asset.name');
        count(asset.download_count, `asset ${asset.id} download_count`);
        timestamp(asset.created_at, 'asset.created_at');
        timestamp(asset.updated_at, 'asset.updated_at');
      }
      releases.push(release);
    }
    if (batch.length < perPage && !hasNext) return { releases, pages: page };
  }
  throw new Error(`Release pagination incomplete after ${maxPages} full pages`);
}

export function aggregate(releases) {
  const tally = { windows: 0, macos: 0, linux: 0, meta: 0, blockmap: 0, other: 0, total: 0, all: 0 };
  for (const release of releases) {
    for (const asset of release.assets) {
      const value = count(asset.download_count, `asset ${asset.id} download_count`);
      const kind = classify(asset.name);
      tally[kind] = count(tally[kind] + value, `${kind} total`);
      tally.all = count(tally.all + value, 'all asset total');
      if (isPackage(kind)) tally.total = count(tally.total + value, 'package total');
    }
  }
  return tally;
}

export function makeEvidence({ repository, repo, releases, pages, collectionStartedAt, observedAt }) {
  validateRepository(repo);
  timestamp(collectionStartedAt, 'collectionStartedAt');
  timestamp(observedAt, 'observedAt');
  const tally = aggregate(releases);
  return {
    schemaVersion: 1,
    repository,
    collectionStartedAt,
    observedAt,
    source: {
      provider: 'GitHub REST API', apiVersion: API_VERSION,
      releasesUrl: `https://api.github.com/repos/${repository}/releases?per_page=100`,
      pages, publicReleasesOnly: true,
    },
    definitions: {
      downloads: 'Cumulative release-asset download counts reported by GitHub, not unique people or completed installations. Includes updates, repeats, automation and CI; no baseline deductions.',
      packageDownloads: 'EXE/MSI, DMG/PKG/mac ZIP, AppImage/DEB/RPM/Snap asset download counts; same file classification as traction.csv downloads_total.',
      updateMetadataDownloads: 'YML/YAML asset downloads. Repeated update checks and automation are included; not a lower bound on active installations.',
      audience: 'Verified installations and active users are not measured. Null means unavailable, not zero.',
    },
    audience: { verifiedInstallations: null, activeUsers: null },
    repositoryCounters: {
      stars: repo.stargazers_count, forks: repo.forks_count,
      watchers: repo.subscribers_count, openIssues: repo.open_issues_count,
    },
    totals: {
      publicReleases: releases.length, allAssetDownloads: tally.all, packageDownloads: tally.total,
      packagesByPlatform: { windows: tally.windows, macos: tally.macos, linux: tally.linux },
      updateMetadataDownloads: tally.meta, blockmapDownloads: tally.blockmap, otherAssetDownloads: tally.other,
    },
    releases: releases.map((release) => ({
      id: release.id, tag_name: release.tag_name, prerelease: release.prerelease,
      created_at: release.created_at, published_at: release.published_at,
      assets: release.assets.map((asset) => ({
        id: asset.id, name: asset.name, download_count: asset.download_count,
        created_at: asset.created_at, updated_at: asset.updated_at,
      })),
    })),
  };
}

export function validateTraffic(data, key) {
  count(data?.count, `${key}.count`);
  count(data?.uniques, `${key}.uniques`);
  if (!Array.isArray(data[key])) throw new Error(`Missing ${key} daily data`);
  for (const day of data[key]) {
    timestamp(day.timestamp, `${key}.timestamp`);
    count(day.count, `${key} daily count`);
    count(day.uniques, `${key} daily uniques`);
  }
  return data;
}
