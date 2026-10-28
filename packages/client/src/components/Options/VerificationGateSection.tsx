import { useTranslation } from 'react-i18next';

/**
 * §5.3 #12-4 (J) — 검증 정책 옵트인(기본 끔). 옵션창 [적용]과 한 벌로 저장되므로 값은 창이 들고 여기는 그리기만 한다.
 * 판정은 shared `isVerificationGateEnabled` 한 곳, 제목은 주입원 창과 같은 이름. 켠 경우에만 Codex·Claude Code 양쪽에 안내 + 실행 전 차단.
 */

interface VerificationGateSectionProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function VerificationGateSection({ enabled, onChange }: VerificationGateSectionProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('ide.context.src.verificationPolicy', { defaultValue: 'Verification policy' })}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.permissions.verificationGateIntro', {
          defaultValue: 'This policy applies to both Codex and Claude Code only when enabled. Agents are then told to run tests, lint, type checks, verification builds, E2E, browser checks, screenshot comparisons and verification agents only when requested in the current task, and unrequested calls are blocked before execution.',
        })}
      </p>

      <label className="flex cursor-pointer items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 hover:border-gray-600">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-200">
            {t('panel.options.permissions.verificationGateEnabled', { defaultValue: 'Require a request before running verification' })}
          </span>
          <span className="text-[12px] leading-snug text-gray-500">
            {t('panel.options.permissions.verificationGateEnabledDesc', {
              defaultValue: 'Off by default. When off, Vibisual adds no verification restriction to prompts and does not block calls under this policy. When on, script names containing check, verify or test may also be blocked. Save with {{apply}}: blocking changes from the next tool call, and prompt guidance from the next turn.',
              apply: t('panel.options.apply'),
            })}
          </span>
        </span>
      </label>
    </div>
  );
}
