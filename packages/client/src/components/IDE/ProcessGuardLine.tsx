import { useTranslation } from 'react-i18next';
import type { ProcessGuardNotice } from '@vibisual/shared';
import { formatBytes } from '../../utils/insuranceView.js';

interface ProcessGuardLineProps {
  notice: ProcessGuardNotice;
  /** 원문 줄 — 툴팁으로 남긴다(pid 등 사실을 그대로 확인할 수 있게). */
  content: string;
  sessionLabel?: string;
}

/**
 * §5.3 #9-2 — 메모리 보호가 프로세스를 멈춘 사실 한 줄. 세션 탭·메인 탭 공용(`TransportRecoveryLine` 과 같은 자리).
 *
 * 서버는 사유·실행본·메모리·상한 같은 **사실만** 싣고, 문장은 여기서 로케일로 만든다(§5.5 #17-12 ③ 실패 사유와
 * 같은 규율). 줄 머리 `[process-guard]` 가 칩 패턴 밖이라 표준·간결 밀도에서도 숨지 않는다.
 */
export function ProcessGuardLine({ notice, content, sessionLabel }: ProcessGuardLineProps): React.JSX.Element {
  const { t } = useTranslation();
  const image = notice.image || t('ide.processGuard.someProcess');
  const mem = notice.memBytes !== undefined ? formatBytes(notice.memBytes) : '';
  const cap = notice.capBytes !== undefined ? formatBytes(notice.capBytes) : '';
  const avail = notice.availBytes !== undefined ? formatBytes(notice.availBytes) : '';
  const count = notice.count ?? 0;

  let text: string;
  if (notice.reason === 'cap') {
    text = notice.enforcedBy === 'kernel'
      ? t('ide.processGuard.capKernel', { image, cap })
      : t('ide.processGuard.cap', { image, mem, cap });
  } else if (notice.reason === 'pressure') {
    text = t('ide.processGuard.pressure', { image, mem, avail });
  } else if (notice.reason === 'session-end') {
    text = t('ide.processGuard.sessionEnd', { count });
  } else {
    text = t('ide.processGuard.taskKilled', { count });
  }

  return (
    <div className="flex items-start gap-2 px-4 py-1 text-[12px] text-amber-300/90 max-md:px-1.5" title={content}>
      <svg className="mt-px h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" />
        <path d="M12 8.5v4" />
        <path d="M12 15.5h.01" />
      </svg>
      {sessionLabel && <span className="flex-shrink-0 text-cyan-400/80">{sessionLabel}</span>}
      <span className="min-w-0">{text}</span>
    </div>
  );
}
