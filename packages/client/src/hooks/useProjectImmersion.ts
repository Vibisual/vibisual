import { useEffect } from 'react';
import { exitImmersionLayer, useProjectImmersionStore } from '../stores/projectImmersion.js';
import { isComposingKeyEvent } from '../utils/inputComposition.js';
import { useImmersiveWindow } from './useImmersiveWindow.js';
import { useCommand } from './useCommand.js';

/** Shared by the main project shell and detached project windows. */
export function useProjectImmersion(project: string | null): boolean {
  const immersiveProject = useProjectImmersionStore((state) => state.immersiveProject);
  const immersiveIDE = useProjectImmersionStore((state) => state.immersiveIDE);
  const immersive = project !== null && (immersiveProject === project || immersiveIDE?.project === project);
  useImmersiveWindow(immersive);

  useCommand('global.projectImmersion', (event) => {
    if (project === null || event.defaultPrevented) return false;
    // Holding F11 must not repeatedly enter/leave fullscreen, but still consume repeats.
    if (!event.repeat) useProjectImmersionStore.getState().toggle(project);
  }, { enabled: project !== null });

  useEffect(() => window.api?.window?.onImmersionShortcut?.(() => {
    // Electron consumes F11 before its default fullscreen menu action, even inside iframes.
    // Re-enter the normal dispatcher so remapping, unbinding and key capture still apply.
    const event = new KeyboardEvent('keydown', { key: 'F11', code: 'F11', bubbles: true, cancelable: true });
    (document.activeElement ?? window).dispatchEvent(event);
  }), []);

  useEffect(() => {
    // Leaving this project must also forget immersion, so returning cannot trap the user.
    if ((immersiveProject !== null && immersiveProject !== project)
      || (immersiveIDE !== null && immersiveIDE.project !== project)) {
      useProjectImmersionStore.getState().exit();
    }
  }, [project, immersiveProject, immersiveIDE]);

  useEffect(() => {
    if (!immersive) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || isComposingKeyEvent(event)) return;
      // Hidden IDE windows also listen for Escape. Restore them without closing any of them.
      event.preventDefault();
      event.stopImmediatePropagation();
      // Escape leaves the third IDE stage at the existing maximized size, without closing it.
      exitImmersionLayer();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [immersive]);

  useEffect(() => () => useProjectImmersionStore.getState().exit(), []);
  return immersive;
}
