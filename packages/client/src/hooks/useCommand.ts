import { useEffect, useRef } from 'react';
import {
  COMMANDS,
  bindingSpecificity,
  commandDef,
  matchesBinding,
  scopeChain,
  type CommandId,
  type CommandScope,
} from '@vibisual/shared';
import { useKeymapStore } from '../stores/keymap.js';
import { isComposingKeyEvent } from '../utils/inputComposition.js';

/**
 * **단축키를 실제로 듣는 곳 한 군데** — 리스너 하나, 무엇을 들을지는 `COMMANDS` 표와 사용자 키맵.
 * `window` capture 단계라 재매핑 캡처 중 다른 단축키가 먼저 발동하지 않고 옛 bubble 핸들러보다 먼저 판정한다.
 * 스코프는 스토어 상태가 아니라 `e.target` 조상(실제 DOM)으로 정한다 — 상태는 켜고 끄기가 한 번 어긋나면 단축키를 죽인다.
 */

/** 한 명령에 걸린 처리기. `true` 를 돌려주면 "내가 처리했다"(그 자리에서 멈춘다). */
export type CommandHandler = (e: KeyboardEvent) => boolean | void;

interface Registration {
  handler: CommandHandler;
  /** 꺼져 있으면 없는 것처럼 군다(조건부 단축키). */
  enabled: boolean;
  /** 나중에 등록된 것이 먼저다 — 위에 열린 창이 아래를 가린다. */
  seq: number;
}

const registry = new Map<CommandId, Registration[]>();
let seqCounter = 0;
let listenerInstalled = false;

/** 재매핑 캡처 중에 눌린 조합을 받아 가는 곳. 있으면 **모든 키를 삼킨다**. */
let captureSink: ((e: KeyboardEvent) => void) | null = null;

/** 재매핑 캡처 모드. 켜진 동안 keydown 을 통째로 삼킨다 — 안 그러면 `Ctrl+S` 를 배정하다 저장되고 `Escape` 에 창이 닫힌다. */
export function setKeyCaptureSink(sink: ((e: KeyboardEvent) => void) | null): void {
  captureSink = sink;
}

/** 입력 중인가 — 타이핑을 가로채면 안 되는 자리. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/** 이벤트 자리의 스코프 사슬(좁은 것 → 넓은 것). `xterm` 은 xterm.js 가 늘 붙이는 공개 클래스, 나머지는 컴포넌트 루트의 `data-*`. */
export function resolveEventScopes(target: EventTarget | null): CommandScope[] {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return ['global'];

  // 모달·팝오버가 가장 좁다 — 열려 있는 동안 그 안에서 난 키는 그쪽 것이다.
  if (el.closest('[data-shortcut-scope="dialog"]')) return scopeChain('dialog');

  if (el.closest('[data-ide-overlay]')) {
    if (el.closest('.xterm')) return scopeChain('terminal');
    // §5.5 #17-17 ㉔ — 무대도 이제 **그 판 안**이지만 편집 스코프는 아니다: 비추는 것이 지도일 때
    //   `Ctrl+S` 가 편집창의 저장으로 잡히면 열린 파일도 없이 도는 명령이 된다. 스코프를 정하는 것은
    //   **껍데기가 아니라 지금 비추는 것**이라, 무대 표식을 먼저 본다(더 좁은 것이 이긴다).
    if (el.closest('[data-ide-editor-pane]')) {
      if (el.closest('[data-ide-stage-pane]')) return scopeChain('ide');
      return scopeChain('editor');
    }
    return scopeChain('ide');
  }
  return scopeChain('canvas');
}

/** 그 명령을 지금 이 자리에서 들을 수 있는가. */
function isCommandAudible(
  id: CommandId,
  scopes: readonly CommandScope[],
  editable: boolean,
): boolean {
  const def = commandDef(id);
  if (!scopes.includes(def.scope)) return false;
  // 타이핑 중에는 `typingSafe` 만 산다 — 이 줄이 없으면 글을 쓰다 캔버스가 움직인다.
  if (editable && !def.typingSafe) return false;
  return true;
}

