import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PREVIEW_DEVICE_PRESETS } from '@vibisual/shared';

import { buildPickPrompt, describePickedElement } from './pickPrompt.js';
import type { PreviewPicker } from './usePreviewPicker.js';

/**
 * §7.11 (판올림 번호 발급 대기) — 프리뷰 위에 붙는 조작 줄 + 집은 요소 패널.
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

export function PreviewControls({ picker }: { picker: PreviewPicker }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      {/* 폭 프리셋 — 실제 폭으로 렌더한다(축소 ❌). */}
      <div className="flex items-center overflow-hidden rounded border border-white/[0.08]">
        {PREVIEW_DEVICE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => picker.setDevice(preset.id)}
            className={`px-1.5 py-0.5 text-[10px] transition-colors ${
              picker.device === preset.id
                ? 'bg-sky-500/20 text-sky-300'
                : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
            }`}
            title={preset.width === null ? t('common.preview.deviceAutoTip') : t('common.preview.deviceTip', { width: preset.width })}
          >
            {t(preset.labelKey)}
          </button>
        ))}
      </div>
      {/* 요소 집기 — 켜면 프리뷰 안에서 hover 한 요소에 테두리가 뜨고, 클릭이 그 안에서 소비된다. */}
      <button
        type="button"
        onClick={picker.togglePickMode}
        className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
          picker.pickMode
            ? 'border-blue-400/60 bg-blue-500/20 text-blue-200'
            : 'border-white/[0.08] text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
        }`}
        title={t('common.preview.pickHint')}
      >
        <PickIcon />
        <span>{t('common.preview.pickElement')}</span>
      </button>
    </div>
  );
}

/** 집은 요소 패널 — 무엇을 집었는지 보여 주고, 한 문장을 받아 그 프리뷰를 띄운 에이전트에게 보낸다. */
export function PreviewPickPanel({ picker }: { picker: PreviewPicker }): React.JSX.Element | null {
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

  if (!picked) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t border-white/[0.08] bg-gray-900/90 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-[11px] text-blue-300">{describePickedElement(picked)}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto flex-shrink-0 rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-gray-300 transition-colors hover:bg-white/[0.06]"
        >
          {copied ? t('common.preview.pickCopied') : t('common.preview.pickCopy')}
        </button>
        <button
          type="button"
          onClick={picker.clearPicked}
          className="flex-shrink-0 rounded px-1 py-0.5 text-[10px] text-gray-500 transition-colors hover:text-gray-200"
        >
          {t('common.preview.pickClose')}
        </button>
      </div>
      {picked.textSnippet !== '' && (
        <div className="truncate text-[10px] text-gray-500">“{picked.textSnippet}”</div>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
          }}
          rows={2}
          placeholder={t('common.preview.pickPlaceholder')}
          className="scrollbar-thin min-w-0 flex-1 resize-none rounded border border-white/[0.08] bg-gray-950/70 px-2 py-1 text-[12px] text-gray-200 outline-none focus:border-blue-500/60"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={picker.hostAgentId === undefined || text.trim() === ''}
          className="flex-shrink-0 rounded bg-blue-600/85 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          title={picker.hostAgentId === undefined ? t('common.preview.pickNoHost') : undefined}
        >
          {t('common.preview.pickSend')}
        </button>
      </div>
      {picker.hostAgentId === undefined && (
        <div className="text-[10px] text-amber-300/80">{t('common.preview.pickNoHost')}</div>
      )}
    </div>
  );
}
