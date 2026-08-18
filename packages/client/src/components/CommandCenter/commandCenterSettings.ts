import { COMMAND_CENTER_SORTS, type CommandCenterSort } from './commandCenterModel.js';

// SCENARIO.md §5.12 (E)(H)(I) — 지휘통제실 창의 설정. **클라 localStorage 전용**이다.
// 북마크(`vibisual:bookmarks`)·tabPins 와 같은 부류 — 서버·스냅샷·체크포인트 무관(§3.2 대상 ❌).

const STORAGE_KEY = 'vibisual:commandCenter';

/**
 * §5.12 (I) — 저장 포맷 판. 올리면 **그 판에서 바뀐 기본값만** 한 번 다시 적용된다.
 * v2: 정렬 기본값 `recent` → `priority`. 옛 저장본의 `recent` 는 사용자가 고른 값이 아니라
 * 옛 기본값이므로, 판 번호가 없으면 한 번만 새 기본값으로 되돌린다(그 뒤 선택은 그대로 유지).
 */
const SETTINGS_VERSION = 2;

/** 보기 형태(§5.12 (H)) — 레인을 열로 세우거나(board), 세로로 쌓거나(list). */
export type CommandCenterView = 'board' | 'list';

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
  /** §5.12 (H) — board(칸반 열) / list(세로 구역). 창이 좁으면 코드가 list 로 접는다. */
  view: CommandCenterView;
  /** §5.12 (H) — 상세 패널을 쓸지. 끄면 카드만 넓게 본다. */
  detailPane: boolean;
  /**
   * §5.12 (A) v4.44 — 특정 프로젝트에 **고정**(표시명). null 이면 메인 창의 활성 프로젝트를
   * 따라간다(기본). 여기 담기는 값은 store 의 프로젝트 표시명 키다(경로가 아니다).
   */
  pinnedProject: string | null;
  /** 저장 포맷 판(§5.12 (I)). 사용자가 고르는 값이 아니라 마이그레이션 표시용이다. */
  v: number;
}

export const DEFAULT_COMMAND_CENTER_SETTINGS: CommandCenterSettings = {
  sort: 'priority',
  groupByAgent: false,
  autoTidy: false,
  autoTidyMinutes: 30,
  collapsedLanes: [],
  view: 'board',
  detailPane: true,
  pinnedProject: null,
  v: SETTINGS_VERSION,
};

export function loadCommandCenterSettings(): CommandCenterSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COMMAND_CENTER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<CommandCenterSettings>;
    const savedVersion = typeof parsed.v === 'number' ? parsed.v : 1;
    const knownSort =
      parsed.sort && (COMMAND_CENTER_SORTS as readonly string[]).includes(parsed.sort)
        ? parsed.sort
        : DEFAULT_COMMAND_CENTER_SETTINGS.sort;
    return {
      ...DEFAULT_COMMAND_CENTER_SETTINGS,
      ...parsed,
      // 저장값이 낡아도 화면이 깨지지 않게 방어(사용자가 손으로 고쳤을 수도).
      collapsedLanes: Array.isArray(parsed.collapsedLanes) ? parsed.collapsedLanes : [],
      view: parsed.view === 'list' || parsed.view === 'board' ? parsed.view : DEFAULT_COMMAND_CENTER_SETTINGS.view,
      pinnedProject: typeof parsed.pinnedProject === 'string' ? parsed.pinnedProject : null,
      // §5.12 (I) 마이그레이션 — 옛 판이면 정렬만 새 기본값으로 한 번 되돌린다.
      sort: savedVersion < SETTINGS_VERSION ? DEFAULT_COMMAND_CENTER_SETTINGS.sort : knownSort,
      v: SETTINGS_VERSION,
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
