import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  VOICE_MODEL_SOURCES,
  isVoiceInstallRunning,
  voiceAsrLanguageTier,
  voiceInstallPercent,
  voiceModelTotalBytes,
  type VoiceAsrState,
} from '@vibisual/shared';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * VoiceInstallDialog — **§5.5 #17-38 ⑬ 마이크를 처음 누르면 뜨는 준비 창.**
 *
 * §5.19 (B) 가 세운 흐름 그대로다: **창은 준비 과정 그 자체이고, 끝나는 순간 스스로 물러나며
 * 하려던 일이 이어진다.** 여기서는 "설치했습니다. 이제 마이크를 다시 눌러 주세요" 로 끝내지
 * 않는다 — 사용자가 누른 것은 [설치]가 아니라 **[말하기]** 였다.
 *
 * ### 왜 주의사항을 접지 않고 다 펴 두는가
 * 700MB 를 받는 일이고, 되돌리려면 어디를 지워야 하는지까지 알아야 한다. 접어 두면 아무도
 * 안 펴고, 안 편 채 눌렀다가 나중에 "왜 이렇게 커졌냐"가 된다. 대신 **문장 수를 줄이고**
 * 각 줄이 한 가지만 말하게 했다.
 */

export interface VoiceInstallDialogProps {
  open: boolean;
  state: VoiceAsrState | null;
  /** 화면 언어 — 이 모델이 그 말을 어느 등급으로 알아듣는지 창이 미리 말한다. */
  uiLocale: string;
  onInstall: () => void;
  onCancel: () => void;
  onClose: () => void;
  /** 설치가 끝났다 — 창을 닫고 곧바로 듣기 시작한다. */
  onReady: () => void;
}

/** 사람이 읽는 크기. 소수점 한 자리까지만 — 그 아래는 아무 정보도 아니다. */
function human(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / 1_000_000;
  if (mb < 1000) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1000).toFixed(1)} GB`;
}

export function VoiceInstallDialog(props: VoiceInstallDialogProps): JSX.Element | null {
  const { open, state, uiLocale, onInstall, onCancel, onClose, onReady } = props;
  const { t } = useTranslation();
  const backdrop = useBackdropDismiss(onClose);

  const progress = state?.install ?? null;
  const running = progress !== null && isVoiceInstallRunning(progress.stage);
  const failed = progress?.stage === 'error';
  const ready = state?.ready === true;

  /** 모델 몫 + 엔진 몫(대략) — 받기 전에 얼마인지 말하기 위한 값. */
  const totalBytes = useMemo(() => {
    const source = VOICE_MODEL_SOURCES[0];
    const model = source ? voiceModelTotalBytes(source) : 0;
    // 엔진 자산은 플랫폼마다 18~25MB 라 25MB 로 잡아 말한다 — **적게 말하지 않는다.**
    return model + 25_000_000;
  }, []);

  const tier = voiceAsrLanguageTier(uiLocale);

  /**
   * 끝나는 순간 물러난다.
   *
   * ⚠ 한 번만 부른다 — `ready` 는 다음 상태 갱신마다 참으로 남아 있어, 가드가 없으면 창이
   * 닫힌 뒤에도 `onReady` 가 계속 불려 받아쓰기가 껐다 켜졌다 한다.
   */
  const firedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      firedRef.current = false;
      return;
    }
    if (ready && !firedRef.current) {
      firedRef.current = true;
      onReady();
    }
  }, [open, ready, onReady]);

  if (!open) return null;

  const percent = progress ? voiceInstallPercent(progress) : 0;
  const stageLabel = ((): string => {
    if (!progress) return '';
    if (progress.stage === 'engine') return t('ide.voiceInstall.stageEngine');
    if (progress.stage === 'extracting') return t('ide.voiceInstall.stageExtract');
    if (progress.stage === 'model') return t('ide.voiceInstall.stageModel');
    if (progress.stage === 'verifying') return t('ide.voiceInstall.stageVerify');
    if (progress.stage === 'ready') return t('ide.voiceInstall.stageReady');
    if (progress.stage === 'canceled') return t('ide.voiceInstall.stageCanceled');
    return '';
  })();

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
      {...backdrop}
    >
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 text-rose-400"
            aria-hidden="true"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <path d="M12 19v3" />
          </svg>
          <h2 className="text-[13px] font-semibold text-gray-100">{t('ide.voiceInstall.title')}</h2>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed text-gray-300">
          <p>{t('ide.voiceInstall.intro', { size: human(totalBytes) })}</p>

          <ul className="space-y-1.5 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
            <li>· {t('ide.voiceInstall.noteSize', { size: human(totalBytes) })}</li>
            <li>· {t('ide.voiceInstall.noteResume')}</li>
            <li>· {t('ide.voiceInstall.notePrivacy')}</li>
            <li>· {t('ide.voiceInstall.noteFirstRun')}</li>
            <li>· {t('ide.voiceInstall.noteLicense')}</li>
            {tier === 'primary' ? <li>· {t('ide.voiceInstall.langPrimary')}</li> : null}
            {tier === 'broad' ? <li className="text-amber-300">· {t('ide.voiceInstall.langBroad')}</li> : null}
            {tier === 'none' ? <li className="text-amber-300">· {t('ide.voiceInstall.langNone')}</li> : null}
          </ul>

          {running || progress?.stage === 'ready' ? (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="font-medium text-gray-200">{stageLabel}</span>
                <span className="tabular-nums text-gray-400">
                  {progress && progress.grandTotalBytes > 0
                    ? `${human(progress.doneBytes + progress.receivedBytes)} / ${human(progress.grandTotalBytes)}`
                    : human(progress?.receivedBytes ?? 0)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full rounded-full bg-rose-500 transition-[width] duration-200"
                  style={{ width: `${String(percent)}%` }}
                />
              </div>
              {progress?.item !== undefined && progress.item.length > 0 ? (
                <p className="truncate text-[12px] text-gray-500" title={progress.item}>
                  {progress.item}
                </p>
              ) : null}
            </div>
          ) : null}

          {failed ? (
            <p className="rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-[12px] text-red-200">
              {progress?.error ?? t('ide.voiceInstall.failed')}
            </p>
          ) : null}

          {progress?.stage === 'canceled' ? (
            <p className="text-[12px] text-gray-400">{t('ide.voiceInstall.canceledHint')}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3">
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-gray-700 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-gray-800"
            >
              {t('ide.voiceInstall.cancel')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-700 px-3 py-1.5 text-[12px] text-gray-300 hover:bg-gray-800"
              >
                {t('ide.voiceInstall.later')}
              </button>
              <button
                type="button"
                onClick={onInstall}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-500"
              >
                {failed || progress?.stage === 'canceled'
                  ? t('ide.voiceInstall.retry')
                  : t('ide.voiceInstall.start')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
