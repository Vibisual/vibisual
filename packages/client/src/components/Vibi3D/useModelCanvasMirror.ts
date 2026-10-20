import { useCallback, useSyncExternalStore } from 'react';
import {
  modelCanvasMirrorKey, readModelCanvasMirror, subscribeModelCanvasMirror,
  type ModelCanvasMirrorFrame, type ModelCanvasMirrorTarget,
} from './modelCanvasMirror.js';

/** Disable while hidden or when the user takes control of the face's own camera. */
export function useModelCanvasMirror({ enabled, ...target }: ModelCanvasMirrorTarget & { enabled: boolean }): ModelCanvasMirrorFrame | null {
  const key = enabled ? modelCanvasMirrorKey(target) : null;
  const subscribe = useCallback((listener: () => void) => subscribeModelCanvasMirror(key, listener), [key]);
  const snapshot = useCallback(() => readModelCanvasMirror(key), [key]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
