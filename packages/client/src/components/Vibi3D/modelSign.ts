import * as THREE from 'three';
import { validateVibi3DSignRecipe, type Vibi3DSignKind, type Vibi3DSignRecipe } from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';
import { creationIntentId } from '../Creation/creationApi.js';
import { layoutSignGlyphs, offsetSignShapes, type SignFont, type SignGlyphShape } from './signGlyphs.js';
import { bakeSignTexture } from './signCanvas.js';
import { SignParts } from './signParts.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';
import { loadSignFont } from './signFonts.js';

export interface SignPreparation {
  font?: SignFont; sourceTexture?: THREE.Texture;
  /** Injecting a baker keeps geometry/font tests independent of a DOM. Production always uses the Canvas PNG baker. */
  bake?: typeof bakeSignTexture;
}
export async function prepareModelSign(recipe: Vibi3DSignRecipe, id: string, options: SignPreparation = {}): Promise<THREE.Group> {
  const font = options.font ?? (recipe.text?.trim() || !recipe.source ? await loadSignFont(recipe.font, recipe.weight) : undefined);
  return buildModelSign(recipe, id, { ...options, font });
}
export function defaultSignRecipe(kind: Vibi3DSignKind = 'fascia'): Vibi3DSignRecipe {
  return { kind, text: '모퉁이 상점', font: 'sans', weight: 400, color: '#21424a', background: kind === 'window' || kind === 'channel' ? false : '#f5f1e8',
    size: kind === 'projecting' ? [0.7, 2.5, 0.12] : kind === 'panel' ? [1.2, 1.8, 0.08] : [3, 0.8, 0.08],
    layout: kind === 'projecting' ? 'vertical' : 'horizontal', lit: false };
}
function board(parts: SignParts, recipe: Vibi3DSignRecipe): void {
  const [width, height, suppliedDepth] = recipe.size!, depth = suppliedDepth ?? 0.08;
  if (recipe.kind !== 'window' && recipe.background !== false) parts.box('backing', [width, height, depth], [0, 0, -depth / 2], recipe.kind === 'banner' ? 'awning-fabric' : 'plastic');
  if (recipe.kind === 'projecting') {
    for (const [key, y] of [['upper', height * 0.35], ['lower', -height * 0.35]] as const) parts.box(`mount-${key}`, [0.08, 0.08, 0.35], [-width / 2, y, -0.2]);
  } else if (recipe.kind === 'panel' || recipe.kind === 'rooftop') {
    const length = recipe.kind === 'panel' ? Math.max(0.4, height * 0.45) : Math.max(0.25, height * 0.35);
    for (const [key, x] of [['left', -width * 0.35], ['right', width * 0.35]] as const) parts.box(`support-${key}`, [0.05, length, 0.05], [x, -height / 2 - length / 2, -depth]);
  } else if (recipe.kind === 'banner') {
    for (const [key, y] of [['top', height / 2], ['bottom', -height / 2]] as const) parts.box(`rail-${key}`, [width + 0.08, 0.035, 0.035], [0, y, -0.025]);
  }
}
function imageLayer(parts: SignParts, recipe: Vibi3DSignRecipe, texture: THREE.Texture, key: string, offset: number, transparent: boolean): void {
  const [width, height, depth] = recipe.size!;
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, map: texture, transparent,
    alphaTest: transparent ? 0.02 : 0, side: THREE.FrontSide, ...(recipe.lit ? { emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.45 } : {}) });
  Object.assign(material, { uuid: creationIntentId('sign-art-material', parts.id, key, recipe, texture.uuid) });
  if (recipe.lit) material.userData['vibi3dLinkedEmission'] = true;
  if (key === 'artwork' && recipe.source) material.userData['vibi3dMaterial'] = { maps: { map: { source: structuredClone(recipe.source) } } };
  const front = parts.mesh(`${key}-front`, new THREE.PlaneGeometry(width, height), material, [0, 0, offset], true);
  if (texture.userData['vibi3dSource']) texture.userData['vibi3dSource'].target = front.userData['vibi3dId'];
  if (recipe.kind === 'projecting') {
    const back = parts.mesh(`${key}-back`, new THREE.PlaneGeometry(width, height), material, [0, 0, -(depth ?? 0.08) - offset], true); back.rotation.y = Math.PI;
  }
}
function artwork(parts: SignParts, recipe: Vibi3DSignRecipe, glyphs: SignGlyphShape[], options: SignPreparation): void {
  // Pinned artwork remains a separate map, so the existing user link-update control never erases baked text.
  if (options.sourceTexture) imageLayer(parts, recipe, options.sourceTexture.clone(), 'artwork', 0.002, true);
  if (glyphs.length || !options.sourceTexture) {
    const textRecipe = options.sourceTexture ? { ...recipe, background: false as const } : recipe;
    imageLayer(parts, recipe, (options.bake ?? bakeSignTexture)(textRecipe, glyphs), 'lettering', 0.004, textRecipe.background === false);
  }
}
function channel(parts: SignParts, recipe: Vibi3DSignRecipe, glyphs: SignGlyphShape[]): void {
  const depth = recipe.size![2] ?? 0.08;
  for (const glyph of glyphs) {
    const settings = { color: recipe.color!, emissive: recipe.lit ? recipe.color! : '#000000', emissiveIntensity: recipe.lit ? 0.55 : 0 };
    const extrusion = (shapes: THREE.Shape[], thickness: number): THREE.BufferGeometry => new THREE.ExtrudeGeometry(shapes, { depth: thickness, bevelEnabled: false, curveSegments: 8, steps: 1 });
    parts.mesh(glyph.key, extrusion(glyph.shapes, depth), parts.material(glyph.key, 'emissive-acrylic', settings));
    if (recipe.outline && recipe.outline.width > 0) parts.mesh(`${glyph.key}-outline`, extrusion(offsetSignShapes(glyph.shapes, recipe.outline.width), depth * 0.85),
      parts.material(`${glyph.key}-outline`, 'plastic', { color: recipe.outline.color }));
  }
}

/** Build from already prepared font/image data. The editor installs the complete object atomically. */
export function buildModelSign(recipeInput: Vibi3DSignRecipe, id: string, options: SignPreparation = {}): THREE.Group {
  const recipe = validateVibi3DSignRecipe({ ...defaultSignRecipe(recipeInput.kind), ...recipeInput, ...(recipeInput.source && recipeInput.text === undefined ? { text: '' } : {}) });
  if (!recipe) throw new CreationUiError('invalid-command');
  if (recipe.source && !options.sourceTexture) throw new CreationUiError('image-source-unavailable');
  if (recipe.text?.trim() && !options.font) throw new CreationUiError('sign-font-unavailable');
  const parts = new SignParts(id); parts.root.name = recipe.text?.trim() || recipe.kind; parts.root.userData['vibi3dSignRecipe'] = structuredClone(recipe);
  const glyphs = recipe.text?.trim() ? layoutSignGlyphs(options.font!, { text: recipe.text, size: recipe.size!, layout: recipe.layout!, weight: recipe.weight! }) : [];
  board(parts, recipe);
  if (recipe.kind === 'channel') {
    if (recipe.source) artwork(parts, { ...recipe, text: '' }, [], options);
    channel(parts, recipe, glyphs);
  } else artwork(parts, recipe, glyphs, options);
  refreshModelMetricUvs(parts.root); return parts.root;
}
