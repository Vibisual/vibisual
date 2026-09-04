import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  VOICE_INPUT,
  emptyVoiceLevels,
  levelFromTimeDomain,
  pushVoiceLevel,
  type VoiceInputErrorCode,
  isMicAccessFixable,
  type VoiceInputStatus,
} from '@vibisual/shared';
import { shortcutLabel } from '../../utils/platform.js';

/**
 * VoiceInputOverlay — **§5.5 #17-38 "지금 듣고 있다"를 입력창 **위**에 그리는 판.**
 *
 * 왜 입력창 안이 아니라 위인가: 말한 것은 **입력창의 글**이 되어야 하고(고치고 지우고 이어 쓸
 * 수 있어야 한다), 듣는 중이라는 신호는 그 글과 섞이면 안 된다. 둘을 한 칸에 겹쳐 그리면
 * 확정 전 글자가 입력창에 들어갔다 사라지는 것처럼 보여, 사용자가 무엇을 보내게 되는지
 * 알 수 없게 된다(사용자 지시 — "텍스트 입력은 텍스트 창에, 이펙트는 텍스트창 위에").
 *
 * 자리는 히스토리 힌트·슬래시 드롭다운과 같은 `bottom-full` 레일이다(새 축 ❌).
 */

interface VoiceInputOverlayProps {
  status: VoiceInputStatus;
  error: VoiceInputErrorCode | null;
  /** 아직 확정되지 않은 말. 확정되면 이 자리에서 사라지고 아래 입력창에 나타난다. */
  interim: string;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  onStop: () => void;
  onDismissError: () => void;
  /**
   * §5.5 #17-38 ⑮ — 이 실패를 **OS 설정에서 풀 수 있을 때** 그리로 가는 문을 연다.
   * 사유만 말하고 끝내면 사용자는 어디를 만져야 하는지 모른 채 같은 버튼만 다시 누른다.
   */
  onOpenMicSettings: () => void;
}

/**
 * 파형 — **실제로 잰 소리 세기의 최근 기록**.
 *
 * React 상태를 쓰지 않는다: 초당 스물 몇 번 도는 자리라 상태로 올리면 입력창 전체가 그만큼
 * 다시 그려진다(타이핑 지연 회귀). 막대 하나하나의 `transform` 만 직접 만진다.
 */
function VoiceWave({ analyserRef, active }: {
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  active: boolean;
}): React.JSX.Element {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const indices = useMemo(
    () => Array.from({ length: VOICE_INPUT.BAR_COUNT }, (_unused, i) => i),
    [],
  );

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    let levels = emptyVoiceLevels();
    const samples = new Uint8Array(VOICE_INPUT.FFT_SIZE);

    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      // rAF 는 화면 주사율을 따르지만(120Hz 판도 있다) 막대는 그만큼 자주 바꿀 필요가 없다.
      if (now - last < VOICE_INPUT.LEVEL_INTERVAL_MS) return;
      last = now;
      const analyser = analyserRef.current;
      let level = 0;
      if (analyser !== null) {
        analyser.getByteTimeDomainData(samples);
        level = levelFromTimeDomain(samples);
      }
      levels = pushVoiceLevel(levels, level);
      for (let i = 0; i < levels.length; i += 1) {
        const el = barsRef.current[i];
        if (!el) continue;
        const scale = VOICE_INPUT.BAR_MIN + (1 - VOICE_INPUT.BAR_MIN) * (levels[i] ?? 0);
        el.style.transform = `scaleY(${scale.toFixed(3)})`;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, analyserRef]);

  return (
    <span className="flex h-4 flex-shrink-0 items-center gap-[2px]" aria-hidden="true">
      {indices.map((i) => (
        <span
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          className="h-4 w-[2px] rounded-full bg-gray-200/85 transition-transform duration-75 ease-out"
          // 처음 프레임부터 납작하게 시작한다 — 켜는 순간 막대가 천장에서 떨어지지 않게.
          style={{ transform: `scaleY(${VOICE_INPUT.BAR_MIN})` }}
        />
      ))}
    </span>
  );
}

