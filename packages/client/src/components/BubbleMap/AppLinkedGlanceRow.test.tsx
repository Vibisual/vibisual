import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppLinkedHoverSurface } from './AppLinkedHoverSurface.js';
import { AppLinkedGlanceRow } from './AppLinkedGlanceRow.js';
import type { AppLinkedSatellitesProps } from './AppLinkedSatellites.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/usePopupDismiss.js', () => ({ useOutsidePressDismiss: vi.fn() }));
vi.mock('../../apps/appLinkedItems.js', () => ({ thumbnailAppFor: () => null }));
vi.mock('./linkedBeadParts.js', () => ({
  itemTitle: (item: { label: string }) => item.label, stageStyle: () => ({}),
  BeadPicture: () => null, KindGlyph: () => null,
}));

const p: AppLinkedSatellitesProps = {
  items: Array.from({ length: 14 }, (_, i) => ({ id: String(i), index: i + 1, group: 'scene', kind: 'scene', label: `Scene ${i}`, stageFocus: true })),
  pastFiles: [], nodeWidth: 242, nodeHeight: 183, glow: '#A8B4CC', appId: 'test', appIcon: null, projectId: undefined,
  onOpenNode: vi.fn(), onOpenPast: vi.fn(), onContextMenu: vi.fn(), onFocusItem: vi.fn(),
};
let view: ReactTestRenderer;
afterEach(() => { act(() => view?.unmount()); vi.clearAllMocks(); });
function mount(): void { act(() => { view = create(<AppLinkedHoverSurface><AppLinkedGlanceRow {...p} /></AppLinkedHoverSurface>); }); }
const surface = (): ReturnType<ReactTestRenderer['root']['findByType']> => view.root.findAllByType('div')[0]!;
const button = (label: string): ReturnType<ReactTestRenderer['root']['findByType']> => view.root.findAllByType('button').find((node) => node.props['aria-label'] === label)!;
const expanded = (): boolean => button('canvas.linkedItems.rowLabel').props['aria-expanded'] as boolean;
const enter = (): void => { act(() => surface().props.onPointerEnter({ pointerType: 'mouse' })); };

describe('connected item hover panel', () => {
  it('starts folded, opens on hover, and unmounts previews on leave', () => {
    mount(); expect(expanded()).toBe(false); expect(view.root.findAllByType('button')).toHaveLength(1);
    enter(); expect(expanded()).toBe(true); expect(button('Scene 0')).toBeDefined();
    act(() => surface().props.onPointerLeave());
    expect(expanded()).toBe(false); expect(view.root.findAllByType('button')).toHaveLength(1);
  });
  it('keeps scene focus and editor actions distinct and reaches later scenes', () => {
    mount(); enter();
    act(() => button('Scene 0').props.onClick()); expect(p.onFocusItem).toHaveBeenCalledWith('0');
    act(() => button('Scene 0').props.onDoubleClick()); expect(p.onOpenNode).toHaveBeenCalledOnce();
    act(() => button('canvas.bundle.nextPage').props.onClick()); expect(button('Scene 6')).toBeDefined();
    expect(view.root.findAllByType('button').some((node) => node.props['aria-label'] === 'Scene 0')).toBe(false);
  });
  it('supports touch toggle and Escape without reopening while still hovered', () => {
    mount(); act(() => surface().props.onPointerEnter({ pointerType: 'touch' })); expect(expanded()).toBe(false);
    act(() => button('canvas.linkedItems.rowLabel').props.onClick()); expect(expanded()).toBe(true);
    enter(); act(() => surface().props.onKeyDown({ key: 'Escape', stopPropagation: vi.fn() })); expect(expanded()).toBe(false);
    act(() => surface().props.onPointerLeave()); enter(); expect(expanded()).toBe(true);
  });
  it('opens from keyboard focus and closes when focus leaves the card', () => {
    mount(); act(() => surface().props.onFocusCapture({ target: { matches: () => true } })); expect(expanded()).toBe(true);
    act(() => surface().props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null })); expect(expanded()).toBe(false);
  });
});
