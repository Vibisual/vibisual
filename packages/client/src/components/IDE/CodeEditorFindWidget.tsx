import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { runEnterKey } from '../../hooks/useEnterSubmit.js';
import { useElementWidth } from '../../hooks/useElementWidth.js';
import { IME_ENTER_OWNER, isImeConsumedKey } from '../../utils/inputComposition.js';
import { decideEnterKey } from '../../utils/inputEnterKey.js';
import { useTitleWithBinding } from '../Shortcuts/useBindingLabel.js';
import { findBarStacked } from './ideResponsive.js';
import type { EditorFindWidgetModel, EditorGotoModel } from './useEditorFind.js';

/**
 * CodeEditorFindWidget.tsx — §5.5 #17-27 ⑲ 편집창의 **찾기·바꾸기 막대**와 **줄 번호로 가기 상자**.
 *
 * 순수 표시다 — 상태와 동작은 전부 `useEditorFind` 가 쥐고, 여기는 받은 모델을 그린다. 자리는 VS Code 와
 * 같다(찾기 막대는 본문 오른쪽 위, 줄 번호 상자는 가운데 위) — 본문을 밀어내지 않고 그 위에 뜬다.
 *
 * 막대 안의 키 — `Enter` 다음 · `Shift+Enter` 이전(바꿀 말 칸에서는 `Enter` 가 하나 바꾸기) · `Esc` 닫기.
 * 그 밖의 키(옵션 셋·모두 바꾸기 …)는 단축키 표(`shared/keymap.ts`)의 것이라 여기서 판정하지 않는다
 * (단추 툴팁의 키도 표에서 읽는다 — 재매핑하면 함께 바뀐다).
 * 입력칸은 `IME_ENTER_OWNER` 다 — 한글 조합을 끝낸 첫 Enter 가 막대에 닿아야 두 번 누르지 않는다.
 */

/** 막대 단추 하나의 겉모양(아이콘 칸). 터치에서는 손가락 크기(32px)로 키운다. */
const ICON_BUTTON = 'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400 pointer-coarse:h-8 pointer-coarse:w-8';
/** 켜진 옵션 스위치. */
const TOGGLE_ON = 'bg-blue-500/25 text-blue-200 ring-1 ring-inset ring-blue-400/60 hover:bg-blue-500/30 hover:text-blue-100';
/** 입력칸을 감싸는 상자 — 초점이 들어오면 테두리가 파랗게 선다. 터치에서는 안의 토글(32px)이 들어가게 높인다. */
const FIELD_BOX = 'flex h-6 min-w-0 flex-1 items-center rounded border bg-gray-950 pl-1.5 pr-0.5 focus-within:border-blue-500/70 pointer-coarse:h-9';
const FIELD_INPUT = 'min-w-0 flex-1 bg-transparent text-[12px] text-gray-100 placeholder:text-gray-600 focus:outline-none';

/** 단추를 눌러도 입력칸의 초점·캐럿을 뺏지 않는다(누른 뒤에도 이어서 칠 수 있게). */
function keepFocus(e: React.MouseEvent): void {
  e.preventDefault();
}

