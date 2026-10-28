import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { SessionMemoLink, SessionMemoLinkKind } from '@vibisual/shared';
import { shortcutLabel } from '../../utils/platform.js';
import { MemoLinkIcon } from './memoLinkIcons.js';
import { memoLinkTargetText } from './memoLinks.js';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import type { MemoLinkHost } from './useMemoLinkHost.js';
import { followVisibleViewport, placeBelowAnchor, visibleViewport } from './popupPlacement.js';

/** §5.5 #17-36 ⑫ — 링크 상자. 본문 클릭은 캐럿이라 따라가기는 [이동]·Ctrl/Cmd+클릭뿐. 입력칸 초점을 뺏지 않고, 카드의 overflow·transform 에 갇히지 않게 body 로 포털한다. */

/** 링크 상자·링크 창의 층 — 전역 글자 메뉴(`GlobalTextFieldContextMenu`)와 같은 높이. 모달 위에서도 떠야 한다. */
export const MEMO_LINK_POPUP_Z = 1_000_000;

/** 종류 이름 키 — 글자 그대로 적어 둔다(키를 이어 붙여 만들면 번역 검사가 그 키를 못 본다). */
export const MEMO_LINK_KIND_NAME_KEY: Record<SessionMemoLinkKind, string> = {
  stream: 'ide.memo.link.kind.stream',
  session: 'ide.memo.link.kind.session',
  file: 'ide.memo.link.kind.file',
  url: 'ide.memo.link.kind.url',
};

/** 링크 글자와 상자 사이(px). 화면 가장자리 여백은 떠 있는 상자들과 한 벌이다(`popupPlacement`). */
const GAP = 6;

interface MemoLinkBubbleProps {
  memoId: string;
  link: SessionMemoLink;
  /** 링크 글자의 화면 사각형(거울 층에서 잰 첫 줄). */
  anchor: { left: number; top: number; bottom: number };
  host: MemoLinkHost;
  /** 따라간다 — 못 가면 false(상자가 그 사실을 말한다). */
  onFollow: () => Promise<boolean>;
  /** 다시 고르기 — 종류 목록을 그 자리에 연다. */
  onRepick: (at: { x: number; y: number }) => void;
  onRemove: () => void;
  onBlur: (e: React.FocusEvent<HTMLDivElement>) => void;
  onReturnToText: () => void;
}

export function MemoLinkBubble({ memoId, link, anchor, host, onFollow, onRepick, onRemove, onBlur, onReturnToText }: MemoLinkBubbleProps): React.JSX.Element {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const repickRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const target = link.target;
  // 세션을 가리키는 링크는 지금 그 탭이 있는지를 묻는다 — 이름은 살아 있는 이름이 이긴다.
  const session = target.kind === 'session' ? host.sessionInfo(target.sessionId) : null;
  const gone = session !== null && !session.alive;
  const kindName = t(MEMO_LINK_KIND_NAME_KEY[target.kind]);
  const text = memoLinkTargetText(target, session?.alive ? session.label : null) || kindName;
  const shortcut = shortcutLabel('Ctrl');

  // 자리 잡기 — 링크 글자 바로 아래, 넘치면 위로. **보이는 화면** 밖으로는 나가지 않는다 — 메모 본문을 고치는 중이라
  //   폰에서는 가상 키보드가 늘 떠 있다(`innerHeight` 로 재면 상자가 키보드 밑에 깔린다). 키보드가 오르내리면 다시 잰다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const at = { left: anchor.left, top: anchor.top, bottom: anchor.bottom };
    return followVisibleViewport(() => {
      const { left, top } = placeBelowAnchor(at, el.getBoundingClientRect(), visibleViewport(), GAP);
      setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    });
  }, [anchor.left, anchor.top, anchor.bottom, failed, gone, text]);

  const follow = (): void => {
    setFailed(false);
    void onFollow().then((ok) => { if (!ok) setFailed(true); });
  };

  const repick = (): void => {
    const r = repickRef.current?.getBoundingClientRect();
    onRepick(r ? { x: r.left, y: r.bottom + 2 } : { x: anchor.left, y: anchor.bottom + GAP });
  };

  return createPortal(
    <div
      ref={ref}
      data-memo-link-bubble={memoId}
      role="group"
      aria-label={t('ide.memo.link.menu')}
      className="fixed flex max-w-[min(22rem,calc(100vw-16px))] flex-col gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1.5 text-[12px] text-gray-200 shadow-xl shadow-black/40"
      // 자리는 재어 본 뒤에야 안다 — 첫 프레임은 숨겨 두어 한 번 튀는 것을 보이지 않는다.
      style={{
        left: pos?.left ?? anchor.left,
        top: pos?.top ?? anchor.bottom + GAP,
        zIndex: MEMO_LINK_POPUP_Z,
        visibility: pos ? 'visible' : 'hidden',
      }}
      // 입력칸의 초점·선택을 지킨다 — 상자를 눌러도 캐럿은 링크 안에 그대로 있다.
      onMouseDown={(e) => e.preventDefault()}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key !== 'Tab' || !e.shiftKey || isComposingKeyEvent(e.nativeEvent)) return;
        if (e.target !== e.currentTarget.querySelector('button:not(:disabled)')) return;
        e.preventDefault();
        onReturnToText();
      }}
      // 포털이라도 리액트 이벤트는 조상(대화 본문)으로 오른다 — 본문의 클릭·글자 메뉴가 같이 돌지 않게 끊는다.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex-shrink-0 text-sky-300" title={kindName}>
          <MemoLinkIcon name={target.kind} />
        </span>
        <span className="min-w-0 flex-1 truncate" title={text}>{text}</span>
        <button
          type="button"
          onClick={follow}
          disabled={gone}
          title={gone ? t('ide.memo.link.sessionGone') : t('ide.memo.link.followTitle', { shortcut })}
          aria-label={t('ide.memo.link.follow')}
          className="flex h-6 flex-shrink-0 items-center gap-1 rounded px-1.5 text-sky-200 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent pointer-coarse:h-8"
        >
          <MemoLinkIcon name="follow" />
          <span>{t('ide.memo.link.go')}</span>
        </button>
        <button
          ref={repickRef}
          type="button"
          onClick={repick}
          title={t('ide.memo.link.repick')}
          aria-label={t('ide.memo.link.repick')}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-300 transition-colors hover:bg-white/10 pointer-coarse:h-8 pointer-coarse:w-8"
        >
          <MemoLinkIcon name="repick" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title={t('ide.memo.link.remove')}
          aria-label={t('ide.memo.link.remove')}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-300 transition-colors hover:bg-rose-500/25 pointer-coarse:h-8 pointer-coarse:w-8"
        >
          <MemoLinkIcon name="unlink" />
        </button>
      </div>
      {(gone || failed) && (
        <div className="text-[12px] leading-snug text-rose-300">
          {gone ? t('ide.memo.link.sessionGone') : t('ide.memo.link.openFailed')}
        </div>
      )}
    </div>,
    document.body,
  );
}
