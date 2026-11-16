import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { shortcutLabel } from '../../utils/platform.js';
import { ScrollFade } from '../ScrollFade.js';
import { studioCommand } from './studioCommands.js';
import { isCommandKey } from './studioCommandKeys.js';
import type { StudioCommandContext } from './studioCommandTypes.js';
import { firstEnabled, paletteKeyAction, paletteRows, rankPaletteRows, type RankedRow } from './studioPaletteModel.js';
import { StudioIcon } from './studioIcons.js';
import { StudioPaletteRow } from './StudioPaletteRow.js';

/**
 * §5.13 (V) 37-22 — 명령 팔레트(검색 입구 — 새 손잡이가 아니다). 스튜디오 뿌리 안에 덮이는 판이라 `box-*` 등급이 닿는다.
 * 키는 검색 칸이 다 받고 스튜디오로 흘려보내지 않는다(열린 동안 스튜디오 단축키는 쉰다).
 */
export interface StudioPaletteProps {
  readonly context: StudioCommandContext;
  /** 이 창에서 최근 실행한 명령 id(최근 것 먼저). */
  readonly recent: readonly string[];
  /** 명령 실행(팔레트를 닫는 것은 받는 쪽 몫). 2단계면 고른 항목 id 를 `arg` 로. */
  readonly onRun: (id: string, arg?: string) => void;
  readonly onClose: () => void;
}

const hasDom = (): boolean => typeof document !== 'undefined';

