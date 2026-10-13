import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { IME_ENTER_OWNER, isComposingKeyEvent } from '../../utils/inputComposition.js';
import { useEnterSubmit } from '../../hooks/useEnterSubmit.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';

/**
 * §5.13 (V) 37-1 — AI 패널 아래의 **입력창 + 칩 + 제안 칩**. 칩은 이 말과 함께 실려 갈 것들이다 — 가리킨 것·메모·첨부·시각.
 * 제안 칩은 지난 바퀴 보고의 `suggestions`(누르면 입력창에 채운다). 보내기는 셸이 기존 명령 큐로 한다.
 */
export interface ComposerChip {
  readonly id: string;
  readonly icon: StudioIconName;
  readonly label: string;
  readonly onRemove?: (() => void) | undefined;
}

export interface StudioComposerProps {
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly chips: readonly ComposerChip[];
  readonly suggestions: readonly string[];
  readonly onAttach: (files: readonly File[]) => void;
  readonly onSend: (liveText?: string) => void;
  readonly canSend: boolean;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly placeholder: string;
}

export function StudioComposer(p: StudioComposerProps): React.JSX.Element {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const onEnter = useEnterSubmit((live) => p.onSend(live));
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-white/10 p-3">
      {p.suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label={t('panel.videoStudio.ai.suggestions')}>
          {p.suggestions.map((s) => (
            <button key={s} type="button" onClick={() => p.onText(s)} title={s}
              className="max-w-full truncate rounded-full border border-white/15 px-2.5 py-1 text-left text-[12px] text-slate-300 hover:bg-white/10 hover:text-slate-50">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {p.chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {p.chips.map((c) => (
            <span key={c.id} className="flex max-w-full items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] py-0.5 pl-2 pr-1 text-[12px] text-slate-200">
              <StudioIcon name={c.icon} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{c.label}</span>
              {c.onRemove ? (
                <button type="button" onClick={c.onRemove} aria-label={t('panel.videoStudio.removeNamed', { name: c.label })}
                  className="rounded-full p-0.5 text-slate-500 hover:bg-white/10 hover:text-slate-100"><StudioIcon name="close" className="h-3 w-3" /></button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-1.5 rounded-xl border border-white/10 bg-vb-sunken p-1.5 focus-within:ring-1 focus-within:ring-[var(--vs-accent)]">
        <button type="button" onClick={() => fileInput.current?.click()} disabled={p.disabled || p.busy}
          aria-label={t('panel.videoStudio.ai.attach')} title={t('panel.videoStudio.ai.attach')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-35">
          <StudioIcon name="attach" />
        </button>
        <input ref={fileInput} type="file" multiple className="hidden" aria-label={t('panel.videoStudio.ai.attach')}
          accept=".mp4,.webm,.mov,.m4v,.mp3,.wav,.ogg,.m4a,.flac,.aac,.png,.jpg,.jpeg,.webp,.gif,.avif"
          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length > 0) p.onAttach(files); }} />
        <textarea
          {...IME_ENTER_OWNER}
          rows={2}
          value={p.text}
          disabled={p.disabled}
          onChange={(e) => p.onText(e.target.value)}
          onKeyDown={(e) => {
            // 스튜디오의 단축키(Space·화살표·P·N)가 글을 치는 손을 가로채지 않게.
            e.stopPropagation();
            if (onEnter(e)) return;
            if (isComposingKeyEvent(e.nativeEvent)) return;
            if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
          }}
          placeholder={p.placeholder}
          aria-label={p.placeholder}
          spellCheck={false}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-[13px] leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-40"
        />
        <button type="button" disabled={!p.canSend} onClick={() => p.onSend()} aria-label={t('panel.videoStudio.ai.send')} title={t('panel.videoStudio.ai.send')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-slate-50 hover:bg-white/15 disabled:opacity-35">
          {p.busy ? <span className="h-3 w-3 animate-[vs-breathe_1.2s_ease-in-out_infinite] rounded-full bg-[var(--vs-accent)]" aria-hidden="true" /> : <StudioIcon name="send" />}
        </button>
      </div>
    </div>
  );
}