function Icon({ children, className = 'h-3.5 w-3.5' }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function CodeEditorFindWidget({ model }: { model: EditorFindWidgetModel }): React.JSX.Element {
  const { t } = useTranslation();
  // 막대 **자기 폭**으로 접는다(뷰포트 ❌ — 편집창은 넓은 화면에서도 280px 일 수 있다). 막대 폭은
  //   `min(460px, 편집창 - 2rem)` 으로 바깥이 정하므로 쌓아도 폭이 바뀌지 않는다(판정이 진동하지 않는다).
  const rootRef = useRef<HTMLDivElement>(null);
  const stacked = findBarStacked(useElementWidth(rootRef));
  const matchCaseTitle = useTitleWithBinding(t('ide.editor.find.matchCase'), 'editor.toggleMatchCase');
  const wholeWordTitle = useTitleWithBinding(t('ide.editor.find.wholeWord'), 'editor.toggleWholeWord');
  const regexTitle = useTitleWithBinding(t('ide.editor.find.regex'), 'editor.toggleRegex');
  const prevTitle = useTitleWithBinding(t('ide.search.prev'), 'editor.findPrev');
  const nextTitle = useTitleWithBinding(t('ide.search.next'), 'editor.findNext');
  const toggleReplaceTitle = useTitleWithBinding(t('ide.editor.find.toggleReplace'), 'editor.replace');
  const replaceOneTitle = useTitleWithBinding(t('ide.editor.find.replace'), 'editor.replaceOne');
  const replaceAllTitle = useTitleWithBinding(t('ide.editor.find.replaceAll'), 'editor.replaceAll');

  const noMatch = model.query.length > 0 && model.total === 0;
  const status = model.invalid
    ? t('ide.editor.find.invalidRegex')
    : !model.query
      ? ''
      : model.total === 0
        ? t('ide.editor.find.noResults')
        : t(model.capped ? 'ide.editor.find.countCapped' : 'ide.editor.find.count', {
          current: model.current + 1,
          total: model.total,
        });
  const canStep = model.total > 0;
  const canReplace = canStep && !model.readOnly;

  // Enter 판정은 보내는 칸들과 한 벌이다(`decideEnterKey` — 입력기가 먹은 키와 확정된 키를 거기서만 가른다).
  //   찾을 말 칸: Enter = 다음, Shift+Enter(보내는 칸의 "줄 추가" 자리) = 이전.
  const onFindKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (isImeConsumedKey(e.nativeEvent)) return;
    const outcome = decideEnterKey({ key: e.key, shiftKey: e.shiftKey, chordKey: false, imeConsumed: false, slashMatchCount: 0 });
    if (outcome.kind !== 'submit' && outcome.kind !== 'newline') return;
    e.preventDefault();
    if (outcome.kind === 'newline') model.onPrev();
    else model.onNext();
  };
  // 바꿀 말 칸: Enter = 하나 바꾸기.
  const onReplaceKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    runEnterKey(e, () => model.onReplaceOne());
  };
  // Esc 는 막대만 닫는다 — 막대는 방금 연 일회성 막대라 IDE 창의 Esc(창 닫기)까지 가지 않게 여기서 멈춘다.
  const onRootKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape' || isImeConsumedKey(e.nativeEvent)) return;
    e.preventDefault();
    e.stopPropagation();
    model.onClose();
  };

  return (
    <div
      ref={rootRef}
      role="search"
      aria-label={t('ide.terminal.find')}
      onKeyDown={onRootKey}
      className="absolute right-4 top-1 z-20 flex w-[min(460px,calc(100%-2rem))] items-start gap-1 rounded-md border border-gray-700 bg-gray-900/95 p-1 shadow-xl shadow-black/40 backdrop-blur"
    >
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={model.onToggleReplace}
        disabled={model.readOnly}
        title={model.readOnly ? t('ide.editor.ctx.readOnlyFile') : toggleReplaceTitle}
        aria-label={t('ide.editor.find.toggleReplace')}
        aria-expanded={model.replaceOpen}
        // 두 줄을 걸치는 높이(52px)는 찾기·바꾸기 두 줄일 때의 값이다 — 쌓인 막대는 줄이 넷이라 첫 줄에만 선다.
        className={`${ICON_BUTTON} w-4 ${model.replaceOpen && !stacked ? 'h-[52px]' : 'h-6'}`}
      >
        <Icon className={`h-3.5 w-3.5 transition-transform ${model.replaceOpen ? 'rotate-90' : ''}`}><path d="m9 18 6-6-6-6" /></Icon>
      </button>

      {/* 두 줄의 입력칸 폭을 맞추려고 격자로 세운다 — 오른쪽 칸은 두 줄의 단추 중 넓은 쪽에 맞춰진다.
          좁은 막대(`stacked`)에서는 한 열로 — 입력칸이 막대 폭을 다 쓰고, 상태 글자·단추는 그 아래 줄로 내려간다
          (상태 글자를 숨기지 않는다 — 몇 개 중 몇 번째인지는 이 막대만 말한다). */}
      <div className={`grid min-w-0 flex-1 items-center gap-1 ${stacked ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_auto]'}`}>
        <div className={`${FIELD_BOX} ${noMatch || model.invalid ? 'border-rose-500/70' : 'border-gray-700'}`}>
          <input
            ref={model.findInputRef}
            value={model.query}
            onChange={(e) => model.onQuery(e.target.value)}
            onKeyDown={onFindKey}
            placeholder={t('ide.terminal.find')}
            aria-label={t('ide.terminal.find')}
            aria-invalid={model.invalid || undefined}
            spellCheck={false}
            autoComplete="off"
            {...IME_ENTER_OWNER}
            className={FIELD_INPUT}
          />
          <button
            type="button" onMouseDown={keepFocus} onClick={() => model.onToggleOption('matchCase')}
            title={matchCaseTitle} aria-label={t('ide.editor.find.matchCase')} aria-pressed={model.options.matchCase}
            className={`${ICON_BUTTON} h-5 w-5 ${model.options.matchCase ? TOGGLE_ON : ''}`}
          >
            <Icon><path d="m3 15 4-8 4 8" /><path d="M4 13h6" /><circle cx="18" cy="12" r="3" /><path d="M21 9v6" /></Icon>
          </button>
          <button
            type="button" onMouseDown={keepFocus} onClick={() => model.onToggleOption('wholeWord')}
            title={wholeWordTitle} aria-label={t('ide.editor.find.wholeWord')} aria-pressed={model.options.wholeWord}
            className={`${ICON_BUTTON} h-5 w-5 ${model.options.wholeWord ? TOGGLE_ON : ''}`}
          >
            <Icon><circle cx="7" cy="12" r="3" /><path d="M10 9v6" /><circle cx="17" cy="12" r="3" /><path d="M14 7v8" /><path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" /></Icon>
          </button>
          <button
            type="button" onMouseDown={keepFocus} onClick={() => model.onToggleOption('regex')}
            title={regexTitle} aria-label={t('ide.editor.find.regex')} aria-pressed={model.options.regex}
            className={`${ICON_BUTTON} h-5 w-5 ${model.options.regex ? TOGGLE_ON : ''}`}
          >
            <Icon><path d="M17 3v10" /><path d="m12.67 5.5 8.66 5" /><path d="m12.67 10.5 8.66-5" /><path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z" /></Icon>
          </button>
        </div>
        <div className={`flex items-center gap-1 ${stacked ? 'min-w-0' : ''}`}>
          <span
            aria-live="polite"
            title={status || undefined}
            className={`truncate px-1 text-[12px] tabular-nums ${stacked ? 'min-w-0 flex-1 text-left' : 'w-[5.5rem] flex-shrink-0 text-center'} ${noMatch || model.invalid ? 'text-rose-300' : 'text-gray-400'}`}
          >
            {status}
          </span>
          <button type="button" onMouseDown={keepFocus} onClick={model.onPrev} disabled={!canStep} title={prevTitle} aria-label={t('ide.search.prev')} className={ICON_BUTTON}>
            <Icon><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></Icon>
          </button>
          <button type="button" onMouseDown={keepFocus} onClick={model.onNext} disabled={!canStep} title={nextTitle} aria-label={t('ide.search.next')} className={ICON_BUTTON}>
            <Icon><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Icon>
          </button>
          <button type="button" onMouseDown={keepFocus} onClick={model.onClose} title={t('ide.search.close')} aria-label={t('ide.search.close')} className={ICON_BUTTON}>
            <Icon><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>
          </button>
        </div>

        {model.replaceOpen && (
          <>
            <div className={`${FIELD_BOX} border-gray-700`}>
              <input
                ref={model.replaceInputRef}
                value={model.replacement}
                onChange={(e) => model.onReplacement(e.target.value)}
                onKeyDown={onReplaceKey}
                placeholder={t('ide.editor.find.replace')}
                aria-label={t('ide.editor.find.replace')}
                spellCheck={false}
                autoComplete="off"
                {...IME_ENTER_OWNER}
                className={FIELD_INPUT}
              />
            </div>
            <div className={`flex items-center gap-1 ${stacked ? 'justify-end' : ''}`}>
              <button type="button" onMouseDown={keepFocus} onClick={model.onReplaceOne} disabled={!canReplace} title={replaceOneTitle} aria-label={t('ide.editor.find.replace')} className={ICON_BUTTON}>
                <Icon><path d="M14 4a2 2 0 0 1 2-2" /><path d="M16 10a2 2 0 0 1-2-2" /><path d="M20 2a2 2 0 0 1 2 2" /><path d="M22 8a2 2 0 0 1-2 2" /><path d="m3 7 3 3 3-3" /><path d="M6 10V5a3 3 0 0 1 3-3h1" /><rect x="2" y="14" width="8" height="8" rx="2" /></Icon>
              </button>
              <button type="button" onMouseDown={keepFocus} onClick={model.onReplaceAll} disabled={!canReplace} title={replaceAllTitle} aria-label={t('ide.editor.find.replaceAll')} className={ICON_BUTTON}>
                <Icon><path d="M14 14a2 2 0 0 1 2-2" /><path d="M14 4a2 2 0 0 1 2-2" /><path d="M16 10a2 2 0 0 1-2-2" /><path d="M16 20a2 2 0 0 1-2-2" /><path d="M20 12a2 2 0 0 1 2 2" /><path d="M20 2a2 2 0 0 1 2 2" /><path d="M22 18a2 2 0 0 1-2 2" /><path d="M22 8a2 2 0 0 1-2 2" /><path d="m3 7 3 3 3-3" /><path d="M6 10V5a3 3 0 0 1 3-3h1" /><rect x="2" y="14" width="8" height="8" rx="2" /></Icon>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 줄 번호로 가기 — `12` · `12:5` · `-1`(끝 줄). 치는 동안 그 줄을 미리 보여 주고 Enter 로 간다. */
export function CodeEditorGotoLine({ model }: { model: EditorGotoModel }): React.JSX.Element {
  const { t } = useTranslation();
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (runEnterKey(e, () => model.onSubmit())) return;
    if (isImeConsumedKey(e.nativeEvent)) return;
    if (e.key === 'Escape') {
      // 막대와 같다 — 이 상자만 닫고 IDE 창의 Esc 까지 가지 않는다.
      e.preventDefault();
      e.stopPropagation();
      model.onCancel();
    }
  };
  return (
    <div
      role="dialog"
      aria-label={t('common.shortcuts.cmd.editor.goToLine')}
      className="absolute left-1/2 top-1 z-30 w-[min(360px,calc(100%-2rem))] -translate-x-1/2 rounded-md border border-gray-700 bg-gray-900/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur"
    >
      <div className={`${FIELD_BOX} h-7 gap-1.5 border-gray-700 px-1.5`}>
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-gray-500"><path d="M4 9h16" /><path d="M4 15h16" /><path d="M10 3 8 21" /><path d="m16 3-2 18" /></Icon>
        <input
          ref={model.inputRef}
          value={model.value}
          onChange={(e) => model.onChange(e.target.value)}
          onKeyDown={onKey}
          // 다른 곳을 누르면 상자만 닫는다 — 되돌리기(취소)는 그 누름이 정한 커서를 지워 버린다.
          onBlur={model.onDismiss}
          inputMode="numeric"
          placeholder={t('ide.editor.goto.placeholder')}
          aria-label={t('common.shortcuts.cmd.editor.goToLine')}
          spellCheck={false}
          autoComplete="off"
          {...IME_ENTER_OWNER}
          className={FIELD_INPUT}
        />
      </div>
      <p className="mt-1 px-0.5 text-[12px] leading-snug text-gray-500">
        {t('ide.editor.goto.hint', { line: model.line, column: model.column, max: model.lineCount })}
      </p>
    </div>
  );
}
