import type { CommandCenterSort } from './commandCenterModel.js';

// SCENARIO.md §5.12 (E) — 지휘통제실 창의 설정. **클라 localStorage 전용**이다.
// 북마크(`vibisual:bookmarks`)·tabPins 와 같은 부류 — 서버·스냅샷·체크포인트 무관(§3.2 대상 ❌).

const STORAGE_KEY = 'vibisual:commandCenter';

export interface CommandCenterSettings {
  sort: CommandCenterSort;
  /** 에이전트별로 묶어 보기. */
  groupByAgent: boolean;
  /** 자동 정리 — **기본 꺼짐**(사용자 명시 결정). 켜도 표시를 접을 뿐 세션을 죽이지 않는다. */
  autoTidy: boolean;
  /** 자동 정리 문턱(분). */
  autoTidyMinutes: number;
  /** 접어 둔 레인 id 목록. */
  collapsedLanes: string[];
}

export const DEFAULT_COMMAND_CENTER_SETTINGS: CommandCenterSettings = {
  sort: 'recent',
  groupByAgent: false,
  autoTidy: false,
  autoTidyMinutes: 30,
  collapsedLanes: [],
};

export function loadCommandCenterSettings(): CommandCenterSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COMMAND_CENTER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<CommandCenterSettings>;
    return {
      ...DEFAULT_COMMAND_CENTER_SETTINGS,
      ...parsed,
      // 저장값이 낡아도 화면이 깨지지 않게 방어(사용자가 손으로 고쳤을 수도).
      collapsedLanes: Array.isArray(parsed.collapsedLanes) ? parsed.collapsedLanes : [],
    };
  } catch {
    return { ...DEFAULT_COMMAND_CENTER_SETTINGS };
  }
}

export function saveCommandCenterSettings(settings: CommandCenterSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 저장 실패는 무시 — 표시 설정이라 기능에 영향 없음. */
  }
}
