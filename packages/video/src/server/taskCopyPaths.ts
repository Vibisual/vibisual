/** Copy namespaces contain a mirrored project tree, so relative code imports keep working. */
export function taskCopyNamespaceOf(relative: string): string | null {
  return /^(\.vibisual\/video\/task-copies\/[a-f0-9-]{36}\/)/.exec(relative.replace(/\\/g, '/'))?.[1] ?? null;
}
