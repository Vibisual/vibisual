import { useTranslation } from 'react-i18next';
import type { CommandError } from '@vibisual/shared';
import { describeCommandError } from './commandError.js';

/** Shared by session output, command fallback and the main timeline. */
export function CommandErrorNotice({ error, className = '' }: { error: CommandError; className?: string }): React.JSX.Element {
  const { t } = useTranslation();
  const desc = describeCommandError(error);
  const guidance = desc.guidance;
  return (
    <div className={`rounded-md border px-3 py-2.5 text-[12px] leading-relaxed ${guidance
      ? 'border-slate-500/30 bg-slate-500/5 text-gray-300'
      : 'border-red-500/30 bg-red-500/5 text-red-300'} ${className}`}>
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" className={`mt-0.5 h-4 w-4 flex-shrink-0 ${guidance ? 'text-sky-300' : 'text-red-400'}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          {guidance ? <><path d="M12 11v6" /><path d="M12 7h.01" /></> : <><path d="M12 7v6" /><path d="M12 17h.01" /></>}
        </svg>
        <div className="min-w-0 flex-1">
          <div className={`font-medium ${guidance ? 'text-gray-200' : 'text-red-300'}`}>{t(desc.labelKey, desc.labelParams)}</div>
          {guidance && <>
            <p className="mt-1 break-words">{t(guidance.explanationKey)}</p>
            <p className="mt-1 break-words text-gray-200">{t(guidance.actionKey)}</p>
            {guidance.resetsLabel && <p className="mt-1 text-amber-200">{t('ide.providerNotice.resets', { time: guidance.resetsLabel })}</p>}
            {guidance.links.length > 0 && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {guidance.links.map(link => <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">{t(link.labelKey)}</a>)}
            </div>}
          </>}
          {desc.detail && (guidance ? (
            <details className="mt-2 text-gray-400">
              <summary className="cursor-pointer select-none hover:text-gray-200">{t('ide.providerNotice.details')}</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono leading-relaxed">{desc.detail}</pre>
            </details>
          ) : <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-gray-400">{desc.detail}</pre>)}
        </div>
      </div>
    </div>
  );
}
