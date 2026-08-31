import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { shortcutLabel } from '../../utils/platform.js';
import { PREVIEW_DEVICE_PRESETS } from '@vibisual/shared';

import { buildPickPrompt, describePickedElement } from './pickPrompt.js';
import type { PreviewPicker } from './usePreviewPicker.js';
import type { PreviewSnip } from './usePreviewSnip.js';

/**
 * §7.11 (판올림 번호 발급 대기) + §5.17 — 프리뷰 위에 붙는 조작 줄 + 집은 요소·첨부 패널.
 *
 * 탭 프리뷰와 캔버스 프리뷰가 같은 화면 요소를 쓰도록 여기 하나로 둔다.
 */

/** 요소 집기 아이콘 — 조준하는 네모(lucide `scan`/`crosshair` 톤). */
function PickIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

/** 영역 캡처 아이콘 — 잘라내는 틀(lucide `crop` 톤). */
function SnipIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </svg>
  );
}

interface PreviewControlsProps {
  picker: PreviewPicker;
  /** 없으면 [영역 캡처] 를 그리지 않는다(붙일 입력창이 없는 화면). */
  snip?: PreviewSnip | undefined;
}

export function PreviewControls({ picker, snip }: PreviewControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    // 이 줄은 **되돌아오는 유일한 문**이다(§7.16 — 조작은 헤더 한 곳). 그래서 좁아져도 줄지 않고
    // (`shrink-0`), 자리가 모자라면 잘리는 대신 아랫줄로 접힌다(`flex-wrap`) — 한 번 잘려 나가면
    // 폭 프리셋을 되돌릴 방법이 화면에서 사라진다.
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {/* 폭 프리셋 — 실제 폭으로 렌더한다(축소 ❌). `compare` 는 폭 하나가 아니라 여러 폭을 나란히. */}
      <div className="flex shrink-0 items-center overflow-hidden rounded border border-white/[0.08]">
        {PREVIEW_DEVICE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => picker.setDevice(preset.id)}
            className={`shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[12px] transition-colors ${
              picker.device === preset.id
                ? 'bg-sky-500/20 text-sky-300'
                : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
            }`}
            title={
              preset.id === 'compare'
                ? t('common.preview.deviceCompareTip')
                : preset.width === null
                  ? t('common.preview.deviceAutoTip')
                  : t('common.preview.deviceTip', { width: preset.width })
            }
          >
            {t(preset.labelKey)}
          </button>
        ))}
      </div>
      {/* 요소 집기 — 켜면 프리뷰 안에서 hover 한 요소에 테두리가 뜨고, 클릭이 그 안에서 소비된다. */}
      <button
        type="button"
        onClick={picker.togglePickMode}
        className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[12px] transition-colors ${
          picker.pickMode
            ? 'border-blue-400/60 bg-blue-500/20 text-blue-200'
            : 'border-white/[0.08] text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
        }`}
        title={t('common.preview.pickHint')}
      >
        <PickIcon />
        <span>{t('common.preview.pickElement')}</span>
      </button>
      {/* §5.17 (B) 영역 캡처 — 그은 사각형이 이 프리뷰를 띄운 에이전트의 입력창 첨부가 된다. */}
      {snip && picker.hostAgentId !== undefined && (
        <button
          type="button"
          onClick={snip.toggle}
          disabled={snip.busy}
          className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            snip.snipMode
              ? 'border-sky-400/60 bg-sky-500/20 text-sky-200'
              : 'border-white/[0.08] text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
          }`}
          title={t('common.preview.snipHint')}
        >
          <SnipIcon />
          <span>{snip.busy ? t('common.preview.snipBusy') : t('common.preview.snip')}</span>
        </button>
      )}
    </div>
  );
}

interface PreviewPickPanelProps {
  picker: PreviewPicker;
  snip?: PreviewSnip | undefined;
}

/**
 * 집은 요소 패널 — 무엇을 집었는지 보여 주고, 한 문장을 받아 그 프리뷰를 띄운 에이전트에게 보낸다.
 * §5.17 (B) — 방금 캡처한 그림도 같은 자리에 함께 뜬다(집은 요소가 없어도 첨부만으로 열린다).
 */
