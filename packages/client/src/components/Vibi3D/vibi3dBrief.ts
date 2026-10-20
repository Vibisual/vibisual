import * as THREE from 'three';
import { readVibi3DAuthoring } from '@vibisual/shared';
import { AppAgentPreparationError } from '../../apps/registry.js';
import { prepareVibi3DRun, vibi3DResumePrompt } from './vibi3dWorkflow.js';
import { vibi3dAgentPrompt } from './vibi3dAgentPrompt.js';
import type { AppAgentBrief, AppAgentBriefArgs } from '../../apps/registry.js';
import { disposeModel, loadWorkspaceModel } from './modelIO.js';
import { serializeModelSource, readModelDocument, saveModelDocument } from './modelSource.js';
import { vibi3dProductionPrompt } from './vibi3dProduction.js';
import { requestsVibi3DBlender } from './vibi3dAuthoringChoice.js';

/** Owns the app-specific source format; the core only stores the returned ref. */
export async function buildVibi3DBrief({ projectName, projectId, bubble, request }: AppAgentBriefArgs): Promise<AppAgentBrief | null> {
  let document;
  try {
    if (bubble.ref) document = await readModelDocument(projectName, bubble.ref);
    else {
      const loaded = bubble.file ? await loadWorkspaceModel(projectName, bubble.file) : { object: new THREE.Group(), clips: [] };
      loaded.object.name ||= bubble.title || bubble.label || 'Model';
      try { document = await saveModelDocument(projectName, null, loaded.object.name, serializeModelSource(loaded.object, loaded.clips)); }
      finally { disposeModel(loaded.object); }
    }
  } catch { throw new AppAgentPreparationError('vibi3d-source-unavailable'); } // Never replace an existing source after a failed read.
  const blender = !!readVibi3DAuthoring(document.payload) || requestsVibi3DBlender(request);
  if (!blender) {
    const prepared = await prepareVibi3DRun(projectId, document.id);
    const workDraft = !!prepared.snapshot.document?.dirty && prepared.snapshot.document.humanDirty === false;
    return { ref: document.id, executionRequirements: { localTransport: true, runLimits: { maxTurns: 160, maxMinutes: 120 } },
      text: [`- node ${bubble.id} · Vibi3D EDITABLE MODEL · source ${document.id} · project ${JSON.stringify(projectName)}.`,
        vibi3dAgentPrompt(prepared.snapshot, request, { workDraft }),
        ...(prepared.run ? [`Run context: ${JSON.stringify(prepared.run)}`] : []),
        vibi3DResumePrompt(prepared.previousRun),
        'Preserve payload.generatorCode, payload.authoring, conditions, doc.links, pinned source revisions, look, shots and stable object/recipe IDs. Use direct creation JSON only for data the native commands cannot express.',
      ].join('\n') };
  }
  const path = `/api/app/creation/docs/${encodeURIComponent(document.id)}`;
  return { ref: document.id, text: [
    `- node ${bubble.id} · Vibi3D EDITABLE MODEL · source ${document.id} · project ${JSON.stringify(projectName)} · revision ${document.revision}.`,
    'Create and edit the requested geometry using your existing coding capability and the installed local authoring tools. Never replace a model with a flat image.',
    'Authenticate with x-vibisual-hook-token from VIBISUAL_TOKEN or VIBISUAL_HOOK_AUTH and VIBISUAL_BASE. Never print credentials.',
    vibi3dProductionPrompt(projectName, document.id),
    `Read GET ${path}?projectId=${encodeURIComponent(projectName)} before editing. For an empty source, commit the first editable draft with POST ${path}/commit {projectId,baseRevision:<latest>,requestId:<UUID>,payload,label}.`,
    `For revisions to an existing source, propose POST ${path}/candidates {projectId,baseRevision:<latest>,requestId:<UUID>,payload,label,input}; the user previews Before/After and accepts it in Vibi3D. Never accept a candidate yourself.`,
    'A 409 stale-base or revision-conflict means preserve the new human edits and recompute from the latest revision; never force overwrite. A 409 candidate-limit means the user must review or clean up waiting proposals first — report it, do not retry.',
    'payload format is {format:"vibi3d",version:1,scene:<Three Object3D JSON>,clips:<AnimationClip JSON[]>}. ObjectLoader parses this as data. Keep geometry/material/texture/skeleton/animation data not involved in the request and preserve every existing UUID and userData.vibi3dId.',
    'Large data is stored as "vibi-blob:<sha256>.<ext>" references (geometry arrays, embedded images). Keep references of unchanged data; send new arrays or data:image URLs inline and the server stores them. GET /api/app/creation/guide explains the blob endpoints.',
    'Store the generation program as payload.generatorCode (text, never executed by the viewer), local rebuild parameters in payload.authoring.parameters and built-in dimensions in object recipes, '
      + 'references in doc.links, and production conditions in payload.conditions. Preserve this source metadata on every edit. Run generation code only under '
      + 'the existing coding-agent sandbox/file rules.',
    'For a new source, scene={metadata:{version:4.7,type:"Object",generator:"Vibi3D"},geometries:[],materials:[],'
      + 'object:{uuid:<UUID>,type:"Group",name:"Product",matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],children:[]}}. Add Mesh children with '
      + 'uuid,name,geometry:<geometry UUID>,material:<material UUID>,matrix and userData:{vibi3dId:<stable ID>,vibi3dRecipe:<recipe>}.',
    'Geometry JSON may use BoxGeometry(width,height,depth), SphereGeometry(radius,widthSegments,heightSegments), '
      + 'CylinderGeometry(radiusTop,radiusBottom,height,radialSegments) or explicit BufferGeometry data. Material JSON uses '
      + '{uuid,type:"MeshStandardMaterial",color:<integer RGB>,roughness,metalness,opacity}. Geometry recipes preserve adjustable dimensions: '
      + '{kind:"box",width,height,depth}, {kind:"cylinder",radius,radiusTop,height}, {kind:"sphere",radius}, or lathe/extrude/path points. Keep recipe and actual geometry parameters consistent.',
    'Read lockedPaths and object.userData.vibi3dLocked; preserve them — the server refuses a proposal or commit that changes a locked path (409 '
      + 'locked-element-changed). Modify only the selected/requested object. For imported rigs and morphs, edit transforms/materials while preserving geometry and animation bindings.',
    'Textures must be embedded data:image URLs, blob references or serialized image pixel data; arbitrary network URLs are rejected. Image source links belong in doc.links with id/sourceId/sourceRevision/role/targets; only the user changes a link revision or keeps an older one.',
    'Camera authoring is a PerspectiveCamera child with userData.vibi3dViewCamera=true plus root userData.vibi3dCamera={position:[x,y,z],target:[x,y,z]}; a '
      + 'keyed camera path is a clip named "Vibi3D:camera:<name>" on that camera with root userData.vibi3dCameraMotion={name,keys:[{time,position,target}]}.',
    'Object motions are clips named "Vibi3D:<vibi3dId>:<name>" with tracks "<object uuid>.position|quaternion|scale" (times in seconds) and the editable keys in userData.vibi3dMotions={<name>:[{time,position?,rotation?(degrees),scale?}]}. Keep authored clips in payload.clips.',
    'Lights are three Light objects (DirectionalLight, PointLight, SpotLight, HemisphereLight, AmbientLight) with userData.vibi3dId and userData.vibi3dLight=true. A model with its own lights replaces the matching studio light in every view and output.',
    'After a commit the app reloads only if it has no unsaved human changes; otherwise it preserves the scene and reports the conflict. Ask the user to review this source in Vibi3D. Claim visual verification only if you inspected an actual rendered view.',
  ].join('\n') };
}
