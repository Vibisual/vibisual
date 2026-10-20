import { useAppWindowsStore } from './appWindows.js';
import { finishAppWindowTransfer, hasAppWindowTransferGuard, prepareAppWindowTransfer } from './appWindowTransfer.js';
import { matchesTaskWindow, prepareOutsideTaskWindow, type TaskWindowTarget } from './appTaskWindowBridge.js';
import { getInternalApp, type AppTaskTarget } from './registry.js';

export interface AppTaskTransitionArgs {
  readonly projectId: string;
  readonly projectName: string;
  readonly appId: string;
  readonly bubble: AppTaskTarget & { readonly id: string; readonly title?: string | undefined };
  readonly mode: 'new' | 'copy';
  readonly title?: string | undefined;
  readonly requestId?: string | undefined;
}
export interface AppTaskTransitionResult { readonly previous: AppTaskTarget; readonly next: AppTaskTarget }

/** Save live editors first; only then allocate a separate document. Never rebind or clear the source node. */
export async function prepareAppTaskTransition(args: AppTaskTransitionArgs): Promise<AppTaskTransitionResult> {
  const app = getInternalApp(args.appId);
  if (!app?.taskDocument) throw new Error('app-task-unsupported');
  const target: TaskWindowTarget = { appId: args.appId, projectId: args.projectId, bubbleId: args.bubble.id,
    ref: args.bubble.ref, file: args.bubble.file };
  let previous: AppTaskTarget = { ref: args.bubble.ref, file: args.bubble.file };
  const windows = useAppWindowsStore.getState();
  const inside = windows.windows.filter(win => matchesTaskWindow(win, target));
  // More than one live owner can carry conflicting unsaved edits; do not guess which one to copy.
  const outside = windows.outside.filter(win => matchesTaskWindow(win, target));
  if (inside.length + outside.length > 1) throw new Error('app-task-multiple-editors');
  const live = inside[0];
  if (live) {
    if (!hasAppWindowTransferGuard(live.id) || !await prepareAppWindowTransfer(live.id)) throw new Error('app-task-save-failed');
    try {
      const saved = useAppWindowsStore.getState().windows.find(win => win.id === live.id);
      if (!saved || !matchesTaskWindow(saved, target)) throw new Error('app-task-source-changed');
      previous = { ref: saved.ref, file: saved.file };
    } finally { finishAppWindowTransfer(live.id); }
  } else if (outside.length) previous = await prepareOutsideTaskWindow(target);
  const build = await app.taskDocument();
  const next = await build({ projectId: args.projectId, projectName: args.projectName, mode: args.mode,
    source: previous, title: args.title ?? args.bubble.title ?? app.name, requestId: args.requestId ?? crypto.randomUUID() });
  if (!next.ref && !next.file) throw new Error('app-task-document-missing');
  return { previous, next };
}
