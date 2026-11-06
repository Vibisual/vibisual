import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLightboxState } from '../../stores/graphStore.js';

const io = vi.hoisted(() => ({ media: vi.fn(), read: vi.fn(), graph: { workspaceImageSavedAt: {} as Record<string, number> } }));
vi.mock('react-i18next', () => {
  const t = (key: string): string => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../apps/appWindowVisibility.js', () => ({ useAppVisible: () => true }));
vi.mock('../../hooks/useInspectorPicker.js', () => ({ useInspectorPicker: () => undefined }));
vi.mock('../Layout/WindowControls.js', () => ({ WindowControls: () => null }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (selector: (state: typeof io.graph) => unknown) => selector(io.graph),
  workspaceImageFileKey: (root: string, path: string) => `${root}|${path}`,
}));
vi.mock('../../utils/workspaceMedia.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/workspaceMedia.js')>()),
  fetchWorkspaceMediaBlob: io.media,
}));
vi.mock('../IDE/useWorkspaceImage.js', () => ({ readWorkspaceImage: io.read }));
vi.mock('../IDE/ImageAnnotator.js', () => ({ ImageLightboxView: (props: object) => createElement('lightbox', props) }));
const { VibimageViewer } = await import('./VibimageViewer.js');

type LayerEdit = (picture: { blob: Blob; name: string; original?: string } | null) => void;
type LightboxProps = { state: ImageLightboxState; canAttach: boolean; onOpenLayers?: (png: Blob, edited: boolean) => void; onClose: () => void };
let renderer: ReactTestRenderer | undefined;

async function mount(file: string, onLayerEdit?: LayerEdit): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(createElement(VibimageViewer, {
      appId: 'vibimage', params: { projectId: 'C:/proj', file, appWindowHosted: '1' }, ...(onLayerEdit ? { onLayerEdit } : {}),
    }));
  });
  return renderer!;
}
const button = (r: ReactTestRenderer, label: string): ReactTestInstance | undefined =>
  r.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label)[0];

beforeEach(() => {
  io.media.mockResolvedValue(new Blob(['not-a-known-header']));
  io.read.mockResolvedValue({ blob: new Blob(['bytes']), mtimeMs: 42, revision: 'sha256:r1' });
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

describe('§5.13 (R-10) the viewer [Edit] is the quick editor; [Layer edit] makes the source', () => {
  it('[Edit] opens the quick editor over this picture with the file as its save target (mtime + revision read with the bytes)', async () => {
    const r = await mount('art/logo.png', vi.fn());
    const edit = button(r, 'panel.fileEdit.edit');
    expect(edit).toBeDefined();
    await act(async () => { edit!.props.onClick(); });
    expect(io.read).toHaveBeenCalledWith('C:/proj', 'art/logo.png', expect.anything());
    const lightbox = r.root.findByType('lightbox' as never).props as LightboxProps;
    expect(lightbox.canAttach).toBe(false);
    expect(lightbox.state.workspace).toMatchObject({ root: 'C:/proj', path: 'art/logo.png', mtimeMs: 42, revision: 'sha256:r1', bakeable: true, mime: 'image/png' });
  });

  it('Layer edit inside the quick editor hands over the baked picture only when something was edited', async () => {
    const onLayerEdit = vi.fn<LayerEdit>();
    const r = await mount('art/logo.png', onLayerEdit);
    await act(async () => { button(r, 'panel.fileEdit.edit')!.props.onClick(); });
    const png = new Blob(['png']);
    const lightbox = () => r.root.findByType('lightbox' as never).props as LightboxProps;
    act(() => lightbox().onOpenLayers!(png, true));
    expect(onLayerEdit).toHaveBeenLastCalledWith({ blob: png, name: 'logo.png', original: 'art/logo.png' });
    act(() => lightbox().onOpenLayers!(png, false));
    expect(onLayerEdit).toHaveBeenLastCalledWith(null);
  });

  it('[Layer edit] in the header makes the source from the file as it is', async () => {
    const onLayerEdit = vi.fn<LayerEdit>();
    const r = await mount('art/logo.png', onLayerEdit);
    act(() => button(r, 'panel.apps.vibimage.layerEdit')!.props.onClick());
    expect(onLayerEdit).toHaveBeenCalledWith(null);
  });

  it('a picture outside the project opens the quick editor without a save target and offers no Layer edit', async () => {
    const r = await mount('/tmp/probe/out/preview.png');
    expect(button(r, 'panel.apps.vibimage.layerEdit')).toBeUndefined();
    await act(async () => { button(r, 'panel.fileEdit.edit')!.props.onClick(); });
    const lightbox = r.root.findByType('lightbox' as never).props as LightboxProps;
    expect(lightbox.state.workspace).toBeUndefined();
    expect(lightbox.onOpenLayers).toBeUndefined();
  });

  it('a picture that cannot be read offers no edit buttons, only Try again', async () => {
    io.media.mockResolvedValue(null);
    const r = await mount('art/missing.png', vi.fn());
    expect(button(r, 'panel.fileEdit.edit')).toBeUndefined();
    expect(button(r, 'panel.apps.vibimage.layerEdit')).toBeUndefined();
    const retry = r.root.findAll((node) => node.type === 'button' && node.children.includes('panel.apps.vibimage.retry'))[0];
    expect(retry).toBeDefined();
    io.media.mockResolvedValue(new Blob(['ok']));
    await act(async () => { retry!.props.onClick(); });
    expect(io.media).toHaveBeenCalledTimes(2);
    expect(button(r, 'panel.fileEdit.edit')).toBeDefined();
  });
});
