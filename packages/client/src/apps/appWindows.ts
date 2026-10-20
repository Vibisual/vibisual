import { create } from 'zustand';

import { markAppTiming } from './appTiming.js';
import { getInternalApp } from './registry.js';
import type { AppOpenArgs } from './registry.js';
import type { FloatingWindowGeom } from '../hooks/floatingWindowGeom.js';
import { finishAppWindowTransfer, prepareAppWindowTransfer } from './appWindowTransfer.js';
import { appWindowKey, resolveAppWindowDestination, type OutsideAppWindow } from './appWindowFocus.js';

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
  readonly geometry?: FloatingWindowGeom | undefined;
  readonly appId: string;
  /** 프로젝트 루트 절대 경로(= projectId). */
  readonly projectId: string;
  /** 앱이 해석하는 열쇠(영상 앱이면 문서 id) — §5.13 (M). */
  readonly ref?: string | undefined;
  /** 프로젝트 루트 기준 상대 경로 — §5.13 (R-2). */
  readonly file?: string | undefined;
  /** Preserved across native/embedded transfers so source-less autosaves can be restored. */
  readonly draftKey?: string | undefined;
  /** 창 제목에 쓸 이름(버블 이름 등). 없으면 앱 이름이 쓰인다. */
  readonly title?: string | undefined;
  /**
   * §5.13 (L) — 이 창을 연 캔버스 노드. 앱이 다른 작업 문서를 고르면 그 노드가 그 문서를 기억한다.
   * 창의 열쇠(같은 창인가)에는 넣지 않는다 — 같은 문서를 가리키는 노드 둘이 창을 두 벌 띄우지 않게.
   */
  readonly bubbleId?: string | undefined;
}

export interface AppWindow extends AppWindowArgs {
  /** 이 창의 고유 id. */
  readonly id: string;
  /** An agent may need the editor bridge quietly; false retains its document identity after revealing it. */
  readonly background?: boolean;
  /**
   * 맨 앞으로 올려 달라는 신호(마지막 요청 시각).
   *
   * 이미 떠 있는 것을 또 열면 **두 벌로 겹치지 않고** 그 창이 앞으로 온다 — 같은 문서를 두 창에
   * 띄우면 어느 쪽이 진짜인지 알 수 없다(§5.13 (R-3) 이 문서 무덤을 막은 것과 같은 판단).
   */
  readonly focusAt: number;
}

/** 같은 것을 가리키는 창인가 — 열쇠의 규칙(경로 접기 포함)은 `appWindowFocus.ts` 한 곳이 쥔다(밖의 창과 같은 말로 견준다). */
const windowKey = appWindowKey;
const sameDocument = (a: AppWindowArgs, b: AppWindowArgs): boolean => !!a.ref && a.ref === b.ref
  && windowKey({ ...a, file: undefined }) === windowKey({ ...b, file: undefined });

interface AppWindowsState {
  windows: readonly AppWindow[];
  /**
   * §5.13 (S-11) **밖에** 떠 있는 앱 창(OS 창)과 그 창이 보는 대상 — main 의 목록을 그대로 비춘 것(이 store 가
   * 만들지 않는다 — `useAppWindowRedock` 이 받아 적는다). 그 문서를 다시 열면 앱 안에 한 벌 더 세우지 않고 그 창을
   * 앞으로 세운다(`openAppWindow`).
   */
  outside: readonly OutsideAppWindow[];
  setOutside: (list: readonly OutsideAppWindow[]) => void;
  open: (args: AppWindowArgs, opts?: { background?: boolean }) => void;
  close: (id: string) => void;
  /** Hide the human view while retaining the live editor and its agent bridge. */
  hide: (id: string) => void;
  /** Preserve the current document when the shell changes its selection before popping out. */
  updateReference: (id: string, ref: string) => void;
  updateTarget: (id: string, target: { ref?: string | undefined; file?: string | undefined; draftKey?: string | undefined }) => void;
  /** §5.13 (S-5) 밖으로 꺼낸다 — 종전의 그 OS 창을 열고 앱 안 창은 닫는다. */
  popOut: (id: string, placement?: AppOpenArgs['placement']) => Promise<boolean>;
}

let seq = 0;
const pendingPopOut = new Set<string>();

