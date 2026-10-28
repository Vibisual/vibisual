import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { placeAnchoredMenu } from '../Layout/anchoredMenuPlacement.js';
import { COMMANDS, type CommandId } from '@vibisual/shared';
import { useKeymapStore, selectBinding } from '../../stores/keymap.js';
import { KeyCap } from './KeyCap.js';
import { useKeyCapture } from './useKeyCapture.js';
import { COMMAND_LABEL_EN } from './commandLabels.js';

/** 키캡 + 그 자리 재매핑. 연필은 호버 때만(자리 0), 상자는 `createPortal`(`overflow-hidden` 에 안 잘리고 배치 불변). */

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
          // 터치에는 호버가 없다 — 늘 보이게 하고 누르는 자리를 32px 로 넓힌다(키보드를 단 태블릿에서도 바꿀 수 있게).
          className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded text-gray-500 opacity-0 transition-opacity hover:text-gray-200 focus-visible:opacity-100 group-hover/keyhint:opacity-100 pointer-coarse:h-8 pointer-coarse:w-8 pointer-coarse:opacity-100"
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
/** 키캡과 상자 사이(px). */
const BOX_GAP = 6;

interface KeyCaptureBoxProps {
  cmd: CommandId;
  anchor: DOMRect;
  capture: ReturnType<typeof useKeyCapture>;
  onClose: () => void;
}

/** 캡처 상자. `data-shortcut-scope="dialog"` 는 안전망 — 캡처 중엔 디스패처가 모든 키를 먼저 삼킨다. */
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
  const top = anchor.bottom + BOX_GAP;

  // 그리기 직전에 실제 높이를 재서 아래가 모자라면 위로 뒤집는다(안 재면 화면 아래쪽 키캡에서 밖에 열린다). 가로는 `placeAnchoredMenu` 와 같은 계산.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const visual = window.visualViewport;
    const position = placeAnchoredMenu(
      anchor,
      box.getBoundingClientRect(),
      {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
      },
      'center',
      BOX_GAP,
    );
    box.style.left = `${position.left}px`;
    box.style.top = `${position.top}px`;
  });

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
      className="fixed z-[200] max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-2xl"
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

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => void capture.unbind()}
          className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:py-2"
        >
          {t('common.shortcuts.unbindAction', { defaultValue: 'Unbind' })}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:py-2"
        >
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </button>
        {capture.stealable.length > 0 ? (
          <button
            type="button"
            onClick={() => void capture.commit(true)}
            className="rounded bg-rose-600/80 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-600 pointer-coarse:py-2"
          >
            {t('common.shortcuts.stealAction', { defaultValue: 'Take it over' })}
          </button>
        ) : (
          <button
            type="button"
            disabled={!capture.pending || capture.blocked}
            onClick={() => void capture.commit(false)}
            className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500 pointer-coarse:py-2"
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
