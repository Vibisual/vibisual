import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PopoverItem, StudioPopover } from './StudioPopover.js';
import { StudioIcon } from './studioIcons.js';
import { SKIP_SECONDS, formatSkipSeconds, isSkipPreset, normalizeSkipSeconds } from './skipSeconds.js';

/**
 * §5.13 (V) 37-24 (B) — 건너뛰기 간격 칸: 숫자 칸(직접 적는다) + 펼침 단추(5·10·30초 · 직접 입력).
 * Enter·칸을 떠나면 반영하고 Esc 는 되돌린다. 못 읽는 값은 종전 값으로 돌아간다.
 */
export interface SkipSecondsControlProps {
  readonly seconds: number;
  readonly onChange: (seconds: number) => void;
}

export function SkipSecondsControl({ seconds, onChange }: SkipSecondsControlProps): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(formatSkipSeconds(seconds));
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  // 밖에서 값이 바뀌면(고정 간격 고르기) 칸의 글자도 따라간다.
  useEffect(() => { setDraft(formatSkipSeconds(seconds)); }, [seconds]);
  const commit = (): void => {
    const next = normalizeSkipSeconds(draft, seconds);
    setDraft(formatSkipSeconds(next));
    if (next !== seconds) onChange(next);
  };
  const label = t('panel.videoStudio.preview.skipSeconds');
  return (
    <span className="flex h-8 shrink-0 items-center rounded-md border border-white/10 bg-vb-sunken pl-1.5 text-[12px] text-slate-300 focus-within:ring-1 focus-within:ring-[var(--vs-accent)] pointer-coarse:h-10">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        aria-label={label}
        title={label}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          // 칸 안의 키는 스튜디오 단축키·창 닫기로 새지 않는다.
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(formatSkipSeconds(seconds)); e.currentTarget.blur(); }
        }}
        className="w-9 bg-transparent text-right tabular-nums text-slate-100 outline-none pointer-coarse:w-11"
      />
      <span className="pl-0.5 text-slate-500" aria-hidden="true">{t('panel.videoStudio.preview.skipUnit')}</span>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('panel.videoStudio.preview.skipPresets')}
        title={t('panel.videoStudio.preview.skipPresets')}
        onClick={() => setOpen((o) => !o)}
        className="flex h-full w-6 items-center justify-center rounded-r-md text-slate-400 transition-colors duration-150 ease-out hover:bg-white/10 hover:text-slate-100 pointer-coarse:w-9"
      >
        <StudioIcon name="chevronDown" className="h-3.5 w-3.5" />
      </button>
      <StudioPopover anchor={anchorRef} open={open} onClose={() => setOpen(false)} side="above" align="end" label={t('panel.videoStudio.preview.skipPresets')} className="min-w-32">
        {SKIP_SECONDS.presets.map((preset) => (
          <PopoverItem key={preset} active={preset === seconds} onClick={() => { setOpen(false); onChange(preset); }}>
            {t('panel.videoStudio.preview.skipSecondsValue', { seconds: formatSkipSeconds(preset) })}
          </PopoverItem>
        ))}
        <PopoverItem active={!isSkipPreset(seconds)} {...(isSkipPreset(seconds) ? {} : { hint: t('panel.videoStudio.preview.skipSecondsValue', { seconds: formatSkipSeconds(seconds) }) })}
          onClick={() => { setOpen(false); inputRef.current?.focus(); }}>
          {t('panel.videoStudio.preview.skipCustom')}
        </PopoverItem>
      </StudioPopover>
    </span>
  );
}
