import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { toProxyUrl } from '../../utils/iframeProxyUrl.js';
import { usePreviewPicker } from '../Preview/usePreviewPicker.js';
import { usePreviewSnip } from '../Preview/usePreviewSnip.js';
import { PreviewFrames } from '../Preview/PreviewFrames.js';
import { PreviewControls, PreviewPickPanel } from '../Preview/PreviewControls.js';

interface IframeViewProps {
  url: string;
  tabId: string;
}

export function IframeView({ url, tabId }: IframeViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
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
      <PreviewFrames
        picker={picker}
        snip={snip}
        src={toProxyUrl(currentUrl)}
        primaryRef={iframeRef}
        className="bg-gray-950"
        style={overlayStyle}
      />

      <PreviewPickPanel picker={picker} snip={snip} />
    </div>
  );
}
