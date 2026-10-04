import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { toProxyUrl } from '../../utils/iframeProxyUrl.js';
import { usePreviewPicker } from '../Preview/usePreviewPicker.js';
import { usePreviewSnip } from '../Preview/usePreviewSnip.js';
import { PreviewFrames } from '../Preview/PreviewFrames.js';
import { PreviewControls, PreviewPickPanel } from '../Preview/PreviewControls.js';
import { shouldIframeViewFollow } from '../../utils/iframeTabFollow.js';
import { useIframeTabGuard } from './useIframeTabGuard.js';

interface IframeViewProps {
  url: string;
  tabId: string;
}

export function IframeView({ url, tabId }: IframeViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
  // §7.11 / §3.5 — 탭 주소가 바뀌면 화면도 옮긴다. 스토어는 위성 주소를 따라 탭 주소를 고친다
  //   (`followIframeTabUrls` — 한 포트 두 주인이면 서버가 `localhost` 를 우리 서버에 닿는 `127.0.0.1` 로
  //   옮긴다). 연 순간의 주소를 상태로 붙들면 캔버스 버블은 고쳐져도 열어 둔 탭은 남의 화면을 계속 보여 준다.
  //   사용자가 주소창으로 딴 데를 보고 있으면 덮어쓰지 않는다. 본창은 key 없이 이 칸을 다른 탭과 이어
  //   쓰므로, 탭이 바뀌면 언제나 그 탭의 주소로 옮긴다.
  const [source, setSource] = useState({ tabId, url });
  if (source.tabId !== tabId || source.url !== url) {
    const follow = shouldIframeViewFollow(source, { tabId, url }, currentUrl);
    setSource({ tabId, url });
    if (follow) {
      setCurrentUrl(url);
      setInputUrl(url);
    }
  }
  // §7.11 / §3.5 — 불러오기 전에 이 탭을 연 프로젝트 기준으로 소속을 묻는다(B 를 보는 동안엔 A 의 위성이
  //   스냅샷에 없어 위 따라가기만으로는 모자란다). 사용자가 주소창으로 고른 주소는 묻지 않는다.
  const guard = useIframeTabGuard(tabId, currentUrl, currentUrl === url);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // §7.11 — 폭 프리셋 + 요소 집기(집은 요소 → 이 프리뷰를 띄운 에이전트에게 명령).
  const picker = usePreviewPicker(iframeRef, currentUrl);
  // §5.17 (B) — 그은 사각형이 그 에이전트의 입력창 첨부가 된다.
  const snip = usePreviewSnip(picker.hostAgentId);

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
      {/* URL bar — `flex-wrap`: 창이 좁아지면 조작 줄을 잘라 내지 않고 **아랫줄로 접는다**.
          폭 프리셋을 되돌릴 유일한 자리라, 여기가 잘리는 순간 그 프리뷰는 빠져나올 수 없게 된다. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-gray-900/60 px-3 py-1.5">
        {/* Reload button */}
        <button
          type="button"
          onClick={handleReload}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-white/[0.08]"
          title={t('common.iframe.reload')}
        >
          <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>

        {/* URL input */}
        {/* 좁아질 때 먼저 양보하는 쪽. `min-w-0` 이 없으면 input 이 자기 기본 폭을 고집해
            옆의 조작 줄을 밀어낸다(§5.17 — 되돌릴 버튼이 밀려나면 끝이다). */}
        <form onSubmit={handleNavigate} className="min-w-0 flex-1">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            className="w-full rounded-md border border-white/[0.08] bg-gray-800/60 px-3 py-1 text-[12px] text-gray-200 outline-none transition-colors focus:border-sky-500/40 focus:bg-gray-800"
            placeholder={t('common.iframe.urlInput')}
          />
        </form>

        {/* §7.11 · §5.17 — 폭 프리셋 + 요소 집기 + 영역 캡처. 캔버스 프리뷰와 같은 훅·같은 화면 요소. */}
        <PreviewControls picker={picker} snip={snip} />
      </div>

      {/* iframe content — 프록시 경유. 서버 꺼짐 시 opacity 낮춰 비활성 표시. */}
      {/*   폭 프리셋이 걸리면 그 폭 **그대로**(scale 축소 ❌), `compare` 면 세 폭을 나란히(§5.17 (A)). */}
      {/*   §7.11 / §3.5 — 첫 판정 전에는 iframe 을 띄우지 않고, 다른 프로젝트 서버면 안내만 보인다. */}
      {guard === 'show' ? (
        <PreviewFrames
          picker={picker}
          snip={snip}
          src={toProxyUrl(currentUrl)}
          primaryRef={iframeRef}
          className="bg-gray-950"
          style={overlayStyle}
        />
      ) : guard === 'block' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-950 p-6">
          <div className="flex max-w-md flex-col items-center gap-2 text-center">
            <svg className="h-5 w-5 text-amber-300/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            <p className="text-[13px] font-medium text-gray-200">{t('common.iframe.otherProjectTitle')}</p>
            <p className="break-words text-[12px] leading-relaxed text-gray-400">
              {t('common.iframe.otherProjectBody', { url: currentUrl })}
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 bg-gray-950" />
      )}

      <PreviewPickPanel picker={picker} snip={snip} />
    </div>
  );
}
