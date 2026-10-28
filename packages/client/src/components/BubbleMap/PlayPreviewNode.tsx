import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';

import { useGraphStore } from '../../stores/graphStore.js';
import { toProxyUrl } from '../../utils/iframeProxyUrl.js';
import { isInteractiveTarget, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { useCanvasNodeSelection } from './useCanvasNodeSelection.js';
import { openGroupMenuIfGrouped } from './BubbleContextMenu.js';
import { usePreviewPicker } from '../Preview/usePreviewPicker.js';
import { usePreviewSnip } from '../Preview/usePreviewSnip.js';
import { PreviewFrames } from '../Preview/PreviewFrames.js';
import { PreviewControls, PreviewPickPanel } from '../Preview/PreviewControls.js';

/** §5.14 — 플레이 프리뷰(iframe). 버튼과 한 레코드지만 캔버스에선 따로 끌고·크기 바꾸고·닫는다. 헤더에서만 드래그 — 본체 마우스는 페이지 조작 몫. */

export interface PlayPreviewNodeData extends Record<string, unknown> {
  playBubbleId: string;
  url: string;
  width: number;
  height: number;
  title?: string | undefined;
  /** §5.17 (C) — 이 화면을 만든 에이전트. 캔버스 점선의 끝점이자, 집기·캡처가 향하는 곳. */
  ownerAgentId?: string | undefined;
}

/** §5.17 (C) — 담당 에이전트 엣지의 끝점. 끄는 손잡이가 아니라 1px·투명(BubbleNode 와 같다). */
const HANDLE_STYLE: React.CSSProperties = {
  left: '50%',
  top: '50%',
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  pointerEvents: 'none',
};

const CHROME_BG = 'rgba(17, 24, 39, 0.92)';
const CHROME_BORDER = 'rgba(255, 255, 255, 0.12)';

export const PlayPreviewNode = memo(function PlayPreviewNode({
  id,
  data,
  selected,
}: NodeProps & { data: PlayPreviewNodeData }): React.JSX.Element {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // §7.11 — 폭 프리셋 + 요소 집기. 탭 프리뷰(IframeView)와 **같은 훅**이라 한 쪽만 되는 일이 없다.
  const picker = usePreviewPicker(iframeRef, data.url, data.ownerAgentId);
  // §5.17 (B) — 그은 사각형이 그 에이전트의 입력창 첨부가 된다.
  const snip = usePreviewSnip(picker.hostAgentId);
  // 새로고침 — src 를 다시 넣으면 되지만, 같은 문자열이면 브라우저가 무시하므로 키를 돌린다.
  const [reloadKey, setReloadKey] = useState(0);

  const selectPlayBubble = useGraphStore((s) => s.selectPlayBubble);
  const patchLocal = useGraphStore((s) => s.patchPlayBubbleLocal);
  const updatePlayBubble = useGraphStore((s) => s.updatePlayBubble);
  const setDragLock = useGraphStore((s) => s.setPlayBubbleDragLock);

  // 선택 링은 `selectIntentId`(캔버스가 나눠 쓰는 "지금 고른 것 한 칸")도 함께 본다.
  // 둘 다 판정 결과만 구독한다(§9) — id 를 받으면 다른 버블을 고를 때마다 이 버블도 다시 그려진다.
  const chosenHere = useGraphStore((s) => s.selectedPlayBubbleId === data.playBubbleId || s.selectIntentId === data.playBubbleId);
  const isSelected = selected === true || chosenHere;

  /** 선택 — 공용 `bubbleSelectGesture`(더블클릭 없음: 바로 선택, 끈 뒤엔 ❌). 캡처 단계·헤더 버튼 건너뛰기의 이유는 그 파일에. */
  // §6 — 고른 묶음은 다른 버블과 같은 칸이다. 프리뷰는 표지와 따로 사는 노드라 묶음에도 따로 든다.
  const canvasSelection = useCanvasNodeSelection(id, data.playBubbleId);
  const gesture = useBubbleSelectGesture({
    doubleClickable: false,
    select: () => {
      canvasSelection.replace();
      selectPlayBubble(data.playBubbleId);
    },
    toggle: canvasSelection.toggle,
    setIntent: (active) => {
      useGraphStore.getState().setSelectIntent(active ? data.playBubbleId : null);
    },
    ignore: (e) => isInteractiveTarget(e.target),
  });
  // §6 — 여럿을 고른 묶음 안에서 우클릭하면 묶음 메뉴. 묶음 밖이면 종전대로다(이 노드에는 따로 메뉴가 없다).
  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    if (selected !== true || !openGroupMenuIfGrouped(id, e.clientX, e.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
  }, [id, selected]);

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
      // 저장 직후 스냅샷이 방금 옮긴 자리를 덮지 않게 잠깐 더 잠근다.
      setTimeout(() => setDragLock(data.playBubbleId, false), 300);
    })();
  };

  // `shrink-0` — 새로고침·브라우저로 열기·**닫기**는 자리가 모자라도 0 폭으로 눌려 사라지면 안 된다.
  //   프리뷰를 접는 유일한 손잡이가 [닫기] 라서, 눌려 없어지는 순간 그 버블에서 빠져나올 길이 사라진다.
  const iconBtn = 'flex h-5 w-5 shrink-0 items-center justify-center rounded text-white/70 transition-colors hover:bg-white/10 hover:text-white';

  return (
    <>
      <NodeResizer
        // §6 — 크기 손잡이는 지금 고른 하나에만(묶음 안 노드마다 서면 묶음 표시가 손잡이에 묻힌다).
        isVisible={chosenHere}
        minWidth={220}
        minHeight={160}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        lineClassName="!border-emerald-400/60"
        handleClassName="!h-2 !w-2 !rounded-sm !border-emerald-300 !bg-emerald-400"
      />
      <div
        {...gesture.handlers}
        onContextMenu={handleContextMenu}
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
        <Handle type="source" id="src" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
        <Handle type="target" id="tgt" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />

        {/* 헤더만 드래그 손잡이. `min-h-7` + `flex-wrap` 을 `h-7` 고정으로 되돌리면 좁을 때 [닫기]가 밖으로 밀려 잘린다(§5.17). */}
        <div className="drag-handle flex min-h-7 shrink-0 cursor-grab flex-wrap items-center gap-1.5 border-b px-2 py-0.5" style={{ borderColor: CHROME_BORDER }}>
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[12px] text-white/70">
            {data.title ?? data.url.replace(/^https?:\/\//, '')}
          </span>
          <span onMouseDown={(e) => e.stopPropagation()} className="shrink-0">
            <PreviewControls picker={picker} snip={snip} />
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

        {/* 폭 프리셋이 걸리면 그 폭 그대로(scale 축소 ❌), `compare` 면 세 폭을 나란히(§5.17 (A)). */}
        <PreviewFrames
          picker={picker}
          snip={snip}
          src={toProxyUrl(data.url)}
          primaryRef={iframeRef}
          reloadKey={reloadKey}
          className="bg-white"
        />
        <span onMouseDown={(e) => e.stopPropagation()}>
          <PreviewPickPanel picker={picker} snip={snip} />
        </span>
      </div>
    </>
  );
});
