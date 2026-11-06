import { describe, expect, it } from 'vitest';
import type { AppWindowArgs } from '../../apps/appWindows.js';
import { openInLayerEditor, peekLayerEditPicture, releaseLayerEditPicture } from './layerEditHandoff.js';
import { lightboxLayerOpener } from '../IDE/imageLightboxLayers.js';

const picture = (name = 'shot.png') => ({ blob: new Blob([name]), name });

describe('§5.5 #17-25 ④-3 hand-off from the quick editor to the layer editor', () => {
  it('opens a fresh Vibimage window keyed by its own draft key and keeps the picture until that window takes it', () => {
    const opened: AppWindowArgs[] = [];
    const first = picture('a.png');
    expect(openInLayerEditor('C:/proj', first, (args) => { opened.push(args); return true; })).toBe(true);
    expect(openInLayerEditor('C:/proj', picture('b.png'), (args) => { opened.push(args); return true; })).toBe(true);
    expect(opened.map((args) => args.appId)).toEqual(['vibimage', 'vibimage']);
    expect(opened[0]?.draftKey).not.toBe(opened[1]?.draftKey);
    expect(opened[0]).toMatchObject({ projectId: 'C:/proj', title: 'a.png' });
    expect(opened[0]?.file).toBeUndefined();
    const key = opened[0]?.draftKey;
    // 같은 창이 다시 그려져도 같은 답 — 받은 뒤에야 지운다.
    expect(peekLayerEditPicture(key)).toBe(first);
    expect(peekLayerEditPicture(key)).toBe(first);
    releaseLayerEditPicture(key);
    expect(peekLayerEditPicture(key)).toBeNull();
  });

  it('takes the picture back when no window opens, and never opens without a project', () => {
    let key = '';
    expect(openInLayerEditor('C:/proj', picture(), (args) => { key = args.draftKey ?? ''; return false; })).toBe(false);
    expect(peekLayerEditPicture(key)).toBeNull();
    let called = false;
    expect(openInLayerEditor('', picture(), () => { called = true; return true; })).toBe(false);
    expect(called).toBe(false);
  });

  it('holds only the most recent few hand-offs a window never took', () => {
    const keys: string[] = [];
    for (let i = 0; i < 6; i += 1) openInLayerEditor('C:/proj', picture(`${i}.png`), (args) => { keys.push(args.draftKey ?? ''); return true; });
    expect(peekLayerEditPicture(keys[0])).toBeNull();
    expect(peekLayerEditPicture(keys[5])?.name).toBe('5.png');
    keys.forEach(releaseLayerEditPicture);
  });

  it('an IDE quick editor sends its baked picture to the file root, else the pane project, else offers nothing', () => {
    const sent: Array<{ root: string; name: string; original?: string }> = [];
    const open = (root: string, pic: { name: string; original?: string }): boolean => { sent.push({ root, name: pic.name, ...(pic.original ? { original: pic.original } : {}) }); return true; };
    const fromFile = lightboxLayerOpener({ url: 'blob:x', origin: { slot: 'ide', cell: null },
      workspace: { root: 'C:/proj', path: 'art/logo.png', mtimeMs: 1, bakeable: true, mime: 'image/png' } }, 'C:/other', 'Imported', open);
    fromFile?.(new Blob(['png']));
    const fromAttachment = lightboxLayerOpener({ url: 'blob:y', origin: { slot: 'ide', cell: null } }, 'C:/other', 'Imported', open);
    fromAttachment?.(new Blob(['png']));
    expect(sent).toEqual([{ root: 'C:/proj', name: 'logo.png', original: 'art/logo.png' }, { root: 'C:/other', name: 'Imported' }]);
    expect(lightboxLayerOpener({ url: 'blob:z', origin: { slot: 'ide', cell: null } }, null, 'Imported', open)).toBeUndefined();
  });
});
