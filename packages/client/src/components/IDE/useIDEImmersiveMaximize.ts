import { useCallback, useEffect } from 'react';
import { useProjectImmersionStore } from '../../stores/projectImmersion.js';

interface IDEImmersiveMaximizeOptions {
  project: string | null;
  paneKey: string | null;
  maximized: boolean;
  onMaximized: (maximized: boolean) => void;
  enabled?: boolean;
}

interface IDEImmersiveMaximize {
  immersive: boolean;
  hidden: boolean;
  fillsWindow: boolean;
  nextAction: 'maximize' | 'immerse' | 'restore';
  cycle: () => void;
}

/** Keep the pane's existing maximized/float/dock state; only the third stage owns shell chrome. */
export function useIDEImmersiveMaximize({
  project, paneKey, maximized, onMaximized, enabled = true,
}: IDEImmersiveMaximizeOptions): IDEImmersiveMaximize {
  const owner = useProjectImmersionStore((state) => state.immersiveIDE);
  const projectImmersive = useProjectImmersionStore((state) => project !== null && state.immersiveProject === project);
  const ownsImmersion = enabled && owner !== null && owner.project === project && owner.paneKey === paneKey;
  const immersive = ownsImmersion && maximized;
  const hidden = enabled && owner !== null && !ownsImmersion;
  const nextAction = !maximized ? 'maximize'
    : immersive || projectImmersive || !project || !paneKey ? 'restore' : 'immerse';

  const cycle = useCallback((): void => {
    if (!enabled) return;
    const state = useProjectImmersionStore.getState();
    const own = state.immersiveIDE?.paneKey === paneKey && state.immersiveIDE?.project === project;
    if (!maximized) {
      onMaximized(true);
    } else if (own || state.immersiveProject === project || !project || !paneKey) {
      if (paneKey) state.exitIDE(paneKey);
      onMaximized(false);
    } else {
      state.enterIDE(project, paneKey);
    }
  }, [enabled, maximized, onMaximized, paneKey, project]);

  useEffect(() => {
    // Drag-to-restore, docking and layout presets already clear maximized through the pane store.
    if (ownsImmersion && !maximized && paneKey) useProjectImmersionStore.getState().exitIDE(paneKey);
  }, [ownsImmersion, maximized, paneKey]);

  useEffect(() => () => {
    // Closing, collapsing, moving to another project or detaching must not leave the shell hidden.
    if (enabled && paneKey) useProjectImmersionStore.getState().exitIDE(paneKey);
  }, [enabled, paneKey, project]);

  return { immersive, hidden, fillsWindow: enabled && maximized && (immersive || projectImmersive), nextAction, cycle };
}
