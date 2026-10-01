import path from 'node:path';
import type { QueuedCommand } from '@vibisual/shared';
import { isWithinRoot, samePath } from './pathKey.js';

/** Queue/history references own submitted files, even when the client lost the reply. */
export function findReferencedCommandAttachment(
  filePath: string,
  attachmentDir: string,
  commands: readonly Pick<QueuedCommand, 'attachments'>[],
  recoverMovedUpload = false,
): string | undefined {
  const requested = path.resolve(filePath);
  const root = path.resolve(attachmentDir);
  if (!isWithinRoot(requested, root) || samePath(requested, root)) return undefined;
  const references = commands.flatMap((command) => command.attachments ?? [])
    .map((reference) => path.resolve(reference))
    .filter((reference) => isWithinRoot(reference, root) && !samePath(reference, root));
  const exact = references.find((reference) => samePath(reference, requested));
  if (exact) return exact;
  // Uploads have unique server-issued filenames. Only a missing original upload
  // may follow its move, and only through this session's actual command records.
  if (!recoverMovedUpload || !samePath(path.dirname(requested), root)) return undefined;
  const matches = references.filter((reference) => samePath(path.basename(reference), path.basename(requested)));
  const match = matches[0];
  return match && matches.every((reference) => samePath(reference, match)) ? match : undefined;
}
