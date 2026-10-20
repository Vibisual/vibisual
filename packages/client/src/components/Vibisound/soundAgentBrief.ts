import type { AppAgentBriefBuilder } from '../../apps/registry.js';
import { AppAgentPreparationError } from '../../apps/registry.js';
import { buildAudioDelegatePrompt } from './audioDelegate.js';
import { readSoundDoc } from './soundApi.js';
import { prepareSoundTaskDocument } from './soundTaskDocument.js';

/** A linked sound task edits its document, rather than exporting over the old result file. */
export const buildSoundAgentBrief: AppAgentBriefBuilder = async (args) => {
  try {
    const target = args.bubble.ref ? { ref: args.bubble.ref } : await prepareSoundTaskDocument({
      projectId: args.projectId, projectName: args.projectName,
      mode: args.bubble.file ? 'copy' : 'new', source: args.bubble,
      title: args.bubble.title?.trim() || args.bubble.label,
      requestId: `bubble-${args.bubble.id}`,
    });
    if (!target.ref) throw new Error('missing-audio-document');
    const { doc } = await readSoundDoc(args.projectName || args.projectId, target.ref);
    return { ref: doc.id, text: [
      `- node ${args.bubble.id} · Vibisound ${JSON.stringify(args.bubble.label)} · AUDIO DOCUMENT ${JSON.stringify(doc.id)}`,
      buildAudioDelegatePrompt({ projectId: args.projectName || args.projectId, doc, selectedClipId: null, selection: null,
        request: args.request, requestId: `sound-${crypto.randomUUID()}` }),
      'Edit only this document. Other task documents and prior exports remain separate. Do not export audio unless the user explicitly requests it.',
    ].join('\n') };
  } catch {
    throw new AppAgentPreparationError('vibisound-source-unavailable');
  }
};
