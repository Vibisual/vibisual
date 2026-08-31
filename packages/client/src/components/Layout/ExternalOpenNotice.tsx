import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ExternalOpenFailure } from '@vibisual/shared';

/**
 * §3.7 — 바깥 브라우저 열기가 실패했을 때 그 사실을 알리는 안내(폴백 ❌).
 *
 * 앱 안의 "브라우저로 열기"는 전부 한 길을 지난다 — `window.open(url,'_blank')` →
 * main `setWindowOpenHandler` → `shell.openExternal`. 그 길은 오랫동안 **실패를 한 번도
 * 말하지 않았다**. 리눅스 설치본에서 로그인 창의 [Open in browser] 를 눌러도 아무 반응이
 * 없던 것이 그 결과다(배포판에 브라우저가 0개면 xdg-open 이 아무것도 못 찾는다).
 *
 * ⚠️ **여기서 대신 열어 주지 않는다(사용자 명시 결정).** 우리가 임의로 고른 창에 OAuth
 * 주소를 넘기는 것은 사용자가 그은 선이 아니다. 할 일은 "안 열렸다"를 말하고 **주소를
 * 손에 쥐여 주는 것**까지다 — 그래서 [복사] 가 안내 안에 함께 있다.
 *
 * **부팅 지점(main.tsx)에서 한 번만 마운트한다** — `InspectorOverlay`·
 * `GlobalTextFieldContextMenu` 와 같은 이유다. 별창·오버레이 창·지휘통제실 창·내부 앱 창
 * 어디서든 링크를 누르고, shell 안쪽에 두면 그 창들에서는 통째로 죽는다.
 */

// 온보딩 게이트 중 가장 위(ClaudeSetupGate 100_700)보다도 위 — 그 창들 **안의** 링크가
// 실패하는 경우가 정확히 우리가 고치려는 그 상황이라, 그 아래에 깔리면 보이지 않는다.
const Z = 100_800;

/** 안내는 스스로 사라지지 않는다 — 주소를 읽고 복사할 시간이 필요하다. */
export function ExternalOpenNotice(): React.ReactElement | null {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<ExternalOpenFailure | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // 모바일 웹(§4 v3.16)에는 preload 가 없다 — 그 창에서는 조용히 아무것도 하지 않는다.
    const bridge = window.api?.externalOpen;
    if (!bridge) return;
    return bridge.onFailed((payload) => {
      setCopied(false);
      setFailure(payload);
    });
  }, []);

  useEffect(() => {
    if (!copied) return;
    const tid = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(tid);
  }, [copied]);

  const handleCopy = useCallback(() => {
    if (!failure) return;
    void navigator.clipboard
      .writeText(failure.url)
      .then(() => setCopied(true))
      .catch(() => {});
  }, [failure]);

  const handleDismiss = useCallback(() => setFailure(null), []);

  if (!failure) return null;

  const message =
    failure.reason === 'no-browser'
      ? t('common.externalOpen.noBrowser', {
          defaultValue: '브라우저를 찾지 못했습니다 — 링크를 복사해 여세요',
        })
      : t('common.externalOpen.openFailed', {
          defaultValue: '링크를 열지 못했습니다 — 링크를 복사해 여세요',
        });

  return createPortal(
    <div
      className="fixed left-1/2 top-14 flex max-w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 rounded-lg border border-amber-600/60 bg-amber-950/95 px-3.5 py-3 shadow-xl"
      style={{ zIndex: Z }}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-px h-4 w-4 shrink-0 text-amber-300"
          aria-hidden="true"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-amber-100">{message}</span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('common.close', { defaultValue: 'Close' })}
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-amber-300/70 transition-colors hover:bg-amber-900/60 hover:text-amber-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div className="flex items-center gap-2">
        {/* 주소는 자를 수 있어야 안내가 창을 넘지 않는다(min-w-0 + truncate 가 한 쌍). */}
        <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1 text-[12px] text-amber-200/90">
          {failure.url}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md border border-amber-600/60 px-2.5 py-1 text-[12px] font-medium text-amber-100 transition-colors hover:bg-amber-900/60"
        >
          {copied
            ? t('common.externalOpen.copied', { defaultValue: '복사함' })
            : t('common.externalOpen.copy', { defaultValue: '복사' })}
        </button>
      </div>
    </div>,
    document.body,
  );
}
