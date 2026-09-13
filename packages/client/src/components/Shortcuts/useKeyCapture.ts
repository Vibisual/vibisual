import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bindingFromEvent,
  inspectBinding,
  blocksAssignment,
  COMMANDS,
  type BindingIssue,
  type CommandId,
} from '@vibisual/shared';
import { setKeyCaptureSink } from '../../hooks/useCommand.js';
import { useKeymapStore } from '../../stores/keymap.js';
import { clientKeyPlatform } from '../../utils/platform.js';

/**
 * useKeyCapture.ts — **"키를 눌러 보세요" 상태 하나.**
 *
 * 재매핑은 두 곳(힌트 안 · 설정 표)에서 일어나는데 그 둘이 각자 캡처를 구현하면 한쪽만 고쳐져
 * 어긋난다. 그래서 캡처의 규칙은 여기 한 벌이다.
 *
 * ## 캡처 중에는 모든 키를 삼킨다
 * `setKeyCaptureSink` 가 `window` capture 단계에서 keydown 을 통째로 가로챈다. 이게 없으면
 * `Ctrl+S` 를 배정하려는 순간 파일이 저장되고, `Escape` 를 배정하려는 순간 창이 닫힌다.
 *
 * ## 세 가지 손짓
 * - `Escape` — 취소(아무것도 바꾸지 않는다)
 * - `Backspace`(모디파이어 없이) — **해제**(그 명령을 키보드에서 내린다)
 * - 그 외 조합 — 그 자리에서 잡히고, **즉시** 충돌 판정이 붙는다
 */

export interface KeyCaptureState {
  /** 지금 잡는 중인가. */
  capturing: boolean;
  /** 잡힌 조합(정규 표기). 아직 키를 안 눌렀으면 `null`. */
  pending: string | null;
  /** 잡힌 조합에 걸리는 것들. */
  issues: BindingIssue[];
  /** 확정을 막는 문제가 있는가. */
  blocked: boolean;
  /** 충돌 상대에게서 키를 뺏어오면 풀리는가(= 막는 이유가 충돌뿐인가). */
  stealable: CommandId[];

  start: () => void;
  cancel: () => void;
  /** 잡힌 조합을 확정. 상대에게서 뺏어올지 여부. */
  commit: (steal?: boolean) => Promise<void>;
  /** 그 명령을 키보드에서 내린다. */
  unbind: () => Promise<void>;
}

export function useKeyCapture(id: CommandId): KeyCaptureState {
  const [capturing, setCapturing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const resolved = useKeymapStore((s) => s.resolved);
  const setBinding = useKeymapStore((s) => s.setBinding);

  // 캡처 중에는 스토어가 바뀌어도 리스너를 다시 걸지 않는다 — 다시 걸리는 순간 사용자가 누르고
  // 있던 조합이 흘러가 버린다. 최신 값은 ref 로 읽는다.
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  const cancel = useCallback(() => {
    setCapturing(false);
    setPending(null);
  }, []);

  const start = useCallback(() => {
    setPending(null);
    setCapturing(true);
  }, []);

  const unbind = useCallback(async () => {
    setCapturing(false);
    setPending(null);
    await setBinding(id, null);
  }, [id, setBinding]);

  const platform = clientKeyPlatform();
  const issues = pending ? inspectBinding(id, pending, resolved, platform) : [];
  const blocked = blocksAssignment(issues);
  // OS 예약은 뺏어올 수 없다 — 상대가 우리 앱이 아니다.
  const reserved = issues.some((i) => i.kind === 'os-reserved');
  const stealable = reserved
    ? []
    : issues.filter((i) => i.kind === 'conflict').flatMap((i) => i.with);

  const commit = useCallback(async (steal = false) => {
    if (!pending) return;
    const conflicting = inspectBinding(id, pending, resolvedRef.current, platform)
      .filter((i) => i.kind === 'conflict')
      .flatMap((i) => i.with);
    if (steal) {
      // 뺏어오기 = 상대에게서 그 키를 내린다. 상대를 기본값으로 되돌리면 같은 키가 되살아나
      // 다시 충돌하므로, 되돌리기(`resetBinding`)가 아니라 **해제**(`null`)여야 한다.
      for (const other of conflicting) await setBinding(other, null);
    } else if (conflicting.length > 0) {
      return; // 막힌 상태에서 그냥 확정하지 않는다.
    }
    setCapturing(false);
    setPending(null);
    await setBinding(id, pending);
  }, [id, pending, platform, setBinding]);

  useEffect(() => {
    if (!capturing) return;
    setKeyCaptureSink((e) => {
      if (e.key === 'Escape') { cancel(); return; }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        void unbind();
        return;
      }
      const next = bindingFromEvent(e, platform);
      // 모디파이어만 눌린 중간 상태(`Ctrl` 을 누르고 있는 동안)는 아직 조합이 아니다 —
      // 지우지 않고 그대로 둔다(누르다 만 것처럼 깜빡이지 않게).
      if (next) setPending(next);
    });
    return () => setKeyCaptureSink(null);
  }, [capturing, cancel, unbind, platform]);

  // 이 컴포넌트가 사라져도 캡처가 남아 앱 전체 키가 먹통이 되면 안 된다.
  useEffect(() => () => setKeyCaptureSink(null), []);

  return { capturing, pending, issues, blocked, stealable, start, cancel, commit, unbind };
}

/** 그 명령이 기본 바인딩과 다른가. */
export function isBindingChanged(id: CommandId, binding: string | null): boolean {
  return binding !== COMMANDS[id].defaultBinding;
}
