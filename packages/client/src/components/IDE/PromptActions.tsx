import type { MouseEventHandler } from 'react';
import { useTranslation } from 'react-i18next';
import type { PromptTone } from './CollapsiblePrompt.js';

/** The same two controls stay in the same order when a prompt fills its IDE pane. */
export function PromptActions({ tone, copied, onCopy, onView, expanded = false }: {
  tone: PromptTone;
  copied: boolean;
  onCopy: () => void;
  onView?: MouseEventHandler<HTMLButtonElement>;
  expanded?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const viewLabel = t(expanded ? 'ide.streamRenderer.promptReader.back' : 'ide.streamRenderer.promptReader.open');
  const copyLabel = t(copied ? 'ide.streamRenderer.copied' : 'ide.streamRenderer.copy');
  const buttonClass = 'absolute top-2 inline-flex items-center rounded border px-1.5 py-1 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-current';

  return (
    <>
      {onView && (
        <button
          type="button"
          onClick={onView}
          title={expanded ? `${viewLabel} (Esc)` : viewLabel}
          aria-label={viewLabel}
          aria-haspopup={expanded ? undefined : 'dialog'}
          className={`${buttonClass} right-10 ${tone.copyIdle}`}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={expanded ? 'm12 5-7 7 7 7M5 12h14' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'} />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        title={copyLabel}
        aria-label={copyLabel}
        className={`${buttonClass} right-2 gap-1 font-medium ${copied ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : tone.copyIdle}`}
      >
        {copied ? (
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        )}
      </button>
    </>
  );
}
