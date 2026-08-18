import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * §5.5 읽기 설정 패널의 표시 원소들.
 * 값 자체는 갖지 않는 순수 프레젠테이션 — 모든 상태는 부모(ReadingSettingsPopover)가 쥔다.
 */

interface ReadingRowProps {
  label: string;
  /** 현재 값 요약(우측 정렬, 숫자 폭 고정). */
  value?: string;
  /** 이 설정의 근거 한 줄 — 사용자가 "왜 이 값인지" 읽고 고르게 한다. */
  note?: string;
  /**
   * 이 항목**만** 기본값으로 되돌린다. 패널 위쪽 전체 초기화와 달리 다른 항목은 건드리지 않는다 —
   * 하나를 시험해 보다 마음에 안 들 때 나머지 설정까지 잃지 않고 그 줄만 물릴 수 있어야 한다.
   */
  onReset?: () => void;
  /** 지금 값이 이미 기본값인가 — 그러면 버튼을 눌러도 바뀔 게 없으므로 비활성으로 알린다. */
  isDefault?: boolean;
  children: React.ReactNode;
}

export function ReadingRow({
  label, value, note, onReset, isDefault, children,
}: ReadingRowProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 border-b border-gray-700/60 px-3 py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-gray-300">{label}</span>
        <span className="flex items-center gap-1.5">
          {value ? <span className="tabular-nums text-[11px] text-gray-500">{value}</span> : null}
          {onReset ? (
            <button
              type="button"
              onClick={onReset}
              disabled={isDefault}
              title={isDefault ? t('ide.reading.resetFieldAtDefault') : t('ide.reading.resetField')}
              aria-label={t('ide.reading.resetField')}
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center self-center rounded transition-colors ${
                isDefault
                  ? 'cursor-default text-gray-700'
                  : 'text-gray-500 hover:bg-gray-700/60 hover:text-gray-200'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
                aria-hidden="true"
              >
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          ) : null}
        </span>
      </div>
      {children}
      {note ? <p className="text-[10px] leading-relaxed text-gray-500">{note}</p> : null}
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  title?: string;
  /** 비활성 사유가 있으면 버튼을 누를 수 없게 하고 툴팁으로 알린다. */
  disabledReason?: string;
}

interface ReadingSegmentedProps<T extends string> {
  /** `undefined` = 어느 항목과도 맞지 않음(슬라이더로 임의 값을 만든 상태). 그때는 아무것도 켜지 않는다. */
  value: T | undefined;
  options: readonly SegmentedOption<T>[];
  onChange: (id: T) => void;
  /** 항목이 많으면 줄바꿈(글꼴 목록처럼). */
  wrap?: boolean;
}

export function ReadingSegmented<T extends string>({
  value, options, onChange, wrap,
}: ReadingSegmentedProps<T>): React.JSX.Element {
  return (
    <div className={`flex gap-1 ${wrap ? 'flex-wrap' : ''}`} role="group">
      {options.map((opt) => {
        const active = opt.id === value;
        const disabled = Boolean(opt.disabledReason);
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            title={opt.disabledReason ?? opt.title ?? opt.label}
            className={`flex-1 whitespace-nowrap rounded border px-2 py-1 text-[10.5px] transition-colors ${
              active
                ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                : 'border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-600 hover:text-gray-200'
            } ${disabled ? 'cursor-not-allowed opacity-40 hover:border-gray-700 hover:text-gray-400' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface ReadingSelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (id: T) => void;
}

/**
 * 항목이 많은 축(글꼴처럼 열 개가 넘는 것)은 버튼을 늘어놓으면 패널이 버튼밭이 된다.
 * 한 줄 드롭다운으로 접어 **고르는 값이 하나임을 형태로** 말한다(선택지 수가 늘어도 높이가 고정).
 */
export function ReadingSelect<T extends string>({
  label, value, options, onChange,
}: ReadingSelectProps<T>): React.JSX.Element {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full min-w-0 cursor-pointer rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-200 outline-none transition-colors hover:border-gray-600 focus:border-blue-500"
    >
      {options.map((opt) => (
        <option key={opt.id} value={opt.id} disabled={Boolean(opt.disabledReason)}>
          {opt.disabledReason ? `${opt.label} — ${opt.disabledReason}` : opt.label}
        </option>
      ))}
    </select>
  );
}

interface ReadingTextFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  /** 자동완성 후보(비어 있으면 목록 없이 그냥 입력창) — 직접 입력 경로는 언제나 열려 있다. */
  suggestions?: readonly string[];
  /** 우측 보조 버튼 — 후보 목록을 불러오는 등 사용자가 명시로 눌러야 하는 동작. */
  action?: { label: string; title?: string; onClick: () => void; disabled?: boolean };
}

export function ReadingTextField({
  label, value, placeholder, onChange, suggestions, action,
}: ReadingTextFieldProps): React.JSX.Element {
  // 같은 패널이 두 번 뜨더라도 datalist id 가 겹치지 않게 — React 가 발급하는 안정 id 를 쓴다.
  const listId = `${React.useId()}-fonts`;
  const hasList = Boolean(suggestions && suggestions.length > 0);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        {...(hasList ? { list: listId } : {})}
        className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-200 outline-none transition-colors placeholder:text-gray-600 hover:border-gray-600 focus:border-blue-500"
      />
      {hasList ? (
        <datalist id={listId}>
          {suggestions!.map((s) => <option key={s} value={s} />)}
        </datalist>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.title ?? action.label}
          className="flex-shrink-0 whitespace-nowrap rounded border border-gray-700 bg-gray-800/60 px-1.5 py-1 text-[9.5px] text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

interface ReadingSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** 연구가 가리키는 지점 — 누르면 그 값으로 점프한다(눈금 대신 버튼이라 인라인 스타일이 필요 없다). */
  recommend?: { value: number; label: string };
}

export function ReadingSlider({
  label, value, min, max, step, onChange, recommend,
}: ReadingSliderProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded bg-gray-700 accent-blue-500"
      />
      {recommend ? (
        <button
          type="button"
          onClick={() => onChange(recommend.value)}
          title={recommend.label}
          className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[9.5px] transition-colors ${
            Math.abs(value - recommend.value) < step / 2
              ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
              : 'border-gray-700 bg-gray-800/60 text-gray-500 hover:border-gray-600 hover:text-gray-300'
          }`}
        >
          {recommend.label}
        </button>
      ) : null}
    </div>
  );
}

interface ReadingToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ReadingToggle({ label, checked, onChange }: ReadingToggleProps): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
      />
      <span>{label}</span>
    </label>
  );
}
