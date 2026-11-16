import { useEffect, useRef, type RefObject } from 'react';

import { dispatchStudioKey, type StudioKeyEvent } from './studioCommandKeys.js';
import type { StudioCommandContext } from './studioCommandTypes.js';

/**
 * §5.13 (V) 37-24 (D) — 스튜디오 뿌리 밖에 초점이 있어도(창 틀 단추 · 아무 데도 없음) 이 창의 키면 같은 등록부로 받는다.
 * 뿌리 안·머리줄 자리(포털)의 키는 React 길이 이미 받았으니 다시 받지 않는다.
 */

/** 판정에 쓰는 노드의 모양(시험이 이 모양으로 흉내 낸다). */
export interface KeyScopeNode {
  contains(other: never): boolean;
}

export interface StudioKeyScope {
  readonly key: string;
  readonly target: unknown;
  /** 스튜디오 뿌리. */
  readonly root: KeyScopeNode;
  /** 이 스튜디오를 담은 앱 안 창 틀(없으면 null — 단독 OS 창 · IDE 무대). */
  readonly frame: KeyScopeNode | null;
  /** 창 틀 안의 머리줄 자리(스튜디오 머리줄이 포털로 서는 곳). */
  readonly slot: KeyScopeNode | null;
  /** 초점이 아무 데도 없다(문서 몸). */
  readonly unfocused: boolean;
  /** 마지막으로 누른 곳이 이 창이다. */
  readonly active: boolean;
  /** 본창 안에 얹힌 판 — 창 틀을 못 찾으면 창 수준 키를 받지 않는다(본창의 키를 뺏지 않는다). */
  readonly hosted: boolean;
  /** 이 스튜디오가 전체 화면이다. */
  readonly fullscreen: boolean;
}

const has = (node: KeyScopeNode | null, target: unknown): boolean => node?.contains(target as never) === true;

/** 이 키를 창 수준에서 스튜디오가 받는가. 순수. */
export function studioOwnsKey(s: StudioKeyScope): boolean {
  // Esc 는 창 스택(닫기)과 브라우저(전체 화면 나가기) 몫이다.
  if (s.key === 'Escape') return false;
  if (has(s.root, s.target) || has(s.slot, s.target)) return false;
  if (s.fullscreen) return true;
  if (s.frame) return has(s.frame, s.target) || (s.unfocused && s.active);
  // 창 틀이 없다 — 단독 OS 창이면 창 전체가 이 스튜디오이고, 본창 안에 얹힌 판이면 받지 않는다.
  return !s.hosted;
}

const FRAME_SELECTOR = '[data-app-window]';
const SLOT_SELECTOR = '[data-app-chrome-slot]';

export function useStudioWindowKeys(root: RefObject<HTMLElement | null>, context: StudioCommandContext, hosted: boolean, onInput?: () => void): void {
  const live = useRef({ context, hosted, onInput });
  live.current = { context, hosted, onInput };
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    // 방금 연 창은 이 창이 앞이다.
    let active = true;
    const frameOf = (): HTMLElement | null => root.current?.closest<HTMLElement>(FRAME_SELECTOR) ?? null;
    const onPointerDown = (e: PointerEvent): void => {
      const el = root.current;
      if (!el) return;
      const at = e.target as Node | null;
      active = el.contains(at) || frameOf()?.contains(at) === true;
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      const el = root.current;
      if (!el) return;
      const frame = frameOf();
      const target = e.target as Node | null;
      const owns = studioOwnsKey({
        key: e.key, target, root: el, frame, slot: (frame ?? document).querySelector(SLOT_SELECTOR),
        unfocused: target === document.body || target === document.documentElement,
        active, hosted: live.current.hosted, fullscreen: document.fullscreenElement === el,
      });
      if (!owns) return;
      live.current.onInput?.();
      const event: StudioKeyEvent = {
        key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
        defaultPrevented: e.defaultPrevented, nativeEvent: e, target, preventDefault: () => e.preventDefault(),
      };
      dispatchStudioKey(event, live.current.context);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    // 버블 단계 — React(뿌리·포털)와 앱 전역 단축키(창 캡처)가 먼저 받고, 처리된 키(`defaultPrevented`)는 등록부 문턱이 거른다.
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [root]);
}