export function PreviewPickPanel({ picker, snip }: PreviewPickPanelProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const picked = picker.picked;

  const handleSend = useCallback(() => {
    if (!picked) return;
    const prompt = buildPickPrompt(picked, text, t('common.preview.pickPromptHeader'), {
      page: t('common.preview.pickLabelPage'),
      element: t('common.preview.pickLabelElement'),
      selector: t('common.preview.pickLabelSelector'),
      text: t('common.preview.pickLabelText'),
      request: t('common.preview.pickLabelRequest'),
    });
    if (prompt === '') return;
    if (picker.send(prompt)) setText('');
  }, [picked, text, t, picker]);

  const handleCopy = useCallback(() => {
    if (!picked) return;
    void navigator.clipboard.writeText(picked.selector).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => { /* 클립보드가 막혀도 화면은 그대로 */ },
    );
  }, [picked]);

  const snipAttachments = snip?.attachments ?? [];
  const snipError = snip?.error ?? null;
  if (!picked && snipAttachments.length === 0 && snipError === null) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t border-white/[0.08] bg-gray-900/90 px-2 py-1.5">
      {/* §5.17 (B) — 방금 붙인 그림. 입력창의 그 첨부와 같은 항목이라 여기서 지우면 거기서도 사라진다. */}
      {snipAttachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-sky-300">{t('common.preview.snipAttached')}</span>
          {snipAttachments.map((a) => (
            <span key={a.tempId} className="relative inline-flex">
              <img
                src={a.previewUrl}
                alt=""
                className={`h-10 w-16 rounded border border-white/[0.12] object-cover ${a.uploading ? 'opacity-50' : ''}`}
              />
              <button
                type="button"
                onClick={() => snip?.remove(a.tempId)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-950/90 text-gray-300 transition-colors hover:text-white"
                title={t('common.preview.snipRemove')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
              {a.error !== undefined && (
                <span className="absolute inset-x-0 bottom-0 truncate bg-red-950/85 px-0.5 text-[12px] text-red-200">
                  {a.error}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      {snipError !== null && (
        <div className="flex items-center gap-1.5 text-[12px] text-amber-300/85">
          <span className="min-w-0 flex-1 truncate">
            {snipError === 'unavailable' ? t('common.preview.snipUnavailable') : t('common.preview.snipFailed', { error: snipError })}
          </span>
          <button
            type="button"
            onClick={() => snip?.clearError()}
            className="shrink-0 rounded px-1 py-0.5 text-gray-500 transition-colors hover:text-gray-200"
          >
            {t('common.preview.pickClose')}
          </button>
        </div>
      )}
      {picked && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[12px] text-blue-300">{describePickedElement(picked)}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="ml-auto flex-shrink-0 rounded border border-white/[0.08] px-1.5 py-0.5 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.06]"
            >
              {copied ? t('common.preview.pickCopied') : t('common.preview.pickCopy')}
            </button>
            <button
              type="button"
              onClick={picker.clearPicked}
              className="flex-shrink-0 rounded px-1 py-0.5 text-[12px] text-gray-500 transition-colors hover:text-gray-200"
            >
              {t('common.preview.pickClose')}
            </button>
          </div>
          {picked.textSnippet !== '' && (
            <div className="truncate text-[12px] text-gray-500">“{picked.textSnippet}”</div>
          )}
          <div className="flex items-end gap-1.5">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
              }}
              rows={2}
              placeholder={t('common.preview.pickPlaceholder', { shortcut: shortcutLabel('Ctrl+Enter') })}
              className="scrollbar-thin min-w-0 flex-1 resize-none rounded border border-white/[0.08] bg-gray-950/70 px-2 py-1 text-[12px] text-gray-200 outline-none focus:border-blue-500/60"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={picker.hostAgentId === undefined || text.trim() === ''}
              className="flex-shrink-0 rounded bg-blue-600/85 px-2 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
              title={picker.hostAgentId === undefined ? t('common.preview.pickNoHost') : undefined}
            >
              {t('common.preview.pickSend')}
            </button>
          </div>
          {picker.hostAgentId === undefined && (
            <div className="text-[12px] text-amber-300/80">{t('common.preview.pickNoHost')}</div>
          )}
        </>
      )}
    </div>
  );
}
