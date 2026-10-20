import { STUDIO_APP_ID } from './studioAppId.js';

/**
 * §5.13 (AA) 42-2·42-8 — 내보내기의 OS 기능(앱 main 몫 `export:*` — 코어의 일반 통로 `app.invoke` 하나로만 닿는다).
 *
 * 웹·모바일처럼 `window.api.app` 이 없으면 쓸 수 없다 — 그때 화면은 폴더 고르기·폴더에서 보기·열기 칸을 세우지 않는다(42-8).
 */
export function exportHostAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.api?.app?.invoke === 'function';
}

async function call<T>(action: string, payload: unknown): Promise<T | null> {
  const api = window.api?.app;
  if (!api) return null;
  return (await api.invoke(STUDIO_APP_ID, action, payload)) as T;
}

/** OS 폴더 창 — 고른 절대 경로(취소면 null). */
export async function pickExportFolder(defaultPath: string | null, title: string): Promise<string | null> {
  const picked = await call<{ path: string } | null>('export:pickFolder', { ...(defaultPath ? { defaultPath } : {}), title });
  return picked?.path ?? null;
}

/** 그 파일을 탐색기·Finder·파일 관리자에서 보인다. */
export async function revealExport(path: string): Promise<boolean> {
  return (await call<boolean>('export:reveal', { path })) === true;
}

/** 결과 파일을 OS 기본 앱으로 연다(결과 형식만). */
export async function openExport(path: string): Promise<boolean> {
  return (await call<boolean>('export:open', { path })) === true;
}

/** 저장 폴더를 연다. */
export async function openExportFolder(path: string): Promise<boolean> {
  return (await call<boolean>('export:openFolder', { path })) === true;
}
