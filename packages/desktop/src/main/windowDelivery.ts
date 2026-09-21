interface WindowMessageTarget {
  isDestroyed(): boolean;
  readonly webContents: {
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
  };
}

/**
 * A closing window can outlive its webContents. One recipient must not abort other
 * windows' notifications or a closed listener's cleanup. Resolve/check at delivery time.
 * https://www.electronjs.org/docs/latest/api/browser-window#event-closed
 */
export function broadcastWindowMessage(
  windows: Iterable<WindowMessageTarget>, channel: string, payload: unknown,
): void {
  for (const win of windows) {
    try {
      if (win.isDestroyed()) continue;
      const contents = win.webContents;
      if (contents.isDestroyed()) continue;
      contents.send(channel, payload);
    } catch (error) {
      try { console.warn(`[windowManager] ${channel} delivery failed:`, error); }
      catch { /* A broken diagnostic output must not abort the remaining recipients. */ }
    }
  }
}
