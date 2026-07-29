import { useCallback } from 'react';
import { create } from 'zustand';

// §5.9 캡처 버블 — 뷰/조작 환경설정 영속(순수 클라, 서버 비관여).
//
// 화질 모드·핀 고정·불투명도·정지화면 절전·조작 잠금·조작 타임아웃·배지 표시 등은
// "보는 기기별 취향"이라 서버 SSOT(4지점 영속) 대신 localStorage 에 버블 id 별로 담는다
// (폰은 '최소' 화질, 데스크톱은 '원본' 처럼 기기마다 달라도 됨). 앱/창 재시작 후에도 유지.
//
// 포인터 방식(터치/마우스)은 v3.43 에 여기서 빠져 런타임 `controlMode` 3상태로 합쳐졌다 — 모드를
// 고르는 것이 곧 조작 시작이라, 재시작하면 항상 'off' 로 돌아가는 비영속 축이어야 한다.

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
   * 이음새 숨기기 — 버블 여러 개를 이어 붙여(§5.9 자석 스냅) 하나의 큰 화면처럼 볼 때 켠다.
   * 평상시 테두리·모서리 라운드·그림자를 숨기고 영상이 버블 전체를 채우며 헤더는 호버할 때만
   * 떠오른다(헤더가 드래그 핸들이라 없애지는 않는다). 선택·조작 중엔 어느 버블인지 보여야 하므로
   * 크롬이 다시 나타난다.
   */
  seamless: boolean;
  /**
   * "커서 안 움직이기"(v3.62) — 켜면 대상 창에 마우스 메시지를 직접 넣어 사용자의 커서를 전혀
   * 건드리지 않는다. 일반 Win32 앱엔 잘 먹지만 게임·보호된 창은 무시하므로 그런 창에선 자동으로
   * 기본(커서를 잠깐 빌리는) 경로로 되돌아간다 — 그래서 기본값은 꺼짐이다.
   */
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
