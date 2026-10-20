import * as THREE from 'three';
// The MIT three GTAO pass owns the shader/rendering. This adapter scopes scene visibility to its normal pass.
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

function excludesAmbientOcclusion(object: THREE.Object3D): boolean {
  if (object.userData['vibi3dLookHelper'] === true) return true;
  if (!(object instanceof THREE.Mesh)) return false;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.some(material => material.transparent || material.opacity < 1 || material.alphaTest > 0
    || (material as THREE.MeshPhysicalMaterial).transmission > 0 || material.polygonOffset);
}

/** Glass/alpha surfaces and the sky must not become opaque walls in GTAO's normal/depth buffer. */
export class SceneAmbientOcclusionPass extends GTAOPass {
  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget,
    deltaTime: number, maskActive: boolean): void {
    const hidden: THREE.Object3D[] = [], override = this.scene.overrideMaterial;
    this.scene.traverse(object => {
      if (object.visible && excludesAmbientOcclusion(object)) { hidden.push(object); object.visible = false; }
    });
    try { super.render(renderer, write, read, deltaTime, maskActive); }
    finally { hidden.forEach(object => { object.visible = true; }); this.scene.overrideMaterial = override; }
  }
  override dispose(): void {
    // three r185's dispose does not release these two shader materials.
    this.gtaoMaterial.dispose(); this.blendMaterial.dispose(); super.dispose();
  }
}
