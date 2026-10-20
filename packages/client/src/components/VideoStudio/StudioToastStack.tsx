import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { creationErrorKey } from '../Creation/creationErrors.js';
import { StudioIcon } from './studioIcons.js';
import type { StudioToast } from './useStudioToasts.js';

/**
 * §5.13 (V) 37-1 — 알림 더미(아래 가운데). 오류는 사람이 읽는 말 한 줄 + [자세히](원문은 접어 둔다)와 닫기, 성공·안내는 잠깐
 * 떴다 사라진다(시계는 훅이 든다). 화면을 덮지 않게 폭을 묶고 클릭은 알림 위에서만 받는다.
 * 반응형 — 폰 폭 창에서는 AI 칸이 미리보기 아래에 쌓여 아래 가운데가 곧 입력창·보내기 단추 자리다. 그래서 위(머리줄 아래)로 올리고
 * 폭을 창 폭 − 여백으로 편다.
 */
export function StudioToastStack({ toasts, onDismiss }: { readonly toasts: readonly StudioToast[]; readonly onDismiss: (id: number) => void }): React.JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 flex w-[min(520px,90%)] -translate-x-1/2 flex-col gap-2 box-narrow:bottom-auto box-narrow:top-12 box-narrow:w-[calc(100%-1rem)]" role="status" aria-live="polite">
      {toasts.map((toast) => <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />)}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { readonly toast: StudioToast; readonly onDismiss: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isError = toast.tone === 'error';
  const message = toast.tone === 'error'
    ? (toast.code ? t(creationErrorKey(toast.code)) : t(`panel.videoStudio.errors.${toast.kind}`))
    : t(toast.key, toast.values ?? {});
  return (
    <div className={`pointer-events-auto animate-[vs-in-up_160ms_ease-out] rounded-lg border bg-vb-raised px-3 py-2 text-[13px] shadow-lg shadow-black/40 ${isError ? 'border-rose-400/40' : 'border-white/10'}`}>
      <div className="flex items-start gap-2">
        <span className={isError ? 'mt-0.5 text-rose-300' : 'mt-0.5 text-[var(--vs-accent)]'}>
          <StudioIcon name={isError ? 'warn' : 'check'} />
        </span>
        <p className="min-w-0 flex-1 leading-snug text-slate-100">{message}</p>
        {isError ? (
          <button type="button" className="shrink-0 rounded px-1.5 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100 pointer-coarse:py-1.5" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {t('panel.videoStudio.errors.details')}
          </button>
        ) : null}
        <button type="button" className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-slate-200 pointer-coarse:p-2" aria-label={t('common.close', { defaultValue: 'Close' })} onClick={onDismiss}>
          <StudioIcon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
      {isError && open && toast.tone === 'error' ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-vb-sunken px-2 py-1.5 text-[12px] text-slate-400">{toast.detail}</pre>
      ) : null}
    </div>
  );
}