function handleKeyDown(e: KeyboardEvent): void {
  // ① 재매핑 캡처가 켜져 있으면 아무것도 통과시키지 않는다.
  if (captureSink) {
    e.preventDefault();
    e.stopImmediatePropagation();
    captureSink(e);
    return;
  }

  // ② 한글·일본어 조합 중에는 판정하지 않는다 — `ㅅ` 을 치는 도중 `s` 로 잡히면
  //    아무 데서나 저장이 튄다(IME 가 확정하기 전의 키는 우리 것이 아니다).
  if (isComposingKeyEvent(e)) return;

  const scopes = resolveEventScopes(e.target);
  const editable = isEditableTarget(e.target);
  const resolved = useKeymapStore.getState().resolved;

  // ③ 좁은 스코프부터 본다 — 편집기의 `Ctrl+S` 가 전역의 것을 가린다.
  for (const scope of scopes) {
    // 같은 스코프 안에서는 **좁은 바인딩**(진짜 Control)이 먼저다 — 판정이 `ctrlKey || metaKey` 라
    //   mac 의 ⌃G 는 ⌘G 자리(`Ctrl+G`, 다음 찾기)에도 맞는다(`bindingSpecificity`). 그 밖의 순서는
    //   종전 그대로(표에 등록된 차례 — 정렬은 안정적이다).
    const candidates: Array<{ regs: Registration[]; specificity: number }> = [];
    for (const [id, regs] of registry) {
      if (COMMANDS[id].scope !== scope) continue;
      if (!isCommandAudible(id, scopes, editable)) continue;
      const binding = resolved[id];
      if (!binding || !matchesBinding(e, binding)) continue;
      candidates.push({ regs, specificity: bindingSpecificity(binding) });
    }
    candidates.sort((a, b) => b.specificity - a.specificity);

    for (const { regs } of candidates) {
      // 나중에 등록된 것부터(위에 열린 창이 아래를 가린다).
      const ordered = [...regs].filter((r) => r.enabled).sort((a, b) => b.seq - a.seq);
      for (const reg of ordered) {
        const handled = reg.handler(e);
        if (handled !== false) {
          e.preventDefault();
          // 삼킨다 — 이 키를 아래로 흘려보내면 xterm 이 같은 조합을 셸로 보내고(§5.5 #17-37 ④),
          // 아직 이관되지 않은 옛 window 핸들러가 같은 동작을 한 번 더 한다.
          e.stopPropagation();
          return;
        }
        // `false` 를 돌려준 처리기는 "이번엔 내 것이 아니다" — 다음 후보로 넘긴다.
      }
    }
  }
}

function ensureListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return;
  window.addEventListener('keydown', handleKeyDown, true);
  listenerInstalled = true;
}

/**
 * 이 명령이 눌리면 부른다. 키는 여기서 정하지 않는다(`COMMANDS` 표와 사용자 키맵). `enabled: false` 면 없는 것처럼 군다.
 * 처리기가 `false` 를 돌려주면 다음 후보로 넘어간다(여러 화면이 듣고 하나만 대상을 가질 때).
 */
export function useCommand(
  id: CommandId,
  handler: CommandHandler,
  opts: { enabled?: boolean } = {},
): void {
  const enabled = opts.enabled ?? true;
  // 처리기는 매 렌더 새 함수라, 그대로 의존성에 두면 등록이 매 렌더 풀렸다 다시 걸린다.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    ensureListener();
    const reg: Registration = {
      handler: (e) => handlerRef.current(e),
      enabled,
      seq: (seqCounter += 1),
    };
    const list = registry.get(id) ?? [];
    list.push(reg);
    registry.set(id, list);
    return () => {
      const cur = registry.get(id);
      if (!cur) return;
      const at = cur.indexOf(reg);
      if (at >= 0) cur.splice(at, 1);
      if (cur.length === 0) registry.delete(id);
    };
  }, [id, enabled]);
}

/** 지금 이 명령을 듣는 곳이 있는가 — 힌트·오버레이가 지금 누를 수 있는 키만 보이는 데 쓴다. */
export function isCommandLive(id: CommandId): boolean {
  return (registry.get(id) ?? []).some((r) => r.enabled);
}

/** 지금 살아 있는 명령 전부(오버레이가 그린다). */
export function liveCommandIds(): CommandId[] {
  const out: CommandId[] = [];
  for (const [id, regs] of registry) {
    if (regs.some((r) => r.enabled)) out.push(id);
  }
  return out;
}

/** 테스트 전용 — 등록을 비운다(모듈 상태가 파일 사이로 새지 않게). */
export function __resetCommandRegistry(): void {
  registry.clear();
  captureSink = null;
}
