/** §4 앱 테마 — 테마 파일 문제 목록. 서버는 코드(`AppThemeIssue.code`)만 보내고 문장은 여기서 짓는다. `error` = 파일을 못 씀, `warning` = 그 칸만 버림. */
import { useTranslation } from 'react-i18next';
import { APP_THEME_LIMITS, type AppThemeIssue } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';

export function ThemeIssueList({ issues }: { issues: readonly AppThemeIssue[] }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
        {t('panel.options.theme.custom.issuesTitle', { n: issues.length })}
      </span>
      <ScrollFade maxHeight={140} className="rounded border border-gray-700/60 bg-gray-900/40">
        <ul className="flex flex-col gap-1 p-2">
          {issues.map((issue, i) => (
            <li key={`${issue.file}:${issue.code}:${issue.detail ?? ''}:${i}`} className="flex items-start gap-1.5 text-[12px] leading-snug">
              {issue.level === 'error' ? (
                <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
              ) : (
                <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
              )}
              <span className={`min-w-0 break-words ${issue.level === 'error' ? 'text-red-300' : 'text-gray-300'}`}>
                {t(`panel.options.theme.issue.${issue.code}`, {
                  file: issue.file,
                  detail: issue.detail ?? '',
                  max: APP_THEME_LIMITS.maxFiles,
                  maxKb: Math.round(APP_THEME_LIMITS.maxFileBytes / 1024),
                })}
              </span>
            </li>
          ))}
        </ul>
      </ScrollFade>
    </div>
  );
}