export const useAppWindowsStore = create<AppWindowsState>((set, get) => ({
  windows: [],
  outside: [],

  setOutside: (list): void => {
    set({ outside: list });
  },

  open: (args, opts): void => {
    const key = windowKey(args);
    const existing = get().windows.find((w) => windowKey(w) === key);
    if (existing) {
      // Preparation must not raise, hide, or replace a window the person is already using.
      if (opts?.background) return;
      // 이미 떠 있다 — 맨 앞으로만 올린다(제목은 최신 것으로 갱신: 버블 이름을 바꾼 뒤 다시 열 때).
      set({
        windows: get().windows.map((w) => (
          w.id === existing.id
            ? { ...w, ...(w.background ? { background: false } : {}), title: args.title, ...(args.bubbleId ? { bubbleId: args.bubbleId } : {}), focusAt: Date.now() }
            : w
        )),
      });
      return;
    }
    seq += 1;
    set({
      windows: [...get().windows, { ...args, id: `appwin-${Date.now().toString(36)}-${seq}`,
        ...(opts?.background ? { background: true } : {}), focusAt: opts?.background ? 0 : Date.now() }],
    });
  },

  close: (id): void => {
    set({ windows: get().windows.filter((w) => w.id !== id) });
  },

  hide: (id): void => {
    set({ windows: get().windows.map(w => w.id === id ? { ...w, background: true } : w) });
  },

  updateReference: (id, ref): void => {
    set({ windows: get().windows.map(w => w.id === id ? { ...w, ref, file: undefined } : w) });
  },

  updateTarget: (id, target): void => {
    set({ windows: get().windows.map(w => w.id === id ? { ...w, ref: target.ref, file: target.file, draftKey: target.draftKey } : w) });
  },

  popOut: async (id, placement): Promise<boolean> => {
    if (pendingPopOut.has(id) || !get().windows.some(w => w.id === id)) return false;
    pendingPopOut.add(id);
    let prepared = false; let transferred = false;
    try {
      prepared = await prepareAppWindowTransfer(id);
      if (!prepared) return false;
      const win = get().windows.find((w) => w.id === id);
      if (!win) return false;
      const app = getInternalApp(win.appId);
      // An unknown app cannot receive this window; leave the source open.
      if (!app) return false;
      const opened = await app.open({ projectId: win.projectId, ref: win.ref, file: win.file,
        ...(win.draftKey ? { draftKey: win.draftKey } : {}),
        ...(win.bubbleId ? { bubbleId: win.bubbleId } : {}),
        ...(win.title ? { title: win.title } : {}), ...(placement ? { placement } : {}) });
      if (!opened) return false;
      transferred = true;
      set({ windows: get().windows.filter((w) => w.id !== id) });
      return true;
    } catch { return false; }
    finally { if (prepared) finishAppWindowTransfer(id, transferred); pendingPopOut.delete(id); }
  },
}));

/**
 * §5.13 (S-6) — 앱을 여는 **유일한 문**.
 *
 * 버블 더블클릭 · 버블 우클릭 [열기] · 옵션 패널 [열기] · 파일 클릭((R-7) 의 `app` 갈래)이 전부
 * 여기로 온다. 지점마다 자기 판단을 들면 같은 앱이 자리마다 다른 곳에서 열린다.
 *
 * 등록되지 않은 `appId` 면 열지 않고 false — 부르는 쪽이 연결 프로그램 등 다른 길로 갈 수 있게.
 *
 * §5.13 (S-11) — 그 문서가 **이미 밖에 떠 있으면** 앱 안에 한 벌 더 세우지 않고 밖의 그 창을 앞으로 세운다(IDE 창
 * §5.5 #17-6 (H-13)(H-16) 과 같은 "포커싱" — 다른 프로그램 뒤에 가려져 있어도 앞으로 오고, 테두리가 한 번 대답한다).
 * 그 사이 그 창이 닫혔으면(목록이 한 박자 늦다) 종전대로 앱 안에 연다.
 *
 * @param opts.redock 밖의 창을 앱 안으로 **되돌리는** 길 — 그 창은 닫히는 중이라 밖을 보지 않는다.
 * @param opts.background Prepare the editor bridge quietly; only a later explicit open shows it.
 */
export function openAppWindow(args: AppWindowArgs, opts?: { redock?: boolean; background?: boolean }): boolean {
  if (!getInternalApp(args.appId)) return false;
  const store = useAppWindowsStore.getState();
  if (opts?.background) {
    if (store.windows.some(win => sameDocument(win, args))) return true;
    // An existing outside editor owns its scene too. Do not focus it or start a second copy.
    if (!store.outside.some(win => windowKey(win) === windowKey(args) || sameDocument(win, args))) store.open(args, { background: true });
    return true;
  }
  // A source bubble can retain its import file after obtaining a document ref. Reveal the prepared
  // document, preserving its live scene, rather than opening a second renderer for that old file.
  const prepared = store.windows.find(win => win.background !== undefined && sameDocument(win, args))
    ?? store.outside.find(win => sameDocument(win, args));
  const target = prepared ? { ...args, file: prepared.file } : args;
  // §5.13 (Y) 40-12 — 여는 누름의 시각(앱 쪽 계측이 여기서부터 첫 그림까지를 잰다).
  markAppTiming(`open:${args.appId}`);
  const api = typeof window !== 'undefined' ? window.api?.app : undefined;
  const destination = resolveAppWindowDestination({
    args: target,
    inside: store.windows,
    outside: store.outside,
    redock: opts?.redock === true,
    canFocusOutside: typeof api?.focus === 'function',
  });
  if (destination.kind === 'outside' && api?.focus) {
    const openInside = (): void => { useAppWindowsStore.getState().open(target); };
    void api.focus(destination.appId, destination.windowId)
      .then((raised) => { if (!raised) openInside(); }, openInside);
    return true;
  }
  store.open(target);
  return true;
}

/**
 * 이 판이 앱을 **밖으로** 내보낼 수 있는가(데스크톱 렌더러인가).
 *
 * 못 내보내는 판(웹·구버전 preload)에서는 끌어내기 손짓과 [별도 창으로] 손잡이를 아예 띄우지
 * 않는다 — 안내만 뜨고 아무 일도 안 일어나면 그건 고장으로 읽힌다(§5.13 (S-5)).
 */
export function canPopOutAppWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.api?.app?.open === 'function';
}
