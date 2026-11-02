// §4 폴더 우클릭으로 프로젝트 열기 — 켬/끔 판정과 상태의 모양. 서버(main 에 넘김)·옵션창이 같은 답을 내야 해 한 곳에 둔다.
import type { UserDefaults } from './types.js';

/** 미설정 = 켬. 설치하면 바로 우클릭에 보인다. */
export const FOLDER_CONTEXT_MENU_DEFAULT_ENABLED = true;

export function isFolderContextMenuEnabled(defaults: UserDefaults | null | undefined): boolean {
  const v = defaults?.advanced?.folderContextMenu;
  return typeof v === 'boolean' ? v : FOLDER_CONTEXT_MENU_DEFAULT_ENABLED;
}

/** 메뉴를 적는 자리. Linux 는 설치된 파일 관리자에만 적는다. */
export type FolderContextMenuTarget = 'windows-explorer' | 'macos-finder' | 'nautilus' | 'caja' | 'dolphin' | 'nemo';

/**
 * desktop main 이 적고 걷은 결과. `reason`:
 * `dev-build` — 패키지가 아닌 실행이라 설치본의 항목을 덮지 않으려고 적지 않았다 ·
 * `no-file-manager` — Linux 에서 아는 파일 관리자가 하나도 없다 · `unsupported-platform` · `error` — 쓰다가 실패(`error` 에 원문).
 */
export interface FolderContextMenuStatus {
  enabled: boolean;
  installed: boolean;
  targets: FolderContextMenuTarget[];
  reason?: 'dev-build' | 'no-file-manager' | 'unsupported-platform' | 'error';
  error?: string;
  /** 마지막으로 적거나 걷은 시각(ms). 아직 한 번도 돌지 않았으면 없다. */
  appliedAt?: number;
}
