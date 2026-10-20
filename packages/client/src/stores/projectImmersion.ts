import { create } from 'zustand';

interface ImmersiveIDE {
  project: string;
  paneKey: string;
}

interface ProjectImmersionState {
  /** Window-local presentation state; never persist or broadcast it. */
  immersiveProject: string | null;
  /** The third IDE size stage is independent of the project's canvas immersion toggle. */
  immersiveIDE: ImmersiveIDE | null;
  toggle: (project: string) => void;
  enterIDE: (project: string, paneKey: string) => void;
  exitIDE: (paneKey?: string) => void;
  exit: () => void;
}

export const useProjectImmersionStore = create<ProjectImmersionState>((set) => ({
  immersiveProject: null,
  immersiveIDE: null,
  toggle: (project): void => {
    set((state) => ({ immersiveProject: state.immersiveProject === project ? null : project, immersiveIDE: null }));
  },
  enterIDE: (project, paneKey): void => { set({ immersiveIDE: { project, paneKey } }); },
  exitIDE: (paneKey): void => {
    set((state) => !state.immersiveIDE || (paneKey !== undefined && state.immersiveIDE.paneKey !== paneKey)
      ? state : { immersiveIDE: null });
  },
  exit: (): void => { set({ immersiveProject: null, immersiveIDE: null }); },
}));

/** Shell chrome and non-IDE windows yield to either kind of immersion. */
export function selectShellImmersive(state: ProjectImmersionState): boolean {
  return state.immersiveProject !== null || state.immersiveIDE !== null;
}

/** The hover exit button and Escape leave the same layer without closing any editor. */
export function exitImmersionLayer(): void {
  const state = useProjectImmersionStore.getState();
  if (state.immersiveIDE) state.exitIDE();
  else state.exit();
}
