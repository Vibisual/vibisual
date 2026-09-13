import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { COMMANDS, type CommandId } from '@vibisual/shared';
import { useKeymapStore, selectBinding } from '../../stores/keymap.js';
import { KeyCap } from './KeyCap.js';
import { useKeyCapture } from './useKeyCapture.js';
import { COMMAND_LABEL_EN } from './commandLabels.js';

/**
 * KeyHint.tsx — **키캡 + 그 자리에서 바꾸기.**
 *
 * VS Code 는 재매핑을 설정 페이지에서만 할 수 있는데, 그 왕복이 곧 아무도 안 바꾸는 이유다.
 * 여기서는 힌트로 떠 있는 키캡을 **그 자리에서** 누르면 바뀐다.
 *
 * 디자인을 침범하지 않기 위한 두 가지:
 *  - 연필 글리프는 **호버할 때만** 나타난다(평소에는 키캡만 — 늘어난 자리 0).
 *  - 바꾸는 상자는 `createPortal` 로 띄운다(부모가 `overflow-hidden` 이어도 잘리지 않고,
 *    원래 화면 배치가 1px 도 안 움직인다).
 */

interface KeyHintProps {
  cmd: CommandId;
  /** 눌러서 바꿀 수 있는가. 읽기 전용 자리(메뉴 항목 등)에서는 `false`. */
  editable?: boolean;
  tone?: 'muted' | 'strong';
  /** 칩 크기 — 조밀한 메뉴에서는 `sm`(§5.4 #34). 그대로 `KeyCap` 에 흘려보낸다. */
  size?: 'sm' | 'md';
  className?: string;
}

export function KeyHint({
  cmd,
  editable = true,
  tone = 'muted',
  size = 'md',
  className,
}: KeyHintProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const binding = useKeymapStore(selectBinding(cmd));
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const capture = useKeyCapture(cmd);

  const open = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setRect(el.getBoundingClientRect());
    capture.start();
  }, [capture]);

  const close = useCallback(() => {
    capture.cancel();
    setRect(null);
  }, [capture]);

  // 캡처가 밖에서 끝났으면(확정·해제) 상자도 닫는다.
  useEffect(() => {
    if (!capture.capturing) setRect(null);
  }, [capture.capturing]);

  // 해제된 명령은 키캡이 없다 — 바꿀 수 있는 자리에서는 "없음"을 눌러 붙일 수 있게 둔다.
  if (!binding && !editable) return null;

  return (
    <span ref={anchorRef} className={`group/keyhint inline-flex items-center gap-1 ${className ?? ''}`}>
      {binding
        ? <KeyCap binding={binding} tone={tone} size={size} />
        : (
          <span className="inline-flex h-5 items-center rounded border border-dashed border-gray-700 px-1 font-mono text-xs leading-none text-gray-600">
            {t('common.shortcuts.unbound', { defaultValue: 'none' })}
          </span>
        )}
      {editable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); open(); }}
          title={t('common.shortcuts.remap', { defaultValue: 'Change shortcut' })}
          aria-label={t('common.shortcuts.remap', { defaultValue: 'Change shortcut' })}
          className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded text-gray-500 opacity-0 transition-opacity hover:text-gray-200 focus-visible:opacity-100 group-hover/keyhint:opacity-100"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
      {rect && createPortal(
        <KeyCaptureBox cmd={cmd} anchor={rect} capture={capture} onClose={close} />,
        document.body,
      )}
    </span>
  );
}

/** 상자 폭(px) — 충돌 한 줄이 읽히는 폭. */
const BOX_WIDTH = 300;
/** 화면 가장자리에서 이만큼은 띄운다(px). */
const EDGE_GAP = 8;

interface KeyCaptureBoxProps {
  cmd: CommandId;
  anchor: DOMRect;
  capture: ReturnType<typeof useKeyCapture>;
  onClose: () => void;
}

/**
 * "키를 눌러 보세요" 상자.
 *
 * `data-shortcut-scope="dialog"` 를 달아 이 안에서 난 키는 대화상자 스코프로 읽히게 한다 —
 * 다만 캡처가 켜져 있는 동안에는 디스패처가 애초에 모든 키를 삼키므로 실제로는 도달하지 않는다.
 */
