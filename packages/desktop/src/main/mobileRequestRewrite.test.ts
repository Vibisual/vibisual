import { describe, expect, it } from 'vitest';
import { isMobileContentBase } from '@vibisual/shared';
import { boundOpenRange, contentCapabilityRedirect, resolveContentCapability } from './mobileRequestRewrite';

const SESSION = 'a'.repeat(48);
const DOC = '/api/app/someapp/content/project/doc-1/.vibisual/video/compositions/scene/index.html';
const QUERY = '?item=clip&v=abc';

function capabilityFor(url: string, session = SESSION): string {
  const target = contentCapabilityRedirect(url, session);
  if (target === null) throw new Error('expected a capability path');
  return target.split('/')[3]!;
}

describe('mobile content capability', () => {
  it('turns a document request into a path whose relative URLs keep the capability', () => {
    const target = contentCapabilityRedirect(`${DOC}${QUERY}`, SESSION)!;
    expect(target.startsWith('/mobile/content/')).toBe(true);
    expect(target.endsWith(`${DOC}${QUERY}`)).toBe(true);
    const sibling = new URL('../_shared/engine.js', `https://phone.invalid${target}`).pathname;
    const resolved = resolveContentCapability(sibling, [SESSION]);
    expect(resolved?.url).toBe('/api/app/someapp/content/project/doc-1/.vibisual/video/compositions/_shared/engine.js');
    expect(isMobileContentBase(resolved!.base)).toBe(true);
  });

  it('keeps the query string when it hands the request to the core', () => {
    expect(resolveContentCapability(contentCapabilityRedirect(`${DOC}${QUERY}`, SESSION)!, [SESSION])?.url).toBe(`${DOC}${QUERY}`);
  });

  it('leaves anything that is not app content alone', () => {
    expect(contentCapabilityRedirect('/api/projects', SESSION)).toBeNull();
    expect(contentCapabilityRedirect('/api/app/someapp/media?path=a.wav', SESSION)).toBeNull();
    expect(contentCapabilityRedirect('/assets/index.js', SESSION)).toBeNull();
  });

  it('rejects a capability from another session, a removed session, or a tampered one', () => {
    const path = contentCapabilityRedirect(DOC, SESSION)!;
    expect(resolveContentCapability(path, ['b'.repeat(48)])).toBeNull();
    expect(resolveContentCapability(path, [])).toBeNull();
    expect(resolveContentCapability(path.replace('/mobile/content/', '/mobile/content/x'), [SESSION])).toBeNull();
  });

  it('accepts any live session so that pairing another device keeps open frames working', () => {
    expect(resolveContentCapability(contentCapabilityRedirect(DOC, SESSION)!, ['b'.repeat(48), SESSION])).not.toBeNull();
  });

  it('scopes a capability to one document', () => {
    const capability = capabilityFor(DOC);
    expect(resolveContentCapability(`/mobile/content/${capability}/api/app/someapp/content/project/doc-2/a.js`, [SESSION])).toBeNull();
    expect(resolveContentCapability(`/mobile/content/${capability}/api/app/someapp/content/other/doc-1/a.js`, [SESSION])).toBeNull();
    expect(resolveContentCapability(`/mobile/content/${capability}/api/app/other/content/project/doc-1/a.js`, [SESSION])).toBeNull();
  });

  it.each([
    '/api/app/someapp/content/project/doc-1/../../../../projects',
    '/api/app/someapp/content/project/doc-1/%2e%2e/%2e%2e/%2e%2e/%2e%2e/projects',
    '/api/app/someapp/content/project/doc-1/.%2E/.%2E/secret',
    '/api/app/someapp/content/project/doc-1/a\\..\\..\\b',
  ])('refuses a path the dispatcher would normalize out of the signed scope: %s', (inner) => {
    const capability = capabilityFor(DOC);
    expect(resolveContentCapability(`/mobile/content/${capability}${inner}`, [SESSION])).toBeNull();
    expect(contentCapabilityRedirect(inner, SESSION)).toBeNull();
  });

  it('refuses a capability path that does not reach app content', () => {
    const capability = capabilityFor(DOC);
    expect(resolveContentCapability(`/mobile/content/${capability}`, [SESSION])).toBeNull();
    expect(resolveContentCapability(`/mobile/content/${capability}/api/projects`, [SESSION])).toBeNull();
    expect(resolveContentCapability('/mobile/qr', [SESSION])).toBeNull();
  });
});

describe('open-ended range bound', () => {
  const CHUNK = 4 * 1024 * 1024;

  it('bounds an open-ended range to one chunk from its start', () => {
    expect(boundOpenRange('bytes=0-', CHUNK)).toBe(`bytes=0-${CHUNK - 1}`);
    expect(boundOpenRange('bytes=1000-', CHUNK)).toBe(`bytes=1000-${1000 + CHUNK - 1}`);
  });

  it('keeps closed, suffix and multiple ranges at their requested length', () => {
    for (const range of ['bytes=0-1', 'bytes=10-99999999', 'bytes=-500', 'bytes=0-1,5-', 'items=0-']) {
      expect(boundOpenRange(range, CHUNK)).toBe(range);
    }
  });

  it('leaves a start too large to do arithmetic on for the core to refuse', () => {
    const range = `bytes=${'9'.repeat(30)}-`;
    expect(boundOpenRange(range, CHUNK)).toBe(range);
  });
});
