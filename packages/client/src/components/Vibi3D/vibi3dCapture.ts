import * as THREE from 'three';
import { validateVibi3DWorkflowCommand, VIBI3D_CAPTURE_DEFAULT_QUALITY, vibi3DCaptureSize, resolveVibi3DCameraFov, type Vibi3DCaptureCommand, type Vibi3DSnapshot, type Vibi3DCaptureRaster } from '@vibisual/shared';
import { renderStudioView, readStudioViewRaster } from '../Creation/studioLighting.js';
import { applyModelCameraView, readActiveModelShot, readModelCamera, readModelShots } from './modelCamera.js';

export interface CapturedView {
  view: string; mode: 'lit' | 'clay' | 'wire' | 'ao'; quality: 'draft' | 'final';
  width: number; height: number; dataUrl: string; raster?: Vibi3DCaptureRaster;
}
interface CaptureStage {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  model: THREE.Object3D; snapshot: Vibi3DSnapshot;
}

/** Captures render synchronously, independent of animation-frame scheduling in hidden windows. */
export function captureVibi3DViews(stage: CaptureStage, command: Vibi3DCaptureCommand): CapturedView[] {
  if (!validateVibi3DWorkflowCommand(command)) throw new Error('invalid-command');
  const { renderer, scene, camera, model, snapshot } = stage;
  const quality = command.quality ?? VIBI3D_CAPTURE_DEFAULT_QUALITY;
  const mode = command.mode ?? 'lit';
  const size = renderer.getSize(new THREE.Vector2());
  const ratio = renderer.getPixelRatio();
  const previousCamera = camera.clone();
  const override = scene.overrideMaterial;
  const helpers: { object: THREE.Object3D; visible: boolean }[] = [];
  scene.children.forEach((object) => {
    if (object !== model && !(object instanceof THREE.Light) && object.userData['vibi3dLookHelper'] !== true) {
      helpers.push({ object, visible: object.visible }); object.visible = false;
    }
  });
  const material = mode === 'clay' ? new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 1 })
    : mode === 'wire' ? new THREE.MeshBasicMaterial({ color: 0xb9c2d0, wireframe: true }) : null;
  try {
    scene.overrideMaterial = material;
    renderer.setPixelRatio(1);
    const shots = readModelShots(model), saved = readModelCamera(model);
    const views = command.views?.length ? command.views : [readActiveModelShot(model)?.id ?? 'current'];
    return views.map((view, index) => {
      camera.copy(previousCamera);
      const named = typeof view === 'string' && view !== 'current' ? shots.find(shot => shot.id === view || shot.name === view) : undefined;
      if (typeof view === 'string' && view !== 'current' && !named) throw new Error('capture-shot-not-found');
      const input = typeof view === 'string' ? named : (({ name: _name, ...cameraView }) => cameraView)(view);
      const aspect = command.aspect ?? input?.aspect ?? (view === 'current' ? saved?.aspect : undefined) ?? '9:16';
      const [width, height] = command.size ?? vibi3DCaptureSize(aspect, quality);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      if (input) applyModelCameraView(camera, input, { aspect: camera.aspect });
      else {
        camera.fov = resolveVibi3DCameraFov(saved ?? snapshot.camera ?? {}, camera.aspect, previousCamera.fov);
        camera.filmGauge = 35;
        if (snapshot.camera) camera.lookAt(new THREE.Vector3().fromArray(snapshot.camera.target));
        camera.updateProjectionMatrix();
      }
      renderStudioView(scene, renderer, camera, { object: model, quality, mode });
      const raster = readStudioViewRaster(renderer);
      return { view: typeof view === 'string' ? view : view.name ?? `view-${index + 1}`, mode, quality,
        width, height, ...(raster ? { raster } : {}), dataUrl: renderer.domElement.toDataURL('image/png') };
    });
  } finally {
    camera.copy(previousCamera); scene.overrideMaterial = override;
    helpers.forEach(({ object, visible }) => { object.visible = visible; });
    renderer.setPixelRatio(ratio); renderer.setSize(size.x, size.y, false);
    material?.dispose();
    renderStudioView(scene, renderer, camera, { object: model, mode: override ? 'wire' : 'lit' });
  }
}
