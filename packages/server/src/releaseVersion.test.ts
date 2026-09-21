import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const policy = await import(pathToFileURL(path.resolve(__dirname, '../../../.github/scripts/releaseVersion.mjs')).href);
const release = (version: string, extra = {}) => ({
  tag_name: `v${version}`, draft: false, prerelease: false, published_at: '2026-09-21T00:00:00Z', ...extra,
});

describe('release version — only published stable releases consume a number', () => {
  it('starts at 0.2.0 despite unpublished local bumps and older published releases', () => {
    for (const currentVersion of ['0.1.25', '0.1.31', '0.2.0', '9.9.9']) {
      expect(policy.selectReleaseVersion({ pages: [[release('0.1.25')]], currentVersion }).target).toBe('0.2.0');
    }
  });

  it('increments the numeric highest stable publication across every page', () => {
    expect(policy.selectReleaseVersion({ pages: [[release('0.2.9')], [release('0.2.10'), release('0.2.1')]] }).target).toBe('0.2.11');
  });

  it('keeps a failed target and advances only after it is published', () => {
    const pages = [[release('0.1.25'), release('0.2.0', { draft: true, published_at: null }), release('9.0.0', { prerelease: true })]];
    expect(policy.selectReleaseVersion({ pages, currentVersion: '0.2.0' }).target).toBe('0.2.0');
    expect(policy.selectReleaseVersion({ pages: [[release('0.2.0')]], currentVersion: '0.2.0' }).target).toBe('0.2.1');
  });

  it('accepts a repeated explicit unpublished target without consulting the local bump', () => {
    expect(policy.selectReleaseVersion({ pages: [[release('0.1.25')]], explicitVersion: '0.2.0', currentVersion: '0.2.0' }).target).toBe('0.2.0');
  });

  it('does not overwrite any published version, including a published prerelease', () => {
    for (const prerelease of [false, true]) {
      expect(() => policy.selectReleaseVersion({ pages: [[release('0.2.0', { prerelease })]], explicitVersion: '0.2.0' })).toThrow('immutable');
    }
  });

  it('rejects downgrade targets, targets below the floor and invalid semver', () => {
    expect(() => policy.selectReleaseVersion({ pages: [[release('0.2.5')]], explicitVersion: '0.2.3' })).toThrow('greater than published');
    for (const explicitVersion of ['0.1.32', '0.2.01', '0.2.0-beta', '0.2.0;echo bad', '9007199254740992.0.0']) {
      expect(() => policy.selectReleaseVersion({ pages: [[]], explicitVersion })).toThrow();
    }
  });

  it('distinguishes a verified empty history from an invalid or incomplete API response', () => {
    expect(policy.selectReleaseVersion({ pages: [[]] }).target).toBe('0.2.0');
    for (const pages of [null, {}, [], [null], [{ message: 'Bad credentials' }], [[{ tag_name: 'v0.2.0' }]], [[release('0.2.0', { published_at: null })]], [[release('0.2.0', { published_at: 'invalid' })]]]) {
      expect(() => policy.selectReleaseVersion({ pages })).toThrow();
    }
  });

  it('ignores non-stable tag names without allowing malformed records', () => {
    expect(policy.selectReleaseVersion({ pages: [[release('0.2.3'), release('99.0.0-beta.1')]] }).target).toBe('0.2.4');
  });

  it('resume retains the current unpublished version and refuses an explicit mismatch', () => {
    const pages = [[release('0.2.0')]];
    expect(policy.selectReleaseVersion({ pages, resume: true, currentVersion: '0.3.0' }).target).toBe('0.3.0');
    expect(() => policy.selectReleaseVersion({ pages, resume: true, currentVersion: '0.3.0', explicitVersion: '0.3.1' })).toThrow('differs');
  });
});

describe('release resume identity', () => {
  const valid = { target: '0.2.0', headSha: 'abc', headSubject: 'release: v0.2.0', remoteHead: 'abc', localTagSha: 'abc', remoteTagSha: 'abc', rootVersion: '0.2.0', desktopVersion: '0.2.0' };

  it('accepts matching local and remote tags, or a not-yet-tagged release commit', () => {
    expect(() => policy.assertResumeIdentity(valid)).not.toThrow();
    expect(() => policy.assertResumeIdentity({ ...valid, localTagSha: null, remoteTagSha: null })).not.toThrow();
  });

  it('rejects every source of commit/version mismatch before a tagged build can be retried', () => {
    for (const change of [{ headSubject: 'another commit' }, { remoteHead: 'def' }, { localTagSha: 'def' }, { remoteTagSha: 'def' }, { rootVersion: '0.2.1' }, { desktopVersion: '0.2.1' }]) {
      expect(() => policy.assertResumeIdentity({ ...valid, ...change })).toThrow();
    }
  });
});