/** 실패 사유 → 번역 키. 새 사유가 생기면 여기 한 줄과 로케일 한 줄이 짝이다. */
const ERROR_KEY: Record<VoiceInputErrorCode, string> = {
  unsupported: 'ide.mainArea.voiceErrUnsupported',
  permission: 'ide.mainArea.voiceErrPermission',
  device: 'ide.mainArea.voiceErrDevice',
  // 마이크가 **아예 없다** — 설정을 켜라가 아니라 **꽂으라고** 말해야 하는 자리다.
  'no-device': 'ide.mainArea.voiceErrNoDevice',
  // 있는데 다른 앱이 쥐고 있다 — 꽂으라고 하면 꽂힌 마이크를 다시 꽂아 보게 된다.
  'device-busy': 'ide.mainArea.voiceErrDeviceBusy',
  network: 'ide.mainArea.voiceErrNetwork',
  // 인식기는 이 PC 에서 돈다 — "서비스에 닿지 못했다"가 아니라 "엔진이 안 떴다"가 사실이다.
  engine: 'ide.mainArea.voiceErrEngine',
  language: 'ide.mainArea.voiceErrLanguage',
  'no-speech': 'ide.mainArea.voiceErrUnknown',
  aborted: 'ide.mainArea.voiceErrUnknown',
  unknown: 'ide.mainArea.voiceErrUnknown',
};

export function VoiceInputOverlay({
  status, error, interim, analyserRef, onStop, onDismissError, onOpenMicSettings,
}: VoiceInputOverlayProps): React.JSX.Element | null {
  const { t } = useTranslation();

  if (status === 'error' && error !== null) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-1 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/80 px-3 py-2 text-[12px] text-red-200 shadow-lg">
        <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        <span className="min-w-0 flex-1">{t(ERROR_KEY[error])}</span>
        {/* §5.5 #17-38 ⑮ — 권한·장치로 막힌 실패는 **OS 설정에서 풀 수 있다.** 그 문을 여기 둔다.
            `device` 도 태우는 이유는 win 에서 "데스크톱 앱 허용"이 꺼지면 권한 문제가
            `NotFoundError`(=장치 없음)로 오기 때문이다(`isMicAccessFixable` 주석). */}
        {isMicAccessFixable(error) && (
          <button
            type="button"
            onClick={onOpenMicSettings}
            className="flex h-5 flex-shrink-0 items-center rounded border border-red-400/40 px-1.5 text-[12px] font-semibold text-red-100 transition-colors hover:bg-red-500/25"
          >
            {t('ide.mainArea.voiceMicSettingsAction')}
          </button>
        )}
        <button
          type="button"
          onClick={onDismissError}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-100"
          aria-label={t('ide.mainArea.voiceErrDismiss')}
          title={t('ide.mainArea.voiceErrDismiss')}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    );
  }

  if (status !== 'starting' && status !== 'listening') return null;
  const listening = status === 'listening';

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 flex items-center gap-2.5 rounded-lg border border-gray-700 bg-gray-900/95 px-3 py-2 shadow-lg"
      // 읽어 주는 도구에게는 "지금 듣고 있다"가 파형이 아니라 이 한 줄로 전달된다.
      role="status"
      aria-live="polite"
    >
      {/* 녹음 점 — 켜져 있는 동안만 맥이 뛴다. 켜졌는지가 한눈에 보이는 유일한 표식이다. */}
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0 items-center justify-center">
        {listening && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500/60" />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${listening ? 'bg-rose-500' : 'bg-gray-500'}`} />
      </span>

      {listening ? (
        <VoiceWave analyserRef={analyserRef} active />
      ) : (
        <span className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-gray-400 border-t-transparent" />
      )}

      {/* 들리는 말 — 확정되기 전까지만 여기 있다가, 확정되면 아래 입력창으로 옮겨 간다. */}
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
        {interim.length > 0 ? (
          <span className="text-gray-100">{interim}</span>
        ) : (
          <span className="text-gray-500">
            {listening ? t('ide.mainArea.voiceListening') : t('ide.mainArea.voiceStarting')}
          </span>
        )}
      </span>

      <span className="hidden flex-shrink-0 text-[12px] text-gray-600 sm:inline">
        {t('ide.mainArea.voiceCancelHint')}
      </span>

      <button
        type="button"
        onClick={onStop}
        className="flex h-6 flex-shrink-0 items-center gap-1 rounded bg-rose-600 px-2 text-[12px] font-semibold text-white transition-colors hover:bg-rose-500"
        title={t('ide.mainArea.voiceStop', { shortcut: shortcutLabel(VOICE_INPUT.SHORTCUT) })}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="8" height="8" rx="1" />
        </svg>
        {t('ide.mainArea.voiceDone')}
      </button>
    </div>
  );
}
