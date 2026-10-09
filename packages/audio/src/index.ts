/** Pure domain entry point: no filesystem, network, browser device, or server imports. */
export * from './types.js';
export * from './constants.js';
export * from './audioEdit.js';
export { createEmptyAudioDoc, applyAudioPatch } from './ops.js';
export { validateAudioDoc } from './validateDoc.js';
export { audioDocDuration, clipFadeGain } from './timeline.js';
export { renderAudioDoc } from './render/renderDoc.js';
export type { AudioDecodedAssets, AudioRenderOptions } from './render/renderDoc.js';
