import { useTranslation } from 'react-i18next';

/**
 * §5.3 #12-4 (J) — 옵션창 권한 탭의 검증 정책 옵트인 손잡이.
 *
 * 스위치(`UserDefaults.permissions.verificationGate`, 기본 끔)는 옵션창의 [적용]과 **함께** 저장된다. 같은
 * 창의 다른 칸과 한 벌로 보내야 서로를 덮지 않으므로, 값은 창이 들고 여기는 그리기만 한다(`EngineBridgeSection`
 * 과 같은 문법). 켬/끔 판정은 shared `isVerificationGateEnabled` 한 곳이다.
 *
 * 제목은 주입원 창의 같은 줄 이름(`ide.context.src.verificationPolicy`)을 그대로 쓴다 — 같은 정책을 두 이름으로
 * 부르면 사용자가 둘을 잇지 못한다. 이 스위치를 켠 경우에만 Codex·Claude Code 양쪽에 제한 안내와 실행 전
 * 차단을 적용한다. 주입원 창은 켜진 정책의 안내만 숨길 수 있다. 저장 뒤 차단은 다음 도구 호출부터,
 * 프롬프트 안내는 다음 턴부터 바뀐다.
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
