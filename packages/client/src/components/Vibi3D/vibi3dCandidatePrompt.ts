import { readVibi3DAuthoring, type CreationDoc, type Vibi3DSnapshot } from '@vibisual/shared';
import { vibi3dAgentPrompt } from './vibi3dAgentPrompt.js';
import { vibi3dProductionPrompt } from './vibi3dProduction.js';
import { requestsVibi3DBlender } from './vibi3dAuthoringChoice.js';

export function vibi3dCandidatePrompt(snapshot: Vibi3DSnapshot, document: CreationDoc, request: string, rebuild = false): string {
  if (!rebuild && !readVibi3DAuthoring(document.payload) && !requestsVibi3DBlender(request)) return [
    vibi3dAgentPrompt(snapshot, request),
    `Proposal source: ${JSON.stringify({ id: document.id, baseRevision: document.revision, selectedId: snapshot.selectedId })}`,
    'This request requires a final Before/After proposal. Use native commands in the live work scene and propose {label} once when complete. Never accept your own candidate.',
    'Preserve payload.generatorCode, payload.authoring, production conditions, doc.links, look, shots and all unrelated geometry/material/texture/animation data.',
  ].join('\n');
  const base = `/api/app/creation/docs/${encodeURIComponent(document.id)}`;
  return [
    'Propose a reviewable alternative for this editable Vibi3D source. The user will compare it and choose Accept. Do not modify the live scene or commit the source directly.',
    `User request: ${JSON.stringify(request.trim())}`,
    `Source: ${JSON.stringify({ projectId: snapshot.projectId, id: document.id, sourceRevision: document.revision, selectedId: snapshot.selectedId })}`,
    `Selected objects: ${JSON.stringify(snapshot.nodes.filter((node) => node.id === snapshot.selectedId))}`,
    'Use VIBISUAL_BASE and x-vibisual-hook-token from VIBISUAL_TOKEN or VIBISUAL_HOOK_AUTH. Never print credentials.',
    `First GET ${base}?projectId=${encodeURIComponent(snapshot.projectId)}. If its revision differs from the context, preserve newer human edits and recompute the proposal from that latest document.`,
    vibi3dProductionPrompt(snapshot.projectId, document.id, 'candidate'),
    'The payload is {format:"vibi3d",version:1,scene:<Three Object3D.toJSON()>,clips:<AnimationClip JSON[]>}. Update only the requested objects, their geometry/material resources and vibi3dRecipe dimensions.'
      + ' Preserve all other UUIDs, stable userData.vibi3dId values, imported textures, animations and user edits. This is JSON data, never executable source.',
    'Large data (geometry arrays, embedded images) is stored as "vibi-blob:<sha256>.<ext>" references. Keep the references of everything you do not change;'
      + ' send new arrays or data:image URLs inline and the server stores them (GET /api/app/creation/guide explains the blob endpoints).',
    'Never change lockedPaths or objects with userData.vibi3dLocked=true, including protected descendants: the server refuses such a proposal (409 locked-element-changed with the pointer).'
      + ' Keep unchanged generated geometry dimensions and recipe parameters consistent.',
    'Preserve payload.generatorCode, payload.authoring, production conditions and other source metadata. Update the stored generator program only for the requested change. The viewer never executes it; local rebuilds run through the existing coding CLI.',
    `Inspect the current rendered view through GET /api/app/vibi3d/sessions/${encodeURIComponent(snapshot.sessionId)}/image if available. Download and inspect an actual image before claiming visual verification.`,
    `POST ${base}/candidates {projectId:${JSON.stringify(snapshot.projectId)},baseRevision:<revision just read>,requestId:<new UUID>,payload:<complete edited JSON payload>,label:<short change title>,input:${JSON.stringify(request.trim())}}.`,
    'On network uncertainty reuse requestId. A 409 stale-base means the source changed after you read it: read the latest revision, keep the newer human edits and propose again.'
      + ' A 409 candidate-limit means too many proposals are waiting: tell the user to review, discard or clean up old proposals in Vibi3D — do not retry.',
    'Never accept your own candidate; acceptance is the user’s action in Vibi3D.',
    'Finish with the actual changed object names and the proposed version. Request does not authorize any installation, application rebuild, external generation service, or unrelated scene regeneration.',
  ].join('\n');
}
