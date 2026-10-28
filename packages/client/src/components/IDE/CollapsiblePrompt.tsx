/**
 * CollapsiblePrompt — "내 메시지" 말풍선(두 렌더 경로 `StreamRenderer` · `IDEMainArea` 공용). 길면 기본 접힘(펼치면 공백·줄바꿈 보존).
 * 펼친 것은 IDE 어디를 눌러도 접힌다(`useOutsidePressDismiss` — 안에서 시작한 press·드래그는 제외).
 * §5.5 #17-18 ⑤ 이 말풍선이 곧 대기 줄 — 상태는 색(실행 중 emerald / 대기 slate / 합치기 violet / 즉시 amber / 보낸 뒤 sky), 칩·삭제도 안에.
 * 보낸 시각을 늘 띄운다(`promptStamp.ts`).
 */
import { useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { COMMAND_DISPATCH_MODES, DEFAULT_COMMAND_DISPATCH_MODE, type CommandDispatchMode } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { POPUP_DISMISS } from '../../hooks/popupDismiss.js';
import { formatPromptStamp } from './promptStamp.js';
import { FullscreenPrompt } from './FullscreenPrompt.js';
import { PromptActions } from './PromptActions.js';
import type { SpeechRunPos } from './streamDensity.js';
import { streamToggleProps } from './streamToggle.js';

/** 접이식(여러 줄/긴 입력)으로 다룰지 — 짧은 한 줄이면 정적 말풍선. */
export function isLongUserPrompt(prompt: string): boolean {
  return prompt.includes('\n') || prompt.length > 160;
}

/**
 * AI 발화 표식(본문 왼쪽 스파클) — 내 입력 말풍선과 짝이라 공용 모듈에. §5.5 #17-45 `run` = 연속 발화 런의 자리(`speechRunPositions`) — 첫 문단만 말머리, 이어지는 문단엔 실선.
 * ⚠ 세로 여백은 옆 본문 칸이 준다 — 바깥 상자에 `py-*` 를 주면 실선이 점선처럼 끊긴다.
 */
export function AiSpeakerGlyph({ run = 'solo' }: { run?: SpeechRunPos }): React.JSX.Element {
  const head = run === 'solo' || run === 'head';
  return (
    <span className="relative flex w-5 flex-shrink-0 select-none justify-center" aria-hidden="true">
      {run !== 'solo' && (
        <span
          className={`absolute left-1/2 w-px -translate-x-1/2 bg-gray-600/40 ${
            head ? 'bottom-0 top-7' : run === 'tail' ? 'bottom-2 top-0' : 'inset-y-0'
          }`}
        />
      )}
      {head && (
        <span className="mt-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-gray-700/40 text-gray-300/80">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
            <path d="M5 3v4" />
            <path d="M19 17v4" />
            <path d="M3 5h4" />
            <path d="M17 19h4" />
          </svg>
        </span>
      )}
    </span>
  );
}

/**
 * 이 말풍선이 그리는 명령의 상태 — 색과 안쪽 컨트롤을 정한다.
 * `agentId`+`commandId` 가 있고 `status==='queued'` 일 때만 [대기|합치기|즉시]·삭제가 뜬다
 * (이미 나간 명령의 방식은 바꿀 수 없다).
 */
export interface PromptCommandState {
  status: 'queued' | 'executing' | 'completed' | 'error';
  dispatchMode?: CommandDispatchMode;
  agentId?: string;
  /** 큐의 원본 명령 id (`cmd-` 접두어 없는 raw id). 없으면 컨트롤 미표시. */
  commandId?: string;
}

/** 말풍선 색 한 벌 — Tailwind 는 문자열을 정적으로 훑으므로 색마다 전체 클래스를 적어 둔다. */
export interface PromptTone {
  bubble: string;
  hover: string;
  chip: string;
  label: string;
  /** 보낸 시각 — 이름표(`label`)보다 한 단계 죽여 읽는 순서를 「나 → 본문 → 시각」으로 둔다. */
  stamp: string;
  body: string;
  chevron: string;
  copyIdle: string;
  pre: string;
  divider: string;
  badge: string;
}

const PROMPT_TONES: Record<'sky' | 'emerald' | 'slate' | 'violet' | 'amber', PromptTone> = {
  // 보낸 뒤(완료/오류) — 종전과 같은 sky 말풍선.
  sky: {
    bubble: 'border-sky-400/40 bg-sky-500/15 shadow-sky-900/20',
    hover: 'hover:bg-sky-500/20',
    chip: 'bg-sky-400/25 text-sky-200',
    label: 'text-sky-200/80',
    stamp: 'text-sky-200/55',
    body: 'text-sky-50',
    chevron: 'text-sky-200/60 group-hover/hdr:text-sky-100',
    copyIdle: 'border-sky-300/20 bg-sky-950/40 text-sky-200/70 hover:border-sky-300/40 hover:bg-sky-900/50 hover:text-sky-50',
    pre: 'border-sky-300/20 bg-sky-950/30 text-sky-50/90',
    divider: 'border-sky-300/20',
    badge: 'bg-sky-400/20 text-sky-200',
  },
  // 지금 이 프롬프트가 도는 중.
  emerald: {
    bubble: 'border-emerald-400/45 bg-emerald-500/15 shadow-emerald-900/20',
    hover: 'hover:bg-emerald-500/20',
    chip: 'bg-emerald-400/25 text-emerald-200',
    label: 'text-emerald-200/80',
    stamp: 'text-emerald-200/55',
    body: 'text-emerald-50',
    chevron: 'text-emerald-200/60 group-hover/hdr:text-emerald-100',
    copyIdle: 'border-emerald-300/20 bg-emerald-950/40 text-emerald-200/70 hover:border-emerald-300/40 hover:bg-emerald-900/50 hover:text-emerald-50',
    pre: 'border-emerald-300/20 bg-emerald-950/30 text-emerald-50/90',
    divider: 'border-emerald-300/20',
    badge: 'bg-emerald-400/20 text-emerald-200',
  },
  // 대기 — 자기 턴을 따로 갖는다(가장 조용한 색).
  slate: {
    bubble: 'border-slate-400/35 bg-slate-500/10 shadow-slate-900/20',
    hover: 'hover:bg-slate-500/15',
    chip: 'bg-slate-400/20 text-slate-200',
    label: 'text-slate-300/80',
    stamp: 'text-slate-300/55',
    body: 'text-slate-100',
    chevron: 'text-slate-300/60 group-hover/hdr:text-slate-100',
    copyIdle: 'border-slate-300/20 bg-slate-950/40 text-slate-300/70 hover:border-slate-300/40 hover:bg-slate-900/50 hover:text-slate-50',
    pre: 'border-slate-300/20 bg-slate-950/30 text-slate-100/90',
    divider: 'border-slate-300/20',
    badge: 'bg-slate-400/20 text-slate-200',
  },
  // 합치기 — 앞 프롬프트에 실려 한 턴으로 함께 나간다.
  violet: {
    bubble: 'border-violet-400/45 bg-violet-500/15 shadow-violet-900/20',
    hover: 'hover:bg-violet-500/20',
    chip: 'bg-violet-400/25 text-violet-200',
    label: 'text-violet-200/80',
    stamp: 'text-violet-200/55',
    body: 'text-violet-50',
    chevron: 'text-violet-200/60 group-hover/hdr:text-violet-100',
    copyIdle: 'border-violet-300/20 bg-violet-950/40 text-violet-200/70 hover:border-violet-300/40 hover:bg-violet-900/50 hover:text-violet-50',
    pre: 'border-violet-300/20 bg-violet-950/30 text-violet-50/90',
    divider: 'border-violet-300/20',
    badge: 'bg-violet-400/20 text-violet-200',
  },
  // 즉시 — 지금 도는 턴을 끊는다.
  amber: {
    bubble: 'border-amber-400/45 bg-amber-500/15 shadow-amber-900/20',
    hover: 'hover:bg-amber-500/20',
    chip: 'bg-amber-400/25 text-amber-200',
    label: 'text-amber-200/80',
    stamp: 'text-amber-200/55',
    body: 'text-amber-50',
    chevron: 'text-amber-200/60 group-hover/hdr:text-amber-100',
    copyIdle: 'border-amber-300/20 bg-amber-950/40 text-amber-200/70 hover:border-amber-300/40 hover:bg-amber-900/50 hover:text-amber-50',
    pre: 'border-amber-300/20 bg-amber-950/30 text-amber-50/90',
    divider: 'border-amber-300/20',
    badge: 'bg-amber-400/20 text-amber-200',
  },
};

/** 대기 중 명령의 dispatch 방식별 색 — 말풍선 색과 칩 활성 색이 같은 계열이라 눈이 한 번에 잇는다. */
const MODE_TONE: Record<CommandDispatchMode, keyof typeof PROMPT_TONES> = {
  wait: 'slate',
  merge: 'violet',
  immediate: 'amber',
};

/** 상태 → 말풍선 색. 명령 정보가 없으면(이력 표시 등) 종전 sky. */
function toneFor(command: PromptCommandState | undefined): keyof typeof PROMPT_TONES {
  if (!command) return 'sky';
  if (command.status === 'executing') return 'emerald';
  if (command.status === 'queued') return MODE_TONE[command.dispatchMode ?? DEFAULT_COMMAND_DISPATCH_MODE];
  return 'sky';
}

/** 대기 줄 칩 아이콘 — 대기(시계) / 합치기(합류 화살표) / 즉시(번개). lucide 톤 stroke SVG. */
export function DispatchModeIcon({ mode }: { mode: CommandDispatchMode }): React.JSX.Element {
  const common = { className: 'h-3 w-3', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (mode === 'wait') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </svg>
    );
  }
  if (mode === 'immediate') {
    return (
      <svg {...common}>
        <polygon points="13 2 4 14 11 14 10 22 19 10 12 10 13 2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M7 4v6a5 5 0 0 0 5 5h5" />
      <polyline points="14 12 17 15 14 18" />
    </svg>
  );
}

export function CollapsiblePrompt({ prompt, command, submittedAt }: {
  prompt: string;
  command?: PromptCommandState;
  /**
   * **내가 보낸 시각**(`QueuedCommand.timestamp`). 말풍선을 세우는 정렬 anchor(§5.5 #17-18 ⑥ —
   * 대기 중이면 `PENDING_COMMAND_TS` 꼬리 표식)와 **다른 값**이다. 없으면 시각을 그리지 않는다.
   */
  submittedAt?: number;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [fullscreenHost, setFullscreenHost] = useState<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const collapsible = isLongUserPrompt(prompt);
  const setCommandDispatchMode = useGraphStore((s) => s.setCommandDispatchMode);
  const removeCommand = useGraphStore((s) => s.removeCommand);
  const tone = PROMPT_TONES[toneFor(command)];
  const mode = command?.dispatchMode ?? DEFAULT_COMMAND_DISPATCH_MODE;
  /*
   * §5.5 #17-10 ⑥-5 — 손잡이는 배지와 같은 사실(`displayCommands` 의 `command.status`)을 따른다 — 원본 큐를 따르면 조용한 압축 중 "실행 중…" 배지 아래에
   * 대기 칩이 붙는다. 물려받은 명령은 손잡이가 없고, 빠지는 길은 [중지](§5.3 #9-1 (P)(b)).
   */
  const controlAgentId = command?.status === 'queued' ? command.agentId : undefined;
  const controlCommandId = command?.status === 'queued' ? command.commandId : undefined;
  const controllable = controlAgentId !== undefined && controlCommandId !== undefined;

  // 펼친 말풍선은 IDE 어디를 눌러도 접힌다(팝업 닫기 공통 규약 — `popupDismissContract`). 안에서 시작한 press·선택 드래그는 접지 않고,
  // `graceMs` 는 펼친 클릭의 잔여 이벤트를 거르며, 접혀 있으면 리스너를 안 건다(`enabled`).
  const collapse = useCallback(() => setOpen(false), []);
  const closeFullscreen = useCallback(() => setFullscreenHost(null), []);
  useOutsidePressDismiss({
    enabled: collapsible && open && !fullscreenHost,
    onDismiss: collapse,
    refs: [bubbleRef],
    graceMs: POPUP_DISMISS.openGraceMs,
  });

  const firstLine = useMemo(() => {
    const line = prompt.split('\n').find((l) => l.trim().length > 0) ?? prompt;
    return line.trim();
  }, [prompt]);

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => { /* clipboard 권한 거부 — 조용히 무시 */ });
  }, [prompt]);

  // 보낸 시각 — 렌더마다 새로 만든다(값을 붙들어 두면 자정을 넘겨도 "오늘"이 그대로 남는다).
  //   `Intl` 인스턴스는 promptStamp 안에서 로케일별로 재사용되므로 이 계산 자체는 싸다.
  const stamp = formatPromptStamp(submittedAt, i18n.language);

  // 사람 아이콘 칩 + "나" 라벨 (+ 보낸 시각 + 상태 배지) — 접이식/정적 말풍선이 공유하는 본인 입력 표식.
  const identity = (
    <>
      <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${tone.chip}`}>
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </span>
      <span className={`flex-shrink-0 text-[12px] font-semibold uppercase tracking-wide ${tone.label}`}>{t('ide.streamRenderer.youTyped')}</span>
      {/* 언제 보낸 글인가 — 되감을 때 날짜가 붙은 표기(어제·그 전)가 눈에 걸리도록 한 단계 굵게. */}
      {stamp && (
        <time
          dateTime={stamp.iso}
          title={stamp.title}
          className={`flex-shrink-0 text-[12px] tabular-nums ${stamp.aged ? 'font-medium' : 'font-normal'} ${tone.stamp}`}
        >
          {stamp.text}
        </time>
      )}
      {/* 실행 중 / 대기 중 — 색만으로 못 읽는 사람을 위해 글자로도 한 번 말한다. */}
      {command?.status === 'executing' && (
        <span className={`flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold ${tone.badge}`}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          {t('ide.mainArea.executing')}
        </span>
      )}
      {command?.status === 'queued' && (
        <span className={`flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold ${tone.badge}`}>
          <DispatchModeIcon mode={mode} />
          {t(`ide.mainArea.dispatchMode.${mode}`)}
        </span>
      )}
    </>
  );

  return (
    // §4 — 폰에선 말풍선을 폭에 더 붙인다. `ide-user-msg` = §5.5 #17-22 ⑨ 대화 정렬 표식(켜지면 index.css 가 90% 폭을 풀어 오른쪽 끝에 붙인다).
    <div className="ide-user-msg mb-2 ml-auto w-full max-w-[90%] max-md:max-w-[96%]">
      <div ref={bubbleRef} className={`relative overflow-hidden rounded-2xl rounded-tr-sm border shadow-sm ${tone.bubble}`}>
        {collapsible ? (
          /* 여러 줄/긴 입력 — 클릭하면 펼침/접힘. 접힘 상태에선 첫 줄만 미리보기. */
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            {...streamToggleProps(open)}
            title={open ? t('ide.streamRenderer.clickToCollapse') : t('ide.streamRenderer.clickToExpand')}
            className={`group/hdr flex w-full items-center gap-2 py-2 pl-2.5 pr-[4.5rem] text-left transition-colors ${tone.hover}`}
          >
            {identity}
            <span className={`ide-prompt-text min-w-0 flex-1 truncate text-[13px] ${tone.body}`}>{firstLine}</span>
            <svg className={`h-3 w-3 flex-shrink-0 transition-transform ${tone.chevron} ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        ) : (
          /* 짧은 한 줄 — 접을 게 없으니 셰브론 없는 정적 말풍선, 본문 그대로 표시. */
          <div className="flex w-full items-center gap-2 py-2 pl-2.5 pr-10">
            {identity}
            <span className={`ide-prompt-text min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] ${tone.body}`}>{prompt}</span>
          </div>
        )}

        {/* 확대해도 복사와 보기 버튼의 자리·모양은 같다. 헤더 button과 형제여야 한다. */}
        <PromptActions
          tone={tone}
          copied={copied}
          onCopy={onCopy}
          onView={collapsible ? (event) => {
            const host = event.currentTarget.closest<HTMLElement>('[data-ide-text-viewport]');
            if (host) setFullscreenHost(host);
          } : undefined}
        />

        {/* 펼친 내용 — 사용자가 넣은 그대로(공백·줄바꿈 보존) */}
        {collapsible && open && (
          <pre className={`ide-prompt-text scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-2.5 text-[13px] ${tone.pre}`}>
            {prompt}
          </pre>
        )}

        {/* §5.5 #17-18 ⑤ — 대기 중 덧말 컨트롤 줄: 칩 + 삭제(×) + 고른 방식 설명. */}
        {controllable && (
          <div className={`flex items-center gap-1.5 border-t px-2 py-1 ${tone.divider}`}>
            <div className="flex flex-shrink-0 items-center gap-0.5 rounded bg-gray-950/50 p-0.5">
              {COMMAND_DISPATCH_MODES.map((m) => {
                const active = m === mode;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { if (!active) setCommandDispatchMode(controlAgentId, controlCommandId, m); }}
                    title={t(`ide.mainArea.dispatchModeTitle.${m}`)}
                    aria-pressed={active}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] transition-colors ${
                      active
                        ? m === 'immediate'
                          ? 'bg-amber-500/25 text-amber-200'
                          : m === 'merge'
                            ? 'bg-violet-500/25 text-violet-200'
                            : 'bg-slate-500/25 text-slate-100'
                        : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                    }`}
                  >
                    <DispatchModeIcon mode={m} />
                    {t(`ide.mainArea.dispatchMode.${m}`)}
                  </button>
                );
              })}
            </div>
            <span className="min-w-0 flex-1 truncate text-[12px] leading-tight text-gray-400/80" title={t(`ide.mainArea.dispatchModeTitle.${mode}`)}>
              {t(`ide.mainArea.dispatchModeTitle.${mode}`)}
            </span>
            <button
              type="button"
              onClick={() => removeCommand(controlAgentId, controlCommandId)}
              title={t('ide.mainArea.queuedRemove')}
              aria-label={t('ide.mainArea.queuedRemove')}
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-red-600/20 hover:text-red-300"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {fullscreenHost && (
        <FullscreenPrompt host={fullscreenHost} tone={tone} prompt={prompt} identity={identity} preview={firstLine} copied={copied} onCopy={onCopy} onClose={closeFullscreen} />
      )}
    </div>
  );
}
