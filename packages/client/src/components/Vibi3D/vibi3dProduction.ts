import { readVibi3DAuthoring, type CreationDoc, type Vibi3DParameter } from '@vibisual/shared';

export type ProductionValues = Record<string, string | number | boolean>;
export interface ProductionParameterRequest { documentId: string; revision: number; text: string }

/** Instructions for the existing coding CLI, never an execution path in the renderer or server. */
export function vibi3dProductionPrompt(projectId: string, documentId: string, mode: 'auto' | 'candidate' = 'auto'): string {
  return [
    'LOCAL CLI MODELING: prefer the installed Blender authoring kit for new geometry and substantial shape edits. Use this existing coding-agent session and its normal shell permissions; no MCP, separate AI session, external generation API, or automatic installation.',
    `GET /api/app/vibi3d/authoring/kit?projectId=${encodeURIComponent(projectId)} with the existing hook authentication. Read its protocol and manifest template. It returns blenderPath, projectRoot and files containing the worker and reusable recipe Python sources.`,
    `Use source document ${JSON.stringify(documentId)}. Write kit files and model.py into a new project-relative .vibisual/modeling/<docId>/<runId>/ directory; keep previous source files intact. Use the kit's resolved projectRoot, not a display name.`,
    mode === 'candidate'
      ? 'Set manifest.mode="candidate". This is a review request even if the source is empty: the result must remain a candidate and must never commit the current source. Follow the kit protocol for intermediate checkpoint publication.'
      : 'Set manifest.mode="auto". Only a document that was empty when this run began can receive committed checkpoints; an existing model receives a completed review candidate.',
    'Write model.py with def build(ctx). Read adjustable values from ctx.params[key]; define number/color/boolean parameter schemas with labels, bounds, steps and partIds in manifest.parameters. Use ctx.recipes.box/cylinder/torus/bevel/material where useful and Blender Python for requested geometry. Register every editable part with ctx.part(obj, stable_id); keep the same IDs between generations.',
    'Read any existing payload.authoring.source.script, manifest and baseline before modifying them. Prefer the saved generatorCode if the user edited its stored text. Preserve unrelated parts, materials, transforms, rigs, clips, userData and locks. Never reconstruct an imported rig or textured asset from primitives just to use this worker; use the existing data-edit path when it preserves the model better.',
    'Create manifest.json using the returned template: {projectId,projectRoot,docId,script:<relative model.py>,outputDir:<new relative run directory>,runId,parameters,input,publish:true,render:true,triangleBudget}. Run the resolved executable with argument-safe shell quoting: blender --background --factory-startup --python-exit-code 1 --python <kit>/vibi3d_worker.py -- --manifest <manifest.json>. The installed CLI owns process execution and stopping; the viewer only reads saved data.',
    'Expose real checkpoints with ctx.checkpoint(id,label,render=False): blockout (proportions), detail (parts and edges), material (surface), review (final, render=True). Save actual intermediate artifacts, not an animated imitation or a guessed percentage. During existing-model regeneration, intermediate checkpoints stay local; the worker merges and submits only its final complete checkpoint as a candidate, so unfinished construction never deletes later-built human-edited parts. Initially empty sources in auto mode publish valid intermediate revisions. Never accept a candidate yourself or commit over existing geometry.',
    'The worker performs publication automatically. Do not repeat a POST for a checkpoint it already published. The direct JSON commit/candidate instructions in this request apply only when using the built-in editing path instead of the worker.',
    'Keep native .blend, model.py, manifest, baseline and exported GLB references in payload.authoring. GLB is an exchange output, not the only editable source. Keep payload.generatorCode and parameter schemas in sync. Preserve authoring metadata on subsequent source edits.',
    'Check finite geometry, object/triangle counts and the configured triangle budget. Open and actually inspect the final multi-view renderPaths using the existing CLI image-reading capability, compare proportions, silhouette, assembly and material to the request, then repair and rerun if needed. Render generation alone is not visual verification; checks.visualReview stays pending. Report only checks you actually performed.',
    'If blenderPath is null, clearly report that local Blender was not found and use the existing built-in editable geometry path for the achievable result. Do not claim Blender quality or install anything. For a source already authored in Blender, preserve its program and explain the unavailable rebuild rather than pretending a built-in edit regenerated it.',
    'If a newer source revision or a conflict is reported, reread and recompute against it while keeping human edits. Never force overwrite, erase locks, or hide a failed checkpoint. Keep the source usable within the command budget.',
  ].join('\n');
}

export function validProductionValue(parameter: Vibi3DParameter, value: string | number | boolean): boolean {
  if (parameter.type === 'boolean') return typeof value === 'boolean';
  if (parameter.type === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return (parameter.min === undefined || value >= parameter.min) && (parameter.max === undefined || value <= parameter.max);
}

/** Only declared parameters can be requested; their exact source revision travels with the request. */
export function productionParameterRequest(document: CreationDoc, values: ProductionValues): ProductionParameterRequest | null {
  const authoring = readVibi3DAuthoring(document.payload);
  if (!authoring || !Object.keys(values).length) return null;
  const changes: ProductionValues = {};
  for (const [key, value] of Object.entries(values)) {
    const parameter = authoring.parameters[key];
    if (!parameter || !validProductionValue(parameter, value)) return null;
    if (value !== parameter.value) changes[key] = value;
  }
  if (!Object.keys(changes).length) return null;
  const partIds = [...new Set(Object.keys(changes).flatMap((key) => authoring.parameters[key]?.partIds ?? []))];
  return { documentId: document.id, revision: document.revision, text: [
    'Apply these exact parameter values to the existing local Blender source and propose the rebuilt result for review.',
    `Parameter edit: ${JSON.stringify({ documentId: document.id, baseRevision: document.revision, overrides: changes, partIds, source: authoring.source })}`,
    'Read the latest saved source first. If its revision changed, preserve newer human edits and recompute; do not apply stale values to a different source. Copy the manifest into a new run directory and update only the requested parameter values. Keep the generator program unless a change is necessary for these values.',
    'Keep all other parameters, stable part IDs, manual transforms/materials, protected objects and unrelated geometry. Set manifest.mode="candidate", run the local authoring worker, inspect the actual render images, and submit a candidate. Do not accept it yourself or write over the current source.',
  ].join('\n') };
}
