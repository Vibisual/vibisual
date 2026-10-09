import { useEffect, useRef } from 'react';
import { useAppWindowsStore } from './appWindows.js';
import { appShellParams, getInternalApp } from './registry.js';
import { registerAppWindowTransferGuard, trackAppWindowTargetUpdate } from './appWindowTransfer.js';

type Params = Readonly<Record<string, string>>;
interface Target { ref?: string | undefined; file?: string | undefined }

/** Publish the current document, including a new selection made after opening the shell. */
export async function updateAppWindowTarget(params: Params, target: Target): Promise<void> {
  const id = params['appWindowId'];
  if (id) {
    useAppWindowsStore.getState().updateTarget(id, target);
    return;
  }
  const app = getInternalApp(params['appWindowAppId'] ?? '');
  const api = window.api?.app;
  if (!app || !api?.updateTarget) return;
  const next = appShellParams(app, { projectId: params['projectId'] ?? '', ...target });
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
