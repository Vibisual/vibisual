import * as THREE from 'three';
// Maintained MIT three passes keep tone mapping/output conversion in one final OutputPass.
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ResolvedVibi3DLook } from '@vibisual/shared';
import { sceneLookQuality, type SceneLookQuality } from './sceneLookQuality.js';
import { SceneAmbientOcclusionPass } from './sceneLookAmbientOcclusion.js';
import { recordSceneRaster } from './sceneLookRaster.js';

interface Effects { composer: EffectComposer; beauty: RenderPass; ao: GTAOPass; bloom: UnrealBloomPass; output: OutputPass; width: number; height: number; samples: number }
const effects = new WeakMap<THREE.WebGLRenderer, Effects>();

function createEffects(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Effects {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(1);
  const beauty = new RenderPass(scene, camera), ao = new SceneAmbientOcclusionPass(scene, camera, 1, 1);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.3, 1);
  // The additive bloom changes RGB, while the original model alpha remains usable in video compositing.
  bloom.blendMaterial.blending = THREE.CustomBlending;
  bloom.blendMaterial.blendEquation = THREE.AddEquation;
  bloom.blendMaterial.blendSrc = THREE.OneFactor; bloom.blendMaterial.blendDst = THREE.OneFactor;
  bloom.blendMaterial.blendEquationAlpha = THREE.AddEquation;
  bloom.blendMaterial.blendSrcAlpha = THREE.ZeroFactor; bloom.blendMaterial.blendDstAlpha = THREE.OneFactor;
  const output = new OutputPass();
  composer.addPass(beauty); composer.addPass(ao); composer.addPass(bloom); composer.addPass(output);
  const entry = { composer, beauty, ao, bloom, output, width: 0, height: 0, samples: -1 };
  effects.set(renderer, entry); return entry;
}

export function renderSceneEffects(scene: THREE.Scene, renderer: THREE.WebGLRenderer, camera: THREE.Camera,
  look: ResolvedVibi3DLook, quality: SceneLookQuality, mode: 'lit' | 'clay' | 'wire' | 'ao'): void {
  const entry = effects.get(renderer) ?? createEffects(renderer, scene, camera);
  const raster = sceneLookQuality(quality, renderer.capabilities);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const width = Math.max(1, Math.round(size.x * raster.scale)), height = Math.max(1, Math.round(size.y * raster.scale));
  if (entry.samples !== raster.samples) {
    entry.composer.renderTarget1.samples = raster.samples; entry.composer.renderTarget2.samples = raster.samples;
    entry.composer.renderTarget1.dispose(); entry.composer.renderTarget2.dispose(); entry.samples = raster.samples;
  }
  if (entry.width !== width || entry.height !== height) {
    entry.composer.setSize(width, height); entry.width = width; entry.height = height;
  }
  entry.beauty.scene = scene; entry.beauty.camera = camera;
  entry.ao.scene = scene; entry.ao.camera = camera;
  entry.ao.enabled = mode === 'ao' || (look.ao.enabled && mode !== 'wire');
  entry.ao.output = mode === 'ao' ? GTAOPass.OUTPUT.Denoise : GTAOPass.OUTPUT.Default;
  entry.ao.blendIntensity = look.ao.intensity;
  entry.ao.updateGtaoMaterial({ radius: look.ao.radius, samples: quality === 'draft' ? 8 : quality === 'final' ? 32 : 16 });
  // More samples reduce spatial grain; depth/normal weighting keeps the filter inside each surface.
  entry.ao.updatePdMaterial({ samples: quality === 'draft' ? 8 : quality === 'final' ? 32 : 16, lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6 });
  entry.bloom.enabled = look.bloom.enabled && mode === 'lit';
  entry.bloom.strength = look.bloom.strength; entry.bloom.radius = look.bloom.radius; entry.bloom.threshold = look.bloom.threshold;
  const override = scene.overrideMaterial, tone = renderer.toneMapping, exposure = renderer.toneMappingExposure;
  const visibility: { object: THREE.Object3D; visible: boolean }[] = [];
  scene.traverse(object => visibility.push({ object, visible: object.visible }));
  const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
  const clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
  try {
    if (mode === 'ao' || mode === 'wire') { renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1; }
    entry.composer.render(0);
    recordSceneRaster(renderer, { width, height, samples: raster.samples });
  } finally {
    // GTAOPass resets overrideMaterial internally; subsequent diagnostic views must keep their white/wire material.
    scene.overrideMaterial = override; renderer.toneMapping = tone; renderer.toneMappingExposure = exposure;
    // three's passes restore their temporary state on success; our boundary also restores after a lost-context throw.
    visibility.forEach(saved => { saved.object.visible = saved.visible; });
    renderer.setRenderTarget(target); renderer.autoClear = autoClear; renderer.setClearColor(clearColor, clearAlpha);
  }
}

export function releaseSceneEffects(renderer: THREE.WebGLRenderer): void {
  const entry = effects.get(renderer);
  if (!entry) return;
  entry.beauty.dispose(); entry.ao.dispose(); entry.bloom.dispose(); entry.output.dispose(); entry.composer.dispose();
  effects.delete(renderer);
}
