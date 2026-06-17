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
 * tool/thinking 의 좌측 세로바 박스와 모양·정렬을 의도적으로 다르게(우측 정렬 + sky 채움 말풍선 +
 * 사람 아이콘·"나" 라벨) 해 본인 입력임을 한눈에 구분한다.
 */
import { useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

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

export function CollapsiblePrompt({ prompt }: { prompt: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const collapsible = isLongUserPrompt(prompt);

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

  // 사람 아이콘 칩 + "나" 라벨 — 접이식/정적 말풍선이 공유하는 본인 입력 표식.
  const identity = (
    <>
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-sky-400/25 text-sky-200">
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </span>
      <span className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide text-sky-200/80">{t('ide.streamRenderer.youTyped')}</span>
    </>
  );

  return (
    <div className="mb-2 ml-auto w-full max-w-[90%]">
      <div className="relative overflow-hidden rounded-2xl rounded-tr-sm border border-sky-400/40 bg-sky-500/15 shadow-sm shadow-sky-900/20">
        {collapsible ? (
          /* 여러 줄/긴 입력 — 클릭하면 펼침/접힘. 접힘 상태에선 첫 줄만 미리보기. */
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title={open ? t('ide.streamRenderer.clickToCollapse') : t('ide.streamRenderer.clickToExpand')}
            className="group/hdr flex w-full items-center gap-2 py-2 pl-2.5 pr-10 text-left transition-colors hover:bg-sky-500/20"
          >
            {identity}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-relaxed text-sky-50">{firstLine}</span>
            <svg className={`h-3 w-3 flex-shrink-0 text-sky-200/60 transition-transform group-hover/hdr:text-sky-100 ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        ) : (
          /* 짧은 한 줄 — 접을 게 없으니 셰브론 없는 정적 말풍선, 본문 그대로 표시. */
          <div className="flex w-full items-center gap-2 py-2 pl-2.5 pr-10">
            {identity}
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-sky-50">{prompt}</span>
          </div>
        )}

        {/* 우상단 복사 버튼 — 항상 표시 */}
        <button
          type="button"
          onClick={onCopy}
          title={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
          aria-label={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
          className={`absolute right-2 top-2 inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-medium transition-colors ${
            copied
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-sky-300/20 bg-sky-950/40 text-sky-200/70 hover:border-sky-300/40 hover:bg-sky-900/50 hover:text-sky-50'
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
          <pre className="scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-sky-300/20 bg-sky-950/30 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-sky-50/90">
            {prompt}
          </pre>
        )}
      </div>
    </div>
  );
}
