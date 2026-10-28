import { useEffect, useRef } from 'react';
import { useAppWindowsStore } from './appWindows.js';
import { APP_BUBBLE_PARAM, appShellParams, getInternalApp } from './registry.js';
import { finishAppWindowTransfer, registerAppWindowTransferGuard, trackAppWindowTargetUpdate } from './appWindowTransfer.js';
import { formChangeMove } from './appNodeForm.js';
import { useGraphStore } from '../stores/graphStore.js';
import { prepareAppWindowTransfer } from './appWindowTransfer.js';
import { registerTaskWindowResponder } from './appTaskWindowBridge.js';

type Params = Readonly<Record<string, string>>;
interface Target { ref?: string | undefined; file?: string | undefined; draftKey?: string | undefined }
const currentTargets = new Map<string, Target>();

/** The live document may have changed since the OS window's initial hash. */
export function getAppWindowTarget(id: string): Target | undefined { return currentTargets.get(id); }

/** §5.13 (L) — 노드에서 연 창이 문서를 고르거나 만들면 그 노드가 그 문서(`AppBubble.ref`)로 묶인다. 명패가 화면이 되면 가운데를 지킨다(§5.4 #36 (F)). */
function bindBubbleRef(bubbleId: string | undefined, ref: string | undefined): void {
  if (!bubbleId || !ref) return;
  const store = useGraphStore.getState();
  const bubble = store.appBubbles?.find((b) => b.id === bubbleId);
  if (!bubble || bubble.ref === ref) return;
  const at = formChangeMove(getInternalApp(bubble.appId), bubble, {
    linkedAgentIds: bubble.linkedAgentIds,
    file: bubble.file,
    ref,
  });
  store.setAppBubbleRef(bubbleId, ref, at);
}

/** Publish the current document, including a new selection made after opening the shell. */
export async function updateAppWindowTarget(params: Params, target: Target): Promise<void> {
  currentTargets.set(params['appWindowId'] ?? '@detached', target);
  bindBubbleRef(params[APP_BUBBLE_PARAM], target.ref);
  const id = params['appWindowId'];
  if (id) {
    useAppWindowsStore.getState().updateTarget(id, target);
    return;
  }
  const app = getInternalApp(params['appWindowAppId'] ?? '');
  const api = window.api?.app;
  if (!app || !api?.updateTarget) return;
  const next = appShellParams(app, { projectId: params['projectId'] ?? '', bubbleId: params[APP_BUBBLE_PARAM], ...target });
  if (params['_windowTitle']) next['_windowTitle'] = params['_windowTitle'];
  const update = api.updateTarget(next).then(ok => { if (!ok) throw new Error('App window target was not accepted'); });
  trackAppWindowTargetUpdate('@detached', update);
  await update;
}

export function useAppWindowTarget(params: Params, target: Target | null): void {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  useEffect(() => {
    if (target) void updateAppWindowTarget(paramsRef.current, target).catch(() => undefined);
  }, [params['appWindowId'], params['appWindowAppId'], params['projectId'], target !== null, target?.ref, target?.file, target?.draftKey]);
}

export function useAppWindowTransferGuard(params: Params, prepare: () => Promise<boolean>, release?: () => void): void {
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  const releaseRef = useRef(release); releaseRef.current = release;
  const paramsRef = useRef(params); paramsRef.current = params;
  useEffect(() => {
    const id = params['appWindowId'] ?? '@detached';
    const unregister = registerAppWindowTransferGuard(id, () => prepareRef.current(), release ? () => releaseRef.current?.() : undefined);
    const stop = id !== '@detached' ? () => undefined : registerTaskWindowResponder(() => {
      const current = paramsRef.current;
      const app = getInternalApp(current['appWindowAppId'] ?? '');
      if (!app || !current['projectId']) return null;
      const target = currentTargets.get(id) ?? { ref: current[app.refKey], file: current['file'], draftKey: current['draftKey'] };
      return { appId: app.id, projectId: current['projectId'], bubbleId: current[APP_BUBBLE_PARAM], ...target };
    }, async () => {
      const prepared = await prepareAppWindowTransfer(id);
      try { return prepared; } finally { if (prepared) finishAppWindowTransfer(id); }
    });
    return () => { unregister(); stop(); currentTargets.delete(id); };
  }, [params['appWindowId'], params['appWindowAppId'], !!release]);
}
