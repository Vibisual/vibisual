import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { workspaceSiteSrc } from '../../utils/workspaceSite.js';
import {
  EMPTY_HTML_PREVIEW_HISTORY,
  canGoBack,
  canGoForward,
  htmlPreviewAddress,
  pushHtmlPreviewHistory,
  readHtmlPreviewReport,
  stepHtmlPreviewHistory,
  withCacheToken,
  type HtmlPreviewHistory,
} from './htmlPreviewNav.js';

/**
 * IDEHtmlPreview.tsx — §5.5 #17-27 ⑮ 편집창 안의 **작은 브라우저**.
 *
 * `CodeEditor`·`IDEImagePreview` 와 형제다 — 같은 자리에 셋 중 하나만 선다. 여기가 하는 일은
 * 둘뿐이다: 페이지를 그리는 iframe 하나와, 그 위의 얇은 조작 줄(뒤로·앞으로·새로고침·주소·
 * 처음으로·바깥 브라우저).
 *
 * **렌더링 엔진을 우리가 만들지 않는다** — Chromium 이 이미 한다(PDF 를 내장 뷰어에 맡긴
 * §5.13 (R) 과 같은 판단). 폭 프리셋·요소 집기 같은 프리뷰 도구도 여기 없다 — 그 자리의
 * 주인은 §7.11 프리뷰이고, 여기는 **파일 한 장**을 보는 자리다.
 */

interface IDEHtmlPreviewProps {
  /** 프로젝트 루트 절대 경로. */
  root: string;
  /** 루트 기준 상대 경로(열려 있는 그 파일). */
  relPath: string;
  /** 디스크 수정 시각. 저장하거나 밖에서 바뀌면 이 값이 달라지고, 그때 페이지가 다시 그려진다(⑮ (e)). */
  mtimeMs: number;
  /** OS 기본 브라우저로 넘긴다(§5.13 (R-6) 재사용 — 새 레일 ❌). */
  onOpenExternal: () => void;
}

/** 조작 줄 버튼 — 손잡이 줄(#17-27 ⑩)과 같은 톤이라 두 줄이 한 벌로 읽힌다. */
function BarButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex-shrink-0 rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-25"
    >
      {children}
    </button>
  );
}

