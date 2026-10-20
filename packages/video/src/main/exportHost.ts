/**
 * §5.13 (AA) 42-2·42-7 — 내보내기의 OS 기능(앱 main 몫 — 코어는 이 파일의 뜻을 모른다, `invoke` 문자열로만 닿는다).
 *
 * - `export:pickFolder` — OS 폴더 창(처음 자리는 OS 의 동영상 폴더 — Windows 동영상 · mac Movies · Linux XDG Videos).
 * - `export:reveal` — 그 파일을 탐색기·Finder·파일 관리자에서 보인다(리눅스는 파일 관리자에 따라 폴더만 열린다).
 * - `export:open` — 결과 파일을 OS 기본 앱으로 연다(결과 형식만 — 실행 파일을 여는 문이 되지 않게).
 * - `export:openFolder` — 저장 폴더를 연다.
 * - `export:done` — 끝난 뒤: OS 알림(앱 창이 앞에 있으면 띄우지 않는다 · 누르면 폴더에서 보인다) · 폴더에서 보이기.
 * - `power:keepAwake` — 렌더가 도는 동안 OS 절전을 막는다(세 OS 공통 `powerSaveBlocker`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, Notification, powerSaveBlocker, shell, type OpenDialogOptions } from 'electron';

/** OS 기본 앱으로 열어도 되는 결과 형식. */
const OPENABLE = new Set(['.mp4', '.webm', '.wav', '.srt', '.png']);

let blockerId: number | null = null;

function record(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : {};
}

/** 절대 경로의 있는 파일만(아니면 null). */
function existingFile(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\u0000') || !path.isAbsolute(raw)) return null;
  try {
    return fs.statSync(raw).isFile() ? raw : null;
  } catch {
    return null;
  }
}

function existingDir(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\u0000') || !path.isAbsolute(raw)) return null;
  try {
    return fs.statSync(raw).isDirectory() ? raw : null;
  } catch {
    return null;
  }
}

function defaultFolder(): string {
  try {
    return app.getPath('videos');
  } catch {
    return app.getPath('home');
  }
}

export async function pickExportFolder(payload: unknown): Promise<{ path: string } | null> {
  const p = record(payload);
  const start = existingDir(p['defaultPath']) ?? defaultFolder();
  const title = typeof p['title'] === 'string' ? p['title'].slice(0, 200) : undefined;
  // `createDirectory` 는 mac 에서만 뜻이 있다(다른 OS 의 폴더 창은 늘 새 폴더를 만들 수 있다).
  const options: OpenDialogOptions = { defaultPath: start, properties: ['openDirectory', 'createDirectory'], ...(title ? { title } : {}) };
  const parent = BrowserWindow.getFocusedWindow();
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  const chosen = result.filePaths[0];
  return result.canceled || !chosen ? null : { path: chosen };
}

export function revealExport(payload: unknown): boolean {
  const file = existingFile(record(payload)['path']);
  if (!file) return false;
  shell.showItemInFolder(file);
  return true;
}

export async function openExport(payload: unknown): Promise<boolean> {
  const file = existingFile(record(payload)['path']);
  if (!file || !OPENABLE.has(path.extname(file).toLowerCase())) return false;
  return (await shell.openPath(file)) === '';
}

export async function openExportFolder(payload: unknown): Promise<boolean> {
  const dir = existingDir(record(payload)['path']);
  if (!dir) return false;
  return (await shell.openPath(dir)) === '';
}

/** 끝난 뒤 — 알림(앱 창이 앞에 없을 때만)·폴더에서 보이기. 표시 전용이라 실패해도 조용히 지나간다. */
export function exportDone(payload: unknown): null {
  const p = record(payload);
  const file = existingFile(p['path']);
  try {
    if (p['reveal'] === true && file) shell.showItemInFolder(file);
    const focused = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
    if (p['notify'] === true && !focused && Notification.isSupported()) {
      const body = typeof p['body'] === 'string' ? p['body'].slice(0, 300) : '';
      const title = typeof p['title'] === 'string' && p['title'] !== '' ? p['title'].slice(0, 200) : body;
      const note = new Notification({ title, body: title === body ? '' : body, silent: false });
      if (file) note.on('click', () => shell.showItemInFolder(file));
      note.show();
    }
  } catch {
    // 알림·폴더 열기는 표시 전용이다 — 렌더 결과에는 영향이 없다.
  }
  return null;
}

/** 절전 막기를 켜고 끈다(같은 상태면 아무 일 없음). */
export function setKeepAwake(payload: unknown): boolean {
  const on = record(payload)['on'] === true;
  if (on && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!on && blockerId !== null) {
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
  return blockerId !== null;
}

/** 본체가 닫힐 때 — 절전 막기를 풀어 둔다. */
export function disposeExportHost(): void {
  setKeepAwake({ on: false });
}
