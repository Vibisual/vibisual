import { create } from 'zustand';

import { clientPathKey } from '../utils/platform.js';
import { getInternalApp } from './registry.js';

/**
 * §5.13 (S) — **앱 안 창**으로 열린 내부 앱들.
 *
 * 종전에는 앱 버블을 더블클릭하면 곧바로 독립 OS 창이 떴다. 그래서 앱 하나를 잠깐 들여다보는
 * 일에도 창이 하나 더 생기고, 캔버스에 놓아 둔 버블과 그 앱의 화면이 다른 세계에 있었다.
 * 이제 순서가 뒤집힌다 — **앱 안에서 먼저 열리고, 밖이 필요한 사람만 끌어낸다**(IDE 창과 같은 결).
 *
 * 이 store 는 "지금 어떤 앱 창이 떠 있나"만 든다(비영속 — 닫으면 잊는다). 창의 좌표·3상태는
 * 창 컴포넌트가 `useFloatingWindow` 로 들고, z-order·Escape 는 공용 창 스택이 맡는다.
 *
 * **특정 앱을 알지 않는다** (§5.13 (P-4)) — 무엇을 그릴지·밖에 어떻게 내보낼지는 전부 `appId` 로
 * 레지스트리에서 꺼낸다.
 */
export interface AppWindowArgs {
  readonly appId: string;
  /** 프로젝트 루트 절대 경로(= projectId). */
  readonly projectId: string;
  /** 앱이 해석하는 열쇠(영상 앱이면 문서 id) — §5.13 (M). */
  readonly ref?: string | undefined;
  /** 프로젝트 루트 기준 상대 경로 — §5.13 (R-2). */
  readonly file?: string | undefined;
  /** 창 제목에 쓸 이름(버블 이름 등). 없으면 앱 이름이 쓰인다. */
  readonly title?: string | undefined;
}

export interface AppWindow extends AppWindowArgs {
  /** 이 창의 고유 id. */
  readonly id: string;
  /**
   * 맨 앞으로 올려 달라는 신호(마지막 요청 시각).
   *
   * 이미 떠 있는 것을 또 열면 **두 벌로 겹치지 않고** 그 창이 앞으로 온다 — 같은 문서를 두 창에
   * 띄우면 어느 쪽이 진짜인지 알 수 없다(§5.13 (R-3) 이 문서 무덤을 막은 것과 같은 판단).
   */
  readonly focusAt: number;
}

/**
 * 같은 것을 가리키는 창인가 — 앱·프로젝트·열쇠·파일이 모두 같으면 같은 창이다.
 *
 * 버블 이름(`title`)은 열쇠가 아니다. 이름만 다른 버블 둘이 같은 문서를 가리킬 수 있고, 그때
 * 창이 두 벌 뜨면 편집이 갈라진다.
 *
 * ⚠ 경로는 `clientPathKey` 로 접는다(멀티플랫폼 규약 ① 경로키). 같은 파일이 부르는 자리에 따라
 * `C:\proj` 와 `C:/proj` 로 오는데 그대로 견주면 Windows 에서 창이 두 벌 뜬다. **소문자로 접지**
 * **않는다** — Linux 는 `Feature-X` 와 `feature-x` 가 다른 파일이라, 접으면 서로 다른 두 파일이
 * 한 창을 나눠 쓴다(그 판정은 `clientPathKey` 안에 있다).
 */
function windowKey(a: AppWindowArgs): string {
  // `ref` 는 앱이 발급한 식별자(문서 id)라 경로가 아니다 — 접지 않고 그대로 견준다.
  //   JSON 으로 묶는 까닭: 구분자를 문자 하나로 두면 그 문자가 값 안에 들어올 때 두 열쇠가 같아진다.
  return JSON.stringify([
    a.appId,
    clientPathKey(a.projectId),
    a.ref ?? '',
    a.file === undefined || a.file === '' ? '' : clientPathKey(a.file),
  ]);
}

interface AppWindowsState {
  windows: readonly AppWindow[];
  open: (args: AppWindowArgs) => void;
  close: (id: string) => void;
  /** §5.13 (S-5) 밖으로 꺼낸다 — 종전의 그 OS 창을 열고 앱 안 창은 닫는다. */
  popOut: (id: string) => void;
}

let seq = 0;

export const useAppWindowsStore = create<AppWindowsState>((set, get) => ({
  windows: [],

  open: (args): void => {
    const key = windowKey(args);
    const existing = get().windows.find((w) => windowKey(w) === key);
    if (existing) {
      // 이미 떠 있다 — 맨 앞으로만 올린다(제목은 최신 것으로 갱신: 버블 이름을 바꾼 뒤 다시 열 때).
      set({
        windows: get().windows.map((w) => (
          w.id === existing.id ? { ...w, title: args.title, focusAt: Date.now() } : w
        )),
      });
      return;
    }
    seq += 1;
    set({
      windows: [...get().windows, { ...args, id: `appwin-${Date.now().toString(36)}-${seq}`, focusAt: Date.now() }],
    });
  },

  close: (id): void => {
    set({ windows: get().windows.filter((w) => w.id !== id) });
  },

  popOut: (id): void => {
    const win = get().windows.find((w) => w.id === id);
    if (!win) return;
    const app = getInternalApp(win.appId);
    // 등록되지 않은 앱은 밖에 내보낼 방법이 없다 — 창은 그대로 두고 아무 일도 하지 않는다.
    if (!app) return;
    void app.open({ projectId: win.projectId, ref: win.ref, file: win.file });
    set({ windows: get().windows.filter((w) => w.id !== id) });
  },
}));

/**
 * §5.13 (S-6) — 앱을 여는 **유일한 문**.
 *
 * 버블 더블클릭 · 버블 우클릭 [열기] · 옵션 패널 [열기] · 파일 클릭((R-7) 의 `app` 갈래)이 전부
 * 여기로 온다. 지점마다 자기 판단을 들면 같은 앱이 자리마다 다른 곳에서 열린다.
 *
 * 등록되지 않은 `appId` 면 열지 않고 false — 부르는 쪽이 연결 프로그램 등 다른 길로 갈 수 있게.
 */
export function openAppWindow(args: AppWindowArgs): boolean {
  if (!getInternalApp(args.appId)) return false;
  useAppWindowsStore.getState().open(args);
  return true;
}

/**
 * 이 판이 앱을 **밖으로** 내보낼 수 있는가(데스크톱 렌더러인가).
 *
 * 못 내보내는 판(웹·구버전 preload)에서는 끌어내기 손짓과 [별도 창으로] 손잡이를 아예 띄우지
 * 않는다 — 안내만 뜨고 아무 일도 안 일어나면 그건 고장으로 읽힌다(§5.13 (S-5)).
 */
export function canPopOutAppWindow(): boolean {
  return typeof window !== 'undefined' && !!window.api?.app;
}
