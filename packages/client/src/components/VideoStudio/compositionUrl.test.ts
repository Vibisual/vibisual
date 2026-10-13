import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '@vibisual/video';
import type { DrawOp } from '@vibisual/video/render';

const transport = vi.hoisted(() => ({ packaged: false }));
vi.mock('../../transport/index.js', () => ({ isPackagedDesktop: () => transport.packaged }));

import { compositionContentPath, makeCompositionSrc } from './compositionUrl.js';

/**
 * §5.13 (T-3) — 무대가 샌드박스 iframe 에 거는 컴포지션 주소.
 *
 * 주소의 `v` 가 코드·데이터를 따라가지 않으면 에이전트가 고친 컴포지션이 미리보기에 안 나오고, 너무 자주 바뀌면 편집마다
 * 프레임이 다시 뜬다. 경로 인코딩이 틀리면 Windows 절대 경로 프로젝트가 여러 세그먼트로 쪼개져 404 가 된다.
 */

const asset: VideoAsset = {
  id: 'comp1',
  kind: 'composition',
  source: { kind: 'file', path: '.vibisual/video/compositions/intro/index.html' },
  contentHash: 'h1',
  width: 1280,
  height: 720,
};

const op = (itemId: string, props?: Record<string, unknown>): DrawOp =>
  ({ resolved: { item: { id: itemId, kind: 'composition', at: 0, duration: 3, ...(props ? { props } : {}) } } }) as unknown as DrawOp;

beforeEach(() => {
  transport.packaged = false;
});

describe('§5.13 (T-3) 컴포지션 콘텐츠 경로', () => {
  it('세그먼트마다 인코딩한다 — 프로젝트 경로는 Windows·POSIX 모두 한 세그먼트로 간다', () => {
    expect(compositionContentPath('C:\\Users\\me\\proj', 'doc 1', 'a\\b c\\index.html')) // privacy-ok: synthetic Windows path fixture
      .toBe('/api/app/vibistudio/content/C%3A%5CUsers%5Cme%5Cproj/doc%201/a/b%20c/index.html');
    expect(compositionContentPath('/home/me/proj', 'd', 'x/index.html')) // privacy-ok: synthetic POSIX path fixture
      .toBe('/api/app/vibistudio/content/%2Fhome%2Fme%2Fproj/d/x/index.html');
  });
});

describe('§5.13 (T-3) 무대의 compositionSrc', () => {
  const make = (seed = 3) => makeCompositionSrc('proj', { id: 'doc-1', seed });

  it('컴포지션 소재가 아니면 주소를 내지 않는다', () => {
    expect(make()(op('c1'), undefined)).toBeNull();
    expect(make()(op('c1'), { id: 'img', kind: 'image', source: { kind: 'file', path: 'a.png' } })).toBeNull();
  });

  it('문서·아이템을 붙인 주소를 낸다', () => {
    expect(make()(op('c1'), asset)).toMatch(
      /^\/api\/app\/vibistudio\/content\/proj\/doc-1\/\.vibisual\/video\/compositions\/intro\/index\.html\?item=c1&v=[^&]+$/,
    );
  });

  it('코드·씨앗·아이템이 같으면 같은 주소, 하나라도 바뀌면 새 주소다', () => {
    const base = make()(op('c1', { title: 'A' }), asset);
    expect(make()(op('c1', { title: 'A' }), asset)).toBe(base);
    expect(make()(op('c1', { title: 'A' }), { ...asset, contentHash: 'h2' })).not.toBe(base);
    expect(make(4)(op('c1', { title: 'A' }), asset)).not.toBe(base);
    expect(make()(op('c2', { title: 'A' }), asset)).not.toBe(base);
  });

  it('§5.13 (V) 37-5 — props 만 바뀌면 주소가 그대로다(프레임을 다시 열지 않고 데이터 메시지로 맞춘다)', () => {
    expect(make()(op('c1', { title: 'B' }), asset)).toBe(make()(op('c1', { title: 'A' }), asset));
  });

  it('§5.13 (V) 37-3 — 판을 주면 그 판의 문서·코드로 내주는 주소(`<docId>@<revId>`)다', () => {
    expect(makeCompositionSrc('proj', { id: 'doc-1', seed: 3 }, 'rev-a1')(op('c1'), asset))
      .toMatch(/^\/api\/app\/vibistudio\/content\/proj\/doc-1%40rev-a1\/\.vibisual\//);
  });

  it('패키지 앱은 vibproxy 를 앞에 붙인다(문서 출처가 file:// 라 상대 주소가 깨진다)', () => {
    transport.packaged = true;
    expect(make()(op('c1'), asset)?.startsWith('vibproxy://proxy/api/app/vibistudio/content/proj/doc-1/')).toBe(true);
  });
});
