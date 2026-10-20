import type { Express } from 'express';
import type { Vibi3DAuthoringKit } from '@vibisual/shared';
import { findBlender } from './vibi3dAuthoringBlender.js';
import { VIBI3D_IO_PY } from './vibi3dAuthoringIo.js';
import { VIBI3D_WORKER_PY } from './vibi3dAuthoringWorker.js';
import { VIBI3D_EXPORT_PY } from './vibi3dAuthoringExport.js';
import { VIBI3D_MERGE_PY } from './vibi3dAuthoringMerge.js';
import { VIBI3D_SCENE_PY } from './vibi3dAuthoringScene.js';
import { VIBI3D_EXAMPLE_PY, VIBI3D_RECIPES_PY } from './vibi3dAuthoringRecipes.js';

export function authoringKit(projectId: string, projectRoot: string, blenderPath: string | null): Vibi3DAuthoringKit {
  return {
    version: 1, projectRoot, blenderPath,
    files: {
      'vibi3d_worker.py': VIBI3D_IO_PY + VIBI3D_WORKER_PY,
      'vibi3d_export.py': VIBI3D_EXPORT_PY + VIBI3D_MERGE_PY + VIBI3D_SCENE_PY,
      'vibi3d_recipes.py': VIBI3D_RECIPES_PY,
      'model.py': VIBI3D_EXAMPLE_PY,
    },
    manifest: {
      projectId, projectRoot, docId: 'replace-with-source-doc-id', script: '.vibisual/modeling/model.py',
      outputDir: '.vibisual/modeling/replace-with-source-doc-id', runId: 'replace-with-unique-run-id',
      mode: 'auto', publish: true, render: true, triangleBudget: 200_000,
      parameters: {
        width: { label: 'Width', type: 'number', value: 1.6, min: 0.5, max: 4, step: 0.05, partIds: ['body', 'lid'] },
        bodyColor: { label: 'Body color', type: 'color', value: '#304a66', partIds: ['body', 'lid'] },
      },
    },
    protocol: [
      'Use the existing coding CLI to write these four files in a project-contained work folder. Never execute model source in the browser or the app server.',
      'Invoke the detected Blender executable directly with argv: --background --factory-startup --python-exit-code 1 --python <absolute vibi3d_worker.py> -- --manifest <absolute manifest.json>. Do not add a shell wrapper.',
      'Keep VIBISUAL_BASE and VIBISUAL_TOKEN or VIBISUAL_HOOK_AUTH in environment only; the worker contacts authenticated HTTP loopback only. No MCP or external generation API is used.',
      'The model.py must define build(ctx). ctx.params gives declared parameter values; ctx.recipes provides box/cylinder/torus/group/bevel/material; ctx.part assigns stable ids to your own bpy objects.',
      'Call ctx.checkpoint(id,label) after valid proportions and details stages. IDs must be unique and filesystem-safe. The worker adds complete after build returns, with front/side/perspective PNG renders.',
      'Read the current creation document before editing; reuse payload.authoring.source.script and parameters, preserve ids, and use a fresh runId for every execution. Work lives under .vibisual/modeling, not the creation store directory.',
      'Manifest mode:candidate forces review even for an empty source. Auto mode commits stages only when the initial source is empty. Existing-model rebuilds keep intermediate checkpoints as local artifacts and submit only the final complete candidate, so not-yet-built parts are not mistaken for deletions. Any intervening user revision stops the run.',
      'Immutable checkpoint folders retain Python, manifest, raw generated baseline, editable native .blend, GLB, source.json and real PNGs. The native file includes the original generator scene plus an assembled checkpoint scene; modifiers stay editable.',
      'Three-way merge preserves independent human edits and locks. Conflicts fail instead of overwriting. Static BufferGeometry/Group sources are supported; animated/skinned models, unsupported material maps or conflicting native geometry must use the existing built-in editor workflow.',
      'Treat checks.visualReview=pending honestly. Open the produced PNGs with your image-reading tool, compare all views with the request, and repair the script/parameters in a new run before claiming visual quality.',
      'With publish:false the worker writes only project files, without network or token access. Optional sourceDocument is a project-relative saved creation document for offline merge checks. render:false skips PNGs and never claims visual review.',
      'If blenderPath is null, report local Blender availability and use the existing built-in Vibi3D authoring path. Do not silently download Blender or replace editable sources with a preview file.',
    ],
  };
}

/** Read-only kit distribution. This route never starts a subprocess or executes supplied Python. */
export function mountVibi3DAuthoringRoutes(
  app: Express,
  host: { resolveProjectPath(raw: unknown): string | null },
  locate: () => string | null = findBlender,
): void {
  app.get('/authoring/kit', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const projectId = req.query['projectId'];
    const root = typeof projectId === 'string' ? host.resolveProjectPath(projectId) : null;
    if (!root || typeof projectId !== 'string') { res.status(404).json({ ok: false, error: 'project-not-found' }); return; }
    try { res.json({ ok: true, ...authoringKit(projectId, root, locate()) }); }
    catch { res.status(500).json({ ok: false, error: 'blender-discovery-failed' }); }
  });
}
