import { create } from 'zustand';

/**
 * §5.5 #17-27 ⑳ 파일 창 — IDE 의 [오른쪽에 표시] 판을 IDE 밖에 따로 세운 창(캔버스 파일 버블 더블클릭)이 떠 있는가. 비영속.
 * 판의 탭 상태는 판 컴포넌트를 그대로 쓰려고 IDE 창과 같은 슬롯(`ideOverlays[슬롯키]` — `ensureFileWindowSlot`)에 산다.
 * 프로젝트마다 하나 — 파일을 더 열면 그 창에 탭이 는다.
 */

/** 파일 창 판 자리의 슬롯 키 꼬리 — IDE 창의 키(`<프로젝트>` · `<프로젝트>::ide-N`)와 겹치지 않는다. */
const FILE_WINDOW_SLOT_SUFFIX = '::files';

/** 그 프로젝트의 파일 창 슬롯 키(= 창 id). 프로젝트 이름에는 `::` 가 들어가지 않는다고 가정하지 않는다 — 꼬리로만 가른다. */
export function fileWindowSlotKey(projectName: string): string {
  return `${projectName}${FILE_WINDOW_SLOT_SUFFIX}`;
}

export interface FileWindowEntry {
  /** 창 id = 판 자리의 슬롯 키. */
  readonly id: string;
  /** 이 창의 프로젝트(표시 이름 — 슬롯의 `projectId` 와 같은 값). */
  readonly projectName: string;
  /** 그 프로젝트의 루트 절대경로 — 어느 탭에서 보이는지 가른다(앱 안 창과 같은 판정). */
  readonly projectRoot: string;
  /** 맨 앞으로 올려 달라는 신호(마지막 요청 시각). 이미 떠 있는 창에 파일을 또 열면 그 창이 앞으로 온다. */
  readonly focusAt: number;
}

interface FileWindowsState {
  windows: readonly FileWindowEntry[];
  /** 그 창을 세우거나(없으면) 앞으로 올린다(있으면). */
  show: (entry: Omit<FileWindowEntry, 'focusAt'>) => void;
  close: (id: string) => void;
}

export const useFileWindowsStore = create<FileWindowsState>((set, get) => ({
  windows: [],
  show: (entry): void => {
    const now = Date.now();
    const cur = get().windows;
    const existing = cur.find((w) => w.id === entry.id);
    set({
      windows: existing
        ? cur.map((w) => (w.id === entry.id ? { ...w, ...entry, focusAt: now } : w))
        : [...cur, { ...entry, focusAt: now }],
    });
  },
  close: (id): void => {
    const cur = get().windows;
    if (!cur.some((w) => w.id === id)) return;
    set({ windows: cur.filter((w) => w.id !== id) });
  },
}));
