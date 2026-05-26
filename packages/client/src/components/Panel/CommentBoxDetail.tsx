import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommentBox } from '@vibisual/shared';
import { COMMENT_BOX_DEFAULTS, COMMENT_BOX_PALETTE } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { CommentBoxColorPopover } from './CommentBoxColorPopover.js';

interface Props {
  box: CommentBox;
}

/**
 * Comment Box 전용 DetailPanel 섹션 (v1.45).
 * 언리얼 블프 코멘트처럼 색·글자색·폰트·투명도를 편집하고 텍스트 다듬기.
 */
export function CommentBoxDetail({ box }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const updateCommentBox = useGraphStore((s) => s.updateCommentBox);
  const patchCommentBoxLocal = useGraphStore((s) => s.patchCommentBoxLocal);
  const deleteCommentBox = useGraphStore((s) => s.deleteCommentBox);

  const [text, setText] = useState(box.text);
  const [customColor, setCustomColor] = useState(box.color);

  // 외부에서 box 가 갱신되면 로컬 상태 싱크 (다른 사용자 편집 등)
  useEffect(() => { setText(box.text); }, [box.id, box.text]);
  useEffect(() => { setCustomColor(box.color); }, [box.id, box.color]);

  const commitText = useCallback(() => {
    if (text === box.text) return;
    void updateCommentBox(box.id, { text });
  }, [text, box.text, box.id, updateCommentBox]);

  // ─── 라이브 입력(슬라이더/컬러픽커) vs 커밋(서버 PATCH) 분리 ───
  // onChange 마다 PATCH 를 보내면 매 pointermove 마다 broadcast → 한 박자 늦은 잔상이 생김.
  // 드래그/핸들 동안에는 patchCommentBoxLocal 로 store 만 갱신(즉시 시각 반영),
  // 사용자가 손을 뗀 시점(onMouseUp / onChange end / onBlur) 에 updateCommentBox 로 1회 PATCH.

  const liveColor = useCallback((hex: string) => {
    setCustomColor(hex);
    patchCommentBoxLocal(box.id, { color: hex });
  }, [box.id, patchCommentBoxLocal]);
  const commitColor = useCallback((hex: string) => {
    setCustomColor(hex);
    void updateCommentBox(box.id, { color: hex });
  }, [box.id, updateCommentBox]);
  /** 팔레트 버튼 — 단발 클릭은 즉시 PATCH 로 끝내도 트래픽 미미 */
  const setColor = useCallback((hex: string) => {
    setCustomColor(hex);
    void updateCommentBox(box.id, { color: hex });
  }, [box.id, updateCommentBox]);

  const liveTextColor = useCallback((hex: string) => {
    patchCommentBoxLocal(box.id, { textColor: hex });
  }, [box.id, patchCommentBoxLocal]);
  const commitTextColor = useCallback((hex: string | undefined) => {
    void updateCommentBox(box.id, { textColor: hex ?? '' });
  }, [box.id, updateCommentBox]);

  const liveFontSize = useCallback((size: number) => {
    patchCommentBoxLocal(box.id, { fontSize: size });
  }, [box.id, patchCommentBoxLocal]);
  const commitFontSize = useCallback((size: number) => {
    void updateCommentBox(box.id, { fontSize: size });
  }, [box.id, updateCommentBox]);

  const liveOpacity = useCallback((value: number) => {
    patchCommentBoxLocal(box.id, { opacity: value });
  }, [box.id, patchCommentBoxLocal]);
  const commitOpacity = useCallback((value: number) => {
    void updateCommentBox(box.id, { opacity: value });
  }, [box.id, updateCommentBox]);

  const fontSize = box.fontSize ?? COMMENT_BOX_DEFAULTS.FONT_SIZE;
  const opacity = box.opacity ?? COMMENT_BOX_DEFAULTS.OPACITY;

  // 커스텀 색 선택 팝오버 (네이티브 OS 다이얼로그 대체)
  const bgPickerRef = useRef<HTMLButtonElement>(null);
  const textPickerRef = useRef<HTMLButtonElement>(null);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [textPickerOpen, setTextPickerOpen] = useState(false);
  const [bgAnchor, setBgAnchor] = useState({ x: 0, y: 0 });
  const [textAnchor, setTextAnchor] = useState({ x: 0, y: 0 });

  const openBgPicker = useCallback(() => {
    const r = bgPickerRef.current?.getBoundingClientRect();
    if (r) setBgAnchor({ x: r.right, y: r.top });
    setBgPickerOpen(true);
    setTextPickerOpen(false);
  }, []);
  const openTextPicker = useCallback(() => {
    const r = textPickerRef.current?.getBoundingClientRect();
    if (r) setTextAnchor({ x: r.right, y: r.top });
    setTextPickerOpen(true);
    setBgPickerOpen(false);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* 텍스트 편집 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">{t('panel.commentBox.text', 'Text')}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          rows={3}
          className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
          placeholder={t('panel.commentBox.textPlaceholder', 'Comment...')}
        />
      </div>

      {/* 색 팔레트 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-gray-500">{t('panel.commentBox.color', 'Color')}</span>
        <div className="flex flex-wrap gap-1.5">
          {COMMENT_BOX_PALETTE.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setColor(p.color)}
              className={`h-6 w-6 rounded-full border transition-all ${
                box.color.toLowerCase() === p.color.toLowerCase()
                  ? 'border-white ring-2 ring-white/40 ring-offset-2 ring-offset-gray-900'
                  : 'border-gray-700 hover:scale-110'
              }`}
              style={{ backgroundColor: p.color }}
              title={p.label}
              aria-label={p.label}
            />
          ))}
          <button
            ref={bgPickerRef}
            type="button"
            onClick={openBgPicker}
            className="relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-gray-600 text-[10px] text-gray-300 transition-all hover:scale-110 hover:border-gray-300"
            title={t('panel.commentBox.customColor', 'Custom color')}
            aria-label={t('panel.commentBox.customColor', 'Custom color')}
            style={{
              backgroundColor: COMMENT_BOX_PALETTE.some((p) => p.color.toLowerCase() === box.color.toLowerCase())
                ? 'transparent'
                : box.color,
            }}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* 텍스트 색 (자동/사용자 지정) */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-gray-500">{t('panel.commentBox.textColor', 'Text color')}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => commitTextColor(undefined)}
            className={`rounded border px-2 py-0.5 text-[10px] transition-colors ${
              box.textColor === undefined || box.textColor === ''
                ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
            }`}
          >
            {t('panel.commentBox.auto', 'Auto')}
          </button>
          <button
            ref={textPickerRef}
            type="button"
            onClick={openTextPicker}
            className={`relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border transition-all hover:scale-110 ${
              box.textColor && box.textColor !== ''
                ? 'border-white ring-2 ring-white/30 ring-offset-2 ring-offset-gray-900'
                : 'border-gray-700'
            }`}
            style={{ backgroundColor: box.textColor && box.textColor !== '' ? box.textColor : '#1f2937' }}
            title={t('panel.commentBox.textColor', 'Text color')}
            aria-label={t('panel.commentBox.textColor', 'Text color')}
          >
            {(!box.textColor || box.textColor === '') && (
              <svg className="h-3 w-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* 폰트 크기 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">{t('panel.commentBox.fontSize', 'Font size')}</span>
          <span className="font-mono text-xs text-gray-300">{fontSize}px</span>
        </div>
        <input
          type="range"
          min={10}
          max={28}
          step={1}
          value={fontSize}
          onChange={(e) => liveFontSize(parseInt(e.target.value, 10))}
          onMouseUp={(e) => commitFontSize(parseInt((e.target as HTMLInputElement).value, 10))}
          onTouchEnd={(e) => commitFontSize(parseInt((e.target as HTMLInputElement).value, 10))}
          onKeyUp={(e) => commitFontSize(parseInt((e.target as HTMLInputElement).value, 10))}
          className="w-full accent-blue-500"
        />
      </div>

      {/* 투명도 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">{t('panel.commentBox.opacity', 'Opacity')}</span>
          <span className="font-mono text-xs text-gray-300">{Math.round(opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(opacity * 100)}
          onChange={(e) => liveOpacity(parseInt(e.target.value, 10) / 100)}
          onMouseUp={(e) => commitOpacity(parseInt((e.target as HTMLInputElement).value, 10) / 100)}
          onTouchEnd={(e) => commitOpacity(parseInt((e.target as HTMLInputElement).value, 10) / 100)}
          onKeyUp={(e) => commitOpacity(parseInt((e.target as HTMLInputElement).value, 10) / 100)}
          className="w-full accent-blue-500"
        />
      </div>

      {/* 크기 정보 (읽기 전용 — 캔버스 리사이즈 핸들로 조정) */}
      <div className="flex items-center justify-between rounded border border-gray-700/50 bg-gray-800/30 px-2 py-1.5">
        <span className="text-xs text-gray-500">{t('panel.commentBox.size', 'Size')}</span>
        <span className="font-mono text-xs text-gray-300">
          {Math.round(box.width)} × {Math.round(box.height)}
        </span>
      </div>

      {/* 자식 수 */}
      <div className="flex items-center justify-between rounded border border-gray-700/50 bg-gray-800/30 px-2 py-1.5">
        <span className="text-xs text-gray-500">{t('panel.commentBox.contained', 'Contained')}</span>
        <span className="font-mono text-xs text-gray-300">
          {box.childNodeIds.length} {t('panel.commentBox.bubbles', 'bubbles')}
        </span>
      </div>

      {/* 삭제 */}
      <button
        type="button"
        onClick={() => { void deleteCommentBox(box.id); }}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-red-700/60 bg-red-900/30 px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-900/60 hover:text-red-100"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
        {t('panel.commentBox.delete', 'Delete comment')}
      </button>

      {/* 색 선택 팝오버 — 디자인 톤에 맞춘 자체 UI (네이티브 OS 다이얼로그 대체) */}
      {bgPickerOpen && (
        <CommentBoxColorPopover
          value={box.color}
          anchor={bgAnchor}
          onLive={liveColor}
          onCommit={commitColor}
          onClose={() => setBgPickerOpen(false)}
        />
      )}
      {textPickerOpen && (
        <CommentBoxColorPopover
          value={box.textColor && box.textColor !== '' ? box.textColor : '#FFFFFF'}
          anchor={textAnchor}
          onLive={liveTextColor}
          onCommit={(c) => commitTextColor(c)}
          onClose={() => setTextPickerOpen(false)}
        />
      )}
    </div>
  );
}
