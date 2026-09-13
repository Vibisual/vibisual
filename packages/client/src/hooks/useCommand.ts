import { useEffect, useRef } from 'react';
import {
  COMMANDS,
  commandDef,
  matchesBinding,
  scopeChain,
  type CommandId,
  type CommandScope,
} from '@vibisual/shared';
import { useKeymapStore } from '../stores/keymap.js';

/**
 * useCommand.ts — **단축키를 실제로 듣는 곳 한 군데.**
 *
 * 여태 `keydown` 은 78개 파일 128곳에서 각자 `window.addEventListener` 를 걸었다. 그래서
 * ① 어떤 키가 있는지 아무도 모르고 ② 재매핑할 자리가 없고 ③ 충돌을 볼 방법이 없었다.
 * 이 모듈은 그 셋을 한 번에 푼다 — **리스너는 하나**이고, 무엇을 들을지는 `COMMANDS` 표와
 * 사용자 키맵이 정한다.
 *
 * ## 왜 capture 단계인가
 * `window` 의 capture 는 전파 경로의 **맨 앞**이다. 그래서 (a) 재매핑 캡처 중에 다른 단축키가
 * 먼저 발동하는 사고를 막을 수 있고(`Ctrl+S` 를 잡으려다 파일이 저장되는 그 사고),
 * (b) 이관되지 않은 옛 핸들러(bubble 단계)보다 항상 먼저 판정한다.
 *
 * ## 스코프는 상태가 아니라 **이벤트가 일어난 자리**로 정한다
 * "지금 활성 스코프"를 스토어에 들면 그 값을 켜고 끄는 쪽이 한 번 실패할 때마다 단축키가 통째로
 * 죽거나 엉뚱한 데서 산다. 대신 `e.target` 의 조상을 보고 그 자리의 스코프 사슬을 만든다 —
 * 판정 근거가 화면에 실제로 그려진 DOM 이라 어긋날 수가 없다.
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

/**
 * 재매핑 캡처 모드를 켠다/끈다.
 *
 * 켜져 있는 동안 이 리스너가 keydown 을 통째로 삼킨다(`preventDefault` +
 * `stopImmediatePropagation`). 안 그러면 `Ctrl+S` 를 배정하려다 파일이 저장되고,
 * `Escape` 를 배정하려다 창이 닫힌다.
 */
export function setKeyCaptureSink(sink: ((e: KeyboardEvent) => void) | null): void {
  captureSink = sink;
}

/** 입력 중인가 — 타이핑을 가로채면 안 되는 자리. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * 이벤트가 일어난 자리의 스코프 사슬(좁은 것 → 넓은 것).
 *
 * DOM 표식으로 판정한다 — `xterm` 은 xterm.js 가 자기 컨테이너에 항상 붙이는 공개 클래스이고,
 * 나머지는 우리가 그 컴포넌트 루트에 붙여 둔 `data-*` 다.
 */
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
  if (e.isComposing || e.keyCode === 229) return;

  const scopes = resolveEventScopes(e.target);
  const editable = isEditableTarget(e.target);
  const resolved = useKeymapStore.getState().resolved;

  // ③ 좁은 스코프부터 본다 — 편집기의 `Ctrl+S` 가 전역의 것을 가린다.
  for (const scope of scopes) {
    for (const [id, regs] of registry) {
      if (COMMANDS[id].scope !== scope) continue;
      if (!isCommandAudible(id, scopes, editable)) continue;
      const binding = resolved[id];
      if (!binding || !matchesBinding(e, binding)) continue;

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
 * 이 명령이 눌리면 이 함수를 부른다.
 *
 * ```ts
 * useCommand('canvas.copy', () => copySelection());
 * ```
 *
 * - 어떤 키인지는 **여기서 정하지 않는다** — `COMMANDS` 표와 사용자 키맵이 정한다.
 *   그래서 사용자가 설정에서 키를 바꾸면 이 자리는 한 줄도 안 고치고 그대로 따라간다.
 * - `enabled: false` 면 없는 것처럼 군다(조건부 단축키).
 * - 처리기가 `false` 를 돌려주면 "이번엔 내 것이 아니다"라는 뜻이라 다음 후보에게 넘어간다
 *   (같은 명령을 여러 화면이 듣고 있고, 그중 하나만 지금 대상을 갖고 있을 때).
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

/**
 * 지금 이 명령을 듣고 있는 곳이 하나라도 있는가.
 *
 * 힌트·오버레이가 "이 화면에서 실제로 쓸 수 있는 것만" 보여 주는 데 쓴다 — 표에 있다고 다
 * 보여 주면, 지금 누를 수 없는 키까지 알려 주는 셈이 되어 오히려 불친절해진다.
 */
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