export const IDEHtmlPreview = memo(function IDEHtmlPreview({
  root,
  relPath,
  mtimeMs,
  onOpenExternal,
}: IDEHtmlPreviewProps): React.JSX.Element {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);

  /**
   * 캐시 무력화 토큰. 처음에는 디스크 수정 시각이고, [새로고침] 을 누르면 지금 시각이 된다 —
   * 저장 → 화면이 안 바뀜(브라우저 캐시)이 이 항목에서 가장 흔한 실패라 URL 자체를 바꾼다.
   */
  const [token, setToken] = useState(() => mtimeMs);
  // 아래 효과와 **같은 식**으로 시작한다 — 다르면 마운트 직후 한 번 더 실어 오게 된다.
  const [src, setSrc] = useState(() => withCacheToken(workspaceSiteSrc(root, relPath), token));
  const [current, setCurrent] = useState<string | null>(null);
  const [history, setHistory] = useState<HtmlPreviewHistory>(EMPTY_HTML_PREVIEW_HISTORY);

  /** 다른 파일로 갈아탔다 — 기록도 주소도 처음부터 다시 센다(옛 파일의 기록이 남으면 안 된다). */
  useEffect(() => {
    setCurrent(null);
    setHistory(EMPTY_HTML_PREVIEW_HISTORY);
  }, [root, relPath]);

  /** 파일이 디스크에서 바뀌면(저장 포함) 그 자리에서 다시 그린다 — 보고 있던 페이지 그대로. */
  useEffect(() => {
    setToken(mtimeMs);
  }, [mtimeMs]);

  /**
   * 토큰이 바뀌면 **지금 보고 있는 곳**을 다시 연다(열었던 파일이 아니라). 페이지 안 링크를 타고
   * 다른 파일에 가 있는데 저장 한 번에 첫 페이지로 튕기면, 고치면서 확인하는 흐름이 매번 끊긴다.
   */
  const currentRef = useRef<string | null>(null);
  currentRef.current = current;
  useEffect(() => {
    setSrc(withCacheToken(currentRef.current ?? workspaceSiteSrc(root, relPath), token));
    // 열었던 파일이 아니라 token 을 보는 이유 — 위 설명대로 "지금 보고 있는 곳"을 다시 열기 위해서다.
  }, [token, root, relPath]);

  /**
   * ⑮ (b) — 페이지가 알려 온 위치. **우리 창구 안의 주소만** 받는다(`readHtmlPreviewReport`) —
   * iframe 안에서는 사용자의 프로젝트 코드가 돌고, 아무 스크립트나 우리 주소 칸에 제 글자를
   * 적어 넣게 두지 않는다.
   */
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const url = readHtmlPreviewReport(e.data);
      if (url === null) return;
      setCurrent(url);
      setHistory((prev) => pushHtmlPreviewHistory(prev, url));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const step = useCallback((direction: -1 | 1): void => {
    setHistory((prev) => {
      const moved = stepHtmlPreviewHistory(prev, direction);
      if (!moved) return prev;
      setCurrent(moved.url);
      setSrc(moved.url);
      return moved.history;
    });
  }, []);

  const handleReload = useCallback(() => setToken(Date.now()), []);
  const handleHome = useCallback(() => {
    const url = workspaceSiteSrc(root, relPath, Date.now());
    setCurrent(null);
    setHistory(EMPTY_HTML_PREVIEW_HISTORY);
    setSrc(url);
  }, [root, relPath]);

  const address = htmlPreviewAddress(current, root, relPath);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-950">
      {/* 브라우저 줄 — 창이 좁아져도 주소 칸만 양보한다(`min-w-0`), 손잡이는 줄지 않는다. */}
      <div className="flex items-center gap-1 border-b border-gray-800 bg-gray-900/60 px-1.5 py-1">
        <BarButton onClick={() => step(-1)} disabled={!canGoBack(history)} title={t('ide.editor.html.back')}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </BarButton>
        <BarButton onClick={() => step(1)} disabled={!canGoForward(history)} title={t('ide.editor.html.forward')}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </BarButton>
        <BarButton onClick={handleReload} title={t('ide.editor.html.reload')}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </BarButton>
        <BarButton onClick={handleHome} title={t('ide.editor.html.home', { path: relPath })}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
        </BarButton>

        {/* 주소 칸 — 프로젝트 기준 상대 경로. 링크를 타고 옮겨 가면 그 경로로 바뀐다. */}
        <div
          title={t('ide.editor.html.address', { path: address })}
          className="min-w-0 flex-1 truncate rounded border border-gray-800 bg-gray-950/70 px-2 py-0.5 text-[12px] text-gray-400"
        >
          {address}
        </div>

        <BarButton onClick={onOpenExternal} title={t('ide.editor.html.openExternal')}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
          </svg>
        </BarButton>
      </div>

      {/*
        페이지. `sandbox` 로 **최상위 이동을 막는다**(⑮ (f)) — 워크스페이스 안의 HTML 이 우리 앱을
        다른 곳으로 끌고 갈 수 없다. `allow-same-origin` 을 남기는 이유는 그것을 빼면 문서가 불투명
        오리진이 되어 `localStorage` 한 줄에 사용자의 멀쩡한 페이지가 죽기 때문이다(패키지 앱에서
        이 프레임은 어차피 `vibproxy://` 라 우리 창과 다른 오리진이다).
        `target="_blank"` 는 main 의 `setWindowOpenHandler` 가 OS 브라우저로 넘긴다(§3.7).
      */}
      <iframe
        ref={frameRef}
        src={src}
        title={relPath}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
        // 페이지가 자기 배경을 안 칠해도 브라우저처럼 흰 종이에서 시작한다(어두운 깜빡임 ❌).
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
});
