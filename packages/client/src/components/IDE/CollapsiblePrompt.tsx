/**
 * CollapsiblePrompt — 사용자가 IDE 에 입력/붙여넣은 프롬프트를 "내 메시지" 말풍선으로 렌더.
 *
 * 두 렌더 경로(Sub 탭 `StreamRenderer` 의 CommandBlock, Agent/메인 탭 `IDEMainArea` 의 TerminalLine)가
 * **동일하게** 이 컴포넌트를 쓰도록 분리한 공용 모듈 — 한쪽만 고쳐 입력이 탭에 따라 옛 모양으로
 * 뜨던 불일치를 없앤다.
 *
 * 사용자 입력은 **길이와 무관하게 항상 말풍선**으로 뜬다(본인 입력임을 한눈에). 짧은 한 줄은 접을
 * 게 없으니 셰브론 없는 정적 말풍선, 길거나 여러 줄(복붙한 inspector 정보 등)이면 기본 접힘
 * (첫 줄만 미리보기) + 펼치면 넣은 그대로(공백·줄바꿈 보존)인 접이식 말풍선. 둘 다 우상단 복사 버튼.
 *
 * tool/thinking 의 좌측 세로바 박스와 모양·정렬을 의도적으로 다르게(우측 정렬 + 채움 말풍선 +
 * 사람 아이콘·"나" 라벨) 해 본인 입력임을 한눈에 구분한다.
 *
 * §5.5 #17-18 ⑤ v4.77 — **이 말풍선이 곧 대기 줄이다.** 실행 중에 넣은 덧말은 어차피 이 말풍선으로
 * 올라가므로, 입력창 위에 같은 내용을 한 번 더 그리던 별도 "대기 줄"을 없애고 **상태를 말풍선 색으로**
 * 구분한다(실행 중 = emerald / 대기 = slate / 합치기 = violet / 즉시 = amber / 보낸 뒤 = 기존 sky).
 * [대기|합치기|즉시] 칩과 삭제(×)도 대기 줄이 아니라 **그 말풍선 안**에 있다 — 사용자가 자기 글을
 * 보면서 그 자리에서 방식을 바꾼다.
 */
import { useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { COMMAND_DISPATCH_MODES, DEFAULT_COMMAND_DISPATCH_MODE, type CommandDispatchMode } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

/** 접이식(여러 줄/긴 입력)으로 다룰지 — 짧은 한 줄이면 정적 말풍선. */
export function isLongUserPrompt(prompt: string): boolean {
  return prompt.includes('\n') || prompt.length > 160;
}

/**
 * AI 발화 표식 — assistant 텍스트를 박스로 감싸지 않고 평범한 본문으로 두되, 왼쪽에 작은 스파클 글리프만
 * 붙여 "AI 가 말하는 것"임을 한눈에 알리는 수수한 마커. 내 입력(사람 아이콘·sky 말풍선)과 짝을 이루는
 * 발화 주체 표식이라 이 공용 모듈에 둔다(두 렌더 경로가 동일 모양을 쓰도록).
 */
export function AiSpeakerGlyph(): React.JSX.Element {
  return (
    <span
      className="mt-0.5 flex h-5 w-5 flex-shrink-0 select-none items-center justify-center rounded-md bg-gray-700/40 text-gray-300/80"
      aria-hidden="true"
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
        <path d="M5 3v4" />
        <path d="M19 17v4" />
        <path d="M3 5h4" />
        <path d="M17 19h4" />
      </svg>
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
interface PromptTone {
  bubble: string;
  hover: string;
  chip: string;
  label: string;
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

export function CollapsiblePrompt({ prompt, command }: { prompt: string; command?: PromptCommandState }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const collapsible = isLongUserPrompt(prompt);
  const setCommandDispatchMode = useGraphStore((s) => s.setCommandDispatchMode);
  const removeCommand = useGraphStore((s) => s.removeCommand);
  const tone = PROMPT_TONES[toneFor(command)];
  const mode = command?.dispatchMode ?? DEFAULT_COMMAND_DISPATCH_MODE;
  // 대기 중 + 큐 좌표(agentId·commandId)를 아는 말풍선만 방식을 바꾸거나 지울 수 있다.
  const controlAgentId = command?.status === 'queued' ? command.agentId : undefined;
  const controlCommandId = command?.status === 'queued' ? command.commandId : undefined;
  const controllable = controlAgentId !== undefined && controlCommandId !== undefined;

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

  // 사람 아이콘 칩 + "나" 라벨 (+ 상태 배지) — 접이식/정적 말풍선이 공유하는 본인 입력 표식.
  const identity = (
    <>
      <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${tone.chip}`}>
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </span>
      <span className={`flex-shrink-0 text-[12px] font-semibold uppercase tracking-wide ${tone.label}`}>{t('ide.streamRenderer.youTyped')}</span>
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
    // §4 v3.24 — 폰(max-md)에선 말풍선을 화면 폭에 더 붙인다(여백 압축).
    // `ide-user-msg` 는 §5.5 #17-22 ⑨ 대화 정렬이 잡는 표식 — 켜지면 index.css 가 이 90% 폭을 풀고
    // 내용 폭 그대로 오른쪽 끝에 붙인다(꺼져 있으면 아무 규칙도 걸리지 않아 종전 모양 그대로).
    <div className="ide-user-msg mb-2 ml-auto w-full max-w-[90%] max-md:max-w-[96%]">
      <div className={`relative overflow-hidden rounded-2xl rounded-tr-sm border shadow-sm ${tone.bubble}`}>
        {collapsible ? (
          /* 여러 줄/긴 입력 — 클릭하면 펼침/접힘. 접힘 상태에선 첫 줄만 미리보기. */
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title={open ? t('ide.streamRenderer.clickToCollapse') : t('ide.streamRenderer.clickToExpand')}
            className={`group/hdr flex w-full items-center gap-2 py-2 pl-2.5 pr-10 text-left transition-colors ${tone.hover}`}
          >
            {identity}
            <span className={`min-w-0 flex-1 truncate text-[13px] leading-relaxed ${tone.body}`}>{firstLine}</span>
            <svg className={`h-3 w-3 flex-shrink-0 transition-transform ${tone.chevron} ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        ) : (
          /* 짧은 한 줄 — 접을 게 없으니 셰브론 없는 정적 말풍선, 본문 그대로 표시. */
          <div className="flex w-full items-center gap-2 py-2 pl-2.5 pr-10">
            {identity}
            <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed ${tone.body}`}>{prompt}</span>
          </div>
        )}

        {/* 우상단 복사 버튼 — 항상 표시 */}
        <button
          type="button"
          onClick={onCopy}
          title={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
          aria-label={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
          className={`absolute right-2 top-2 inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[12px] font-medium transition-colors ${
            copied ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : tone.copyIdle
          }`}
        >
          {copied ? (
            // check
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            // copy (overlapping squares)
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
          )}
        </button>

        {/* 펼친 내용 — 사용자가 넣은 그대로(공백·줄바꿈 보존) */}
        {collapsible && open && (
          <pre className={`scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-2.5 font-mono text-[13px] leading-relaxed ${tone.pre}`}>
            {prompt}
          </pre>
        )}

        {/* §5.5 #17-18 ⑤ v4.77 — 대기 중 덧말의 컨트롤 줄. 옛 "대기 줄"이 갖고 있던 것을 전부
            이 말풍선 안으로 옮겼다: [대기|합치기|즉시] 칩 + 삭제(×) + 고른 방식의 한 줄 설명. */}
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
    </div>
  );
}