export function StudioPalette(p: StudioPaletteProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const listId = useId();
  const optionId = (i: number): string => `${listId}-${i}`;
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const backdrop = useBackdropDismiss(p.onClose);

  const tEn = useMemo(() => (typeof i18n?.getFixedT === 'function' ? i18n.getFixedT('en') : t), [i18n, t]);
  const stepCommand = step ? studioCommand(step) : undefined;
  const rows: RankedRow[] = step ? [] : rankPaletteRows(paletteRows(p.context, { t, tEn, shortcut: shortcutLabel }), query, p.recent);
  const choices = stepCommand?.choices ? stepCommand.choices(p.context, t, query) : [];
  const enabled = step ? choices.map((c) => !c.disabled) : rows.map((r) => r.enabled);
  const count = enabled.length;

  // 검색어·단계·목록 길이가 바뀌면 첫 실행 가능한 줄로.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => { setActive(firstEnabled(enabledRef.current)); }, [query, step, count]);

  // 열면 검색 칸에 초점, 닫히면 열기 전 자리(없으면 스튜디오 뿌리)로 돌려준다 — 닫은 뒤에도 스튜디오 단축키가 바로 먹게.
  useEffect(() => {
    if (!hasDom()) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const host = rootRef.current?.parentElement ?? null;
    inputRef.current?.focus();
    return () => {
      const target = before && before.isConnected && before !== document.body ? before : host;
      target?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (hasDom() && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = (): void => { setStep(null); setQuery(''); inputRef.current?.focus(); };
  const runAt = (i: number): void => {
    if (step) {
      const choice = choices[i];
      if (choice && !choice.disabled) p.onRun(step, choice.id);
      return;
    }
    const row = rows[i];
    if (!row || !row.enabled) return;
    if (row.hasChoices) {
      studioCommand(row.id)?.prepare?.(p.context);
      setStep(row.id);
      setQuery('');
      inputRef.current?.focus();
      return;
    }
    p.onRun(row.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // 열린 동안 키는 여기서 끝난다 — 스튜디오 뿌리의 단축키로 흘려보내지 않는다.
    e.stopPropagation();
    const isComposing = composing.current || e.nativeEvent.isComposing;
    if (!isComposing && isCommandKey(e, studioCommand('palette'))) { e.preventDefault(); p.onClose(); return; }
    if (e.key === 'Tab') { e.preventDefault(); return; }
    const action = paletteKeyAction(e.key, { composing: isComposing, enabled, active, step: step !== null, queryEmpty: query === '' });
    if (action.kind === 'none') return;
    e.preventDefault();
    if (action.kind === 'move') setActive(action.index);
    else if (action.kind === 'run') runAt(active);
    else if (action.kind === 'back') back();
    else p.onClose();
  };

  const stepName = stepCommand ? t(typeof stepCommand.name === 'function' ? stepCommand.name(p.context) : stepCommand.name) : '';
  const title = t('panel.videoStudio.palette.title');

  return (
    <div ref={rootRef} {...backdrop}
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[12vh] box-narrow:p-2 box-narrow:pt-2">
      <div role="dialog" aria-modal="true" aria-label={title}
        className="flex max-h-[min(34rem,100%)] w-full max-w-xl animate-[vs-pop_140ms_ease-out] flex-col overflow-hidden rounded-xl border border-white/15 bg-vb-raised text-slate-200 shadow-2xl shadow-black/60 box-wide:max-w-2xl box-narrow:max-h-full box-narrow:max-w-none">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3">
          {step ? (
            <button type="button" onClick={back} aria-label={t('panel.videoStudio.palette.back')} title={t('panel.videoStudio.palette.back')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-100 pointer-coarse:h-10 pointer-coarse:w-10">
              <StudioIcon name="chevronDown" className="h-3.5 w-3.5 rotate-90" />
            </button>
          ) : <StudioIcon name="search" className="h-4 w-4 shrink-0 text-slate-500" />}
          {step ? <span className="max-w-[40%] shrink-0 truncate rounded-md bg-white/10 px-2 py-0.5 text-[12px] font-semibold text-slate-200">{stepName}</span> : null}
          <input ref={inputRef} value={query} spellCheck={false} autoComplete="off"
            role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            aria-label={step ? stepName : title} placeholder={step ? stepName : t('panel.videoStudio.palette.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={onKeyDown}
            className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-slate-100 outline-none placeholder:text-slate-500 pointer-coarse:h-12" />
        </div>
        <ScrollFade fill className="min-h-0 flex-1">
          <ul id={listId} role="listbox" aria-label={step ? stepName : title} className="flex flex-col gap-0.5 p-1.5">
            {step ? choices.map((ch, i) => (
              <StudioPaletteRow key={ch.id} id={optionId(i)} icon={null} name={ch.label} hint={ch.hint} combo={ch.combo} current={ch.active}
                active={i === active} enabled={!ch.disabled} onHover={() => setActive(i)} onRun={() => runAt(i)} />
            )) : rows.map((row, i) => {
              const prev = rows[i - 1];
              const heading = query.trim() !== '' ? null
                : row.recent ? (i === 0 ? t('panel.videoStudio.header.recent') : null)
                  : (!prev || prev.recent || prev.group !== row.group ? t(`panel.videoStudio.palette.group.${row.group}`) : null);
              return (
                <Fragment key={row.id}>
                  {heading ? <li role="presentation" className="px-2.5 pb-0.5 pt-2 text-[12px] font-semibold text-slate-500">{heading}</li> : null}
                  <StudioPaletteRow id={optionId(i)} icon={row.icon} name={row.name} detail={row.detail} combo={row.combo} checked={row.checked}
                    more={row.hasChoices} active={i === active} enabled={row.enabled} onHover={() => setActive(i)} onRun={() => runAt(i)} />
                </Fragment>
              );
            })}
            {count === 0 ? (
              <li role="presentation" className="px-2.5 py-4 text-center text-[13px] text-slate-500">
                {query.trim() !== '' ? t('panel.videoStudio.palette.empty', { query: query.trim() }) : t('panel.videoStudio.palette.nothing')}
              </li>
            ) : null}
          </ul>
        </ScrollFade>
        <p className="shrink-0 border-t border-white/10 px-3 py-1.5 text-[12px] text-slate-500 pointer-coarse:hidden">
          {t('panel.videoStudio.palette.footer', { move: `${shortcutLabel('Up')}${shortcutLabel('Down')}`, run: shortcutLabel('Enter'), close: shortcutLabel('Esc') })}
        </p>
      </div>
    </div>
  );
}
