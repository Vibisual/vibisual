import { checkCreationRequirements, creationStableJson } from '@vibisual/shared';
import { changedImageLayers, imageLayerPointer, type ImageLayer } from '../Creation/imageSource.js';
import { imagePayloadValue, type ImageCandidate, type ImageSourceDoc } from './imageApi.js';

/**
 * Whether "only the selected layers changed" could be checked:
 * - `checked` — the request that produced this candidate is on record with a selection;
 * - `none` — the request is on record and nothing was selected (no selection constraint);
 * - `unknown` — the request is not on record for this base revision: the check cannot run, and the screen says so.
 */
export type ImageSelectionCheck = 'checked' | 'none' | 'unknown';

/** Objective checks use the immutable request revision, never the currently edited canvas. */
export function imageReviewChecks(source: ImageSourceDoc, candidate: ImageCandidate) {
  const changed = changedImageLayers(source.payload, candidate.payload);
  const requested = source.parameters.imageRequestRevision === candidate.baseRevision;
  const selection = requested && Array.isArray(source.parameters.imageSelection)
    ? source.parameters.imageSelection.filter((id): id is string => typeof id === 'string') : [];
  const selectionCheck: ImageSelectionCheck = !requested ? 'unknown' : selection.length ? 'checked' : 'none';
  // A selected layer moving in the stack also shifts neighboring indices; only its own move is a targeted edit.
  const shifted = candidate.payload.layers.filter((layer, index) => source.payload.layers[index]?.id !== layer.id);
  for (const layer of shifted) if ((!selection.length || selection.includes(layer.id)) && !changed.includes(layer.id)) changed.push(layer.id);
  const locked = source.payload.layers.filter((layer) => layer.locked);
  const checks = checkCreationRequirements(imagePayloadValue(source.payload), imagePayloadValue(candidate.payload), locked.map((layer) => ({
    id: layer.id, description: layer.name, kind: 'unchanged', pointer: imageLayerPointer(layer.id),
  })));
  const { layers: _beforeLayers, ...beforeCanvas } = source.payload;
  const { layers: _afterLayers, ...afterCanvas } = candidate.payload;
  const canvasChanged = creationStableJson(beforeCanvas) !== creationStableJson(afterCanvas);
  const outside = selection.length ? changed.filter((id) => !selection.includes(id)) : [];
  const order = (layers: ImageLayer[]) => layers.filter((layer) => !selection.includes(layer.id)).map((layer) => layer.id);
  const orderChanged = selection.length > 0 && creationStableJson(order(source.payload.layers)) !== creationStableJson(order(candidate.payload.layers));
  const protectedChanged = checks.some((check) => check.status === 'failed');
  return {
    changed, selection, outside, canvasChanged, orderChanged, protectedChanged, selectionCheck,
    selectedOnly: selection.length > 0 && !outside.length && !canvasChanged && !orderChanged,
    blocked: protectedChanged || (selection.length > 0 && (!!outside.length || canvasChanged || orderChanged)),
    /** Accepting without a selection check needs an explicit second confirmation. */
    needsConfirmation: selectionCheck === 'unknown',
  };
}
