interface RetainedWindow {
  isDestroyed(): boolean;
  close(): void;
  hide(): void;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string): void;
    setBackgroundThrottling(enabled: boolean): void;
  };
}

/** Native close is a request; only an owner's explicit teardown destroys a retained editor. */
export function createAppWindowClose(window: RetainedWindow) {
  let retained = false;
  let approved = false;
  return {
    setRetention(value: boolean): boolean {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
      retained = value;
      // Hidden windows still execute renderer commands, heartbeats and captures.
      window.webContents.setBackgroundThrottling(!value);
      return true;
    },
    onClose(event: { preventDefault(): void }): void {
      if (!retained || approved) return;
      event.preventDefault();
      if (!window.webContents.isDestroyed()) {
        try { window.webContents.send('vibisual:app:close-requested'); } catch { /* Keep the live document on a failed request. */ }
      }
    },
    hide(): boolean {
      if (window.isDestroyed() || !retained) return false;
      window.hide();
      return true;
    },
    close(): boolean {
      if (window.isDestroyed()) return false;
      approved = true;
      try { window.close(); return true; }
      finally { approved = false; }
    },
  };
}
