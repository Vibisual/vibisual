import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['./*.ts', './*.tsx', '../Creation/*.ts', '../VideoStudio/*.ts'], { query: '?raw', import: 'default', eager: true });
describe('saved optical values reach every model render path', () => {
  it.each(['modelCanvasLive.ts', 'candidatePreview.ts'])('%s reads the active shot and applies the common camera helper', file => {
    expect(sources[`./${file}`]).toContain('readActiveModelShot(');
    expect(sources[`./${file}`]).toContain('applyModelCameraView(');
  });
  it('bakes file thumbnails through the same live canvas camera', () => {
    expect(sources['./modelThumbnail.ts']).toContain('createLiveView(');
  });
  it('uses the shared FOV conversion in the editor and capture, and the shared output camera in stills and video', () => {
    expect(sources['./Vibi3DShell.tsx']).toContain('resolveVibi3DCameraFov(');
    expect(sources['./vibi3dCapture.ts']).toContain('applyModelCameraView(');
    expect(sources['./vibi3dCapture.ts']).toContain('vibi3DCaptureSize(');
    expect(sources['../Creation/modelScene.ts']).toContain('applyModelOutputCamera(');
    expect(sources['../Creation/modelScene.ts']).toContain('model.renderTo(renderer, width, height, time, { ...options })');
    expect(sources['../Creation/modelSceneCamera.ts']).toContain('resolveVibi3DCameraFov(');
    expect(sources['../VideoStudio/videoModelScene.ts']).toContain('VideoModelScene extends ModelScene');
    expect(sources['../VideoStudio/videoModelScene.ts']).toContain('op.resolved.item.props ?? {}');
    expect(sources['../VideoStudio/videoModelFrames.ts']).toContain('model.renderOp(renderer, op, width, height');
  });
});
