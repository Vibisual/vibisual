import type { AppAgentBrief, AppAgentBriefArgs } from '../../apps/registry.js';
import { AppAgentPreparationError } from '../../apps/registry.js';
import { fetchWorkspaceMediaBlob } from '../../utils/workspaceMedia.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { newImageDocument, newImageLayer } from '../Creation/imageSource.js';
import { loadImage } from '../Creation/imageRender.js';
import { createImageDoc, readImageDoc, type ImageSourceDoc } from './imageApi.js';
import { importedImageSource } from './imageImport.js';

const API = '/api/app/creation';

export function imageAgentPrompt(doc: ImageSourceDoc, projectId: string, request: string, selected: string, quality: 'draft' | 'refine'): string {
  const layer = doc.payload.layers.find((item) => item.id === selected);
  const selectedLayer = layer
    ? { ...layer, ...(layer.source && !layer.source.startsWith('vibi-blob:') && layer.source.length > 500 ? { source: '<embedded raster; read the source document>' } : {}) }
    : null;
  const project = encodeURIComponent(projectId);
  return [
    'Create or edit an editable Vibimage source. Use the existing coding agent and SVG layer renderer; no paid image API is required.',
    `User request: ${JSON.stringify(request)}`,
    `Context: ${JSON.stringify({ projectId, sourceId: doc.id, baseRevision: doc.revision, quality, selectedLayer,
      lockedLayerIds: doc.payload.layers.filter((item) => item.locked).map((item) => item.id) })}`,
    'Connection: use VIBISUAL_BASE and x-vibisual-hook-token from VIBISUAL_TOKEN or VIBISUAL_HOOK_AUTH. Never print credentials.'
      + ' Use your session hook-listener fallback if environment is absent.',
    `GET ${API}/docs/${doc.id}?projectId=${project} returns {ok,doc}. Read this before editing. Cheap change check: GET ${API}/docs/${doc.id}/head?projectId=${project}.`
      + ' Do not change a revision newer than the context above; tell the user the source changed.',
    'doc.payload is {format:"vibimage",version:1,width,height,background,style:{fontFamily,foreground,accent,margin},layers:[...]}.',
    'Each layer: {id,kind:"text"|"shape"|"image",name,x,y,width,height,fill:"#rrggbb",opacity:0..1,locked:boolean,visible:boolean,anchor:"start"|"center"|"end"}.',
    'text additionally has {text,fontSize,fontFamily,align:"left"|"center"|"right"}; the app wraps text with real font widths inside the layer width'
      + ' (words for spaced scripts, characters for Korean/Chinese/Japanese). shape has {shape:"rect"|"ellipse"}.',
    'image has {source, fit?:"contain"|"cover"}. source is "vibi-blob:<sha256>.<ext>" (stored picture — keep it unchanged),'
      + ' a data:image/... URL for a NEW picture (the server stores it as a blob), or a project-relative path. Preserve stable ids.'
      + ' The layer array is back to front. Coordinates and dimensions are output pixels.',
    'Images imported from photos remain ONE image layer. Never claim hidden text/object layers were recovered from a flattened photo. Create text/shape layers separately.',
    'Preserve locked elements, manually edited values, sources and unrelated layers. For a selected-only request change only the selected stable ID.'
      + ' Keep the current output dimensions unless requested otherwise. sourceOriginal is optional provenance; preserve it.',
    `POST ${API}/docs/${doc.id}/candidates with {projectId:${JSON.stringify(projectId)},baseRevision:${doc.revision},requestId:"<new UUID>",`
      + `payload:<complete edited payload>,label:"<what changed>",input:${JSON.stringify(request)}} creates a proposal for side-by-side comparison.`
      + ' Do NOT commit or accept it; the user adopts it in the app.',
    'A proposal built on an older revision is refused (409 stale-base): read the latest source and propose again. A 409 candidate-limit means the user must'
      + ' review or clean up proposals first — say so instead of retrying. Reuse requestId only for an uncertain transport retry of the same proposal.',
    quality === 'draft'
      ? 'Make one quick editable draft. Keep the pass small; no exhaustive alternatives or external rendering. This request runs under a turn and time limit.'
      : 'Refine this source while preserving its established layout and style. Do not regenerate unrelated layers.',
    'Do not modify the Vibisual repository, install dependencies, restart the app or run arbitrary generated code. SVG output is produced by the app.'
      + ' Report what you actually changed and any visual checks still needed.',
  ].join('\n');
}

export async function buildVibimageBrief(args: AppAgentBriefArgs): Promise<AppAgentBrief | null> {
  try { return await prepareImageBrief(args); }
  catch { throw new AppAgentPreparationError('image-source-unavailable'); }
}

async function prepareImageBrief(args: AppAgentBriefArgs): Promise<AppAgentBrief> {
  // Failed reads must not silently replace an existing source with a new empty document.
  const payload = newImageDocument();
  if (!args.bubble.ref && args.bubble.file) {
    const blob = await fetchWorkspaceMediaBlob(args.projectId, args.bubble.file);
    if (!blob) throw new CreationUiError('image-source-unavailable');
    const source = await importedImageSource(blob);
    const image = await loadImage(source);
    if (!image.naturalWidth || !image.naturalHeight) throw new CreationUiError('image-source-invalid');
    const scale = Math.min(1, 8192 / image.naturalWidth, 8192 / image.naturalHeight);
    payload.width = Math.max(16, Math.round(image.naturalWidth * scale)); payload.height = Math.max(16, Math.round(image.naturalHeight * scale));
    payload.background = 'transparent';
    // The picture travels inline and is stored as a content-addressed blob under .vibisual — the project folder is untouched.
    payload.layers = [{ ...newImageLayer(payload, 'image', args.bubble.file), x: 0, y: 0, width: payload.width, height: payload.height,
      source, sourceOriginal: args.bubble.file }];
  }
  const doc = args.bubble.ref ? await readImageDoc(args.projectId, args.bubble.ref)
    : await createImageDoc(args.projectId, args.bubble.title ?? args.bubble.label, payload);
  return { ref: doc.id, text: imageAgentPrompt(doc, args.projectId, 'Follow the user request associated with this node.', '', 'draft') };
}
