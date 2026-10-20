import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['./*.ts', './*.tsx', '../Creation/*.ts', '../VideoStudio/*.ts'], { query: '?raw', import: 'default', eager: true });
describe('every render framing path excludes kit prototypes', () => {
  it.each(['modelViewport.ts', 'candidatePreview.ts'])('%s frames visible model bounds', file => {
    expect(sources[`./${file}`]).toContain('visibleModelBounds(');
    expect(sources[`./${file}`]).not.toContain('new THREE.Box3().setFromObject(');
  });
  it('uses the shared viewport bounds in the editor and both canvas preview paths', () => {
    expect(sources['./Vibi3DShell.tsx']).toContain('modelFrame(object)');
    expect(sources['./modelCanvasLive.ts']).toContain('modelFrame(object)');
    expect(sources['./modelThumbnail.ts']).toContain('createLiveView(');
    expect(sources['./modelThumbnail.ts']).toContain('loadLiveModel(');
  });
  it('video frames and stills share ModelScene bounds, and common look/capture shadows use those bounds', () => {
    expect(sources['../Creation/modelScene.ts']).toContain('visibleModelBounds(object)');
    expect(sources['../Creation/modelScene.ts']).toContain('const model = new ModelScene(');
    expect(sources['../VideoStudio/videoModelScene.ts']).toContain('VideoModelScene extends ModelScene');
    expect(sources['../VideoStudio/videoModelFrames.ts']).toContain('videoModelScene');
    expect(sources['../Creation/sceneLook.ts']).toContain('visibleModelBounds(object)');
    expect(sources['./vibi3dCapture.ts']).toContain('renderStudioView(scene, renderer, camera, { object: model');
  });
});
