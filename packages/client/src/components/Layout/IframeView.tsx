import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { isPackagedDesktop } from '../../transport/index.js';
import { IFRAME_PROXY_PATH } from '@vibisual/shared';

interface IframeViewProps {
  url: string;
  tabId: string;
}

/**
 * 원본 URL → iframe 프록시 URL 변환 (in-process Express 의 iframe 프록시 → 대상 서버).
 *
 * 패키지 Electron 에선 renderer 가 file:// 로 로드돼 상대경로 <iframe src="/iframe-proxy/…">
 * 가 file:///iframe-proxy/… 로 깨진다. main 에 등록된 vibproxy:// 커스텀 스킴을 거치면
 * protocol.handle 이 in-process 서버로 합성 디스패치한다. 호스트 세그먼트는 고정값 `proxy`
 * — 프록시된 페이지가 재작성한 root-relative `/iframe-proxy/…` 링크가 같은 오리진으로
 * 다시 들어오게 한다.
 */
function toProxyUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const proxyPath = `${IFRAME_PROXY_PATH}/${parsed.host}${parsed.pathname}${parsed.search}`;
    return isPackagedDesktop() ? `vibproxy://proxy${proxyPath}` : proxyPath;
  } catch {
    return raw;
  }
}

export function IframeView({ url, tabId }: IframeViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 서버 꺼짐 감지: 동일 URL을 가진 iframe 버블의 iframeAlive 필드를 구독.
  // 버블이 없으면 (사용자 Delete 등) 그냥 살아있는 것으로 간주 → 평소 스타일.
  const alive = useGraphStore((s) => {
    for (const node of Object.values(s.nodeMap)) {
      if (node.bubbleType === 'iframe' && node.url === currentUrl) {
        return node.iframeAlive !== false;
      }
    }
    return true;
  });
  const overlayStyle = useMemo(
    () => ({ opacity: alive ? 1 : 0.35, transition: 'opacity 0.4s ease-out' }),
    [alive],
  );

  const handleNavigate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    let target = inputUrl.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = `http://${target}`;
    }
    setCurrentUrl(target);
    // Update tab label
    const store = useGraphStore.getState();
    const tab = store.iframeTabs.find((t) => t.id === tabId);
    if (tab) {
      try {
        const parsed = new URL(target);
        const label = parsed.host;
        store.openIframeTab({ ...tab, url: target, label });
      } catch { /* ignore invalid URL */ }
    }
  }, [inputUrl, tabId]);

  const handleReload = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = toProxyUrl(currentUrl);
    }
  }, [currentUrl]);

  return (
    <div className="flex h-full w-full flex-col bg-gray-950">
      {/* URL bar */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-gray-900/60 px-3 py-1.5">
        {/* Reload button */}
        <button
          type="button"
          onClick={handleReload}
          className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-white/[0.08]"
          title={t('common.iframe.reload')}
        >
          <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>

        {/* URL input */}
        <form onSubmit={handleNavigate} className="flex-1">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            className="w-full rounded-md border border-white/[0.08] bg-gray-800/60 px-3 py-1 text-[12px] text-gray-200 outline-none transition-colors focus:border-sky-500/40 focus:bg-gray-800"
            placeholder={t('common.iframe.urlInput')}
          />
        </form>
      </div>

      {/* iframe content — 프록시 경유. 서버 꺼짐 시 opacity 낮춰 비활성 표시. */}
      <div className="flex-1" style={overlayStyle}>
        <iframe
          ref={iframeRef}
          src={toProxyUrl(currentUrl)}
          className="h-full w-full border-0 bg-white"
          title={t('common.iframe.serverPreview')}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
