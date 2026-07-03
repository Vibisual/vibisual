/**
 * StreamRenderer — Sub 탭 전용 CLI 스타일 스트림 렌더러.
 *
 * Hook 에이전트의 Agent 탭(기존 TerminalLine)과 분리.
 * assistant text → 마크다운 렌더링, tool_use/tool_result → 접이식 그룹.
 *
 * 파싱 로직(events → 표시 아이템)은 순수 모듈 `streamItems.ts` 로 분리됐다.
 * v3.10 — 종전엔 스트림 갱신마다 버퍼 전체(최대 4000)를 buildBaseItems 로 재파싱(O(전체 길이)) →
 * 길수록 느려지는 구조였다. 이제 `IncrementalStreamParser` 가 **새로 도착한 이벤트만** 처리해
 * 갱신 비용을 O(신규)로 낮춘다(VS Code 터미널처럼 길이 무관). 출력은 buildBaseItems 와 동일함이
 * streamItems.test.ts 로 못박혀 있어, 아래 카드 합류·정렬·identity 재조정·Virtuoso 배선은 불변.
 */
import { memo, useState, useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Virtuoso, type VirtuosoHandle, type StateSnapshot } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import { findTextRangeInContainer, scrollRangeIntoCenter, scrollElementIntoCenter, flashElement, findItemElement } from './bookmarkScroll.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { SubAgentStreamEvent, QueuedCommand, AgentReport, AgentQuestions, AgentReview, AgentList, AskUserQuestionRequest } from '@vibisual/shared';
import { SystemNode, parseSystemSubtype } from './SystemNode.js';
import { useAttachmentThumbs } from './attachmentThumb.js';
import { ThinkingDots, ThinkingLiveLine } from './ThinkingIndicator.js';
import { AgentReportCard } from './AgentReportCard.js';
import { FeedbackButtons } from './FeedbackButtons.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { AgentReviewCard } from './AgentReviewCard.js';
import { AgentListCard } from './AgentListCard.js';
import { AskQuestionCard } from './AskQuestionCard.js';
import { CollapsiblePrompt, AiSpeakerGlyph } from './CollapsiblePrompt.js';
import {
  mergeCardsIntoItems, sameStreamItem, IncrementalStreamParser,
  type StreamText, type StreamGroup, type StreamThinking, type StreamSystem, type StreamResult,
  type StreamCommand, type StreamItemFull,
} from './streamItems.js';
import { useVirtuosoFrontShift } from './frontShift.js';

// ─── 타입 ───

