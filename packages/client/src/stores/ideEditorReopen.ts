import type { IDEEditorFile, IDEOverlayState } from './graphStore.js';
import { pruneEditorTabScopes, switchEditorTabScope, type EditorTabScopeState } from './editorTabScope.js';

/** Closed owners, oldest first. This is renderer-local UI state, not document storage. */
export const IDE_EDITOR_REOPEN_MAX = 32;

export interface IDEEditorReopenState extends EditorTabScopeState {
  projectId: string;
  agentId: string;
  activeSessionId: string | null;
}

/** Drafts live in the unmounted editor, so a reopened file must not retain a dirty badge. */
function reopenFiles(files: readonly IDEEditorFile[]): IDEEditorFile[] {
  return files.map(({ dirty: _dirty, ...file }) => ({ ...file }));
}

export function forgetIDEEditorTabs(
  history: readonly IDEEditorReopenState[],
  projectId: string,
  agentId: string,
): IDEEditorReopenState[] {
  return history.filter((entry) => entry.projectId !== projectId || entry.agentId !== agentId);
}

/** Keep tab metadata when its pane is closed or reused for a different owner. */
export function rememberIDEEditorTabs(
  history: readonly IDEEditorReopenState[],
  pane: IDEOverlayState,
): IDEEditorReopenState[] {
  if (!pane.agentId || !pane.projectId) return [...history];
  const next = forgetIDEEditorTabs(history, pane.projectId, pane.agentId);
  const editorTabsBySession = Object.fromEntries(
    Object.entries(pane.editorTabsBySession)
      .filter(([, stash]) => stash.files.length > 0)
      .map(([key, stash]) => [key, { files: reopenFiles(stash.files), activePath: stash.activePath }]),
  );
  // An explicitly emptied pane must replace any older remembered tabs with nothing.
  if (pane.editorFiles.length === 0 && Object.keys(editorTabsBySession).length === 0) return next;
  next.push({
    projectId: pane.projectId,
    agentId: pane.agentId,
    activeSessionId: pane.activeSessionId,
    editorFiles: reopenFiles(pane.editorFiles),
    activeEditorPath: pane.activeEditorPath,
    editorPinned: pane.editorPinned,
    editorTabsBySession,
  });
  return next.slice(-IDE_EDITOR_REOPEN_MAX);
}

/** Restore only this owner's tabs, respecting deleted sessions and an explicit main view. */
export function restoreIDEEditorTabs(
  saved: IDEEditorReopenState,
  fallbackSessionId: string | null,
  liveSessionIds: readonly string[],
): EditorTabScopeState & { activeSessionId: string | null } {
  const activeSessionId = saved.activeSessionId === null || liveSessionIds.length === 0 || liveSessionIds.includes(saved.activeSessionId)
    ? saved.activeSessionId
    : fallbackSessionId;
  const scoped = switchEditorTabScope(saved, saved.activeSessionId, activeSessionId);
  return {
    activeSessionId,
    editorFiles: scoped.editorFiles,
    // The stage is not restored here. Its null selection must not hide surviving file tabs.
    activeEditorPath: scoped.editorFiles.some((file) => file.relPath === scoped.activeEditorPath)
      ? scoped.activeEditorPath
      : (scoped.editorFiles[0]?.relPath ?? null),
    editorPinned: scoped.editorPinned,
    editorTabsBySession: liveSessionIds.length > 0
      ? pruneEditorTabScopes(scoped.editorTabsBySession, liveSessionIds)
      : scoped.editorTabsBySession,
  };
}
