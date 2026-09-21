// Release numbers are consumed by publication, not by a local bump, tag or draft.
// Keep this pure policy public so CI can exercise the same rules as /release.
export const MINIMUM_RELEASE_VERSION = '0.2.0';

export function parseReleaseVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid release version: ${String(value)}`);
  }
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error(`Release version is too large: ${value}`);
  return parts;
}

export function compareReleaseVersions(a, b) {
  const left = parseReleaseVersion(a);
  const right = parseReleaseVersion(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

/** Validate gh api --paginate --slurp output; an unavailable/malformed API is never an empty history. */
export function publishedReleaseHistory(pages) {
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(Array.isArray)) {
    throw new Error('GitHub releases response must contain paginated release arrays.');
  }
  const published = new Set();
  let latestStable = null;
  for (const release of pages.flat()) {
    if (!release || typeof release !== 'object' || typeof release.tag_name !== 'string'
      || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean'
      || !(release.published_at === null || (typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at))))) {
      throw new Error('GitHub releases response contains an invalid release record.');
    }
    if (release.draft) continue;
    if (release.published_at === null) throw new Error('A public GitHub release has no publication timestamp.');
    const version = release.tag_name.replace(/^v/, '');
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) continue;
    parseReleaseVersion(version);
    published.add(version);
    if (!release.prerelease && (latestStable === null || compareReleaseVersions(version, latestStable) > 0)) {
      latestStable = version;
    }
  }
  return { published, latestStable };
}

export function selectReleaseVersion({ pages, explicitVersion, currentVersion, resume = false }) {
  const history = publishedReleaseHistory(pages);
  let target;
  if (explicitVersion !== undefined) {
    parseReleaseVersion(explicitVersion);
    target = explicitVersion;
  } else if (resume) {
    parseReleaseVersion(currentVersion);
    target = currentVersion;
  } else if (history.latestStable) {
    const [major, minor, patch] = parseReleaseVersion(history.latestStable);
    target = `${major}.${minor}.${patch + 1}`;
    parseReleaseVersion(target);
    if (compareReleaseVersions(target, MINIMUM_RELEASE_VERSION) < 0) target = MINIMUM_RELEASE_VERSION;
  } else {
    target = MINIMUM_RELEASE_VERSION;
  }
  if (compareReleaseVersions(target, MINIMUM_RELEASE_VERSION) < 0) {
    throw new Error(`Release target must be at least ${MINIMUM_RELEASE_VERSION}.`);
  }
  if (history.published.has(target)) throw new Error(`v${target} is already published and immutable.`);
  if (history.latestStable && compareReleaseVersions(target, history.latestStable) <= 0) {
    throw new Error(`Release target ${target} must be greater than published ${history.latestStable}.`);
  }
  if (resume && target !== currentVersion) {
    throw new Error(`--resume target ${target} differs from the current package version ${currentVersion}.`);
  }
  return { target, latestPublished: history.latestStable };
}

/** Tags are immutable identities. Check both annotated (peeled) and lightweight tag commits. */
export function assertResumeIdentity({ target, headSha, headSubject, remoteHead, localTagSha, remoteTagSha, rootVersion, desktopVersion }) {
  if (rootVersion !== target || desktopVersion !== target) throw new Error('--resume package versions do not match the target.');
  if (headSubject !== `release: v${target}`) throw new Error(`--resume requires HEAD to be release: v${target}.`);
  if (!headSha || headSha !== remoteHead) throw new Error('--resume requires HEAD to equal the remote branch commit.');
  if (localTagSha && localTagSha !== headSha) throw new Error(`Local v${target} points to another commit; it will not be moved.`);
  if (remoteTagSha && remoteTagSha !== headSha) throw new Error(`Remote v${target} points to another commit; it will not be moved.`);
}
