import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageExportPath } from './useImageExport.js';

vi.mock('./VibimageViewer.js', () => ({ VibimageViewer: (props: { onLayerEdit?: unknown }) => createElement('viewer', { onLayerEdit: props.onLayerEdit }) }));
vi.mock('./ImageEditor.js', () => ({ ImageEditor: (props: { picture?: unknown }) => createElement('editor', { picture: props.picture }) }));
const { VibimageShell } = await import('./VibimageShell.js');
const { openInLayerEditor, peekLayerEditPicture } = await import('./layerEditHandoff.js');
type LayerEdit = (picture: { blob: Blob; name: string; original?: string } | null) => void;
let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });

describe('(7) opening a picture writes nothing', () => {
  it('a picture node opens in the (R-9) viewer; the editable source is made only by Layer edit', () => {
    act(() => { renderer = create(createElement(VibimageShell, { appId: 'vibimage', params: { projectId: 'project', file: 'photos/product.png' } })); });
    expect(renderer!.root.findAllByType('editor' as never)).toHaveLength(0);
    const viewer = renderer!.root.findByType('viewer' as never);
    act(() => (viewer.props as { onLayerEdit: LayerEdit }).onLayerEdit(null));
    const editor = renderer!.root.findByType('editor' as never);
    // 편집이 없으면 그림을 넘기지 않는다 — 편집기가 원본 파일을 그대로(무손실) 가져온다.
    expect((editor.props as { picture: unknown }).picture).toBeNull();
  });

  it('Layer edit from the quick editor hands the baked picture to the editor of the same window', () => {
    act(() => { renderer = create(createElement(VibimageShell, { appId: 'vibimage', params: { projectId: 'project', file: 'photos/product.png' } })); });
    const baked = { blob: new Blob(['png']), name: 'product.png', original: 'photos/product.png' };
    act(() => (renderer!.root.findByType('viewer' as never).props as { onLayerEdit: LayerEdit }).onLayerEdit(baked));
    expect((renderer!.root.findByType('editor' as never).props as { picture: unknown }).picture).toBe(baked);
  });

  it('a picture handed over from an IDE quick editor opens straight in the editor and the hand-off is released', () => {
    const picture = { blob: new Blob(['png']), name: 'shot.png' };
    let draftKey = '';
    expect(openInLayerEditor('C:/proj', picture, (args) => { draftKey = args.draftKey ?? ''; return true; })).toBe(true);
    act(() => { renderer = create(createElement(VibimageShell, { appId: 'vibimage', params: { projectId: 'C:/proj', draftKey } })); });
    expect((renderer!.root.findByType('editor' as never).props as { picture: unknown }).picture).toBe(picture);
    expect(peekLayerEditPicture(draftKey)).toBeNull();
  });

  it('a picture outside the project (absolute file) has no Layer edit, so no source can be made for it', () => {
    // §5.1 #2-1 (A) — a canvas file bubble the agent touched outside the project; the editable source would live in
    //   the project's .vibisual, so the viewer offers no Layer edit for it.
    for (const file of ['c:/users/dev/appdata/local/temp/icon-probe/out/preview2.png', '/tmp/probe/out/preview2.png']) { // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      act(() => { renderer = create(createElement(VibimageShell, { appId: 'vibimage', params: { projectId: 'C:/proj', file } })); });
      expect(renderer!.root.findAllByType('editor' as never)).toHaveLength(0);
      expect((renderer!.root.findByType('viewer' as never).props as { onLayerEdit?: LayerEdit }).onLayerEdit).toBeUndefined();
      act(() => renderer!.unmount());
      renderer = undefined;
    }
  });

  it('a node that already has an editable source opens the editor', () => {
    act(() => { renderer = create(createElement(VibimageShell, { appId: 'vibimage', params: { projectId: 'project', file: 'photos/product.png', ref: 'poster' } })); });
    expect(renderer!.root.findAllByType('editor' as never)).toHaveLength(1);
  });

  it('nothing in the editor, the import or the photo tools writes into the project folder', () => {
    const sources = import.meta.glob(['./ImageEditor.tsx', './imageImport.ts', './ImagePhotoTools.tsx', './imageAgentBrief.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(4);
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toContain('writeWorkspaceMedia');
      expect(source, file).not.toContain('vibimage-imports');
    }
  });

  it('exporting the same revision again reuses its file name instead of piling up copies', () => {
    const source = { id: 'poster', title: 'Summer: sale?', revision: 7 };
    expect(imageExportPath(source, 'square', 'png')).toBe('exports/Summer-sale-r7-square.png');
    expect(imageExportPath(source, 'square', 'png')).toBe(imageExportPath({ ...source }, 'square', 'png'));
    expect(imageExportPath({ ...source, revision: 8 }, 'square', 'png')).not.toBe(imageExportPath(source, 'square', 'png'));
    expect(imageExportPath({ ...source, title: '' }, 'original', 'svg')).toBe('exports/poster-r7-original.svg');
  });
});
