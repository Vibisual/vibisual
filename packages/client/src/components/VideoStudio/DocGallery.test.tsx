import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class DocInUseError extends Error {}
  class VersionConflictError extends Error {}
  return {
    DocInUseError, VersionConflictError,
    fetchPoster: vi.fn(), copyDoc: vi.fn(), deleteDoc: vi.fn(), readDoc: vi.fn(), patchDoc: vi.fn(),
  };
});
vi.mock('react-i18next', () => {
  const t = (key: string, vars?: Record<string, unknown>): string => (vars ? `${key}|${JSON.stringify(vars)}` : key);
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('../../hooks/useBoxTier.js', () => ({ useAppBoxTier: () => 'regular' }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./videoApi.js', () => ({
  fetchDocPoster: mocks.fetchPoster, copyDoc: mocks.copyDoc, deleteDoc: mocks.deleteDoc, readDoc: mocks.readDoc, patchDoc: mocks.patchDoc,
  DocInUseError: mocks.DocInUseError, VersionConflictError: mocks.VersionConflictError,
}));

import { DocGallery, type DocGalleryProps } from './DocGallery.js';
import { GALLERY_PAGE } from './docGalleryModel.js';
import { __posterQueueForTest, __resetPostersForTest } from './docPosters.js';
import type { DocSummary } from './videoApi.js';

const doc = (id: string, title: string, updatedAt: number): DocSummary => ({ id, title, updatedAt, version: 3, width: 1920, height: 1080, duration: 12 });
const DOCS = [doc('a', 'Alpha', 300), doc('b', 'Beta', 200), doc('c', 'Gamma', 100)];

let view: ReactTestRenderer | undefined;
let props: DocGalleryProps;
const tick = async (): Promise<void> => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function mount(over: Partial<DocGalleryProps> = {}): void {
  props = {
    project: '/p', docs: DOCS, currentDocId: 'b', locked: false,
    onClose: vi.fn(), onOpenDoc: vi.fn(), onNewDoc: vi.fn(), onRenameCurrent: vi.fn(), onRefreshDocs: vi.fn(async () => undefined), onDocDeleted: vi.fn(),
    ...over,
  };
  act(() => { view = create(createElement(DocGallery, props)); });
}
const root = (): ReactTestInstance => (view as ReactTestRenderer).root;
const textOf = (n: ReactTestInstance | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''));
const options = (): ReactTestInstance[] => root().findAll((n) => typeof n.type === 'string' && n.props.role === 'row');
const byLabel = (label: string): ReactTestInstance[] => root().findAll((n) => typeof n.type === 'string' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith(label));
const buttonWithText = (text: string): ReactTestInstance => {
  const hit = root().findAll((n) => n.type === 'button' && textOf(n).includes(text));
  if (!hit[0]) throw new Error(`no button ${text}`);
  return hit[0];
};
const input = (): ReactTestInstance => root().findByType('input');
const key = (k: string, composing = false) => ({ key: k, nativeEvent: { isComposing: composing }, preventDefault: vi.fn(), stopPropagation: vi.fn() });
const type = (text: string): void => { act(() => input().props.onChange({ target: { value: text } })); };

