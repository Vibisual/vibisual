import { isReadOnlyHookAgent, samePath, type AgentConfig, type BubbleData, type PlatformName } from '@vibisual/shared';
import type { AudioDoc } from '@vibisual/audio';

export interface AudioDelegateContext {
  projectId: string;
  doc: AudioDoc;
  selectedClipId: string | null;
  selection: { start: number; end: number } | null;
  request: string;
  requestId: string;
}

/** Only the editable Claude agents belonging to this app's project can receive work. */
export function audioDelegateAgents(
  agents: readonly BubbleData[],
  projects: Readonly<Record<string, string>>,
  configs: Readonly<Record<string, AgentConfig>>,
  projectId: string,
  platform: PlatformName,
): BubbleData[] {
  if (!projectId) return [];
  return agents.filter((agent) => {
    const config = configs[agent.id];
    const owner = projects[agent.id];
    return agent.bubbleType === 'agent' && !!agent.path && !agent.trashed && !isReadOnlyHookAgent(agent)
      && !config?.provider && config?.executionMode !== 'interactive-terminal'
      && !!owner && samePath(owner, projectId, platform);
  });
}

/** This is an agent protocol, not a UI label. It includes references, never credentials or PCM. */
export function buildAudioDelegatePrompt(input: AudioDelegateContext): string {
  const clip = input.doc.tracks.flatMap((track) => track.clips).find((item) => item.id === input.selectedClipId);
  const route = `/api/app/vibisound/doc/${encodeURIComponent(input.doc.id)}`;
  const query = `?project=${encodeURIComponent(input.projectId)}`;
  return [
    'Edit the existing Vibisound document using its local document API.',
    `Request ID: ${input.requestId}`,
    'User request:', input.request.trim(), '',
    'Editor context (a snapshot, not the authoritative current document):',
    JSON.stringify({
      project: input.projectId, documentId: input.doc.id, version: input.doc.version,
      title: input.doc.title, selectedClipId: input.selectedClipId,
      selectionInProjectSeconds: input.selection,
      selectedClip: clip ? { id: clip.id, at: clip.at, sourceStart: clip.sourceStart, duration: clip.duration, locked: clip.locked === true } : null,
    }, null, 2), '',
    'Connection: use this session\'s VIBISUAL_BASE and the x-vibisual-hook-token header from VIBISUAL_TOKEN or VIBISUAL_HOOK_AUTH. Never print or embed credential values. If unavailable, report that the local connection is unavailable.',
    `First GET ${route}${query} to obtain the latest document and version. Also GET /api/app/vibisound/capabilities for supported operations and constraints.`,
    'The selection above is [start,end) in PROJECT timeline seconds. cropClip/deleteClipRange start/end and splitClip at are CLIP-LOCAL seconds: intersect with the latest selected clip and subtract its latest at. moveClip at is PROJECT seconds. sourceStart is SOURCE-ASSET seconds. Do not interchange these coordinates.',
    'Use stable track/clip/asset IDs. Preserve all unrelated clips, tracks, properties, source assets, and locked clips. Do not unlock or alter locked clips. If the selected target no longer exists or changed incompatibly, report it instead of guessing.',
    'Imported full clips use decoded PCM duration. Asset duration is container metadata and can include codec padding; do not extend source ranges beyond known decoded coverage without verifying the decoded bounds.',
    `POST ${route}/patch with JSON {"project":${JSON.stringify(input.projectId)},"baseVersion":<latest version>,"requestId":${JSON.stringify(input.requestId)},"ops":[<supported operations>]}.`,
    'On HTTP 409 read the latest document and reconsider the requested edit. Reuse a requestId only to retry the identical request; use a new requestId after changing the version or operations. Do not replace the entire document or write the document file directly.',
    'Read back the document after the patch and report the applied changes and version. Do not claim to have listened to audio. Do not install plugins, download models, call external providers, collect API keys, or generate/transcribe/separate audio with an unavailable provider.',
  ].join('\n');
}
