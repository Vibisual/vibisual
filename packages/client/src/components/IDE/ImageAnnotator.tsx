import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore, agentSessionInputKey, type ImageLightboxState } from '../../stores/graphStore.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import {
  ANNOTATION_COLORS,
  ANNOTATION_FONT_STACK,
  ANNOTATION_TOOLS,
  ANNOTATION_WIDTH_STEPS,
  EMPTY_ANNOTATION_HISTORY,
  HIGHLIGHT_ALPHA,
  arrowHead,
  baseBadgeRadius,
  baseFontSize,
  baseStrokeWidth,
  canRedo,
  canUndo,
  clearAnnotations,
  commitAnnotation,
  createAnnotation,
  exportAnnotatedImage,
  exportAnnotatedPng,
  extendAnnotation,
  isCommittable,
  nextBadgeIndex,
  normalizeBox,
  penPathD,
  redoAnnotations,
  toImagePoint,
  undoAnnotations,
  withAlpha,
  type Annotation,
  type AnnotationHistory,
  type AnnotationStyle,
  type AnnotationTool,
  type Point,
  type Size,
} from './imageAnnotate.js';
import { putWorkspaceImage } from './workspaceImageSave.js';

// §5.5 #17-25 v4.80 — 라이트박스 안에서 이미지에 직접 표시하고, 표시가 박힌 PNG 를 그대로 첨부한다.
//
// 기본은 `보기`(도구 미선택) — 그때 오버레이는 pointer-events:none 이라 v2.61 의 보기 동작
// (배경 클릭·Esc·× 닫기)이 한 글자도 바뀌지 않는다. 도구를 고른 사람에게만 캔버스가 열린다.
// 계산은 전부 imageAnnotate.ts(순수 모듈)에 있고 여기는 입력·표시·저장 배선만 한다.

const API_BASE = '';