beforeEach(() => {
  __resetPostersForTest();
  for (const m of [mocks.fetchPoster, mocks.copyDoc, mocks.deleteDoc, mocks.readDoc, mocks.patchDoc]) m.mockReset();
  mocks.fetchPoster.mockResolvedValue({ state: 'empty', image: null });
});
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('문서 갤러리 — 목록·검색·열기', () => {
  it('최근순으로 모든 문서를 보이고 열 때 목록을 새로 읽는다', () => {
    mount();
    expect(options().map((o) => o.props.id.split('-').pop())).toEqual(['a', 'b', 'c']);
    expect(props.onRefreshDocs).toHaveBeenCalledTimes(1);
    expect(options().find((o) => o.props['aria-current'] === 'true')?.props.id.endsWith('-b')).toBe(true);
    expect(options().find((o) => o.props['aria-selected'])?.props.id.endsWith('-b')).toBe(true);
  });

  it('목록은 grid > row > gridcell 이고 상호작용 요소는 셀 안에 있다 · activedescendant 는 늘 있는 행을 가리킨다', () => {
    mount();
    const all = root().findAll((n) => typeof n.type === 'string');
    expect(all.some((n) => n.props.role === 'listbox' || n.props.role === 'option' || n.props.role === 'presentation')).toBe(false);
    const grid = all.find((n) => n.props.role === 'grid');
    expect(grid).toBeDefined();
    const rowEls = options();
    expect(rowEls).toHaveLength(3);
    for (const row of rowEls) {
      const cells = row.findAll((n) => n.props.role === 'gridcell');
      expect(cells.length).toBeGreaterThan(0);
      // 단추는 모두 어떤 gridcell 의 후손이다.
      for (const b of row.findAll((n) => n.type === 'button')) {
        let hit = false;
        for (const c of cells) if (c.findAll((n) => n === b).length > 0) hit = true;
        expect(hit).toBe(true);
      }
    }
    const active = input().props['aria-activedescendant'] as string;
    expect(rowEls.some((r) => r.props.id === active)).toBe(true);
    expect(input().props['aria-controls']).toBe(grid?.props.id);
  });

  it('이름을 고치는 중에도 activedescendant 의 행은 남고, 확인 카드가 뜨면 가리키지 않는다', () => {
    mount();
    act(() => input().props.onKeyDown(key('ArrowUp')));
    const active = (): string | undefined => root().findAllByType('input')[0]?.props['aria-activedescendant'] as string | undefined;
    const target = active();
    expect(target).toBeDefined();
    const menu = byLabel('panel.videoStudio.gallery.itemMenu').find((b) => b.type === 'button');
    act(() => menu?.props.onClick());
    act(() => buttonWithText('header.rename').props.onClick());
    expect(options().some((r) => r.props.id === active())).toBe(true);
    act(() => root().findAllByType('input').find((i) => i.props['aria-label'] === 'panel.videoStudio.header.title')?.props.onKeyDown(key('Escape')));
    const again = byLabel('panel.videoStudio.gallery.itemMenu').find((b) => b.type === 'button');
    act(() => again?.props.onClick());
    act(() => buttonWithText('gallery.delete').props.onClick());
    expect(input().props['aria-activedescendant']).toBeUndefined();
    expect(input().props['aria-controls']).toBeUndefined();
  });

  it('[새 영상] 은 판을 닫고 새 문서로 간다', () => {
    mount();
    act(() => buttonWithText('header.newDoc').props.onClick());
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onNewDoc).toHaveBeenCalled();
  });

  it('검색은 제목 부분 일치이고 결과가 없으면 안내를 보인다', () => {
    mount();
    type('ALP');
    expect(options()).toHaveLength(1);
    type('zzz');
    expect(options()).toHaveLength(0);
    expect(root().findAllByType('p').map(textOf).join('|')).toContain('gallery.noMatch');
  });

  it('Enter 로 고른 문서를 열고, 한글 조합 중 Enter 는 열지 않는다', () => {
    mount();
    type('a');
    act(() => input().props.onKeyDown(key('ArrowDown')));
    act(() => input().props.onKeyDown(key('Enter', true)));
    expect(props.onOpenDoc).not.toHaveBeenCalled();
    act(() => input().props.onKeyDown(key('Enter')));
    expect(props.onOpenDoc).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('Esc 는 판을 닫는다', () => {
    mount();
    act(() => input().props.onKeyDown(key('Escape')));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('수백 개여도 처음에는 한 쪽만 그린다', () => {
    const many = Array.from({ length: 600 }, (_, i) => doc(`d${i}`, `Doc ${i}`, i));
    mount({ docs: many, currentDocId: null });
    expect(options()).toHaveLength(GALLERY_PAGE);
  });

  it('닫으면 줄에서 기다리던 포스터 요청이 정리된다', async () => {
    mocks.fetchPoster.mockImplementation(() => new Promise(() => undefined));
    const many = Array.from({ length: 30 }, (_, i) => doc(`d${i}`, `Doc ${i}`, i));
    mount({ docs: many, currentDocId: null });
    expect(__posterQueueForTest().probeWaiting).toBeGreaterThan(0);
    act(() => view?.unmount());
    view = undefined;
    expect(__posterQueueForTest().probeWaiting).toBe(0);
  });
});

describe('문서 갤러리 — 항목 메뉴', () => {
  const openMenu = (id: string): void => {
    const button = byLabel('panel.videoStudio.gallery.itemMenu').find((b) => b.props['aria-label'].includes(`"${id === 'a' ? 'Alpha' : id === 'b' ? 'Beta' : 'Gamma'}"`));
    if (!button) throw new Error('no menu button');
    act(() => button.props.onClick());
  };

  it('복제는 새 제목으로 서버 복사본을 만들고 목록을 새로 읽는다(열지는 않는다)', async () => {
    mocks.copyDoc.mockResolvedValue({ id: 'copy-1' });
    mount();
    openMenu('a');
    await act(async () => { buttonWithText('gallery.duplicate').props.onClick(); await tick(); });
    expect(mocks.copyDoc).toHaveBeenCalledWith('/p', 'a', 'panel.videoStudio.gallery.copyTitle|{"title":"Alpha"}');
    expect(props.onRefreshDocs).toHaveBeenCalledTimes(2);
    expect(props.onOpenDoc).not.toHaveBeenCalled();
  });

  it('다른 문서의 이름 바꾸기는 최신 판을 읽어 setDoc 연산으로 보낸다 · 409 면 한 번 더', async () => {
    mocks.readDoc.mockResolvedValueOnce({ doc: { id: 'a', version: 5 } }).mockResolvedValueOnce({ doc: { id: 'a', version: 6 } });
    mocks.patchDoc.mockRejectedValueOnce(new mocks.VersionConflictError()).mockResolvedValueOnce({});
    mount();
    openMenu('a');
    act(() => buttonWithText('header.rename').props.onClick());
    expect(root().findAllByType('input')).toHaveLength(2);
    const rename = root().findAllByType('input').find((i) => i.props['aria-label'] === 'panel.videoStudio.header.title');
    expect(rename).toBeDefined();
    act(() => rename?.props.onChange({ target: { value: 'Renamed' } }));
    await act(async () => { rename?.props.onKeyDown(key('Enter')); await tick(); });
    expect(mocks.patchDoc).toHaveBeenNthCalledWith(1, '/p', 'a', 5, [{ op: 'setDoc', patch: { title: 'Renamed' } }]);
    expect(mocks.patchDoc).toHaveBeenNthCalledWith(2, '/p', 'a', 6, [{ op: 'setDoc', patch: { title: 'Renamed' } }]);
    expect(options().some((o) => textOf(o).includes('Renamed'))).toBe(true);
  });

  it('지금 열린 문서의 이름 바꾸기는 머리줄 제목과 같은 길(onRenameCurrent)이다', async () => {
    mount();
    openMenu('b');
    act(() => buttonWithText('header.rename').props.onClick());
    const rename = root().findAllByType('input').find((i) => i.props['aria-label'] === 'panel.videoStudio.header.title');
    act(() => rename?.props.onChange({ target: { value: 'Beta 2' } }));
    await act(async () => { rename?.props.onKeyDown(key('Enter')); await tick(); });
    expect(props.onRenameCurrent).toHaveBeenCalledWith('Beta 2');
    expect(mocks.patchDoc).not.toHaveBeenCalled();
  });

  it('삭제는 확인 카드를 거치고(기본 초점은 취소), 취소하면 아무것도 지우지 않는다', async () => {
    mount();
    openMenu('c');
    act(() => buttonWithText('gallery.delete').props.onClick());
    expect(root().findAll((n) => n.props.role === 'alertdialog')).toHaveLength(1);
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
    act(() => buttonWithText('gallery.cancel').props.onClick());
    expect(root().findAll((n) => n.props.role === 'alertdialog')).toHaveLength(0);
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
  });

  it('확인하면 서버에 지우고 알린다 · 대기열에 렌더가 있으면(409) 이유를 한 줄로 알린다', async () => {
    mocks.deleteDoc.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new mocks.DocInUseError());
    mount();
    openMenu('c');
    act(() => buttonWithText('gallery.delete').props.onClick());
    await act(async () => { root().findAll((n) => n.type === 'button' && textOf(n).includes('gallery.delete')).slice(-1)[0]?.props.onClick(); await tick(); });
    expect(mocks.deleteDoc).toHaveBeenCalledWith('/p', 'c');
    expect(props.onDocDeleted).toHaveBeenCalledWith('c');

    openMenu('a');
    act(() => buttonWithText('gallery.delete').props.onClick());
    await act(async () => { root().findAll((n) => n.type === 'button' && textOf(n).includes('gallery.delete')).slice(-1)[0]?.props.onClick(); await tick(); });
    expect(props.onDocDeleted).toHaveBeenCalledTimes(1);
    expect(root().findAll((n) => n.props.role === 'alert').map(textOf).join('|')).toContain('gallery.errInUse');
  });

  it('확인 카드가 뜬 뒤 그 문서가 잠기면 확정해도 지우지 않는다', async () => {
    mocks.deleteDoc.mockResolvedValue(undefined);
    mount();
    openMenu('b');
    act(() => buttonWithText('gallery.delete').props.onClick());
    act(() => view?.update(createElement(DocGallery, { ...props, locked: true })));
    const confirm = root().findAll((n) => n.type === 'button' && textOf(n).includes('gallery.delete')).slice(-1)[0];
    expect(confirm?.props.disabled).toBe(true);
    await act(async () => { confirm?.props.onClick(); await tick(); });
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
    expect(root().findAll((n) => n.props.role === 'alertdialog')).toHaveLength(1);
  });

  it('고칠 수 없는 때 열린 문서의 이름 바꾸기·삭제는 막힌다', () => {
    mount({ locked: true });
    openMenu('b');
    expect(buttonWithText('header.rename').props.disabled).toBe(true);
    expect(buttonWithText('gallery.delete').props.disabled).toBe(true);
    expect(buttonWithText('gallery.duplicate').props.disabled).toBe(false);
  });
});
