import type { AgentSessionInputDraft } from './graphStore.js';

interface PersistedAttachment {
  tempId: string;
  serverPath: string;
}

interface PersistedDraft {
  text: string;
  attachments: PersistedAttachment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uploadedAttachments(value: unknown): PersistedAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: PersistedAttachment[] = [];
  for (const attachment of value) {
    if (!isRecord(attachment) || attachment.uploading || attachment.error) continue;
    const { tempId, serverPath } = attachment;
    if (typeof tempId !== 'string' || tempId.trim().length === 0
      || typeof serverPath !== 'string' || serverPath.trim().length === 0
      || /^\s*blob:/i.test(serverPath)) continue;
    // Browser-owned previews and transient upload/send state cannot survive a reload.
    attachments.push({ tempId, serverPath });
  }
  return attachments;
}

/** Accept both legacy text-only storage and drafts with completed image uploads. */
export function decodeSessionInputDrafts(value: unknown): Record<string, AgentSessionInputDraft> {
  if (!isRecord(value)) return {};
  const entries: Array<[string, AgentSessionInputDraft]> = [];
  for (const [key, stored] of Object.entries(value)) {
    if (typeof stored === 'string') {
      if (stored.length > 0) entries.push([key, { text: stored, attachments: [] }]);
      continue;
    }
    if (!isRecord(stored)) continue;
    const text = typeof stored.text === 'string' ? stored.text : '';
    const attachments = uploadedAttachments(stored.attachments)
      .map((attachment) => ({ ...attachment, previewUrl: '', uploading: false }));
    if (text.length > 0 || attachments.length > 0) entries.push([key, { text, attachments }]);
  }
  return Object.fromEntries(entries);
}

/** Persist only durable fields; an image-only draft is still an unsent draft. */
export function encodeSessionInputDrafts(
  drafts: Record<string, AgentSessionInputDraft>,
): Record<string, PersistedDraft> {
  const entries: Array<[string, PersistedDraft]> = [];
  for (const [key, draft] of Object.entries(drafts)) {
    const attachments = uploadedAttachments(draft.attachments);
    if (draft.text.length > 0 || attachments.length > 0) {
      entries.push([key, { text: draft.text, attachments }]);
    }
  }
  return Object.fromEntries(entries);
}
