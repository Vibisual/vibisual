import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VOICE_INPUT } from '@vibisual/shared';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { shortcutLabel } from '../../utils/platform.js';

/**
 * MicSettingsPopup — **§5.5 #17-38 ⑮ 마이크가 막혔을 때 데려다 주는 판.**
 *
 * ⑥ 은 실패 사유를 갈라 화면이 "할 수 있는 일"을 **말하게** 했다. 이 판은 그 다음 걸음이다 —
 * 그 일을 **하러 가는 문**을 함께 준다. 문장만 정확하고 문이 없으면, 특히 Windows 사용자는
 * 설정 앱을 열어 우리 앱 이름을 찾다가(unpackaged 라 목록에 없다) 되돌아온다.
 *
 * ### 왜 오류 오버레이와 다른 판인가
 * 오버레이(`VoiceInputOverlay`)는 **입력창 위 한 줄**이라 안내 두 줄과 버튼 둘을 넣을 자리가
 * 없고, 넣으면 듣는 줄이 서던 그 레일이 통째로 두꺼워진다(② "겹쳐 그리지 않는다"의 자리를
 * 우리가 먹는다). 그래서 사유는 오버레이가 한 줄로 말하고, **어떻게 푸는지는 이 판**이 맡는다.
 *
 * ### 두 곳에서 같은 판을 쓴다
 * ⓐ 권한·장치로 막혔을 때 [해결 방법] 을 누르면, ⓑ 마이크 버튼을 **우클릭**하면. 같은 물음에
 * 대한 답이라 두 벌로 만들지 않는다 — 두 벌이 되면 한쪽만 고쳐진다.
 */

export interface MicSettingsPopupProps {
  open: boolean;
  /** OS 설정 창을 열 수 있는가. 아니면 버튼 대신 글 안내만 남는다. */
  openable: boolean;
  /** 그 창에서 무엇을 만져야 하는지 가리키는 번역 키(서버가 플랫폼으로 정한 것). */
  hintKey: string;
  /** 지금 마이크가 실패한 상태인가 — 머리말이 갈린다(고장 안내 vs 그냥 설정 보기). */
  blocked: boolean;
  /**
   * **마이크가 아예 없는 것이 확인됐는가**(입력 장치 0개).
   * 참이면 본문이 "연결해 주세요"를 먼저 말하고, 설정은 곁들이는 선택지로 내려간다 —
   * 없는 사람에게 설정부터 들이밀면 이미 켜져 있는 스위치를 보게 된다.
   */
  noDevice: boolean;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function MicSettingsPopup({
  open, openable, hintKey, blocked, noDevice, onOpenSettings, onClose,
}: MicSettingsPopupProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);

  // 바깥 press 로 닫기 — **공통 규약을 쓴다**(직접 리스너 ❌ · `popupDismissContract` 가 집행한다).
  //   판 안에서 시작한 press·드래그로는 안 닫히고, 뷰포트 밖 press 도 걸러진다.
  //   ⚠ `graceMs` 가 이 판에는 특히 필요하다 — 이 판을 **여는 손짓이 우클릭**이라, 그 우클릭에
  //   뒤이어 오는 이벤트가 곧바로 닫아 열리자마자 사라지는 것처럼 보이는 자리다.
  useOutsidePressDismiss({
    enabled: open,
    onDismiss: onClose,
    refs: [ref],
    graceMs: 150,
  });

  // Esc 는 "이 판 닫기"가 먼저다 — capture 로 서는 이유는 ⑤ 와 같다(듣는 중의 Esc 규율).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl"
      role="dialog"
      aria-label={t('ide.mainArea.voiceMicSettingsTitle')}
    >
      <div className="mb-2 flex items-start gap-2">
        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-gray-100">
            {t('ide.mainArea.voiceMicSettingsTitle')}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-gray-400">
            {t(noDevice
              ? 'ide.mainArea.voiceMicSettingsNoDeviceBody'
              : blocked ? 'ide.mainArea.voiceMicSettingsBlockedBody' : 'ide.mainArea.voiceMicSettingsBody')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
          aria-label={t('ide.mainArea.voiceErrDismiss')}
          title={t('ide.mainArea.voiceErrDismiss')}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 그 창에서 **무엇을 만져야 하는지**. 창만 띄우고 끝내면 열린 설정에서 다시 길을 잃는다 —
          특히 win 의 "데스크톱 앱 허용"은 앱 목록을 한참 내려야 나온다. */}
      <div className="rounded border border-gray-800 bg-gray-950/60 px-2.5 py-2 text-[12px] leading-5 text-gray-300">
        {t(hintKey)}
      </div>

      {/* 장치 유무에 따라 곁들이는 말이 뒤집힌다 — 없는 것이 확인된 사람에게 "연결됐는지
          확인하세요"는 이미 아는 말이고, 그에게 필요한 건 "설정이 감췄을 수도 있다"쪽이다. */}
      <p className="mt-2 text-[12px] leading-4 text-gray-500">
        {t(noDevice ? 'ide.mainArea.voiceMicSettingsHiddenNote' : 'ide.mainArea.voiceMicSettingsDeviceNote')}
      </p>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-[12px] text-gray-600">
          {t('ide.mainArea.voiceMicSettingsShortcutNote', { shortcut: shortcutLabel(VOICE_INPUT.SHORTCUT) })}
        </span>
        {openable && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-7 flex-shrink-0 items-center gap-1.5 rounded bg-blue-600 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-500"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
            {t('ide.mainArea.voiceMicSettingsOpen')}
          </button>
        )}
      </div>
    </div>
  );
}
