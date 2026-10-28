/** §4 앱 테마 — 테마 파일 쓰는 법. 키 이름·기본 테마 id 는 정본(`AppThemeDefinition`·`APP_THEME_TOKEN_SPECS`)에서 꺼낸다(손으로 적으면 낡는다). */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_THEME_TOKENS, BUILTIN_APP_THEMES } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';

const HELP_KEYS = ['extends', 'palette', 'mirror', 'colors'] as const;

export function ThemeFormatHelp(): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded border border-gray-700/60 bg-gray-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-gray-300 hover:text-gray-100"
      >
        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        {t('panel.options.theme.help.title')}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          <ul className="flex flex-col gap-1.5">
            {HELP_KEYS.map((key) => (
              <li key={key} className="text-[12px] leading-snug text-gray-400">
                {t(`panel.options.theme.help.${key}`)}
              </li>
            ))}
          </ul>
          <span className="text-[12px] font-semibold text-gray-500">{t('panel.options.theme.help.builtinIds')}</span>
          <div className="flex flex-wrap gap-1">
            {BUILTIN_APP_THEMES.map((theme) => (
              <code key={theme.id} className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[12px] text-gray-300">{theme.id}</code>
            ))}
          </div>
          <span className="text-[12px] font-semibold text-gray-500">{t('panel.options.theme.help.tokens')}</span>
          <ScrollFade maxHeight={96}>
            <div className="flex flex-wrap gap-1">
              {APP_THEME_TOKENS.map((token) => (
                <code key={token} className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[12px] text-gray-400">{token}</code>
              ))}
            </div>
          </ScrollFade>
        </div>
      )}
    </div>
  );
}
