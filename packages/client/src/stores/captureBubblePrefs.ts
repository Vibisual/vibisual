import { useCallback } from 'react';
import { create } from 'zustand';

// §5.9 캡처 버블 — 보는 기기별 뷰/조작 취향(화질·핀·불투명도 등)을 localStorage 에 버블 id 별로(서버 비관여).
// 포인터 방식은 여기 두지 않는다 — 런타임 `controlMode` 라 재시작하면 'off' 여야 한다.

export type CaptureQualityMode = 'auto' | 'full' | 'saver' | 'min';

export interface CapturePrefs {
  /** 화질 — 'auto'=ABR(회선/부하 따라 자동), 나머지는 고정 프리셋. */
  qualityMode: CaptureQualityMode;
  /** 항상 위(다른 버블보다 앞) 고정. */
  pinned: boolean;
  /** 불투명도(0.3~1). */
  opacity: number;
  /** 정지화면 절전 — 움직임이 없으면 프레임레이트를 확 낮춘다. */
  stillSaver: boolean;
  /** 읽기 전용 — 원격 조작을 잠근다(권한 분리). */
  readOnly: boolean;
  /** 조작 자동 해제까지의 무입력 시간(초). 0=끄기. */
  controlTimeoutSec: number;
  /** fps·해상도 배지 표시. */
  showBadge: boolean;
  /**
   * 이음새 숨기기 — 이어 붙인 버블(§5.9 자석 스냅)을 한 화면처럼. 테두리·라운드·그림자를 숨기고 헤더는 호버 때만(드래그 핸들이라 없애지 않는다).
   * 선택·조작 중엔 크롬이 다시 나타난다.
   */
  seamless: boolean;
  /** 켜면 대상 창에 마우스 메시지를 직접 넣어 커서를 안 움직인다. 게임·보호된 창은 무시해 기본(커서를 빌리는) 경로로 되돌아간다 — 그래서 기본 꺼짐. */
  backgroundClick: boolean;
}

export const DEFAULT_CAPTURE_PREFS: CapturePrefs = {
  qualityMode: 'full',
  pinned: false,
  opacity: 1,
  stillSaver: false,
  readOnly: false,
  controlTimeoutSec: 0,
  showBadge: false,
  seamless: false,
  backgroundClick: false,
};

const STORAGE_KEY = 'vibisual:capturePrefs';

function loadAll(): Record<string, CapturePrefs> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<CapturePrefs>>;
    const out: Record<string, CapturePrefs> = {};
    for (const [id, p] of Object.entries(parsed)) out[id] = { ...DEFAULT_CAPTURE_PREFS, ...p };
    return out;
  } catch {
    return {};
  }
}

interface CapturePrefsState {
  prefs: Record<string, CapturePrefs>;
  setPrefs: (id: string, patch: Partial<CapturePrefs>) => void;
}

export const useCapturePrefsStore = create<CapturePrefsState>((set, get) => ({
  prefs: loadAll(),
  setPrefs: (id, patch): void => {
    const cur = get().prefs[id] ?? DEFAULT_CAPTURE_PREFS;
    const next = { ...get().prefs, [id]: { ...cur, ...patch } };
    set({ prefs: next });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota/비가용 — 무시(세션 내에선 store 로 동작) */
    }
  },
}));

/** 특정 버블의 prefs + 부분 갱신 setter. 항목이 없으면 기본값을 돌려준다. */
export function useCapturePrefs(id: string): [CapturePrefs, (patch: Partial<CapturePrefs>) => void] {
  const prefs = useCapturePrefsStore((s) => s.prefs[id]) ?? DEFAULT_CAPTURE_PREFS;
  const setPrefsRaw = useCapturePrefsStore((s) => s.setPrefs);
  const set = useCallback((patch: Partial<CapturePrefs>) => setPrefsRaw(id, patch), [id, setPrefsRaw]);
  return [prefs, set];
}
