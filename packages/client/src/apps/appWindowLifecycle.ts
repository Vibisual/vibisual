import { useEffect, useRef } from 'react';
import { useAppWindowsStore } from './appWindows.js';
import { APP_BUBBLE_PARAM, appShellParams, getInternalApp } from './registry.js';
import { registerAppWindowTransferGuard, trackAppWindowTargetUpdate } from './appWindowTransfer.js';
import { formChangeMove } from './appNodeForm.js';
import { useGraphStore } from '../stores/graphStore.js';

type Params = Readonly<Record<string, string>>;
interface Target { ref?: string | undefined; file?: string | undefined }

/**
 * §5.13 (L) — 창을 연 캔버스 노드가 **지금 그 창이 보는 작업 문서**를 기억한다(`AppBubble.ref`).
 *
 * 종전에는 노드가 문서를 가리키게 하는 길이 없어(구현 현황 (L) 의 "남은 것") 노드를 열 때마다 빈 앱이 떴고, 그 안에서
 * 고른 문서는 다음에 다시 골라야 했다. 이제 노드에서 연 창이 문서를 고르거나 새로 만들면 그 노드가 그 문서로 묶인다.
 * 명패가 문서를 얻어 화면이 되면 가운데를 지킨다(§5.4 #36 (F) 와 같은 규칙).
 */
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
  }, [params['appWindowId'], params['appWindowAppId'], params['projectId'], target !== null, target?.ref, target?.file]);
}

export function useAppWindowTransferGuard(params: Params, prepare: () => Promise<boolean>): void {
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  useEffect(() => registerAppWindowTransferGuard(params['appWindowId'] ?? '@detached', () => prepareRef.current()), [params['appWindowId']]);
}
