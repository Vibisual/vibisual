import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeResizer, type NodeProps } from '@xyflow/react';

import { useGraphStore } from '../../stores/graphStore.js';
import { toProxyUrl } from '../../utils/iframeProxyUrl.js';

/**
 * §5.14 v4.62 — 플레이 프리뷰 버블.
 *
 * 플레이 버튼을 누르면 **그 옆에** 뜨는 라이브 iframe 이다. 버튼과 한 레코드에서 나오지만
 * 캔버스에서는 따로 산다 — 각자 끌고, 각자 크기를 바꾸고, 프리뷰만 닫을 수 있다.
 *
 * 헤더에서만 드래그한다(본체는 iframe 이라 마우스가 그 안의 페이지로 가야 한다 — 여기서
 * 드래그를 허용하면 앱을 조작할 수가 없다).
 */

export interface PlayPreviewNodeData extends Record<string, unknown> {
  playBubbleId: string;
  url: string;
  width: number;
  height: number;
  title?: string | undefined;
}

const CHROME_BG = 'rgba(17, 24, 39, 0.92)';
const CHROME_BORDER = 'rgba(255, 255, 255, 0.12)';

export const PlayPreviewNode = memo(function PlayPreviewNode({
  data,
  selected,
}: NodeProps & { data: PlayPreviewNodeData }): React.JSX.Element {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 새로고침 — src 를 다시 넣으면 되지만, 같은 문자열이면 브라우저가 무시하므로 키를 돌린다.
  const [reloadKey, setReloadKey] = useState(0);

  const selectPlayBubble = useGraphStore((s) => s.selectPlayBubble);
  const selectedPlayBubbleId = useGraphStore((s) => s.selectedPlayBubbleId);
  const patchLocal = useGraphStore((s) => s.patchPlayBubbleLocal);
  const updatePlayBubble = useGraphStore((s) => s.updatePlayBubble);
  const setDragLock = useGraphStore((s) => s.setPlayBubbleDragLock);

  const isSelected = selected === true || selectedPlayBubbleId === data.playBubbleId;

  /**
   * 선택 — 앱·플레이 버블과 같은 규칙, 같은 함정(v4.69).
   *
   * ⚠ 캡처 단계로 받는다. 드래그 가능한 노드의 래퍼에 걸린 `d3-drag` 가 mousedown 에서
   * `stopImmediatePropagation()` 을 불러, 루트로 위임된 React 의 버블 단계 핸들러는 아예
   * 발화하지 못한다. 헤더의 아이콘 버튼(닫기·새로고침)에서는 선택을 건너뛴다.
   */
  const handleSelect = useCallback((e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest?.('button')) return;
    selectPlayBubble(data.playBubbleId);
  }, [selectPlayBubble, data.playBubbleId]);

  const close = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    // 버튼은 남는다 — 닫히는 것은 프리뷰뿐이다(§5.14).
    patchLocal(data.playBubbleId, { previewOpen: false });
    void updatePlayBubble(data.playBubbleId, { previewOpen: false });
  }, [data.playBubbleId, patchLocal, updatePlayBubble]);

  const reload = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    setReloadKey((k) => k + 1);
  }, []);

  const openExternal = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    window.open(data.url, '_blank', 'noopener');
  }, [data.url]);

  const handleResizeStart: React.ComponentProps<typeof NodeResizer>['onResizeStart'] = () => {
    setDragLock(data.playBubbleId, true);
  };
  const handleResize: React.ComponentProps<typeof NodeResizer>['onResize'] = (_evt, params) => {
    patchLocal(data.playBubbleId, {
      previewX: params.x,
      previewY: params.y,
      previewWidth: params.width,
      previewHeight: params.height,
    });
  };
  const handleResizeEnd: React.ComponentProps<typeof NodeResizer>['onResizeEnd'] = (_evt, params) => {
    void (async () => {
      await updatePlayBubble(data.playBubbleId, {
        previewX: params.x,
        previewY: params.y,
        previewWidth: params.width,
        previewHeight: params.height,
      });
      // 저장 직후 도착하는 스냅샷이 방금 옮긴 자리를 덮지 않도록 잠깐 더 잠근다(§5.13 v4.60 규칙).
      setTimeout(() => setDragLock(data.playBubbleId, false), 300);
    })();
  };

  const iconBtn = 'flex h-5 w-5 items-center justify-center rounded text-white/70 transition-colors hover:bg-white/10 hover:text-white';

  return (
    <>
      <NodeResizer
        isVisible={isSelected}
        minWidth={220}
        minHeight={160}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        lineClassName="!border-emerald-400/60"
        handleClassName="!h-2 !w-2 !rounded-sm !border-emerald-300 !bg-emerald-400"
      />
      <div
        onPointerDownCapture={handleSelect}
        className="flex flex-col overflow-hidden rounded-lg"
        style={{
          width: data.width,
          height: data.height,
          border: '1px solid',
          borderColor: isSelected ? '#FFFFFF' : CHROME_BORDER,
          background: CHROME_BG,
          boxShadow: isSelected ? '0 0 0 3px rgba(52, 211, 153, 0.45)' : '0 10px 30px rgba(0,0,0,0.45)',
        }}
      >
        {/* 헤더 — 여기만 드래그 손잡이다(본체는 페이지 조작에 내준다). */}
        <div className="drag-handle flex h-7 shrink-0 cursor-grab items-center gap-1.5 border-b px-2" style={{ borderColor: CHROME_BORDER }}>
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[10px] text-white/70">
            {data.title ?? data.url.replace(/^https?:\/\//, '')}
          </span>
          <button type="button" onClick={reload} onMouseDown={(e) => e.stopPropagation()} className={iconBtn} title={t('common.iframe.reload')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          <button
            type="button"
            onClick={openExternal}
            onMouseDown={(e) => e.stopPropagation()}
            className={iconBtn}
            title={t('canvas.play.openBrowser', { defaultValue: '브라우저로 열기' })}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={close}
            onMouseDown={(e) => e.stopPropagation()}
            className={iconBtn}
            title={t('canvas.play.hidePreview', { defaultValue: '프리뷰 숨기기' })}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 bg-white">
          <iframe
            key={reloadKey}
            ref={iframeRef}
            src={toProxyUrl(data.url)}
            className="h-full w-full border-0"
            title={t('common.iframe.serverPreview')}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>
    </>
  );
});
