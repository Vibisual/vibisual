import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageExportPath } from './useImageExport.js';

vi.mock('./VibimageViewer.js', () => ({ VibimageViewer: (props: { onEdit?: () => void }) => createElement('viewer', { onEdit: props.onEdit }) }));
vi.mock('./ImageEditor.js', () => ({ ImageEditor: () => createElement('editor') }));
const { VibimageShell } = await import('./VibimageShell.js');
let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });

describe('(7) opening a picture writes nothing', () => {
  it('a picture node opens in the (R-9) viewer; the editable source is made only by Edit', () => {
    act(() => { renderer = create(createElement(VibimageShell, { appId: 'vibimage', params: { projectId: 'project', file: 'photos/product.png' } })); });
    expect(renderer!.root.findAllByType('editor' as never)).toHaveLength(0);
    const viewer = renderer!.root.findByType('viewer' as never);
    act(() => (viewer.props as { onEdit: () => void }).onEdit());
    expect(renderer!.root.findAllByType('editor' as never)).toHaveLength(1);
  });

  it('a picture outside the project (absolute file) opens view-only — no Edit, so nothing can be written', () => {
    // §5.1 #2-1 (A) — a canvas file bubble the agent touched outside the project; the editable source would live in
    //   the project's .vibisual, so the viewer offers no Edit for it.
    for (const file of ['c:/users/dev/appdata/local/temp/icon-probe/out/preview2.png', '/tmp/probe/out/preview2.png']) { // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      act(() => { renderer = create(createElement(VibimageShell, { appId: 'vibimage', params: { projectId: 'C:/proj', file } })); });
      expect(renderer!.root.findAllByType('editor' as never)).toHaveLength(0);
      expect((renderer!.root.findByType('viewer' as never).props as { onEdit?: () => void }).onEdit).toBeUndefined();
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
