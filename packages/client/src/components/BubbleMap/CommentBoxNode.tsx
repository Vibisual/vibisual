import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { NodeResizer, useViewport, type NodeProps } from '@xyflow/react';
import { COMMENT_BOX_DEFAULTS, COMMENT_BOX_LOD } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { pickReadableTextColor } from '../../utils/commentBoxStyle.js';

export interface CommentBoxNodeData {
  /** Comment Box id (store 조회용, Node.id 와 동일 값이지만 명시적으로 data 에도 둠) */
  commentBoxId: string;
  text: string;
  color: string;
  textColor?: string;
  fontSize?: number;
  opacity?: number;
  width: number;
  height: number;
}

/**
 * 언리얼 블프 스타일 Comment Box 커스텀 노드.
 * React Flow 의 기본 드래그/선택/리사이즈 훅에 올라타고, 배경 레이어에 깔림(zIndex 낮게).
 *
 * 동작 요약:
 * - 더블클릭 시 텍스트 인라인 편집. Enter 저장, Escape 취소.
 * - 줌아웃(LOD) 시 상단 외부에 풍선(pill) 라벨 표시 — 스크린 고정 사이즈로 가독성 유지.
 * - 자식 버블 동반 이동/membership 갱신은 BubbleMap 의 onNodeDrag/onNodeDragStop 에서 처리.
 */