interface ImageLightboxViewProps {
  state: ImageLightboxState;
  /** 라이트박스를 띄운 IDE 의 에이전트·세션 — 주석본을 "새 첨부"로 붙일 자리. */
  agentId: string;
  activeSessionId: string | null;
  /** 입력창이 있는 뷰인가(읽기 전용 Hook 메인 탭이면 false → [내려받기]만). */
  canAttach: boolean;
  onClose: () => void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `an-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ImageLightboxView({
  state,
  agentId,
  activeSessionId,
  canAttach,
  onClose,
}: ImageLightboxViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const agents = useGraphStore((s) => s.agents);
  const updateAttachments = useGraphStore((s) => s.updateAgentSessionInputAttachments);
  const markWorkspaceImageSaved = useGraphStore((s) => s.markWorkspaceImageSaved);

  const [tool, setTool] = useState<AnnotationTool | null>(null);
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0] ?? '#ef4444');
  const [widthStep, setWidthStep] = useState(1);
  const [history, setHistory] = useState<AnnotationHistory>(EMPTY_ANNOTATION_HISTORY);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [natural, setNatural] = useState<Size>({ w: 0, h: 0 });
  const [textDraft, setTextDraft] = useState<{ at: Point; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // ④-1 그 사이 디스크가 바뀌었을 때 — 사용자가 [그래도 저장]을 고를 때까지 덮어쓰지 않는다.
  const [fileConflict, setFileConflict] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const draftRef = useRef<Annotation | null>(null);
  const drawingRef = useRef(false);
  // 글자 입력은 Enter 와 blur 두 곳에서 확정된다 — ref 를 먼저 비워 같은 글자가 두 번 박히지 않게.
  const textDraftRef = useRef<{ at: Point; value: string } | null>(null);

  const setTextDraftBoth = useCallback((next: { at: Point; value: string } | null) => {
    textDraftRef.current = next;
    setTextDraft(next);
  }, []);

  const items = history.items;
  const dirty = items.length > 0 || draft !== null;

  // 굵기 3단은 "이미지 크기에서 뽑은 기본값"에 곱한다 — 4K 든 아이콘 캡처든 화면에서 같은 두께로 보인다.
  const style = useMemo<AnnotationStyle>(() => {
    const mul = ANNOTATION_WIDTH_STEPS[widthStep] ?? 1;
    const scale = 0.7 + mul * 0.3;
    return {
      color,
      strokeWidth: Math.max(1, baseStrokeWidth(natural) * mul),
      fontSize: Math.max(10, baseFontSize(natural) * scale),
      badgeRadius: Math.max(8, baseBadgeRadius(natural) * scale),
    };
  }, [color, widthStep, natural]);

  const setDraftBoth = useCallback((next: Annotation | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  // Esc(닫기 확인) · Ctrl+Z / Ctrl+Shift+Z · Ctrl+Y. 글자 입력 중에는 그 입력이 먼저다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (textDraft) {
          setTextDraftBoth(null);
          return;
        }
        requestClose();
        return;
      }
      if (textDraft) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        setHistory(e.shiftKey ? redoAnnotations : undoAnnotations);
      } else if (key === 'y') {
        e.preventDefault();
        setHistory(redoAnnotations);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [textDraft, requestClose]);

  const pointFromEvent = useCallback(
    (e: React.PointerEvent): Point | null => {
      const svg = svgRef.current;
      if (!svg || natural.w <= 0 || natural.h <= 0) return null;
      const rect = svg.getBoundingClientRect();
      return toImagePoint(
        { x: e.clientX, y: e.clientY },
        { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        natural,
      );
    },
    [natural],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!tool || saving) return;
      e.stopPropagation();
      e.preventDefault();
      const at = pointFromEvent(e);
      if (!at) return;
      if (tool === 'text') {
        setTextDraftBoth({ at, value: '' });
        return;
      }
      if (tool === 'number') {
        const badge = createAnnotation({
          id: newId(),
          tool: 'number',
          at,
          style,
          badgeIndex: nextBadgeIndex(items),
        });
        setHistory((h) => commitAnnotation(h, badge));
        return;
      }
      drawingRef.current = true;
      // 이미지 밖으로 끌어도 계속 그려지게 포인터를 잡는다(좌표는 imageAnnotate 가 안쪽으로 클램프).
      // 포인터가 이미 사라진 드문 타이밍에는 던지므로 삼킨다 — 못 잡아도 그리기 자체는 된다.
      try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      setDraftBoth(createAnnotation({ id: newId(), tool, at, style }));
    },
    [tool, saving, pointFromEvent, style, items, setDraftBoth],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawingRef.current) return;
      const at = pointFromEvent(e);
      const cur = draftRef.current;
      if (!at || !cur) return;
      const next = extendAnnotation(cur, at);
      if (next !== cur) setDraftBoth(next);
    },
    [pointFromEvent, setDraftBoth],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* 이미 놓였으면 무시 */ }
      const done = draftRef.current;
      setDraftBoth(null);
      if (done && isCommittable(done)) setHistory((h) => commitAnnotation(h, done));
    },
    [setDraftBoth],
  );

  const commitText = useCallback(() => {
    const cur = textDraftRef.current;
    if (!cur) return;
    setTextDraftBoth(null);
    const ann = createAnnotation({ id: newId(), tool: 'text', at: cur.at, style, text: cur.value });
    if (isCommittable(ann)) setHistory((h) => commitAnnotation(h, ann));
  }, [style, setTextDraftBoth]);

  const uploadAnnotated = useCallback(
    async (blob: Blob, sid: string): Promise<string> => {
      const file = new File([blob], `annotated-${Date.now()}.png`, { type: 'image/png' });
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch(`${API_BASE}/api/agent-attachments/${sid}/upload`, { method: 'POST', body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { path: string };
      return data.path;
    },
    [],
  );

  const handleSave = useCallback(async () => {
    const img = imgRef.current;
    if (!img || saving || items.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await exportAnnotatedPng(img, items);
      if (!blob) throw new Error(t('ide.imageAnnotate.renderFailed'));
      const target = state.attachment;
      const ownerAgentId = target?.agentId ?? agentId;
      const sid = agents.find((a) => a.id === ownerAgentId)?.path ?? null;
      if (!sid) throw new Error(t('ide.imageAnnotate.noSession'));
      const serverPath = await uploadAnnotated(blob, sid);
      const previewUrl = URL.createObjectURL(blob);
      // (a) 대기 중 첨부를 열었으면 그 자리를 교체 — 보내지도 않은 원본이 디스크에 남지 않게 옛 파일은 지운다.
      const prevEntry = target
        ? useGraphStore.getState().agentSessionInputs[agentSessionInputKey(target.agentId, target.sessionId)]
        : undefined;
      const prevAttachment = target
        ? prevEntry?.attachments.find((a) => a.tempId === target.tempId)
        : undefined;
      if (target && prevAttachment) {
        updateAttachments(target.agentId, target.sessionId, (prev) =>
          prev.map((a) => (a.tempId === target.tempId ? { ...a, previewUrl, serverPath, uploading: false } : a)),
        );
        if (prevAttachment.previewUrl && prevAttachment.previewUrl !== previewUrl) {
          URL.revokeObjectURL(prevAttachment.previewUrl);
        }
        if (prevAttachment.serverPath && prevAttachment.serverPath !== serverPath) {
          void fetch(`${API_BASE}/api/agent-attachments/${sid}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: prevAttachment.serverPath }),
          }).catch(() => {});
        }
      } else {
        // (b) 이미 보낸 이미지(또는 그새 사라진 첨부) — 지난 기록은 두고 현재 입력창에 새 첨부로 붙인다.
        updateAttachments(agentId, activeSessionId, (prev) => [
          ...prev,
          { tempId: newId(), previewUrl, serverPath, uploading: false },
        ]);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ide.imageAnnotate.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [saving, items, state.attachment, agentId, activeSessionId, agents, uploadAnnotated, updateAttachments, onClose, t]);

  /**
   * §5.5 #17-25 ④-1 — 세 번째 저장 자리: **그 파일 자체를 덮어쓴다**.
   *
   * 첨부 저장(`handleSave`)과 갈라 둔 이유는 목적지가 다르기 때문이다. 규율은 편집창의 텍스트 저장과
   * 같은 것을 쓴다 — 읽을 때 본 `mtimeMs` 를 함께 보내고, 그 사이 디스크가 바뀌었으면(409) 덮어쓰지
   * 않고 사용자가 [그래도 저장]을 고르게 한다.
   */
  const handleSaveToFile = useCallback(async (force = false) => {
    const img = imgRef.current;
    const target = state.workspace;
    if (!img || !target || saving || items.length === 0 || !target.bakeable) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await exportAnnotatedImage(img, items, target.mime);
      if (!blob) throw new Error(t('ide.imageAnnotate.renderFailed'));
      const out = await putWorkspaceImage(target.root, target.path, blob, force ? 0 : target.mtimeMs);
      if (!out.ok) {
        setFileConflict(out.status === 409);
        setError(t(out.status === 409 ? 'ide.imageAnnotate.fileConflict' : 'ide.imageAnnotate.fileSaveFailed'));
        return;
      }
      // 편집창이 이 신호를 보고 다시 읽어, 방금 그린 표시가 미리보기에 그대로 올라온다.
      markWorkspaceImageSaved(target.path);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ide.imageAnnotate.fileSaveFailed'));
    } finally {
      setSaving(false);
    }
  }, [state.workspace, saving, items, markWorkspaceImageSaved, onClose, t]);

  const handleDownload = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;
    setError(null);
    try {
      const blob = await exportAnnotatedPng(img, items);
      if (!blob) throw new Error(t('ide.imageAnnotate.renderFailed'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `annotated-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ide.imageAnnotate.saveFailed'));
    }
  }, [items, t]);

  const annotating = tool !== null;
  const ready = natural.w > 0 && natural.h > 0;

  // 배경 클릭으로 닫기(작업물이 없을 때만). 그림·주석 위에서 시작한 드래그는 배경에서 끝나도 안 닫힌다.
  const backdrop = useBackdropDismiss(() => { if (!dirty) onClose(); });

  return (
    <div
      {...backdrop}
      className="vibi-image-lightbox fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-3 bg-black/80 p-6 pt-14"
      role="dialog"
      aria-modal="true"
    >
      {/* 도구 막대 — 배경 클릭 닫기와 겹치지 않게 이벤트를 여기서 끊는다. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-w-[92vw] flex-wrap items-center justify-center gap-1 rounded-xl border border-gray-700 bg-gray-900/95 px-2 py-1.5 shadow-2xl"
      >
        <ToolbarButton
          active={tool === null}
          label={t('ide.imageAnnotate.tool.view')}
          onClick={() => { setTool(null); setTextDraftBoth(null); }}
        >
          <ToolGlyph tool="view" />
        </ToolbarButton>
        <Divider />
        {ANNOTATION_TOOLS.map((item) => (
          <ToolbarButton
            key={item}
            active={tool === item}
            label={t(`ide.imageAnnotate.tool.${item}`)}
            onClick={() => { setTool(item); setTextDraftBoth(null); }}
          >
            <ToolGlyph tool={item} />
          </ToolbarButton>
        ))}
        <Divider />
        <div className="flex items-center gap-1 px-0.5" title={t('ide.imageAnnotate.color')}>
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              className={`h-4 w-4 rounded-full border transition-transform ${
                color === c ? 'scale-125 border-white' : 'border-gray-600 hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <Divider />
        <div className="flex items-center gap-0.5">
          {ANNOTATION_WIDTH_STEPS.map((mul, i) => (
            <button
              key={mul}
              type="button"
              title={t(`ide.imageAnnotate.width.${i === 0 ? 'thin' : i === 1 ? 'medium' : 'thick'}`)}
              aria-label={t(`ide.imageAnnotate.width.${i === 0 ? 'thin' : i === 1 ? 'medium' : 'thick'}`)}
              onClick={() => setWidthStep(i)}
              className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                widthStep === i ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span
                className="block rounded-full bg-current"
                style={{ width: `${6 + i * 4}px`, height: `${1.5 + i * 2}px` }}
              />
            </button>
          ))}
        </div>
        <Divider />
        <ToolbarButton
          label={t('ide.imageAnnotate.undo')}
          disabled={!canUndo(history)}
          onClick={() => setHistory(undoAnnotations)}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
        </ToolbarButton>
        <ToolbarButton
          label={t('ide.imageAnnotate.redo')}
          disabled={!canRedo(history)}
          onClick={() => setHistory(redoAnnotations)}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></svg>
        </ToolbarButton>
        <ToolbarButton
          label={t('ide.imageAnnotate.clear')}
          disabled={items.length === 0}
          onClick={() => setHistory(clearAnnotations)}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
        </ToolbarButton>
        <Divider />
        <ToolbarButton label={t('ide.imageAnnotate.download')} onClick={() => void handleDownload()}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        </ToolbarButton>
        {/* ④-1 워크스페이스 파일에서 연 팝업 — 첨부가 아니라 그 파일을 덮어쓴다(둘은 병행). */}
        {state.workspace && (
          <button
            type="button"
            disabled={items.length === 0 || saving || !state.workspace.bakeable}
            onClick={() => void handleSaveToFile()}
            title={
              state.workspace.bakeable
                ? t('ide.imageAnnotate.saveFileHint', { path: state.workspace.path })
                : t('ide.imageAnnotate.saveFileUnsupported')
            }
            className="ml-1 flex h-7 items-center gap-1.5 rounded bg-emerald-600 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            {saving ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white border-t-transparent" />
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            )}
            {t('ide.imageAnnotate.saveFile')}
          </button>
        )}
        {canAttach && (
          <button
            type="button"
            disabled={items.length === 0 || saving}
            onClick={() => void handleSave()}
            className="ml-1 flex h-7 items-center gap-1.5 rounded bg-blue-600 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            {saving ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white border-t-transparent" />
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            )}
            {state.attachment ? t('ide.imageAnnotate.saveReplace') : t('ide.imageAnnotate.saveAttach')}
          </button>
        )}
      </div>

      {error && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex max-w-[92vw] items-center rounded border border-red-500/40 bg-red-900/60 px-3 py-1 text-[12px] text-red-200"
        >
          <span className="min-w-0 truncate">{error}</span>
          {fileConflict && (
            <button
              type="button"
              onClick={() => { setFileConflict(false); void handleSaveToFile(true); }}
              className="ml-2 flex-shrink-0 rounded border border-red-400/50 px-1.5 py-0.5 text-[12px] transition-colors hover:bg-red-500/20"
            >
              {t('ide.imageAnnotate.fileConflictOverwrite')}
            </button>
          )}
        </div>
      )}

      {/* 이미지 + 주석 오버레이 — 상자가 정확히 같아야 natural 좌표가 화면과 맞는다. */}
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <img
          ref={imgRef}
          src={state.url}
          alt=""
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="block max-h-[78vh] max-w-[92vw] rounded-lg border border-gray-700 shadow-2xl"
        />
        {ready && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${natural.w} ${natural.h}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`absolute inset-0 h-full w-full rounded-lg ${
              annotating ? 'cursor-crosshair touch-none' : 'pointer-events-none'
            }`}
          >
            {items.map((ann) => (
              <AnnotationShape key={ann.id} ann={ann} />
            ))}
            {draft && <AnnotationShape ann={draft} />}
          </svg>
        )}
        {textDraft && ready && (
          <input
            autoFocus
            value={textDraft.value}
            onChange={(e) => setTextDraftBoth(textDraft ? { ...textDraft, value: e.target.value } : textDraft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitText(); }
            }}
            onBlur={commitText}
            placeholder={t('ide.imageAnnotate.textPlaceholder')}
            className="absolute z-10 min-w-[7rem] rounded border border-blue-400 bg-gray-900/95 px-1.5 py-0.5 text-[12px] text-white outline-none"
            style={{
              left: `${(textDraft.at.x / natural.w) * 100}%`,
              top: `${(textDraft.at.y / natural.h) * 100}%`,
            }}
          />
        )}
      </div>

      <p className="text-[12px] text-gray-500" onClick={(e) => e.stopPropagation()}>
        {annotating ? t('ide.imageAnnotate.hintDraw') : t('ide.imageAnnotate.hintPick')}
      </p>

      {/* v2.94 — 닫기는 Windows 네이티브 타이틀바 오버레이(우상단 ~144×36px)를 피해 top-12. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); requestClose(); }}
        aria-label={t('panel.detailPanel.close')}
        className="absolute right-4 top-12 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-gray-200 transition-colors hover:bg-black/80"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>

      {confirmDiscard && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/70"
        >
          <div className="w-[min(22rem,90vw)] rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl">
            <p className="text-[13px] text-gray-200">{t('ide.imageAnnotate.discardTitle')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="rounded border border-gray-600 px-2.5 py-1 text-[12px] text-gray-300 transition-colors hover:bg-gray-800"
              >
                {t('ide.imageAnnotate.discardCancel')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-red-600 px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-red-500"
              >
                {t('ide.imageAnnotate.discardConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 부속 ───

function Divider(): React.JSX.Element {
  return <span className="mx-0.5 h-5 w-px flex-shrink-0 bg-gray-700" />;
}

interface ToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ active, disabled, label, onClick, children }: ToolbarButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      disabled={disabled ?? false}
      onClick={onClick}
      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
      } disabled:cursor-not-allowed disabled:text-gray-700 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}

/** 도구 글리프 — lucide 톤 stroke SVG (이모지 ❌). */
function ToolGlyph({ tool }: { tool: AnnotationTool | 'view' }): React.JSX.Element {
  const common = {
    className: 'h-4 w-4',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (tool) {
    case 'view':
      return <svg {...common}><path d="m4 3 7 17 2.6-6.9L20 10.6z" /></svg>;
    case 'rect':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /></svg>;
    case 'ellipse':
      return <svg {...common}><ellipse cx="12" cy="12" rx="9" ry="7" /></svg>;
    case 'arrow':
      return <svg {...common}><line x1="5" y1="19" x2="19" y2="5" /><polyline points="10 5 19 5 19 14" /></svg>;
    case 'pen':
      return <svg {...common}><path d="M16.5 3.5a2.6 2.6 0 0 1 3.7 3.7L7.4 20 3 21l1-4.4z" /><path d="M15 5.5 18.5 9" /></svg>;
    case 'highlight':
      return <svg {...common}><path d="M9 13.5 5 17.5V21h3.5l4-4" /><path d="m12.5 17 7.2-7.2a2.6 2.6 0 0 0-3.7-3.7L8.8 13.3" /></svg>;
    case 'mask':
      return <svg {...common}><path d="M9.9 4.6A9.5 9.5 0 0 1 12 4.4c7 0 10 7.6 10 7.6a19 19 0 0 1-2.2 3.2M6.4 6.5A18 18 0 0 0 2 12s3 7.6 10 7.6a9.4 9.4 0 0 0 5.3-1.6" /><line x1="3" y1="3" x2="21" y2="21" /></svg>;
    case 'text':
      return <svg {...common}><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>;
    case 'number':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M10.5 9.8 12.6 8.3V16" /></svg>;
  }
}

/** 주석 1개를 SVG 로. 캔버스(drawAnnotations)와 **같은 값**을 쓰므로 저장본이 화면과 같다. */
function AnnotationShape({ ann }: { ann: Annotation }): React.JSX.Element | null {
  switch (ann.tool) {
    case 'rect': {
      const box = normalizeBox(ann.from, ann.to);
      return (
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          fill="none"
          stroke={ann.color}
          strokeWidth={ann.strokeWidth}
          strokeLinejoin="round"
        />
      );
    }
    case 'highlight': {
      const box = normalizeBox(ann.from, ann.to);
      return <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={withAlpha(ann.color, HIGHLIGHT_ALPHA)} />;
    }
    case 'mask': {
      const box = normalizeBox(ann.from, ann.to);
      return <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#000000" />;
    }
    case 'ellipse': {
      const box = normalizeBox(ann.from, ann.to);
      return (
        <ellipse
          cx={box.x + box.w / 2}
          cy={box.y + box.h / 2}
          rx={box.w / 2}
          ry={box.h / 2}
          fill="none"
          stroke={ann.color}
          strokeWidth={ann.strokeWidth}
        />
      );
    }
    case 'arrow': {
      const head = arrowHead(ann.from, ann.to, ann.strokeWidth);
      return (
        <g>
          <line
            x1={ann.from.x}
            y1={ann.from.y}
            x2={ann.to.x}
            y2={ann.to.y}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
          />
          <polygon points={head.map((p) => `${p.x},${p.y}`).join(' ')} fill={ann.color} />
        </g>
      );
    }
    case 'pen':
      return (
        <path
          d={penPathD(ann.points)}
          fill="none"
          stroke={ann.color}
          strokeWidth={ann.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'text':
      return (
        <text
          x={ann.at.x}
          y={ann.at.y}
          fill={ann.color}
          stroke="rgba(0, 0, 0, 0.85)"
          strokeWidth={Math.max(2, ann.fontSize * 0.18)}
          paintOrder="stroke"
          fontSize={ann.fontSize}
          fontWeight={700}
          fontFamily={ANNOTATION_FONT_STACK}
          dominantBaseline="text-before-edge"
        >
          {ann.text}
        </text>
      );
    case 'number':
      return (
        <g>
          <circle
            cx={ann.at.x}
            cy={ann.at.y}
            r={ann.radius}
            fill={ann.color}
            stroke="rgba(0, 0, 0, 0.75)"
            strokeWidth={Math.max(1.5, ann.radius * 0.12)}
          />
          <text
            x={ann.at.x}
            y={ann.at.y + ann.radius * 0.04}
            fill="#0b0f19"
            fontSize={Math.round(ann.radius * 1.25)}
            fontWeight={700}
            fontFamily={ANNOTATION_FONT_STACK}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {ann.index}
          </text>
        </g>
      );
  }
}