interface StreamRendererProps {
  events: SubAgentStreamEvent[];
  /** 완료된 명령 (스트림 없을 때 폴백 표시용) */
  commands?: QueuedCommand[];
  /** §4 v3.21 — 피드백 컨텍스트: 이 스트림의 소유 에이전트. 있으면 result 블록에 좋아요/싫어요 노출. */
  agentId?: string;
  /** §4 v3.21 — 피드백 컨텍스트: 이 스트림의 세션(탭) ID. */
  subAgentId?: string;
  /** §4 v2.53 — 이 세션의 작업 신고. createdAt 기준으로 스트림에 인라인 합류(맨 아래 고정 ❌). */
  reports?: AgentReport[];
  /** §4 v2.60 — 이 세션의 질문 카드. reports 와 동일하게 턴 끝에 합류. */
  questions?: AgentQuestions[];
  /** §4 v2.70 — 이 세션의 검수 요청 카드. reports/questions 와 동일하게 턴 끝에 합류. */
  reviews?: AgentReview[];
  /** §4 v2.84 — 이 세션의 번호 목록 정렬 카드. reports/questions/reviews 와 동일하게 턴 끝에 합류. */
  lists?: AgentList[];
  /**
   * §5.3 #12-2 — 이 세션의 pending AskUserQuestion(클로드 네이티브 질문) 카드.
   * 다른 카드와 달리 옛 코드는 가상 리스트 **밖 trailing 형제**로 렌더했는데, customScrollParent 가상화에서
   * 마지막 항목(활성 AskUserQuestion tool 블록)의 높이 측정이 늦으면 예약 높이가 한 항목만큼 모자라
   * 이 카드가 그 위에 겹쳐 그려졌다. 다른 카드들처럼 **가상 리스트 안으로** 합류시켜 정확한 높이를 예약 → 겹침 제거.
   */
  askRequests?: AskUserQuestionRequest[];
  /**
   * v2.99 — Virtuoso 가 자기 내부 스크롤러를 **단독 소유**하고, 그 스크롤러 DOM 을 이 콜백으로 부모에
   * 올린다. 부모(IDEMainArea)는 이걸 받아 StreamStatusBar·북마크 이동·Select All 을 그 컨테이너 한정으로
   * 작동시킨다(옛 외부 customScrollParent 컨테이너 공유를 대체 — 스크롤 소유권을 virtuoso 한 곳으로).
   */
  onScrollerRef?: (el: HTMLElement | null) => void;
  /**
   * v2.99 — 세션 전환 복원 스냅샷. virtuoso `getState` 로 떠날 때 저장한 측정 항목 높이 + 스크롤 위치를
   * 담는다. 마운트 시 `restoreStateFrom` 으로 넘기면 재측정 출렁임 없이 보던 위치로 즉시 복원된다.
   */
  restoreState?: StateSnapshot;
  /**
   * v2.99 — 바닥 추종 여부 변화 통지. virtuoso `atBottomStateChange` 를 그대로 올려, 부모가 세션별
   * 추종 의도 저장·StreamStatusBar 판정에 쓴다(옛 수동 scrollTop 비교·제스처 추적을 대체).
   */
  onAtBottomChange?: (atBottom: boolean) => void;
}

/** §5.5 #17-7 — 북마크 "이동" 시 부모(IDEMainArea)가 호출하는 명령형 핸들. */
export interface StreamRendererHandle {
  /** 출처 항목(anchorId)으로 가상 리스트를 스크롤하고 그 항목/텍스트를 하이라이트. */
  scrollToBookmark: (anchorId: string | undefined, text: string) => void;
  /**
   * 하단 StreamStatusBar 의 "프롬프트로 이동" 점프 — 해당 명령(cmd-${id}) 항목으로 스크롤.
   * 가상 리스트(virtuoso)는 뷰포트 밖 항목을 렌더하지 않으므로, scrollToIndex 로 먼저 그 항목을
   * 렌더시킨 뒤 컨테이너 한정으로 상단 정렬(-16px 여백)한다. DOM querySelector 단독은 미렌더 항목에서
   * 실패(바닥에서 눌러도 안 올라가던 버그)하므로 인덱스 스크롤이 필수.
   */
  scrollToCommand: (cmdId: string) => void;
  /** 인-페이지 검색 — query 를 포함하는 항목들의 id 를 등장 순서로 반환. 네비게이션/하이라이트는
   *  scrollToBookmark(id, query) 재사용(가상 리스트라 DOM 검색 불가 → 항목 데이터 기준 매칭). */
  searchMatchIds: (query: string) => string[];
  /** v2.99 — 세션 떠날 때 부모가 현재 스크롤/측정 상태 스냅샷을 가져가 저장(다음 복귀 때 restoreState 로 전달). */
  getState: (cb: (snap: StateSnapshot) => void) => void;
}

// ─── 마크다운 커스텀 렌더러 ───

/** 펜스드/인덴트 코드 블록 — 우상단 호버 시 복사 버튼.
 *  react-markdown 의 `pre` 슬롯 교체. 내부 `<code>` 는 그대로 children 으로 받는다.
 *  텍스트 추출은 ref 의 `textContent` 로 — 중첩 syntax 토큰까지 한 번에 잡힌다. */