function KeyCaptureBox({ cmd, anchor, capture, onClose }: KeyCaptureBoxProps): React.JSX.Element {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);

  // 바깥을 누르면 닫는다 — §6 팝업 닫기 공통 규약 하나만 쓴다(직접 리스너는 `popupDismissContract`
  //   테스트가 막는다). 상자 **안에서 시작한** 제스처로는 닫히지 않는다.
  useOutsidePressDismiss({ onDismiss: onClose, refs: [boxRef] });

  const left = Math.min(
    Math.max(EDGE_GAP, anchor.left + anchor.width / 2 - BOX_WIDTH / 2),
    Math.max(EDGE_GAP, window.innerWidth - BOX_WIDTH - EDGE_GAP),
  );
  const top = anchor.bottom + 6;

  const conflict = capture.issues.find((i) => i.kind === 'conflict');
  const reserved = capture.issues.find((i) => i.kind === 'os-reserved');
  const shadow = capture.issues.find((i) => i.kind === 'shadow');
  const typing = capture.issues.find((i) => i.kind === 'typing-risk');

  const nameOf = (id: CommandId): string =>
    t(COMMANDS[id].labelKey, { defaultValue: COMMAND_LABEL_EN[id] });

  return (
    <div
      ref={boxRef}
      data-shortcut-scope="dialog"
      className="fixed z-[200] rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-2xl"
      style={{ left, top, width: BOX_WIDTH }}
    >
      <div className="mb-2 truncate text-xs font-semibold text-gray-200">{nameOf(cmd)}</div>

      <div className="mb-2 flex h-9 items-center justify-center rounded border border-dashed border-gray-600 bg-gray-800/60">
        {capture.pending
          ? <KeyCap binding={capture.pending} tone="strong" />
          : <span className="text-xs text-gray-500">{t('common.shortcuts.pressKeys', { defaultValue: 'Press the keys you want' })}</span>}
      </div>

      {reserved && (
        <p className="mb-2 text-xs leading-relaxed text-rose-300">
          {t('common.shortcuts.issue.osReserved', { defaultValue: 'The operating system already uses this combination — the key never reaches us.' })}
        </p>
      )}
      {!reserved && conflict && (
        <p className="mb-2 text-xs leading-relaxed text-rose-300">
          {t('common.shortcuts.issue.conflict', {
            names: conflict.with.map(nameOf).join(', '),
            defaultValue: 'Already used by {{names}}.',
          })}
        </p>
      )}
      {!conflict && !reserved && shadow && (
        <p className="mb-2 text-xs leading-relaxed text-amber-300">
          {t('common.shortcuts.issue.shadow', {
            names: shadow.with.map(nameOf).join(', '),
            defaultValue: 'Takes over {{names}} while this area has focus.',
          })}
        </p>
      )}
      {!conflict && !reserved && typing && (
        <p className="mb-2 text-xs leading-relaxed text-amber-300">
          {t('common.shortcuts.issue.typingRisk', { defaultValue: 'No modifier key — this will not fire while you are typing.' })}
        </p>
      )}

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => void capture.unbind()}
          className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
        >
          {t('common.shortcuts.unbindAction', { defaultValue: 'Unbind' })}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
        >
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </button>
        {capture.stealable.length > 0 ? (
          <button
            type="button"
            onClick={() => void capture.commit(true)}
            className="rounded bg-rose-600/80 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-600"
          >
            {t('common.shortcuts.stealAction', { defaultValue: 'Take it over' })}
          </button>
        ) : (
          <button
            type="button"
            disabled={!capture.pending || capture.blocked}
            onClick={() => void capture.commit(false)}
            className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            {t('common.confirm', { defaultValue: 'Confirm' })}
          </button>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-gray-500">
        {t('common.shortcuts.captureHelp', { defaultValue: 'Esc cancels · Backspace unbinds' })}
      </p>
    </div>
  );
}