export const CommentBoxNode = memo(function CommentBoxNode({
  data,
  selected,
  dragging,
  width: nodeWidth,
  height: nodeHeight,
}: NodeProps): React.JSX.Element {
  const d = data as unknown as CommentBoxNodeData;
  const updateCommentBox = useGraphStore((s) => s.updateCommentBox);
  const patchCommentBoxLocal = useGraphStore((s) => s.patchCommentBoxLocal);
  const selectCommentBox = useGraphStore((s) => s.selectCommentBox);
  const selectedCommentBoxId = useGraphStore((s) => s.selectedCommentBoxId);

  // 실측 — store(d.width/d.height) → React Flow live(node.width/node.height) 순으로 fallback.
  // 리사이즈 중에는 store 가 아직 갱신되기 전에 React Flow 내부 dimension 이 먼저 바뀌므로
  // nodeWidth/nodeHeight 를 우선 사용해야 시각이 즉시 따라간다.
  const liveWidth = nodeWidth ?? d.width;
  const liveHeight = nodeHeight ?? d.height;

  const { zoom } = useViewport();
  const balloonMode = zoom < COMMENT_BOX_LOD.BALLOON_BELOW;

  const textColor = d.textColor ?? pickReadableTextColor(d.color);
  const fontSize = d.fontSize ?? COMMENT_BOX_DEFAULTS.FONT_SIZE;
  const opacity = d.opacity ?? COMMENT_BOX_DEFAULTS.OPACITY;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 외부 데이터가 갱신되면 draft 동기화 (편집 중이 아니면)
  useEffect(() => {
    if (!editing) setDraft(d.text);
  }, [d.text, editing]);

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === d.text) return;
    void updateCommentBox(d.commentBoxId, { text: trimmed });
  }, [draft, d.text, d.commentBoxId, updateCommentBox]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(d.text);
  }, [d.text]);

  const handleHeaderDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // React Flow 의 기본 더블클릭 포커스 등과 충돌 방지
      e.stopPropagation();
      setEditing(true);
    },
    [],
  );

  const handleHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      // 선택은 상단 헤더 클릭에서만 — 본문(body) 클릭은 선택을 트리거하지 않는다.
      e.stopPropagation();
      selectCommentBox(d.commentBoxId);
    },
    [d.commentBoxId, selectCommentBox],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
      // 나머지는 일반 입력으로 흘려보냄 (Delete 포함 — BubbleMap 의 keydown 리스너는
      // target.tagName==='TEXTAREA' 일 때 스킵하므로 여기서 stopPropagation 불필요.)
    },
    [commit, cancel],
  );

  const setCommentBoxDragLock = useGraphStore((s) => s.setCommentBoxDragLock);

  // 라이브 리사이즈 — 매 프레임 store 의 commentBoxes 를 직접 갱신해서 캔버스 즉시 반영.
  // PATCH 는 끝에서만 보내 서버 트래픽 절약. 리사이즈 동안 WS snapshot 이 옛 geometry 로
  // 덮어쓰는 것 막기 위해 락을 건다.
  const handleResizeStart: React.ComponentProps<typeof NodeResizer>['onResizeStart'] = () => {
    setCommentBoxDragLock(d.commentBoxId, true);
  };
  const handleResize: React.ComponentProps<typeof NodeResizer>['onResize'] = (_evt, params) => {
    patchCommentBoxLocal(d.commentBoxId, {
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
    });
  };
  const handleResizeEnd: React.ComponentProps<typeof NodeResizer>['onResizeEnd'] = (_evt, params) => {
    void (async () => {
      await updateCommentBox(d.commentBoxId, {
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      });
      // PATCH 응답 후 300ms 버퍼 — 다른 broadcast 가 옛 geometry 를 들고 늦게 도착해도
      // 락 보호로 옛 값으로 회귀하지 않음 (드래그 종료 처리와 동일 패턴).
      setTimeout(() => setCommentBoxDragLock(d.commentBoxId, false), 300);
    })();
  };

  const isSelected = selected || selectedCommentBoxId === d.commentBoxId;
  const borderColor = d.color;
  const background = `${d.color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;

  // 풍선 라벨(LOD): zoom 이 작을수록 화면상 고정 사이즈가 되도록 1/zoom 배율로 렌더.
  const balloonScreenFont = COMMENT_BOX_LOD.BALLOON_SCREEN_FONT_PX;
  const balloonFontCanvas = balloonScreenFont / Math.max(zoom, 0.01);
  const balloonText = d.text.length > COMMENT_BOX_LOD.BALLOON_MAX_CHARS
    ? `${d.text.slice(0, COMMENT_BOX_LOD.BALLOON_MAX_CHARS)}…`
    : d.text;

  return (
    <div
      className="relative"
      style={{
        width: liveWidth,
        height: liveHeight,
        borderRadius: 10,
        border: `2px solid ${borderColor}`,
        background,
        boxShadow: isSelected ? `0 0 0 2px ${borderColor}, 0 6px 24px rgba(0,0,0,0.35)` : 'none',
      }}
      data-comment-box-id={d.commentBoxId}
    >
      <NodeResizer
        // 항상 활성 — 선택 안 해도 외곽 hover 즉시 리사이즈 가능. hit 영역은 어차피 투명이라
        // 시각적 잡음 없음.
        isVisible
        minWidth={COMMENT_BOX_DEFAULTS.MIN_WIDTH}
        minHeight={COMMENT_BOX_DEFAULTS.MIN_HEIGHT}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        // 시각 요소는 모두 투명 — 박스 자체 테두리(border) 가 이미 가이드 역할.
        // 단, hit area 는 살아있어야 외곽 어디서든 잡고 리사이즈 가능. 4변(line) 은 borderWidth
        // 로 hit 영역만 확보하고 색은 transparent. 4코너(handle) 는 background/border 만 투명화.
        // 루트 div 가 pointerEvents:'none' 이라 자식인 line/handle 도 명시적으로 'auto' 가 필요.
        lineStyle={{ borderColor: 'transparent', borderWidth: 6, pointerEvents: 'auto' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 12, height: 12, pointerEvents: 'auto' }}
      />

      {/* 헤더 — 텍스트 표시/편집 영역 + 드래그 핸들 (BubbleMap 의 dragHandle 셀렉터 일치)
          선택(클릭)·인라인 편집(더블클릭) 도 헤더에서만 처리. 본문 클릭은 무반응. */}
      <div
        className="comment-box-header"
        onClick={handleHeaderClick}
        onDoubleClick={handleHeaderDoubleClick}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: COMMENT_BOX_DEFAULTS.HEADER_HEIGHT,
          padding: '4px 10px',
          background: borderColor,
          color: textColor,
          fontWeight: 600,
          fontSize,
          lineHeight: 1.2,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          overflow: 'hidden',
          cursor: editing ? 'text' : (dragging ? 'grabbing' : 'grab'),
          // 루트의 pointerEvents:'none' 를 헤더에서만 되살려 클릭/드래그/더블클릭 처리.
          pointerEvents: 'auto',
        }}
      >
        <svg width={fontSize - 2} height={fontSize - 2} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80 flex-shrink-0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            className="nodrag"
            style={{
              flex: 1,
              resize: 'none',
              outline: 'none',
              border: 'none',
              background: 'rgba(0,0,0,0.15)',
              color: textColor,
              fontSize,
              fontWeight: 600,
              fontFamily: 'inherit',
              padding: '2px 6px',
              borderRadius: 4,
              height: COMMENT_BOX_DEFAULTS.HEADER_HEIGHT - 8,
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              // 헤더의 grab/grabbing 커서 상속 — 텍스트 캐럿(I) 금지. 이름 변경은 더블클릭으로만.
              cursor: 'inherit',
              userSelect: 'none',
            }}
            title={d.text}
          >
            {d.text}
          </span>
        )}
      </div>

      {/* LOD 풍선 — 줌아웃 시 박스 상단 바깥에 크게 부유 */}
      {balloonMode && !editing && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: `calc(100% + ${8 / Math.max(zoom, 0.01)}px)`,
            transform: 'translateX(-50%)',
            background: borderColor,
            color: textColor,
            fontSize: balloonFontCanvas,
            fontWeight: 700,
            padding: `${4 / Math.max(zoom, 0.01)}px ${12 / Math.max(zoom, 0.01)}px`,
            borderRadius: 9999,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
            maxWidth: 'none',
          }}
        >
          {balloonText || '…'}
        </div>
      )}
    </div>
  );
});
