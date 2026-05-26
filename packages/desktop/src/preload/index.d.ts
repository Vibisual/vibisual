import type { ElectronAPI } from '@electron-toolkit/preload';
import type { DesktopApi } from './index';

// Renderer-side type completion for the contextBridge surface (SCENARIO.md §3.7).
declare global {
  interface Window {
    electron: ElectronAPI;
    api: DesktopApi;
  }
}

export {};