function CodeBlock({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>): React.JSX.Element {
  const { t } = useTranslation();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const onCopy = useCallback(() => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => { /* clipboard 권한 거부 — 조용히 무시 */ });
  }, []);

  return (
    <div className="group/code relative">
      <pre ref={preRef} {...rest}>{children}</pre>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        aria-label={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        className={`absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-medium transition-opacity ${
          copied
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 opacity-100'
            : 'border-white/10 bg-gray-900/70 text-gray-300 opacity-0 group-hover/code:opacity-100 hover:border-white/20 hover:bg-gray-800/80 hover:text-gray-100 focus:opacity-100'
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
    </div>
  );
}

/** 본문 링크 — 밑줄 + sky 색으로 "클릭 가능한 주소"임을 표식. 클릭 시 앱 안 iframe(느림) 대신
 *  외부 브라우저로 연다(window.open → Electron main 이 shell.openExternal 로 가로챔).
 *  드래그 선택은 그대로 가능(텍스트 선택을 막지 않음). */
const MarkdownLink = memo(function MarkdownLink({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.JSX.Element {
  if (!href) return <span>{children}</span>;
  return (
    <a
      href={href}
      onClick={(e) => { e.preventDefault(); try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ } }}
      className="cursor-pointer break-all text-sky-400 underline decoration-sky-400/40 underline-offset-2 transition-colors hover:text-sky-300 hover:decoration-sky-300"
    >
      {children}
    </a>
  );
});

const mdComponents: Components = { pre: CodeBlock, a: MarkdownLink };

/** v3.13 — 앞쪽 절단 shift 카운트용 안정 id 추출자(렌더 간 동일 참조 필요 → 모듈 상수). */
const streamItemId = (item: StreamItemFull): string => item.id;

/** v3.17 — 리스트 끝 여백(px): 마지막 줄이 하단 입력부 경계에 딱 붙어 걸려 보이지 않게.
 *  virtuoso Footer 로 렌더해 리스트(scrollHeight)의 일부가 되므로 DOM 워치독 바닥 접착과 자연히 호환
 *  (스크롤러 padding 은 virtuoso 측정과 어긋나므로 금지). Sub 탭·메인 탭 공용. */
export const STREAM_END_GAP_PX = 28;
export function StreamEndGap(): React.JSX.Element {
  return <div style={{ height: STREAM_END_GAP_PX }} aria-hidden />;
}

/** remark-gfm — `[text](url)` 마크다운 링크뿐 아니라 본문에 그대로 박힌 `http(s)://…` bare URL 도
 *  자동으로 링크(autolink literal)로 만들어 MarkdownLink 가 받아 처리하게 한다. */
const remarkPlugins = [remarkGfm];

// ─── 개별 렌더러 ───

/** assistant 텍스트 → 마크다운. "AI 와 나눈 일상 대화"임을 한눈에 — 박스로 감싸면 도구/생각/결과 박스와
 *  뒤섞여 오히려 지저분해 보이므로, **박스를 걷어내고 평범한 본문 텍스트**로 둔다. 다만 "AI 가 말하는 것"임은
 *  왼쪽의 작은 스파클 글리프로만 표식(도구/생각=좌측 세로바 박스, 내 입력=우측 sky 말풍선과 자연히 구분). */
const TextBlock = memo(function TextBlock({ item }: { item: StreamText }): React.JSX.Element {
  return (
    // §4 v3.24 — 폰(max-md)에선 좌우 여백 압축(카톡/텔레그램 밀도) — 데스크톱 px-4 유지.
    <div className="px-4 py-1 max-md:px-1.5">
      <div className="flex gap-2">
        <AiSpeakerGlyph />
        <div className="ide-md prose prose-invert prose-sm min-w-0 max-w-none flex-1 leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-pre:my-2 prose-headings:text-gray-100 prose-headings:text-[15px] prose-li:my-1 prose-strong:text-gray-100">
          <Markdown remarkPlugins={remarkPlugins} components={mdComponents}>{item.content}</Markdown>
        </div>
      </div>
    </div>
  );
});

/** tool_use + tool_result 접이식 그룹 */
const ToolBlock = memo(function ToolBlock({ item }: { item: StreamGroup }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const accentColor = item.isActive ? 'border-blue-500/70' : 'border-amber-500/40';
  const headerBg = item.isActive ? 'bg-blue-500/5 hover:bg-blue-500/10' : 'bg-gray-800/30 hover:bg-gray-800/60';

  // input 미리보기
  const preview = useMemo(() => {
    if (!item.input) return '';
    try {
      const obj = JSON.parse(item.input) as Record<string, unknown>;
      // 주요 필드만 추출
      const file = obj['file_path'] ?? obj['path'] ?? obj['pattern'] ?? obj['command'];
      if (typeof file === 'string') return file.length > 80 ? `${file.slice(0, 80)}...` : file;
    } catch { /* not JSON */ }
    return item.input.length > 80 ? `${item.input.slice(0, 80)}...` : item.input;
  }, [item.input]);

  return (
    <div className={`mx-2 my-1 overflow-hidden rounded-md border-l-2 max-md:mx-1 ${accentColor} transition-colors`}>
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`group/hdr flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${headerBg}`}
        title={open ? t('ide.streamRenderer.clickToCollapse') : t('ide.streamRenderer.clickToExpand')}
      >
        {/* 셰브론 */}
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-colors group-hover/hdr:bg-gray-700/50">
          <svg
            className={`h-2.5 w-2.5 text-gray-500 transition-transform group-hover/hdr:text-gray-300 ${open ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24" fill="currentColor"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>

        {/* 도구 이름 */}
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-400/90">
          {item.toolName}
        </span>

        {/* 미리보기 */}
        {!open && preview && (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-400">
            {preview}
          </span>
        )}

        {/* 스피너 or hover 힌트 */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {item.isActive && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
          )}
          <span className="hidden text-[10px] text-gray-500 group-hover/hdr:inline">
            {open ? t('ide.streamRenderer.collapse') : t('ide.streamRenderer.expand')}
          </span>
        </div>
      </button>

      {/* 펼친 내용 */}
      {open && (
        <div className="border-t border-gray-800/60 bg-gray-950/50 px-3 py-2">
          {item.input && (
            <div className="mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('ide.streamRenderer.input')}</span>
              <pre className="scrollbar-thin mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2.5 font-mono text-[12.5px] leading-relaxed text-gray-200">
                {item.input}
              </pre>
            </div>
          )}
          {item.output && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('ide.streamRenderer.output')}</span>
              <pre className="scrollbar-thin mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2.5 font-mono text-[12.5px] leading-relaxed text-gray-300">
                {item.output}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 활성 프로그레스 바 */}
      {item.isActive && (
        <div className="h-[2px] w-full overflow-hidden bg-gray-800/30">
          <div className="h-full w-1/3 rounded-full bg-blue-500/60" style={{ animation: 'slide 1.5s ease-in-out infinite' }} />
        </div>
      )}
    </div>
  );
});

/** assistant thinking — VS Code 스타일 1줄 "생각 중 …" + 접이식 전체 보기 (연보라·이탤릭) */
const ThinkingBlock = memo(function ThinkingBlock({ item }: { item: StreamThinking }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // 성능: thinking 본문이 토큰마다 자라도 미리보기는 content 가 바뀔 때만 재계산.
  const preview = useMemo(() => item.content.replace(/\s+/g, ' ').trim().slice(0, 100), [item.content]);
  return (
    <div className="mx-2 my-1 overflow-hidden rounded-md border-l-2 border-violet-500/40 max-md:mx-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/hdr flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-violet-500/10"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <svg className={`h-2.5 w-2.5 text-violet-400/70 transition-transform group-hover/hdr:text-violet-300 ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        {/* "생각 중" 라벨 — 진행 중이면 도트 애니메이션 */}
        <span className="flex flex-shrink-0 items-center gap-0.5 text-[12px] italic text-violet-300/85">
          {t('ide.streamRenderer.thinking')}
          {item.isActive && <ThinkingDots />}
        </span>
        {/* 완료 후 접힘 상태일 때만 첫 문장 미리보기 */}
        {!open && !item.isActive && preview && (
          <span className="min-w-0 flex-1 truncate text-[12px] italic text-violet-300/50">
            {preview}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-violet-500/20 bg-gray-950/50 px-4 py-2.5">
          <div className="whitespace-pre-wrap break-words text-[13px] italic leading-relaxed text-violet-200/90">
            {item.content}
          </div>
        </div>
      )}
    </div>
  );
});

/** system 메시지 — SDK subtype([task_started] 등)은 깔끔한 칩, 그 외 임의 본문은 텍스트 폴백 */
function SystemLine({ item }: { item: StreamSystem }): React.JSX.Element {
  const subtype = parseSystemSubtype(item.content);
  if (subtype) return <SystemNode subtype={subtype} />;
  return (
    <div className="px-4 py-1 max-md:px-1.5">
      <span className="font-mono text-[12px] text-gray-400">{item.content}</span>
    </div>
  );
}

/** §4 v3.21 — result 블록 피드백 컨텍스트 (스트림 소유 에이전트/세션). 없으면 버튼 미노출. */
export interface StreamFeedbackCtx {
  agentId: string;
  subAgentId?: string;
}

/** 최종 결과 */
function ResultBlock({ item, feedbackCtx }: { item: StreamResult; feedbackCtx?: StreamFeedbackCtx }): React.JSX.Element {
  return (
    <div className="mx-2 my-1 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 max-md:mx-1 max-md:px-2.5">
      <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-strong:text-gray-100">
        <Markdown remarkPlugins={remarkPlugins} components={mdComponents}>{item.content}</Markdown>
      </div>
      {/* §4 v3.21 — 턴 완료 메시지에 좋아요/싫어요 (규칙 되먹임 학습 재료). summary = 본문 앞부분 발췌. */}
      {feedbackCtx && (
        <div className="mt-1.5 border-t border-emerald-500/10 pt-1.5">
          <FeedbackButtons
            agentId={feedbackCtx.agentId}
            subAgentId={feedbackCtx.subAgentId}
            targetType="result"
            targetId={item.id}
            summary={[item.content.slice(0, 200)]}
          />
        </div>
      )}
    </div>
  );
}

/** 명령 폴백 (스트림 없을 때). 실행 중 인디케이터는 하단 StreamStatusBar 가 담당 — 여기선 프롬프트/결과만. */
function CommandBlock({ item }: { item: StreamCommand }): React.JSX.Element {
  const isError = item.status === 'error';
  // v2.61 — 전송한 첨부 이미지를 사용자 프롬프트 아래 썸네일로 표시. 클릭 시 전역 라이트박스로 확대.
  // v2.93 — blob preview(메모리) 우선, 없으면 server 파일 라우트로 폴백(별창/새로고침/재시작에서도 표시).
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const thumbs = useAttachmentThumbs(item.attachments);
  return (
    <div className="px-4 py-2 max-md:px-1.5" data-cmd-id={item.id}>
      {/* 프롬프트 — 사용자 입력은 길이와 무관하게 항상 "내 메시지" 말풍선으로. */}
      <CollapsiblePrompt prompt={item.prompt} />
      {/* 전송한 첨부 이미지 썸네일 (클릭 → 라이트박스) */}
      {thumbs.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-2 pl-5">
          {thumbs.map((a) => (
            <button
              key={a.basename}
              type="button"
              onClick={() => openImageLightbox(a.url)}
              className="h-16 w-16 flex-shrink-0 overflow-hidden rounded border border-gray-700 bg-gray-800 transition-opacity hover:opacity-80"
            >
              <img src={a.url} alt="" className="h-full w-full cursor-zoom-in object-cover" />
            </button>
          ))}
        </div>
      )}
      {/* 결과 */}
      {item.result && (
        <div className={`rounded-md border px-3 py-2 ${
          isError ? 'border-red-500/20 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'
        }`}>
          <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed">
            <Markdown remarkPlugins={remarkPlugins} components={mdComponents}>{item.result}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 렌더러 ───

/** 인-페이지 검색용 항목 텍스트 추출 — 대화 본문(text/thinking/tool/command/system/result)만.
 *  카드류(report/question/…)는 별도 UI 라 v1 검색 대상에서 제외. */
function itemSearchText(item: StreamItemFull): string {
  switch (item.kind) {
    case 'text': case 'system': case 'result': case 'thinking': return item.content;
    case 'tool': return `${item.toolName} ${item.input} ${item.output}`;
    case 'command': return `${item.prompt} ${item.result}`;
    default: return '';
  }
}

/** 단일 스트림 아이템 → 블록 엘리먼트. 북마크 이동 앵커용 `data-stream-item-id` 래퍼로 감싼다.
 *  zoom — IDE 본문 텍스트 줌 배율. **스크롤러(가상 리스트 뷰포트)가 아니라 각 항목 래퍼**에 걸어,
 *  Virtuoso 가 zoom 반영된 실제 항목 높이를 그대로 측정(가상화·스크롤 계산과 일관)하게 한다. */
function renderStreamItem(item: StreamItemFull, thinkingLabel: string, zoom: number, feedbackCtx?: StreamFeedbackCtx): React.JSX.Element {
  let inner: React.JSX.Element;
  switch (item.kind) {
    case 'text':     inner = <TextBlock item={item} />; break;
    case 'thinking': inner = <ThinkingBlock item={item} />; break;
    case 'tool':     inner = <ToolBlock item={item} />; break;
    case 'result':   inner = <ResultBlock item={item} feedbackCtx={feedbackCtx} />; break;
    case 'system':   inner = <SystemLine item={item} />; break;
    case 'command':  inner = <CommandBlock item={item} />; break;
    case 'thinking-live': inner = <ThinkingLiveLine label={thinkingLabel} />; break;
    case 'report':   inner = <AgentReportCard report={item.report} />; break;
    case 'question': inner = <AgentQuestionCard questions={item.questions} />; break;
    case 'review':   inner = <AgentReviewCard review={item.review} />; break;
    case 'list':     inner = <AgentListCard list={item.list} />; break;
    case 'ask':      inner = <AskQuestionCard request={item.request} />; break;
  }
  return <div data-stream-item-id={item.id} style={zoom === 1 ? undefined : { zoom }}>{inner}</div>;
}

export const StreamRenderer = memo(forwardRef<StreamRendererHandle, StreamRendererProps>(function StreamRenderer({ events, commands, agentId, subAgentId, reports, questions, reviews, lists, askRequests, onScrollerRef, restoreState, onAtBottomChange }, ref): React.JSX.Element {
  const { t } = useTranslation();
  // 성능(v3.10): 2단 빌드 — 1단계(events 기반 base)는 **증분 파서**가 새로 온 이벤트만 처리(O(신규)).
  //   세션 전환/commands 변경/버퍼 앞쪽 절단이면 파서 내부에서 전체 재구축으로 폴백(결과는 항상 동일).
  //   2단계(카드 합류)는 카드 변경 때만 재계산. 파서 인스턴스는 이 컴포넌트 수명 동안 유지(ref).
  const parserRef = useRef<IncrementalStreamParser | null>(null);
  if (parserRef.current === null) parserRef.current = new IncrementalStreamParser();
  const base = useMemo(() => parserRef.current!.sync(events, commands), [events, commands]);
  const merged = useMemo(
    () => mergeCardsIntoItems(base, commands, reports, questions, reviews, lists, askRequests),
    [base, commands, reports, questions, reviews, lists, askRequests],
  );

  // v3.09 — 항목 identity 안정화(thinking 떨림 차단). 증분 파서는 자란 항목만 새 객체로 교체하지만,
  //   카드 합류/정렬 단계가 배열을 새로 만들므로 여기서 한 번 더 참조를 고정한다: 직전 렌더에서 같은 id 의
  //   항목과 렌더에 영향 주는 필드가 모두 같으면 **이전 객체 참조를 그대로 재사용** → memo 자식이 유지돼
  //   뷰포트 선렌더 버퍼 전체 재측정이 사라진다(스크롤 추종 로직은 손대지 않음).
  const prevById = useRef<Map<string, StreamItemFull>>(new Map());
  const items = useMemo(() => {
    const next = new Map<string, StreamItemFull>();
    const reconciled = merged.map((it) => {
      const old = prevById.current.get(it.id);
      const keep = old && sameStreamItem(old, it) ? old : it;
      next.set(it.id, keep);
      return keep;
    });
    prevById.current = next;
    return reconciled;
  }, [merged]);

  // v3.13 — 버퍼 앞쪽 절단(상한 초과 시 오래된 이벤트 일괄 제거)을 virtuoso 에 shift 로 신고. 이게 없으면
  //   인덱스 기반 sizeTree/offsetTree 가 절단마다 통째로 밀려 측정 모델이 붕괴 → pin/followOutput/restoreState
  //   가 전부 틀린 좌표로 계산돼 긴 세션에서 화면이 "위로 말려 올라갔다"(새 이벤트 유입 = 절단 시점).
  const firstItemIndex = useVirtuosoFrontShift(items, streamItemId);

  const thinkingLabel = t('ide.streamRenderer.thinking');
  // IDE 본문 텍스트 줌 — 각 항목 래퍼에 zoom 적용(아래 renderStreamItem). 변경 시 itemContent 정체성이
  //   바뀌어 Virtuoso 가 전 항목을 재측정 → 새 배율로 정착(줌 조작은 드물어 비용 무관).
  const ideTextZoom = useGraphStore((s) => s.ideTextZoom);
  const itemContent = useCallback(
    (_index: number, item: StreamItemFull) =>
      renderStreamItem(item, thinkingLabel, ideTextZoom, agentId ? { agentId, ...(subAgentId ? { subAgentId } : {}) } : undefined),
    [thinkingLabel, ideTextZoom, agentId, subAgentId],
  );

  // v2.99 — virtuoso 가 단독 소유한 내부 스크롤러 DOM. 북마크 이동의 "컨테이너 한정 스크롤" 이 이걸 쓴다
  //   (옛 외부 scrollParent 컨테이너 대체). scrollerRef 콜백에서 채워 부모에게도 그대로 올린다.
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    const node = el instanceof HTMLElement ? el : null;
    scrollerElRef.current = node;
    onScrollerRef?.(node);
  }, [onScrollerRef]);

  // §5.5 #17-7 — 북마크 이동: anchorId 인덱스로 가상 리스트를 스크롤(렌더 보장)한 뒤, 다음 프레임에
  //   컨테이너 한정 스크롤 + 항목 외곽선 플래시 + 텍스트 선택. anchorId 없거나 못 찾으면 텍스트 검색 폴백.
  const scrollToBookmark = useCallback((anchorId: string | undefined, text: string) => {
    const idx = anchorId ? items.findIndex((it) => it.id === anchorId) : -1;
    if (idx >= 0) virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' });
    window.setTimeout(() => {
      const cont = scrollerElRef.current;
      if (!cont) return;
      if (anchorId) {
        const el = findItemElement(cont, anchorId);
        if (el) {
          scrollElementIntoCenter(cont, el);
          flashElement(el);
          const range = findTextRangeInContainer(el, text);
          if (range) {
            const sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(range); }
          }
          return;
        }
      }
      const range = findTextRangeInContainer(cont, text);
      if (range) scrollRangeIntoCenter(cont, range);
    }, idx >= 0 ? 280 : 60);
  }, [items]);
  // 하단 상태바 점프: 명령 항목(cmd-${id})을 인덱스로 먼저 렌더(virtuoso)시킨 뒤, 다음 프레임에 컨테이너
  //   한정으로 상단(-16px) 정렬. 인덱스 스크롤을 빼면 미렌더 항목에서 querySelector 가 null → 안 올라간다.
  const scrollToCommand = useCallback((cmdId: string) => {
    const itemId = `cmd-${cmdId}`;
    const idx = items.findIndex((it) => it.id === itemId);
    if (idx >= 0) virtuosoRef.current?.scrollToIndex({ index: idx, align: 'start' });
    window.setTimeout(() => {
      const cont = scrollerElRef.current;
      if (!cont) return;
      const el = cont.querySelector<HTMLElement>(`[data-cmd-id="${itemId}"]`);
      if (!el) return;
      const containerRect = cont.getBoundingClientRect();
      const targetRect = el.getBoundingClientRect();
      cont.scrollTo({ top: cont.scrollTop + (targetRect.top - containerRect.top) - 16, behavior: 'smooth' });
    }, idx >= 0 ? 280 : 0);
  }, [items]);
  const getState = useCallback((cb: (snap: StateSnapshot) => void) => {
    virtuosoRef.current?.getState(cb);
  }, []);
  const searchMatchIds = useCallback((query: string): string[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const ids: string[] = [];
    for (const it of items) {
      if (itemSearchText(it).toLowerCase().includes(q)) ids.push(it.id);
    }
    return ids;
  }, [items]);
  useImperativeHandle(ref, () => ({ scrollToBookmark, scrollToCommand, getState, searchMatchIds }), [scrollToBookmark, scrollToCommand, getState, searchMatchIds]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-500">{t('ide.streamRenderer.noActivity')}</p>
      </div>
    );
  }

  // v2.99 — Virtuoso 가 height:100% 로 자기 스크롤러를 단독 소유(외부 customScrollParent 공유 폐기).
  //   v3.14 — 바닥 추종 집행은 부모(IDEMainArea)의 DOM 워치독 단일 권한(followOutput 위임 제거 —
  //   모델 좌표 역주행 차단). atBottomStateChange 로 추종 의도 통지, restoreStateFrom 으로 세션 복원.
  return (
    <Virtuoso
      ref={virtuosoRef}
      className="scrollbar-thin"
      style={{ height: '100%' }}
      scrollerRef={handleScrollerRef}
      data={items}
      // v3.13 — 앞쪽 절단 누적 수. virtuoso 가 공식 shift 경로로 sizeTree 키 재정렬 + scrollTop 보정.
      firstItemIndex={firstItemIndex}
      computeItemKey={(_i, item) => item.id}
      itemContent={itemContent}
      // v3.17 — 마지막 줄과 하단 입력부 사이 여백(리스트 일부라 바닥 접착에 포함).
      components={{ Footer: StreamEndGap }}
      atBottomStateChange={onAtBottomChange}
      atBottomThreshold={40}
      // 복원 스냅샷이 있으면 그 위치/측정값으로, 없으면(첫 진입) 마지막 항목(바닥)에서 시작 — 둘은 배타.
      {...(restoreState
        ? { restoreStateFrom: restoreState }
        : { initialTopMostItemIndex: { index: 'LAST' as const, align: 'end' as const } })}
      // A: 뷰포트 밖 선렌더 버퍼 확대 — 중간 속도 스크롤에서 본문이 미리 준비돼 pop-in 이 줄어든다.
      increaseViewportBy={{ top: 1600, bottom: 2000 }}
      // B(제거): scrollSeek 자리표시자는 **스트리밍 중 떨림(발발 떨림)의 원인**이었다 — 바닥 자동추종(followOutput)
      //   이 매 토큰 바닥으로 순간 점프하면 그 속도가 enter 임계(800px/s)를 넘겨 자리표시자가 깜빡이고, 게다가
      //   마지막 항목이 **자라는 중**이라 추정 높이 ≠ 실제 높이 → 교체할 때마다 화면이 위아래로 튀었다. 빠른 휠
      //   스크롤에서도 같은 높이 불일치로 떨렸다. 자리표시자를 빼고 항상 실제 본문을 그려 떨림을 없앤다(빠른 드래그
      //   시 약간 무겁지만 안정성 우선).
    />
  );
}));
