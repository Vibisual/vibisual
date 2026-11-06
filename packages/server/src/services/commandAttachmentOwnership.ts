import path from 'node:path';
import type { QueuedCommand } from '@vibisual/shared';
import { isWithinRoot, samePath } from './pathKey.js';

/** Queue/history references own submitted files, even when the client lost the reply. */
export function findReferencedCommandAttachment(
  filePath: string,
  attachmentDir: string,
  commands: readonly Pick<QueuedCommand, 'attachments' | 'followUps'>[],
  recoverMovedUpload = false,
): string | undefined {
  const requested = path.resolve(filePath);
  const root = path.resolve(attachmentDir);
  if (!isWithinRoot(requested, root) || samePath(requested, root)) return undefined;
  const references = commands.flatMap((command) => [
    ...(command.attachments ?? []),
    ...(command.followUps ?? []).flatMap((followUp) => followUp.attachments ?? []),
  ])
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

export type CommandAttachmentCheck =
  | { ok: true; valid: string[]; owned: Set<string> }
  | { ok: false; missing: string[] };

/**
 * 제출한 첨부를 확정한다 — 하나라도 이 세션 첨부 폴더 밖이거나 디스크에 없으면 명령 전체를 거절한다.
 * 조용히 빼고 글만 실행하면 사용자는 이미지를 보냈다고 믿는다. 접수된 명령이 옮긴 원본만 그 기록으로 되찾는다(폴더 훑기 ❌).
 * `owned` 는 이미 다른 명령이 가리키는 파일이라 다시 옮기면 안 된다.
 */
export function resolveCommandAttachments(
  attachments: readonly unknown[],
  attachmentDir: string | null,
  commands: readonly Pick<QueuedCommand, 'attachments' | 'followUps'>[],
  fileExists: (filePath: string) => boolean,
): CommandAttachmentCheck {
  const valid: string[] = [];
  const owned = new Set<string>();
  const missing: string[] = [];
  const root = attachmentDir ? path.resolve(attachmentDir) : null;
  for (const attachment of attachments) {
    if (typeof attachment !== 'string') { missing.push(String(attachment)); continue; }
    const resolved = path.resolve(attachment);
    if (!root || !isWithinRoot(resolved, root) || samePath(resolved, root)) { missing.push(attachment); continue; }
    const exists = fileExists(resolved);
    const reference = findReferencedCommandAttachment(resolved, root, commands, !exists);
    if (!exists && (!reference || !fileExists(reference))) { missing.push(attachment); continue; }
    const candidate = reference ?? resolved;
    valid.push(candidate);
    if (reference) owned.add(candidate);
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, valid, owned };
}
