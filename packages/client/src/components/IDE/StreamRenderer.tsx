/**
 * Sub 탭 전용 CLI 스타일 스트림 렌더러(Hook 에이전트 Agent 탭의 `TerminalLine` 과 별개). 파싱은 순수 모듈 `streamItems.ts`.
 * `IncrementalStreamParser` 는 새 이벤트만 처리한다(O(신규)) — 출력이 `buildBaseItems` 와 같음은 `streamItems.test.ts` 가 고정한다.
 */
import { memo, useState, useMemo, useRef, useCallback, useEffect, useContext, createContext, forwardRef, useImperativeHandle, Children, isValidElement } from 'react';
import { Virtuoso, type VirtuosoHandle, type StateSnapshot, type ListRange } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import { findTextRangeInContainer, scrollRangeIntoCenter, scrollElementIntoCenter, flashElement, findItemElement, markRange, highlightSearchMatches } from './bookmarkScroll.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { SubAgentStreamEvent, QueuedCommand, CommandError, AgentReport, AgentQuestions, AgentReview, AgentList, AskUserQuestionRequest } from '@vibisual/shared';
import { isStageBlockLang } from '@vibisual/shared';
import type { WorkspaceOpenPlan } from '@vibisual/shared';
import { SystemNode, parseSystemSubtype, parseSystemTaskInfo } from './SystemNode.js';
import { useAttachmentThumbs } from './attachmentThumb.js';
import { ThinkingLiveLine, StepTraceLine, WriteTraceLine } from './ThinkingIndicator.js';
import { AgentReportCard } from './AgentReportCard.js';
import { FeedbackButtons } from './FeedbackButtons.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useImageLightboxOrigin } from './imageLightboxOrigin.js';
import { StreamImageThumb } from './StreamImageThumb.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { AgentReviewCard } from './AgentReviewCard.js';
import { AgentListCard } from './AgentListCard.js';
import { AskQuestionCard } from './AskQuestionCard.js';
import { CollapsiblePrompt, AiSpeakerGlyph, type PromptCommandState } from './CollapsiblePrompt.js';
import { DiffView, type DiffReviewCtx } from './DiffView.js';
import { followSessionKey } from './editorFollow.js';
import { PlanBlock } from './PlanBlock.js';
import { parseEditToolInput, editSizeLines } from './diffTool.js';
import { editorFileFromAbsPath } from './editorModel.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { useIDEPaneActions } from './idePane.js';
import { parseStreamPathCandidate } from './streamPathLinks.js';
import { parseLinkHrefCandidate, isWebLinkHref, streamUrlTransform, withLinkLabelLines } from './streamLinkHref.js';
import { formatLineRef, type EditorLineRange } from './editorLineRange.js';
import { usePathLinkRails, useWebLinkRails } from './usePathLinkRails.js';
import type { MenuText } from './editorContextMenu.js';
import { getInternalApp } from '../../apps/registry.js';
import { toolPreview } from './toolPreview.js';
import {
  mergeCardsIntoItems, IncrementalStreamParser,
  type StreamText, type StreamGroup, type StreamSystem, type StreamResult, type StreamError, type StreamImage,
  type StreamCommand, type StreamItemFull, type StreamStep, type StreamTurnStop,
} from './streamItems.js';
import { shouldTraceWriting, toolGroupElapsedMs, toolSpanTimestamps, toolCallElapsedMs } from './turnSteps.js';
import { thinkTraceText, writeTraceText, toolElapsedText, toolCallElapsedText } from './stepTraceText.js';
import { formatStreamClock, type StreamClock } from './promptStamp.js';
import { parseStreamErrorContent } from './commandError.js';
import { CommandErrorNotice } from './CommandErrorNotice.js';
import { TransportRecoveryLine } from './TransportRecoveryLine.js';
import { ProcessGuardLine } from './ProcessGuardLine.js';
import { parseProcessGuardNotice } from '@vibisual/shared';
import {
  applyStreamDensity, sameDisplayItem, displayItemId, speechRunPositions, NO_SPEECH_RUNS,
  type StreamDisplayItem, type StreamToolGroup, type SpeechRunPos,
} from './streamDensity.js';
import { useStreamToggle, streamToggleProps } from './streamToggle.js';
import { streamItemFindText, findTextMatches } from './streamSearch.js';
import {
  STREAM_DIFF_AUTO_EXPAND_MAX_LINES,
  isReadOnlyHookAgent,
  type StreamDensity,
} from '@vibisual/shared';
import { useVirtuosoFrontShift } from './frontShift.js';
import { lastPassedIndex, owningCommandId } from './streamViewedCommand.js';
import { measureViewportItems, probePromptPlace, samePromptOutline, settleItemAtTop, PROMPT_JUMP_TOP_GAP, type PromptProbe, type PromptRailEntry } from './promptRail.js';
import { olderHistoryBoundary, reachesHistoryBoundary, requestOlderStreamHistory } from './streamHistory.js';
import { readingItemAttrs } from './reading/readingModel.js';

// ─── 타입 ───

interface StreamRendererProps {
  events: SubAgentStreamEvent[];
  /** 완료된 명령 (스트림 없을 때 폴백 표시용) */
  commands?: readonly QueuedCommand[];
  /** §4 — 피드백 컨텍스트: 이 스트림의 소유 에이전트. 있으면 result 블록에 좋아요/싫어요. */
  agentId?: string;
  /** §4 — 피드백 컨텍스트: 이 스트림의 세션(탭) ID. */
  subAgentId?: string;
  /** §2.4 — 지금 작동 중인가(도는 중 ∪ 줄 서 있음). 부모가 `hasSessionWork` 로 원본 큐 위에서 낸 답 — `commands` 는 화면용 사본이라 생존 판정에 쓰지 않는다(없으면 추정). */
  sessionBusy?: boolean;
  /** §5.5 #17-18 ⑪ — 줄만 서 있는가: `sessionBusy` 가운데 도는 것이 없는 경우. */
  sessionWaiting?: boolean;
  /** §2.4 (무응답) — 마지막으로 움직인 시각(명령 시작 포함). 라이브 1줄은 이것과 마지막 줄 중 늦은 쪽을 잰다 — 조용한 압축 뒤 새 명령이 앞 턴 끝부터 재지 않게. */
  sessionActivityAt?: number | null;
  /** §5.3 #9-1 (P) — 감춘 턴(조용한 사전 압축)이 도는 중. 라이브 줄은 경과만 적고 무응답으로 안 뒤집는다. */
  sessionActivityHidden?: boolean;
  /** §5.5 #17-10 ⑥-6 — 지금 턴(대기면 줄 선) 시작 시각(메인 탭과 같은 값). 평소 경과는 여기서부터 — 활동 시각으로 재면 줄마다 0 으로 되감긴다. */
  sessionTurnStartedAt?: number | null;
  /** §5.5 #17-24 ⑥ — CLI 가 이 세션을 접기 시작한 시각(메인 탭과 같은 값). 있으면 라이브 1줄이 `압축 중` 이 되고 무응답으로 뒤집지 않는다. */
  sessionCompactingSince?: number | null;
  /** §4 — 이 세션의 작업 신고. createdAt 기준 인라인 합류(맨 아래 고정 ❌). */
  reports?: AgentReport[];
  /** §4 — 이 세션의 질문 카드(턴 끝에 합류). */
  questions?: AgentQuestions[];
  /** §4 — 이 세션의 검수 요청 카드(턴 끝에 합류). */
  reviews?: AgentReview[];
  /** §4 — 이 세션의 번호 목록 정렬 카드(턴 끝에 합류). */
  lists?: AgentList[];
  /** §5.3 #12-2 — pending AskUserQuestion 카드. 가상 리스트 안으로 합류시킨다 — 밖 형제로 그리면 마지막 항목 측정이 늦을 때 그 위에 겹친다. */
  askRequests?: AskUserQuestionRequest[];
  /** Virtuoso 가 단독 소유한 스크롤러 DOM 을 부모에 올린다 — StreamStatusBar·북마크 이동·Select All 이 이 컨테이너 한정으로 돈다. */
  onScrollerRef?: (el: HTMLElement | null) => void;
  /** 세션 전환 복원 스냅샷(떠날 때 `getState` 로 뜬 항목 높이 + 스크롤 위치) — `restoreStateFrom` 으로 재측정 출렁임 없이 복원. */
  restoreState?: StateSnapshot;
  /** virtuoso `atBottomStateChange` 그대로 — 부모가 세션별 추종 의도·StreamStatusBar 판정에 쓴다. */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** §5.5 #17-48 — 입력 레일이 그릴 입력 목록(위→아래). 목록이 실제로 바뀔 때만 부른다(토큰마다 부모를 다시 그리지 않게). */
  onPromptOutline?: (prompts: readonly PromptRailEntry[]) => void;
}

/** §5.5 #17-7 — 북마크 "이동" 시 부모(IDEMainArea)가 호출하는 명령형 핸들. */
export interface StreamRendererHandle {
  /** 출처 항목(anchorId)으로 가상 리스트를 스크롤하고 그 항목/텍스트를 하이라이트.
   *  `preserveFocus` 는 인-페이지 검색용 — 텍스트를 selection 대신 CSS 하이라이트로 칠해
   *  포커스를 쥔 검색 입력창의 caret 을 건드리지 않는다(기본 false = 북마크 이동, 종전대로 선택). */
  scrollToBookmark: (anchorId: string | undefined, text: string, preserveFocus?: boolean) => void;
  /** "프롬프트로 이동" — virtuoso 는 화면 밖 항목을 그리지 않으므로 scrollToIndex 로 먼저 렌더시킨 뒤 컨테이너 한정 상단 정렬(-16px). querySelector 만으로는 실패한다. */
  scrollToCommand: (cmdId: string) => void;
  /** 인-페이지 검색 — query 를 포함하는 항목들의 id 를 등장 순서로 반환. 네비게이션/하이라이트는
   *  scrollToBookmark(id, query) 재사용(가상 리스트라 DOM 검색 불가 → 항목 데이터 기준 매칭). */
  searchMatchIds: (query: string) => string[];
  /**
   * §5.5 #17-12 — 화면 맨 위 항목이 속한 명령(`cmd-${id}`). 맨 위 항목만 DOM 으로 재고 명령은 항목 배열로 되짚는다(`streamViewedCommand.ts`) —
   * DOM 에서 명령 블록을 찾으면 긴 턴 사이엔 블록이 렌더되지 않아 상태바가 옛 프롬프트에 머문다.
   */
  viewedCommandId: () => string | null;
  /** 세션을 떠날 때 부모가 가져가 저장하는 스냅샷(복귀 때 restoreState). */
  getState: (cb: (snap: StateSnapshot) => void) => void;
  /** §5.5 #17-12 — 밀도를 바꾼 뒤 보던 항목을 되찾는 손잡이. 선렌더 버퍼 밖이면 DOM 에 없어 부모가 순번으로 먼저 옮긴다. 없으면 -1. */
  indexOfItemId: (id: string) => number;
  /** 자료 순번 `index` 의 항목 윗변을 스크롤러 윗변에서 `offsetPx` 아래에 둔다. */
  scrollToItemIndex: (index: number, offsetPx: number) => void;
  /**
   * §5.5 #17-48 — 입력 레일이 묻는 지금 자리(맨 위 항목의 입력 · 그 말풍선에 서 있나 · 화면 안 마지막 입력 · 바닥인가).
   * `viewedCommandId` 와 같은 측정이라 상태바와 레일이 같은 턴을 가리킨다. 잴 것이 없으면(래퍼 없음·어긋난 프레임) `null`.
   */
  promptProbe: () => PromptProbe | null;
  /** §5.5 #17-48 — 항목 하나(내 입력 말풍선)를 화면 위에서 16px 아래로 **즉시** 옮기고 짧게 빛낸다. */
  jumpToItem: (itemId: string) => void;
  /** §5.5 #17-48 — 목록 맨 위(첫 항목)로 즉시. 거기가 복원 창의 윗끝이면 그 앞 과거를 불러온다. */
  jumpToTop: () => void;
}

// ─── 마크다운 커스텀 렌더러 ───

/**
 * §5.5 #17-27 ⑬ — 지금 `<code>` 가 코드 블록 안인가(경로 손잡이는 인라인 코드만, 블록은 복사 버튼 몫). react-markdown 은 v9 부터 `inline` 플래그가 없어
 * `CodeBlock` 이 이 컨텍스트로 알린다 — `className` 유무 추정은 인덴트 블록에서 틀린다.
 */
const InCodeBlock = createContext(false);

/** 펜스드/인덴트 코드 블록 — 우상단 호버 시 복사 버튼.
 *  react-markdown 의 `pre` 슬롯 교체. 내부 `<code>` 는 그대로 children 으로 받는다.
 *  텍스트 추출은 ref 의 `textContent` 로 — 중첩 syntax 토큰까지 한 번에 잡힌다. */
/** §5.5 #17-17 ⑪(l) — 펜스 언어 이름. react-markdown 은 언어를 안쪽 `<code>` 의 className 에 실어 `pre` 슬롯에선 자식을 한 겹 본다. */
function fencedLangOf(children: React.ReactNode): string | null {
  const first = Children.toArray(children)[0];
  if (!isValidElement(first)) return null;
  const className = (first.props as { className?: string }).className ?? '';
  return /language-([A-Za-z0-9_-]+)/u.exec(className)?.[1] ?? null;
}

function CodeBlock({ children, className, ...rest }: React.HTMLAttributes<HTMLPreElement>): React.JSX.Element | null {
  const { t } = useTranslation();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  // §5.5 #17-17 ⑪(o) — 무대 블록은 조용히 삼킨다(적용은 서버 `stageBlockIngest`, 입구는 목표 뷰 하나 ⑪(k)).
  // 갈림은 훅을 다 부른 뒤에 — 조건부 훅이면 코드 블록과 번갈아 오는 자리에서 상태가 어긋나 붙는다.
  const isStageBlock = useMemo(() => isStageBlockLang(fencedLangOf(children)), [children]);

  const onCopy = useCallback(() => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => { /* clipboard 권한 거부 — 조용히 무시 */ });
  }, []);

  if (isStageBlock) return null;

  return (
    // §5.5 읽기 설정 — 이 래퍼가 `.ide-md` 그리드의 직접 자식이므로(안쪽 <pre> 가 아니라) 탈출 표식도
    //   여기 붙는다. C·D 안에서 코드 블록만 읽기 칼럼 밖으로 나가는 지점.
    <div className="ide-breakout group/code relative">
      <InCodeBlock.Provider value={true}>
        {/* 터치에서는 복사 단추가 늘 떠 있다 — 오른쪽 안쪽 여백을 그만큼 비워, 첫 줄 끝이 단추 밑에 깔려도
            가로로 밀면 단추 옆까지 나오게 한다(넘치는 줄의 끝은 이 여백 앞에서 멈춘다). */}
        <pre ref={preRef} {...rest} className={`${className ?? ''} pointer-coarse:pr-12`}>{children}</pre>
      </InCodeBlock.Provider>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        aria-label={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        // 터치에는 hover 가 없다 — 늘 보이고 손가락 크기로 키운다.
        className={`absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[12px] font-medium transition-opacity pointer-coarse:p-2.5 ${
          copied
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 opacity-100'
            : 'border-white/10 bg-gray-900/70 text-gray-300 opacity-0 group-hover/code:opacity-100 hover:border-white/20 hover:bg-gray-800/80 hover:text-gray-100 focus:opacity-100 pointer-coarse:opacity-100'
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

/** §7.11 — 이 스트림이 누구의 화면인지. 본문 링크를 눌렀을 때 **그 에이전트에** 프리뷰를 매달려면
 *  링크 컴포넌트까지 agentId 가 닿아야 하는데, 마크다운 컴포넌트 표(`mdComponents`)는 모듈 상수라
 *  props 로는 못 내려간다(`InCodeBlock` 과 같은 규약). */
const StreamOwnerAgentId = createContext<string | undefined>(undefined);

/** ⑬ (f) — 손잡이 앞 글리프: 어디서 열리는지를 그림 하나로(인라인 코드·링크 공용). `plan === null` 은 루트 밖(⑬ (d)). */
const PathLinkGlyph = memo(function PathLinkGlyph({ plan }: { plan: WorkspaceOpenPlan | null }): React.JSX.Element {
  const app = plan?.action === 'app' && plan.appId !== undefined ? getInternalApp(plan.appId) : undefined;

  if (plan === null) {
    // 루트 밖은 갈래가 하나라 아이콘도 하나 — 폴더에서 나가는 화살표(우리 창이 아니라 탐색기에서 열린다)
    return (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2v2" />
        <path d="M5 19a2 2 0 0 1-2-2V7" />
        <path d="M14 19h7v-7" />
        <path d="M21 12l-7 7" />
      </svg>
    );
  }
  if (plan.action === 'run') {
    // run — 재생 삼각형(누르면 열리는 것이 아니라 **돈다**는 뜻)
    return (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 4l14 8-14 8z" />
      </svg>
    );
  }
  if (plan.action === 'app' && app) {
    // 내부 앱 — **그 앱의 아이콘**을 그대로 쓴다(코어가 앱마다 그림을 들지 않는다, §5.13 (P)).
    //   앱 아이콘은 목록용 치수(h-4)라 인라인 글자 옆에서는 크다 — 이 자리에서만 줄인다.
    return (
      <span className="mr-[3px] inline-flex align-[-0.15em] opacity-80 [&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">
        <app.icon />
      </span>
    );
  }
  if (plan.action === 'external') {
    // external — 상자 밖으로 나가는 화살표(우리 창이 아니라 바깥에서 열린다)
    return (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
      </svg>
    );
  }
  if (plan.action === 'folder') {
    // folder
    return (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    );
  }
  // file — 모서리 접힌 문서(편집창·그림·PDF 는 전부 우리 창에서 열린다)
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
});

/** ⑬ (f) — 툴팁은 "전체 경로 + 벌어질 일"(여는 곳이 갈리면 말도 갈린다). ⑬ (g) — 줄 범위가 있으면 경로 뒤에 `:806-807` 까지 적는다. */
function pathLinkTitle(plan: WorkspaceOpenPlan, absPath: string, t: MenuText, lines: EditorLineRange | null): string {
  const app = plan.action === 'app' && plan.appId !== undefined ? getInternalApp(plan.appId) : undefined;
  switch (plan.action) {
    case 'run':
      return t('ide.streamRenderer.pathLink.runProgram', { path: absPath });
    case 'app':
      return t('ide.streamRenderer.pathLink.openApp', { app: app?.name ?? plan.appId, path: absPath });
    case 'external':
      return t('ide.streamRenderer.pathLink.openExternal', { path: absPath });
    case 'folder':
      return t('ide.streamRenderer.pathLink.openFolder', { path: absPath });
    default:
      // 줄은 텍스트 편집창에서만 뜻이 있다(그림·PDF 는 줄을 버린다 — `openWorkspaceTarget` 과 같은 판정).
      return t('ide.streamRenderer.pathLink.openFile', { path: plan.action === 'editor' ? formatLineRef(absPath, lines) : absPath });
  }
}

/** ⑬ (f) — 루트 **밖** 툴팁. 파일이면 그 파일이 **든 폴더**가 열린다는 것까지 누르기 전에 말한다 —
 *  문서가 열릴 것으로 기대하고 눌렀다가 탐색기가 뜨면 그건 고장으로 읽힌다. */
function outsidePathLinkTitle(kind: string, absPath: string, t: MenuText): string {
  return kind === 'directory'
    ? t('ide.streamRenderer.pathLink.revealOutsideFolder', { path: absPath })
    : t('ide.streamRenderer.pathLink.revealOutsideFile', { path: absPath });
}

/**
 * 본문 링크(밑줄 + sky). §5.5 #17-27 ⑬ (k) — 목적지가 디스크 경로면 `MarkdownCode` 와 같은 훅·우클릭 메뉴로 연다 — `window.open` 이면
 * 오리진이 `file://`(§3.7)라 `file:///…` 가 `ALLOWED_EXTERNAL_SCHEMES` 밖이 되어 안 열린다. 웹·메일은 바깥 브라우저 + 내 기계 서버면 프리뷰 버블(§7.11).
 */
const MarkdownLink = memo(function MarkdownLink({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.JSX.Element {
  const { t } = useTranslation();
  const ownerAgentId = useContext(StreamOwnerAgentId);
  const rootPath = useIDEProjectRoot();

  // 훅은 `href` 가 있든 없든 **언제나 같은 순서로** 부른다(리액트 규칙). 웹 주소는 경로로 읽지 않으므로
  //   후보가 null 이 되어 아무것도 묻지 않는다 — 주소 하나에 판정 요청이 두 번 가지 않는다.
  // ⑬ (g) ③ — 목적지에 줄이 없으면 링크 글자(`X.h:806-807`)의 줄을 빌린다(이름이 같을 때만).
  const label = inlineCodeText(children);
  const candidate = useMemo(
    () => (!href || isWebLinkHref(href) ? null : withLinkLabelLines(parseLinkHrefCandidate(href, rootPath), label)),
    [href, rootPath, label],
  );
  const path = usePathLinkRails(candidate, rootPath);
  const web = useWebLinkRails(href ?? '', ownerAgentId);

  if (!href) return <span>{children}</span>;

  // 손잡이가 된 링크는 `<a href>` 가 아니라 버튼이다(`MarkdownCode` 와 같은 규약). 주소를 남겨 두면
  //   가운데 클릭이 `file://` 이동으로 새어 종전의 그 안내 띠를 다시 띄운다 — 주소 집어가기는 (j) 의
  //   [경로 복사]가 대신한다.
  if (path.linkedOutside) {
    const outsideTitle = outsidePathLinkTitle(path.linkedOutside.kind, path.linkedOutside.absPath, t);
    return (
      <>
        <button type="button" onClick={path.onReveal} onContextMenu={path.onContextMenu} title={outsideTitle} aria-label={outsideTitle} className="ide-path-link break-all">
          <PathLinkGlyph plan={null} />
          {children}
        </button>
        {path.menu}
      </>
    );
  }

  if (path.linked && path.plan) {
    const title = pathLinkTitle(path.plan, path.linked.absPath, t, candidate?.lines ?? null);
    return (
      <>
        <button type="button" onClick={path.onOpen} onContextMenu={path.onContextMenu} title={title} aria-label={title} className="ide-path-link break-all">
          <PathLinkGlyph plan={path.plan} />
          {children}
        </button>
        {path.menu}
      </>
    );
  }

  // 경로가 아니거나 디스크에 없는 주소 — 여는 동작은 종전 그대로, 우클릭만 링크 메뉴다((k) ④).
  return (
    <>
      <a
        href={href}
        onClick={(e) => { e.preventDefault(); web.open(); }}
        onContextMenu={web.onContextMenu}
        className="cursor-pointer break-all text-sky-400 underline decoration-sky-400/40 underline-offset-2 transition-colors hover:text-sky-300 hover:decoration-sky-300"
      >
        {children}
      </a>
      {web.menu}
    </>
  );
});

/** 인라인 코드의 children 에서 **글자 하나**를 꺼낸다. 강조·링크가 섞인 조각은 경로가 아니므로 null. */
function inlineCodeText(children: React.ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string') return children[0];
  return null;
}

/**
 * §5.5 #17-27 ⑬ — 본문의 경로 = 네 번째 여는 손잡이(파일 → 내장 편집창, 폴더 → 탐색기; 새 레일 ❌). 디스크에 실제로 있을 때만 링크다(⑬ (b)) —
 * `parseStreamPathCandidate` 를 통과한 후보만 서버에 묻고(경로당 한 번, 모듈 캐시) 그 전·없음이면 평범한 인라인 코드.
 */
const MarkdownCode = memo(function MarkdownCode({ children, ...rest }: React.HTMLAttributes<HTMLElement>): React.JSX.Element {
  const { t } = useTranslation();
  const inBlock = useContext(InCodeBlock);
  const rootPath = useIDEProjectRoot();

  const raw = inlineCodeText(children);
  const candidate = useMemo(
    () => (inBlock || raw === null ? null : parseStreamPathCandidate(raw, rootPath)),
    [inBlock, raw, rootPath],
  );
  // ⑬ (k) ③ — 판정·열기·우클릭 메뉴는 링크(`MarkdownLink`)와 **같은 훅 하나**를 쓴다. 두 자리가
  //   어긋나면 같은 파일이 적힌 모양(백틱이냐 링크냐)에 따라 다르게 열리는 화면이 된다.
  const { linked, linkedOutside, plan, onOpen, onReveal, onContextMenu, menu: pathMenu } = usePathLinkRails(candidate, rootPath);

  if (linkedOutside) {
    const outsideTitle = outsidePathLinkTitle(linkedOutside.kind, linkedOutside.absPath, t);
    return (
      <code {...rest}>
        <button type="button" onClick={onReveal} onContextMenu={onContextMenu} title={outsideTitle} aria-label={outsideTitle} className="ide-path-link">
          <PathLinkGlyph plan={null} />
          {children}
        </button>
        {pathMenu}
      </code>
    );
  }

  if (!linked || !plan) return <code {...rest}>{children}</code>;

  const title = pathLinkTitle(plan, linked.absPath, t, candidate?.lines ?? null);

  return (
    // 칩(배경·모노폰트)은 `<code>` 가 그대로 유지하고, 그 안의 버튼만 링크 색·밑줄을 얻는다 —
    // "코드처럼 보이던 그 조각이 이제 눌린다" 가 한눈에 읽히게(⑬ (f)).
    <code {...rest}>
      <button type="button" onClick={onOpen} onContextMenu={onContextMenu} title={title} aria-label={title} className="ide-path-link">
        <PathLinkGlyph plan={plan} />
        {children}
      </button>
      {pathMenu}
    </code>
  );
});

/**
 * §5.5 #17-28 ⑧(d) — 마크다운 번호 목록을 표시 단계에서 정렬한다(에이전트에 `/api/agent-list` 규약 — 매 세션 529 토큰 — 을 싣지 않는다).
 * `AgentListCard` 와 같은 규칙(번호 열 고정폭·우측정렬·`tabular-nums` + 행잉 인덴트). `start` 존중, 중첩 목록도 이 컴포넌트를 탄다.
 */
const MarkdownOrderedList = memo(function MarkdownOrderedList(
  { children, start }: React.OlHTMLAttributes<HTMLOListElement>,
): React.JSX.Element {
  const items = Children.toArray(children).filter(isValidElement) as React.ReactElement<{ children?: React.ReactNode }>[];
  const first = typeof start === 'number' && Number.isFinite(start) ? start : 1;
  return (
    <ol className="my-1 space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="min-w-[1.5rem] flex-shrink-0 select-none text-right font-medium tabular-nums text-teal-300/70">
            {first + i}.
          </span>
          <span className="min-w-0 flex-1 break-words">{item.props.children}</span>
        </li>
      ))}
    </ol>
  );
});

/**
 * 마크다운 표 — 칸보다 넓으면 감싼 상자 안에서 가로 스크롤(표 자체는 `width:100%` 그대로 — `display:block` 이면 넓은 칸에서 표가 줄어든다).
 * 상자가 `.ide-md` 그리드의 직접 자식이라 `.ide-breakout` 표식도 여기 붙는다.
 */
function MarkdownTable({ children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>): React.JSX.Element {
  return (
    <div className="ide-breakout scrollbar-thin overflow-x-auto">
      <table {...rest}>{children}</table>
    </div>
  );
}

const mdComponents: Components = { pre: CodeBlock, a: MarkdownLink, code: MarkdownCode, ol: MarkdownOrderedList, table: MarkdownTable };

/** 앞쪽 절단 shift 셈용 안정 id 추출자 — 렌더 간 같은 참조여야 해서 모듈 상수(밀도 변환 뒤 표시 아이템을 받는다). */
const streamItemId = displayItemId;

/** §5.5 #17-12 · #17-48 — 내 입력(명령 말풍선) 항목인가. 상태바 추종과 입력 레일이 같은 술어를 쓴다. */
const isCommandItem = (it: StreamDisplayItem): boolean => it.kind === 'command';

/** 리스트 끝 여백(`STREAM_END_GAP_PX`, px) — virtuoso Footer 로 그려 리스트 일부가 되므로 바닥 접착과 맞는다. 스크롤러 padding 은 virtuoso 측정과 어긋나 금지. */
/** §5.5 #17-13 — 묶음 헤더에 보여줄 도구 이름 칩 개수(초과분은 `+N`). */
const TOOL_GROUP_NAME_CHIPS = 3;

export const STREAM_END_GAP_PX = 28;
export function StreamEndGap(): React.JSX.Element {
  return <div style={{ height: STREAM_END_GAP_PX }} aria-hidden />;
}

/** remark-gfm — `[text](url)` 마크다운 링크뿐 아니라 본문에 그대로 박힌 `http(s)://…` bare URL 도
 *  자동으로 링크(autolink literal)로 만들어 MarkdownLink 가 받아 처리하게 한다. */
const remarkPlugins = [remarkGfm];

// ─── 개별 렌더러 ───

/** §5.5 #17-39 ⑫ — 그 일을 한 시각. 도구·묶음 머리줄·AI 글이 같은 조각이라 한 세로줄에 선다. 복사에 딸려 가지 않게 선택에서 뺀다. */
function StreamClockStamp({ clock }: { clock: StreamClock | null }): React.JSX.Element | null {
  if (!clock) return null;
  return (
    <time dateTime={clock.iso} title={clock.title} className="flex-shrink-0 select-none tabular-nums text-[12px] leading-4 text-gray-500">
      {clock.text}
    </time>
  );
}

/**
 * assistant 텍스트 → 박스 없는 본문 + 왼쪽 스파클 글리프(박스면 도구/생각 박스와 뒤섞인다).
 * §5.5 #17-49 — 어느 밀도에서도 본문을 접지 않는다(메인 탭 `TerminalTextLine` 과 같은 규칙).
 */
export const TextBlock = memo(function TextBlock({ item, density, run }: { item: StreamText; density: StreamDensity; run: SpeechRunPos }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  // §5.5 #17-39 ⑫ — 이 글이 온 시각. 간결의 연속 발화 런(#17-45)은 말머리가 선 첫 문단에만 —
  //   이어지는 문단마다 줄을 늘리면 런의 실선이 그 줄에서 끊긴다(그 줄은 말머리 칸 밖이다).
  const clock = run === 'solo' || run === 'head' ? formatStreamClock(item.timestamp, i18n.language) : null;
  // §5.5 #17-39 — 작성 자국. **긴 본문에만** 붙인다(짧은 대답 밑의 숫자는 소음이다).
  //   `간결` 은 핵심만 남기는 밀도라 자국도 붙이지 않는다(#17-21 과 같은 갈래).
  const writeTrace = density !== 'compact' && shouldTraceWriting(item.content.length)
    ? writeTraceText(t, i18n.language, (item.endedAt ?? item.timestamp) - item.timestamp, item.content.length)
    : null;
  return (
    // §5.5 #17-45 — 세로 여백은 본문 칸이 갖는다(바깥 상자 ❌) — 말머리 칸이 항목 높이를 채워야 런의 실선이 문단 사이에서 안 끊긴다.
    <div className="px-4 max-md:px-1.5">
      {/* §5.5 #17-39 ⑫ — VS Code 대화처럼 글 위 한 줄의 오른쪽 끝(말머리는 종전대로 첫 줄 옆).
          오른쪽 여백(pr-0.5 · 폰 pr-2)은 도구 머리줄 끝(mx-2 + px-2.5)에 맞춘 값 — 시각들이 한 세로줄에 선다. */}
      {clock && (
        <div className="flex justify-end pr-0.5 pt-1 max-md:pr-2">
          <StreamClockStamp clock={clock} />
        </div>
      )}
      <div className="flex gap-2">
        <AiSpeakerGlyph run={run} />
        <div className={`min-w-0 flex-1 ${run === 'mid' || run === 'tail' ? 'py-0.5' : 'py-1'}`}>
          <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-pre:my-2 prose-headings:text-gray-100 prose-headings:text-[15px] prose-li:my-1 prose-strong:text-gray-100">
            <Markdown remarkPlugins={remarkPlugins} urlTransform={streamUrlTransform} components={mdComponents}>{item.content}</Markdown>
          </div>
          {writeTrace && <WriteTraceLine text={writeTrace} />}
        </div>
      </div>
    </div>
  );
});

/** tool_use + tool_result 접이식 그룹 */
const ToolBlock = memo(function ToolBlock({ item, density, review }: {
  item: StreamGroup;
  density: StreamDensity;
  /** §5.5 #17-30 — 이 스트림이 속한 세션(코멘트를 담을 자리). 없으면 코멘트 손잡이는 뜨지 않는다. */
  review?: DiffReviewCtx | undefined;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  // §5.5 #17-27 — 헤더에 적힌 파일명이 곧 여는 손잡이다(앱 안 편집창 — 밖 편집기는 diff 우측 연필 그대로).
  const rootPath = useIDEProjectRoot();
  const { openEditorFile: openInEditor } = useIDEPaneActions();
  // Edit 계열이면 "이전 vs 이후" diff 로 렌더.
  const parsedEdit = useMemo(() => parseEditToolInput(item.toolName, item.input), [item.toolName, item.input]);
  // §5.5 #17-12 — 종전엔 Edit 이면 무조건 기본 펼침이라 긴 diff 가 화면을 통째로 먹었다. 이제 **짧은 편집만**
  //   자동으로 펼치고(비교가 곧 결과), 임계를 넘으면 접힌 채 줄 수만 알린다. 간결 밀도에서는 항상 접힘.
  const editLines = useMemo(() => (parsedEdit ? editSizeLines(parsedEdit) : 0), [parsedEdit]);
  // §5.5 #17-30 — 이 파일에 아직 보내지 않은 리뷰 코멘트가 있으면 **접힘 대상에서 뺀다**.
  //   접혀 버리면 사용자가 적어 둔 문장이 사라진 것처럼 보인다(불리언만 구독 — 목록 참조 ❌).
  const hasReviewComments = useGraphStore((s) => {
    if (!review || !parsedEdit) return false;
    const list = s.diffComments[review.sessionKey];
    return list !== undefined && list.some((c) => c.filePath === parsedEdit.filePath);
  });
  const autoOpen = parsedEdit !== null
    && (hasReviewComments || (density !== 'compact' && editLines <= STREAM_DIFF_AUTO_EXPAND_MAX_LINES));
  // §5.5 #17-16 ④ — 펼침은 컴포넌트 밖(모듈 저장소)에 산다: 가상 리스트가 언마운트해도 펼쳐 둔 채 돌아온다.
  const [open, toggleOpen] = useStreamToggle(item.id, autoOpen);

  const accentColor = item.isActive ? 'border-blue-500/70' : 'border-amber-500/40';
  const headerBg = item.isActive ? 'bg-blue-500/5 hover:bg-blue-500/10' : 'bg-gray-800/30 hover:bg-gray-800/60';

  // diff 헤더용 파일명(경로 마지막 조각) + 생성/수정 라벨.
  const fileName = useMemo(() => {
    if (!parsedEdit) return '';
    const parts = parsedEdit.filePath.split(/[/\\]/);
    return parts[parts.length - 1] || parsedEdit.filePath;
  }, [parsedEdit]);
  const modeLabel = parsedEdit?.mode === 'create'
    ? t('ide.streamRenderer.diff.created')
    : t('ide.streamRenderer.diff.modified');

  // §5.5 #17-13 — input 미리보기는 공용 순수 함수로(원본 JSON·`cd <절대경로> &&` 노출 제거).
  const preview = useMemo(() => toolPreview(item.input), [item.input]);

  // §5.5 #17-39 ⑪ — 이 도구가 쓴 시간(호출 → 결과 도착). **진행 중에는 재지 않는다** — 끝을 모르는 채로
  //   적으면 매 틱 숫자가 바뀌며 머리줄이 깜빡인다(묶음 머리줄과 같은 규율). 결과가 없으면 아무것도 안 붙인다.
  const elapsed = item.isActive ? '' : toolCallElapsedText(t, toolCallElapsedMs(item.timestamp, item.endedAt));
  // §5.5 #17-39 ⑫ — 이 도구를 쓴 시각(호출이 나간 시각). 시각은 자라지 않으므로 진행 중에도 적는다.
  const clock = formatStreamClock(item.timestamp, i18n.language);

  const handleOpenFile = useCallback((e: React.MouseEvent): void => {
    // 헤더 전체는 펼치기/접기라, 파일명 클릭만 따로 떼어 낸다.
    e.stopPropagation();
    if (parsedEdit?.filePath) openInEditor(editorFileFromAbsPath(parsedEdit.filePath, rootPath));
  }, [parsedEdit, rootPath, openInEditor]);

  return (
    <div className={`mx-2 my-1 overflow-hidden rounded-md border-l-2 max-md:mx-1 ${accentColor} transition-colors`}>
      {/* 헤더 — 파일명이 자체 버튼이라 이 줄은 button 이 아니라 role=button 이다(버튼 중첩 ❌). */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOpen(); }
        }}
        {...streamToggleProps(open)}
        className={`group/hdr flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${headerBg}`}
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
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[12px] font-bold text-amber-400/90">
          {item.toolName}
        </span>

        {/* §5.5 #17-39 ⑪ — 이 도구가 쓴 시간. 묶음 머리줄의 `×N` 뒤 경과와 같은 자리·같은 모양(이름 바로 뒤). */}
        {elapsed && <span className="flex-shrink-0 tabular-nums text-[12px] text-gray-600">{elapsed}</span>}

        {/* 미리보기 — Edit 계열은 펼침 여부와 무관하게 파일명 + 생성/수정 라벨을 항상 표시. */}
        {parsedEdit ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenFile}
              title={t('ide.editor.openInPane', { path: parsedEdit.filePath })}
              className="min-w-0 truncate font-mono text-[12px] text-gray-300 underline-offset-2 transition-colors hover:text-blue-300 hover:underline"
            >
              {fileName}
            </button>
            <span className={`flex-shrink-0 rounded px-1 py-0.5 text-[12px] font-semibold ${
              parsedEdit.mode === 'create' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
            }`}>{modeLabel}</span>
            {/* 접혀 있을 땐 "몇 줄짜리 편집인지"만 알린다(펼침 여부를 사용자가 판단할 재료). */}
            {!open && editLines > 0 && (
              <span className="flex-shrink-0 tabular-nums text-[12px] text-gray-500">
                {t('ide.streamRenderer.diffLines', { count: editLines })}
              </span>
            )}
          </span>
        ) : (!open && preview && (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-400">
            {preview}
          </span>
        ))}

        {/* 스피너 or hover 힌트 + §5.5 #17-39 ⑫ 시각 — `ml-auto` 로 늘 오른쪽 끝에 붙는다(종전엔 펼친 비-Edit
            상자에서 이 칸이 이름 바로 옆에 붙었다). 맨 끝이 시각이라 힌트가 떠도 시각 자리는 움직이지 않는다. */}
        <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
          {item.isActive && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
          )}
          <span className="hidden text-[12px] text-gray-500 group-hover/hdr:inline">
            {open ? t('ide.streamRenderer.collapse') : t('ide.streamRenderer.expand')}
          </span>
          <StreamClockStamp clock={clock} />
        </div>
      </div>

      {/* 펼친 내용 — Edit 계열은 side-by-side diff, 그 외는 raw input/output. */}
      {open && parsedEdit && (
        <div className="border-t border-gray-800/60 bg-gray-950/50 px-2 py-2">
          <DiffView parsed={parsedEdit} review={review} />
        </div>
      )}
      {open && !parsedEdit && (
        <div className="border-t border-gray-800/60 bg-gray-950/50 px-3 py-2">
          {item.input && (
            <div className="mb-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-gray-400">{t('ide.streamRenderer.input')}</span>
              <pre className="scrollbar-thin mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2.5 font-mono text-[13px] leading-relaxed text-gray-200">
                {item.input}
              </pre>
            </div>
          )}
          {item.output && (
            <div>
              <span className="text-[12px] font-semibold uppercase tracking-wide text-gray-400">{t('ide.streamRenderer.output')}</span>
              <pre className="scrollbar-thin mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2.5 font-mono text-[13px] leading-relaxed text-gray-300">
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

/** §5.5 #17-16 — 접힌 묶음의 최근 도구 한 줄. 진행/완료가 같은 높이라 도구가 바뀌어도 스크롤이 튀지 않는다. */
function ToolGroupLatestLine({ item }: { item: StreamGroup }): React.JSX.Element {
  const preview = toolPreview(item.input);
  return (
    // 이 줄은 항상 헤더 아래에 붙는다(§5.5 #17-24 ① 로 헤더 없는 `bare` 자리는 사라졌다).
    <div className="flex items-center gap-2 border-t border-gray-800/40 px-2.5 py-1">
      <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
        {item.isActive ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
        ) : (
          <svg className="h-3 w-3 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <span className={`flex-shrink-0 rounded px-1 py-0.5 text-[12px] font-semibold ${item.isActive ? 'bg-blue-500/15 text-blue-300' : 'bg-amber-500/10 text-amber-400/70'}`}>
        {item.toolName}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-500">{preview}</span>
    </div>
  );
}

/** §5.5 #17-12/#17-16 — 도구 실행 묶음(`명령 실행됨 ×N` + 접혀도 최근 도구 한 줄). 도구 1개부터 묶음이라 늘어도 상자가 교체되지 않는다. */
const ToolGroupBlock = memo(function ToolGroupBlock({ item, density }: { item: StreamToolGroup; density: StreamDensity }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  // §5.5 #17-39 ⑫ — 이 묶음을 시작한 시각(첫 도구). 펼치면 도구 상자마다 제 시각이 따로 선다.
  const clock = formatStreamClock(item.timestamp, i18n.language);
  const [open, toggleOpen] = useStreamToggle(item.id, false);
  const shownNames = item.toolNames.slice(0, TOOL_GROUP_NAME_CHIPS);
  const restNames = item.toolNames.length - shownNames.length;
  // 접혀 있을 때 보여줄 "가장 최근 도구" — 진행 중이면 그게 곧 지금 하는 일이다.
  const latest = useMemo(() => {
    for (let k = item.children.length - 1; k >= 0; k--) {
      const c = item.children[k]!;
      if (c.kind === 'tool') return c;
    }
    return null;
  }, [item.children]);

  // §5.5 #17-24 ① — 간결에는 도구 묶음이 **아예 도달하지 않는다**(진행 중이든 완료든 streamDensity 가
  //   배열에서 뺐다). 종전의 "진행 중 한 줄" 분기는 그 줄이 생겼다 사라지며 화면을 깜빡이게 해 없앴다.

  // §5.5 #17-39 — 이 묶음이 걸린 시간. **진행 중에는 재지 않는다** — 끝을 모르는 채로 적으면 매 틱 숫자가
  //   바뀌며 헤더가 깜빡인다(자라는 자국 ❌ 는 사고 자국과 같은 규율).
  //   ⑪ — 도구 상자의 결과 도착 시각까지 폭에 넣는다(마지막 도구의 실행 시간이 빠지지 않게 — 메인 탭과 같은 폭).
  const elapsed = useMemo(
    () => (item.active ? '' : toolElapsedText(t, toolGroupElapsedMs(toolSpanTimestamps(item.children)))),
    [item.active, item.children, t],
  );

  return (
    <div className={`mx-2 my-1 overflow-hidden rounded-md border-l-2 max-md:mx-1 ${item.active ? 'border-blue-500/70' : 'border-gray-700'}`}>
      <button
        type="button"
        onClick={toggleOpen}
        {...streamToggleProps(open)}
        title={open ? t('ide.streamRenderer.clickToCollapse') : t('ide.streamRenderer.clickToExpand')}
        className="group/hdr flex w-full items-center gap-2 bg-gray-800/20 px-2.5 py-1 text-left transition-colors hover:bg-gray-800/50"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <svg className={`h-2.5 w-2.5 text-gray-600 transition-transform group-hover/hdr:text-gray-400 ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        {/* 터미널 글리프 + "명령 실행됨 ×N" — 사용자는 도구 이름·인자를 몰라도 된다. 볼 사람만 펼친다. */}
        <span className="flex-shrink-0 text-gray-500">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="m7 9 3 3-3 3M13 15h4" />
          </svg>
        </span>
        <span className="flex-shrink-0 text-[12px] text-gray-400">{t('ide.streamRenderer.activity')}</span>
        <span className="flex-shrink-0 tabular-nums text-[12px] text-gray-500">
          {t('ide.streamRenderer.toolRun', { count: item.toolCount })}
        </span>
        {/* §5.5 #17-39 — 이 묶음이 걸린 시간. 잴 수 없으면(호출 하나) 아무것도 붙이지 않는다. */}
        {elapsed && <span className="flex-shrink-0 tabular-nums text-[12px] text-gray-600">{elapsed}</span>}
        <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {shownNames.map((name) => (
            <span key={name} className="flex-shrink-0 rounded bg-gray-700/40 px-1 py-0.5 text-[12px] font-medium text-gray-500">
              {name}
            </span>
          ))}
          {restNames > 0 && <span className="flex-shrink-0 text-[12px] text-gray-600">+{restNames}</span>}
        </span>
        {/* §5.5 #17-39 ⑫ — 오른쪽 끝 시각(이름 칩 칸이 flex-1 이라 늘 맨 끝에 선다). */}
        <StreamClockStamp clock={clock} />
      </button>
      {/* 접혀 있어도 최근 도구 한 줄은 항상 — 활성이든 완료든 같은 높이라 스트리밍 중 화면이 안 움직인다. */}
      {!open && latest && <ToolGroupLatestLine item={latest} />}
      {open && (
        <div className="border-t border-gray-800/60 bg-gray-950/30 py-0.5">
          {item.children.map((child) => (
            child.kind === 'tool'
              ? <ToolBlock key={child.id} item={child} density={density} />
              : child.kind === 'system'
                ? <SystemLine key={child.id} item={child} />
                : <div key={child.id} />
          ))}
        </div>
      )}
    </div>
  );
});

/** system 메시지 — SDK subtype([task_started] 등)은 깔끔한 칩, 그 외 임의 본문은 텍스트 폴백 */
function SystemLine({ item, density }: { item: StreamSystem; density?: StreamDensity }): React.JSX.Element {
  if (item.transportRecovery) return <TransportRecoveryLine recovery={item.transportRecovery} content={item.content} />;
  // §5.3 #9-2 — 메모리 보호가 프로세스를 멈춘 사실. 칩이 아니라 본문이라 어느 밀도에서도 남는다.
  const guard = parseProcessGuardNotice(item.content);
  if (guard) return <ProcessGuardLine notice={guard} content={item.content} />;
  const subtype = parseSystemSubtype(item.content);
  // §5.5 #17-13 ⑤-3 — 작업 칩이면 payload(이름·결과·소요 시간)를 함께 넘긴다(없으면 종전 모양).
  if (subtype) return <SystemNode subtype={subtype} task={parseSystemTaskInfo(item.content)} />;
  return (
    <div className="px-4 py-1 max-md:px-1.5">
      {/* §5.5 #17-21 ⑤ — 내용 있는 system 본문은 간결에서 한 줄로 자른다(내용을 지우진 않는다). */}
      <span className={`font-mono text-[12px] text-gray-400 ${density === 'compact' ? 'block truncate' : ''}`}>{item.content}</span>
    </div>
  );
}

/** §5.25 (O) — 엔진이 내건 그림 한 장. 메인 탭과 같은 `StreamImageThumb` 로 그리고 여기선 세션 좌표만 넘긴다. */
function ImageBlock({ item, ctx }: { item: StreamImage; ctx?: StreamFeedbackCtx }): React.JSX.Element {
  return (
    <div className="px-4 py-1.5 max-md:px-1.5">
      <StreamImageThumb
        agentId={ctx?.agentId}
        subAgentId={ctx?.subAgentId}
        eventId={item.id}
        name={item.content}
      />
    </div>
  );
}

/** §5.5 #17-12 ③ — 실패 사유 한 장: 왜 끝났는지 한 문장 + 원문(stderr 꼬리·CLI 본문)은 코드 폰트 그대로(번역 ❌ — 검색·대조가 안 된다). */
function ErrorLine({ item }: { item: StreamError }): React.JSX.Element {
  return <CommandErrorNotice error={parseStreamErrorContent(item.content)} className="mx-2 my-1 max-md:mx-1" />;
}

/** §5.5 #17-12 ③-6 (g) — 턴이 멈춘 이유 한 줄. 자기 항목으로 턴 꼬리에 선다 — `CommandBlock` 안이면 출력보다 위(명령 자리)에 뜬다. */
function TurnStopNotice({ item }: { item: StreamTurnStop }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mx-2 my-1 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-1.5 text-[12px] font-medium text-amber-300 max-md:mx-1 max-md:px-2.5">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /></svg>
      <span>{t(item.labelKey)}</span>
    </div>
  );
}

/** §4 — result 블록 피드백 컨텍스트. 없으면 버튼을 숨긴다. */
export interface StreamFeedbackCtx {
  agentId: string;
  subAgentId?: string;
}

/** 최종 결과 */
function ResultBlock({ item, feedbackCtx }: { item: StreamResult; feedbackCtx?: StreamFeedbackCtx }): React.JSX.Element {
  return (
    <div className="mx-2 my-1 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 max-md:mx-1 max-md:px-2.5">
      <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-strong:text-gray-100">
        <Markdown remarkPlugins={remarkPlugins} urlTransform={streamUrlTransform} components={mdComponents}>{item.content}</Markdown>
      </div>
      {/* §4 — 턴 완료 좋아요/싫어요(규칙 되먹임 재료). summary = 본문 앞부분. */}
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
function CommandBlock({ item, agentId }: { item: StreamCommand; agentId?: string }): React.JSX.Element {
  const { t } = useTranslation();
  const isError = item.status === 'error';
  // §5.5 #17-18 ⑤ — 말풍선이 상태(실행/대기 + 방식)를 색으로 말하고, 대기 중이면 [대기|합치기|즉시]·삭제가 말풍선 안에 붙는다.
  const commandState = useMemo<PromptCommandState>(() => ({
    status: (item.status === 'queued' || item.status === 'executing' || item.status === 'error' ? item.status : 'completed'),
    ...(item.dispatchMode ? { dispatchMode: item.dispatchMode } : {}),
    ...(agentId ? { agentId } : {}),
    ...(item.commandId ? { commandId: item.commandId } : {}),
  }), [item.status, item.dispatchMode, item.commandId, agentId]);
  // 첨부 이미지 썸네일 — blob preview 우선, 없으면 server 파일 라우트(별창·새로고침·재시작에도 보이게).
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const lightboxOrigin = useImageLightboxOrigin();
  const thumbs = useAttachmentThumbs(item.attachments);
  return (
    <div className="px-4 py-2 max-md:px-1.5" data-cmd-id={item.id}>
      {/* 프롬프트 — 사용자 입력은 길이와 무관하게 항상 "내 메시지" 말풍선으로. */}
      <CollapsiblePrompt prompt={item.prompt} command={commandState} submittedAt={item.submittedAt} />
      {/* 앱이 내려가 끊겼다가 보존된 세션으로 다시 이어 돌린 명령 — 그 사실을 말하지 않으면
          사용자에겐 "왜 처음부터 다시 하지?" 또는 "왜 멈춰 있지?" 로 보인다. */}
      {item.restartResumed && (
        <p className="mt-1 text-[12px] text-amber-300/90">{t('ide.streamRenderer.restartResumed')}</p>
      )}
      {/* §5.5 #17-18 — 합치기로 실린 덧말 수를 말한다(따로 보낸 말이 한 프롬프트인 이유). */}
      {(item.mergedCount ?? 0) > 0 && (
        <div className="mb-1.5 flex items-center gap-1 pl-5 text-[12px] text-gray-500">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4v6a5 5 0 0 0 5 5h5" />
            <polyline points="14 12 17 15 14 18" />
          </svg>
          {t('ide.mainArea.mergedNotice', { count: item.mergedCount ?? 0 })}
        </div>
      )}
      {/* 전송한 첨부 이미지 썸네일 (클릭 → 라이트박스) */}
      {thumbs.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-2 pl-5">
          {thumbs.map((a) => (
            <button
              key={a.basename}
              type="button"
              onClick={() => openImageLightbox(a.url, lightboxOrigin())}
              className="h-16 w-16 flex-shrink-0 overflow-hidden rounded border border-gray-700 bg-gray-800 transition-opacity hover:opacity-80"
            >
              <img src={a.url} alt="" className="h-full w-full cursor-zoom-in object-cover" />
            </button>
          ))}
        </div>
      )}
      {/* §5.5 #17-12 ③ — 그 턴의 오류 줄이 스트림에 없어(창 밖으로 밀렸거나 유실돼) 실패 사유를 실어 줄
          오류 항목이 없을 때의 표면. `error` 를 실어 보내는 쪽(buildCommandItems)이 **턴 단위**로 이미 걸러 두었다. */}
      {item.error && <CommandErrorNotice error={item.error} />}
      {/* §5.5 #17-12 ③-6 (g) — 왜 멈췄는지는 여기(내가 친 글 바로 아래)가 아니라 그 턴의 꼬리에서
          `TurnStopNotice` 가 말한다. 일어난 순서대로 읽히려면 마지막에 일어난 일이 마지막에 서야 한다. */}
      {/* 결과 — §5.5 #17-12 ③-3: 그 턴의 본문이 스트림에 남아 있으면 비어 오고(스트림이 그린다), 복원 창 밖으로
          밀려난 턴은 여기 저장된 마지막 AI 본문이 그 턴의 답이다. */}
      {item.result && (
        <div className={`rounded-md border px-3 py-2 ${
          isError ? 'border-red-500/20 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'
        }`}>
          <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed">
            <Markdown remarkPlugins={remarkPlugins} urlTransform={streamUrlTransform} components={mdComponents}>{item.result}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 렌더러 ───

/** §5.5 #17-24 ② — 라이브 1줄 라벨: 작업 중 · ⑤ 대기 · ⑥ 압축 중(생각 중은 없다 ⑦). */
interface LiveLabels { working: string; waiting: string; compacting: string }

/** §4 (스트림 3종 ①) — `--forward-subagent-text` 로 섞여 오는 자식(Task) 말을 세로선 + 갈래 표식으로 감싼다(안 감싸면 누구 말인지 사라진다). */
function NestedFrame({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="border-l-2 border-violet-400/40 pl-3">
      <div className="mb-1 flex items-center gap-1 text-[12px] text-violet-300/80">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M6 3v12" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M15 6H9a3 3 0 0 0-3 3v3" />
        </svg>
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

/** §5.5 #17-39 — 사고 자국 한 줄. `renderStreamItem` 이 컴포넌트가 아닌 함수라 여기서 `useTranslation` 을 부른다. */
const StepTraceBlock = memo(function StepTraceBlock({ item }: { item: StreamStep }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const text = thinkTraceText(t, i18n.language, item.endedAt - item.timestamp, item.chars);
  return <StepTraceLine text={text} />;
});

/** 단일 스트림 아이템 → 블록 엘리먼트. 북마크 이동 앵커용 `data-stream-item-id` 래퍼로 감싼다.
 *  zoom — IDE 본문 텍스트 줌 배율. **스크롤러(가상 리스트 뷰포트)가 아니라 각 항목 래퍼**에 걸어,
 *  Virtuoso 가 zoom 반영된 실제 항목 높이를 그대로 측정(가상화·스크롤 계산과 일관)하게 한다. */
function renderStreamItem(item: StreamDisplayItem, liveLabels: LiveLabels, zoom: number, density: StreamDensity, speechRuns: ReadonlyMap<string, SpeechRunPos>, nestedLabel: string, feedbackCtx?: StreamFeedbackCtx, reviewCtx?: DiffReviewCtx): React.JSX.Element {
  let inner: React.JSX.Element;
  switch (item.kind) {
    // §5.5 #17-49 — 본문은 어느 밀도에서도 통째로 보인다(간결의 본문 접기 폐기).
    // §5.5 #17-45 — 연달아 온 본문은 한 발화로 묶어 말머리를 첫 문단에만 단다(간결에서만 · 없으면 `solo`).
    case 'text':     inner = <TextBlock item={item} density={density} run={speechRuns.get(item.id) ?? 'solo'} />; break;
    case 'tool':     inner = <ToolBlock item={item} density={density} review={reviewCtx} />; break;
    case 'toolgroup': inner = <ToolGroupBlock item={item} density={density} />; break;
    case 'plan':     inner = <PlanBlock item={item} />; break;
    case 'result':   inner = <ResultBlock item={item} feedbackCtx={feedbackCtx} />; break;
    // §5.5 #17-12 ③ — 실패 사유는 어느 밀도에서도 접거나 묶지 않는다(읽어야 할 유일한 원인).
    case 'error':    inner = <ErrorLine item={item} />; break;
    case 'system':   inner = <SystemLine item={item} density={density} />; break;
    // §5.25 (O) — 엔진이 내건 그림. 밀도에 따라 접지 않는다 — 그림은 줄이면 아무 말도 못 한다.
    case 'image':    inner = <ImageBlock item={item} ctx={feedbackCtx} />; break;
    case 'command':  inner = <CommandBlock item={item} agentId={feedbackCtx?.agentId} />; break;
    // §5.5 #17-24 ② — 항목은 그대로 두고 라벨·색만 바꾼다(작업 중 ↔ 대기 ↔ 압축 중 — ⑦ 이후 생각 중은 없다).
    // §2.4 (무응답) — 마지막 이벤트 시각을 함께 넘겨 "얼마나 조용한지"를 그 줄이 직접 판정하게 한다.
    // §5.5 #17-10 ⑥-6 — 평소 적는 경과는 턴 시작부터다(줄이 와도 되감기지 않는다).
    case 'thinking-live': inner = <ThinkingLiveLine label={liveLabels[item.mode]} mode={item.mode} lastActivityAt={item.lastActivityAt} turnStartedAt={item.turnStartedAt} hiddenTurn={item.hiddenTurn === true} compactingSince={item.compactingSince ?? null} />; break;
    // §5.5 #17-39 — 끝난 사고 런이 그 자리에 남긴 자국(원문 ❌ 시간·분량만).
    case 'step':     inner = <StepTraceBlock item={item} />; break;
    // §5.5 #17-18 ⑦-2 — `live` = 이 카드가 속한 턴이 아직 도는 중(헤더 `작업 중` 배지).
    case 'report':   inner = <AgentReportCard report={item.report} review={item.review} live={item.live} />; break;
    case 'question': inner = <AgentQuestionCard questions={item.questions} live={item.live} />; break;
    case 'review':   inner = <AgentReviewCard review={item.review} live={item.live} />; break;
    case 'list':     inner = <AgentListCard list={item.list} live={item.live} />; break;
    case 'ask':      inner = <AskQuestionCard request={item.request} />; break;
    // §5.5 #17-12 ③-6 (g) — 그 턴이 멈춘 이유. 어느 밀도에서도 접지 않는다(왜 끝났는지가 그 턴의 결말이다).
    case 'turnstop': inner = <TurnStopNotice item={item} />; break;
  }
  // §4 (스트림 3종 ①) — 중첩 서브에이전트가 낳은 줄이면 감싼다. 표식이 없는 항목은 종전과 완전히 같다.
  const nestedUnder =
    item.kind === 'text' || item.kind === 'tool' || item.kind === 'toolgroup'
      ? item.nestedUnderToolUseId
      : undefined;
  if (nestedUnder) inner = <NestedFrame label={nestedLabel}>{inner}</NestedFrame>;
  // §5.5 — 놓친 카드 pill 의 관측 앵커(카드류에만). ⚠ data-card-id 는 접두어 붙은 item.id 가 아니라 raw 카드 id —
  // pill 의 cards 와 메인 탭 앵커가 raw 라 어긋나면 봐도 pill 이 안 사라지고 점프가 -1 이 된다. 흡수된 검수의 앵커는 AgentReportCard 가 단다(§5.5 #17-12).
  const cardId =
    item.kind === 'report' ? item.report.id :
    item.kind === 'question' ? item.questions.id :
    item.kind === 'review' ? item.review.id :
    item.kind === 'list' ? item.list.id : null;
  // §5.5 읽기 설정 — 항목 래퍼가 폭 그리드(`.ide-stream`)를 겸한다. 어떤 항목이 칼럼 밖으로 나가는지는
  //   `readingItemAttrs` 가 kind 로 결정하고, 실제 폭 계산은 전부 index.css 가 한다.
  return (
    <div
      data-stream-item-id={item.id}
      className="ide-stream"
      {...readingItemAttrs(item.kind)}
      {...(cardId ? { 'data-card-id': cardId } : {})}
      style={zoom === 1 ? undefined : { zoom }}
    >
      {inner}
    </div>
  );
}

export const StreamRenderer = memo(forwardRef<StreamRendererHandle, StreamRendererProps>(function StreamRenderer({ events, commands, agentId, subAgentId, sessionBusy, sessionWaiting, sessionActivityAt, sessionActivityHidden, sessionTurnStartedAt, sessionCompactingSince, reports, questions, reviews, lists, askRequests, onScrollerRef, restoreState, onAtBottomChange, onPromptOutline }, ref): React.JSX.Element {
  const { t } = useTranslation();
  // 2단 빌드 — 1단계는 증분 파서(새 이벤트만, 세션 전환·commands 변경·앞 절단이면 전체 재구축), 2단계(카드 합류)는 카드가 바뀔 때만.
  const parserRef = useRef<IncrementalStreamParser | null>(null);
  if (parserRef.current === null) parserRef.current = new IncrementalStreamParser();
  const base = useMemo(
    () => parserRef.current!.sync(events, commands, sessionBusy, sessionWaiting, sessionActivityAt, sessionActivityHidden, sessionTurnStartedAt, sessionCompactingSince),
    [events, commands, sessionBusy, sessionWaiting, sessionActivityAt, sessionActivityHidden, sessionTurnStartedAt, sessionCompactingSince],
  );
  const merged = useMemo(
    () => mergeCardsIntoItems(base, commands, reports, questions, reviews, lists, askRequests),
    [base, commands, reports, questions, reviews, lists, askRequests],
  );

  // §5.5 #17-12 — 3단계: 표시 밀도 변환(연속 동종 도구 묶기 + 옛 계획 접기). identity 안정화 **앞**에 두어
  //   묶음 객체도 참조가 고정되게 한다(뒤에 두면 매 틱 새 묶음 객체 → memo 무효화·전 항목 재측정).
  const density = useGraphStore((s) => s.ideStreamDensity);
  const dense = useMemo(() => applyStreamDensity(merged, density), [merged, density]);

  // identity 고정 — 같은 id·같은 렌더 필드면 직전 객체를 재사용한다. 합류/정렬이 배열을 새로 만들어도 memo 자식이 유지돼 버퍼 재측정(떨림)이 없다.
  const prevById = useRef<Map<string, StreamDisplayItem>>(new Map());
  const items = useMemo(() => {
    const next = new Map<string, StreamDisplayItem>();
    const reconciled = dense.map((it) => {
      const old = prevById.current.get(it.id);
      const keep = old && sameDisplayItem(old, it) ? old : it;
      next.set(it.id, keep);
      return keep;
    });
    prevById.current = next;
    return reconciled;
  }, [dense]);

  // 앞 절단과 과거 앞붙임을 virtuoso 에 shift 로 신고한다 — 없으면 인덱스 기반 측정이 밀려 긴 세션에서 화면이 말려 올라간다.
  // §5.5 #17-12 — 밀도는 리셋 키로 넘긴다(밀도 전환의 선두 id 교체를 절단으로 오인하면 화면이 튄다). 앞붙임 기준은 직전 렌더의 맨 위 항목(맨 앞 항목만 보면 "그대로"로 읽힌다).
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const viewIndexOf = useCallback((prevIds: readonly string[]): number | undefined => {
    const cont = scrollerElRef.current;
    if (!cont) return undefined;
    const els = cont.querySelectorAll<HTMLElement>('[data-stream-item-id]');
    if (els.length === 0) return undefined;
    const contTop = cont.getBoundingClientRect().top;
    const idx = lastPassedIndex(els.length, (i) => els[i]!.getBoundingClientRect().top - contTop, 0);
    const id = (idx >= 0 ? els[idx]! : els[0]!).dataset.streamItemId;
    const at = id === undefined ? -1 : prevIds.indexOf(id);
    return at >= 0 ? at : undefined;
  }, []);
  const firstItemIndex = useVirtuosoFrontShift(items, streamItemId, density, viewIndexOf);

  // §5.5 #17-12 — 복원 창 위쪽 과거 불러오기. 그려진 첫 항목(선렌더 버퍼 포함)이 창의 윗끝 항목에 닿으면
  //   그 앞 한 쪽을 청한다. 콜백은 참조를 고정하고 최신 값은 ref 로 읽는다(virtuoso 가 스크롤마다 부른다).
  const historyBoundary = useMemo(() => olderHistoryBoundary(items, events), [items, events]);
  const historyDone = useGraphStore((s) => (subAgentId ? s.streamHistoryDone[subAgentId] === true : true));
  const historyDeep = useGraphStore((s) => (subAgentId ? s.deepRestoredSessions[subAgentId] === true : false));
  const renderedStartRef = useRef<number | null>(null);
  const historyCtxRef = useRef({ agentId, subAgentId, boundary: historyBoundary, base: firstItemIndex });
  historyCtxRef.current = { agentId, subAgentId, boundary: historyBoundary, base: firstItemIndex };
  const historyTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const checkOlderHistory = useCallback(function check(): void {
    if (!mountedRef.current) return;
    const { agentId: aid, subAgentId: sid, boundary, base: shiftBase } = historyCtxRef.current;
    const start = renderedStartRef.current;
    if (!aid || !sid || start === null) return;
    if (!reachesHistoryBoundary(start - shiftBase, boundary)) return;
    const wait = requestOlderStreamHistory(aid, sid, () => check());
    if (wait > 0 && historyTimerRef.current === null) {
      historyTimerRef.current = window.setTimeout(() => {
        historyTimerRef.current = null;
        check();
      }, wait);
    }
  }, []);
  useEffect(() => {
    checkOlderHistory();
  }, [checkOlderHistory, historyBoundary, firstItemIndex, historyDone, historyDeep]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    };
  }, []);
  const handleRangeChanged = useCallback((range: ListRange) => {
    renderedStartRef.current = range.startIndex;
    checkOlderHistory();
  }, [checkOlderHistory]);

  const liveLabels = useMemo<LiveLabels>(
    () => ({
      // §5.5 #17-24 ⑦ — 작동 중이면 사고든 도구든 이 낱말 하나다. `생각 중`은 턴 시계와 붙어
      //   `생각 중… 53m 59s` 로 서서, 일하는 세션이 멈춘 것으로 읽혔다.
      working: t('ide.streamRenderer.working'),
      // §5.5 #17-18 ⑪ — "작업 중"과 **다른 낱말**이어야 한다. 같은 말이면 사용자는 돌고 있는
      //   줄과 줄만 선 줄을 구별할 방법이 없다(그 혼동이 이 값이 생긴 사고다).
      waiting: t('ide.streamRenderer.waiting'),
      // §5.5 #17-24 ⑥ — CLI 가 대화를 접는 동안. "생각 중"으로 적으면 그 몇 분이 사고로 읽힌다.
      compacting: t('ide.streamRenderer.compacting'),
    }),
    [t],
  );
  // §4 (스트림 3종 ①) — 중첩 서브에이전트 껍데기의 라벨. `renderStreamItem` 은 컴포넌트가 아니라
  //   함수라 훅을 못 쓰므로 `liveLabels` 와 같은 방식으로 번역문을 받아 넘긴다.
  const nestedLabel = t('ide.streamRenderer.nestedSubagent');
  // IDE 본문 텍스트 줌 — 각 항목 래퍼에 zoom 적용(아래 renderStreamItem). 변경 시 itemContent 정체성이
  //   바뀌어 Virtuoso 가 전 항목을 재측정 → 새 배율로 정착(줌 조작은 드물어 비용 무관).
  const ideTextZoom = useGraphStore((s) => s.ideTextZoom);
  // §5.5 #17-45 — 연속 발화 런. **간결에서만** 켠다 — 표준·원문은 도구 상자가 사이사이 끼어 본문이
  //   원래 끊겨 보이므로 문단마다 말머리가 붙는 종전 모양이 맞고, 이 항목은 그 둘을 바꾸지 않는다.
  //   주인(중첩 서브에이전트)이 다르면 런을 끊는다 — 남의 말을 내 발화에 붙일 수 없다.
  const speechRuns = useMemo(
    () => (density === 'compact'
      ? speechRunPositions(items.map((it) => ({
        id: it.id,
        text: it.kind === 'text',
        owner: it.kind === 'text' ? it.nestedUnderToolUseId : undefined,
      })))
      : NO_SPEECH_RUNS),
    [items, density],
  );
  // §5.5 #17-30 — 이 스트림이 속한 세션 = 코멘트를 담을 자리. 쓰기 가능 여부는 `addCommand` 와 **같은 술어**
  //   (`isReadOnlyHookAgent`)로 판정해, 화면에서 손잡이를 지운 것과 서버가 막는 것이 어긋나지 않게 한다.
  const canReviewComment = useGraphStore((s) => (
    agentId !== undefined && !isReadOnlyHookAgent(s.agents.find((a) => a.id === agentId))
  ));
  const reviewCtx = useMemo<DiffReviewCtx | undefined>(
    () => (agentId ? { sessionKey: followSessionKey(agentId, subAgentId ?? null), canComment: canReviewComment } : undefined),
    [agentId, subAgentId, canReviewComment],
  );
  const itemContent = useCallback(
    (_index: number, item: StreamDisplayItem) =>
      renderStreamItem(item, liveLabels, ideTextZoom, density, speechRuns, nestedLabel, agentId ? { agentId, ...(subAgentId ? { subAgentId } : {}) } : undefined, reviewCtx),
    [liveLabels, ideTextZoom, density, speechRuns, nestedLabel, agentId, subAgentId, reviewCtx],
  );

  // virtuoso 소유 스크롤러 DOM — 북마크 이동이 쓰고 부모에도 올린다.
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    const node = el instanceof HTMLElement ? el : null;
    scrollerElRef.current = node;
    onScrollerRef?.(node);
  }, [onScrollerRef]);

  // §5.5 #17-7 — 북마크 이동: anchorId 인덱스로 가상 리스트를 스크롤(렌더 보장)한 뒤, 다음 프레임에
  //   컨테이너 한정 스크롤 + 항목 외곽선 플래시 + 텍스트 선택. anchorId 없거나 못 찾으면 텍스트 검색 폴백.
  //   preserveFocus(인-페이지 검색)면 텍스트를 selection 대신 CSS 하이라이트로 칠해 검색창 caret 을 지킨다.
  const scrollToBookmark = useCallback((anchorId: string | undefined, text: string, preserveFocus = false) => {
    // §5.5 #17-12 — 신고 카드에 흡수된 검수(`review-…`)는 독립 항목이 아니므로 흡수한 신고 항목을 찾아준다.
    const idx = anchorId
      ? items.findIndex((it) => it.id === anchorId || (it.kind === 'report' && it.review !== undefined && `review-${it.review.id}` === anchorId))
      : -1;
    if (idx >= 0) virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' });
    window.setTimeout(() => {
      const cont = scrollerElRef.current;
      if (!cont) return;
      if (anchorId) {
        const el = findItemElement(cont, anchorId);
        if (el) {
          // 인-페이지 검색(preserveFocus)은 검색어가 든 그 줄을 중앙에 놓고 선택 색으로 칠한다
          //   (메인 탭 performBookmarkScroll 과 같은 규칙 — 두 탭의 도착 연출이 갈리지 않게).
          if (preserveFocus && highlightSearchMatches(cont, el, text)) return;
          scrollElementIntoCenter(cont, el);
          flashElement(el);
          const range = findTextRangeInContainer(el, text);
          if (range) markRange(range, preserveFocus);
          return;
        }
      }
      if (preserveFocus && highlightSearchMatches(cont, cont, text)) return;
      const range = findTextRangeInContainer(cont, text);
      if (range) scrollRangeIntoCenter(cont, range, preserveFocus);
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
  // §5.5 #17-12 — "지금 보고 있는 명령": 맨 위 항목만 DOM 으로 이분 탐색하고 명령은 items 로 거슬러 찾는다(버퍼 밖이어도 맞다). #17-48 입력 레일과 같은 측정.
  const viewedCommandId = useCallback((): string | null => {
    const cont = scrollerElRef.current;
    if (!cont) return null;
    const viewport = measureViewportItems(cont);
    if (!viewport) return null;
    return owningCommandId(items, isCommandItem, viewport.topId);
  }, [items]);
  // §5.5 #17-48 — 내 입력 레일: 지금 자리 · 입력으로 즉시 옮기기 · 맨 위.
  const promptProbe = useCallback((): PromptProbe | null => {
    const cont = scrollerElRef.current;
    if (!cont) return null;
    const viewport = measureViewportItems(cont);
    return viewport ? probePromptPlace(items, isCommandItem, viewport, streamItemId) : null;
  }, [items]);
  const jumpToItem = useCallback((itemId: string) => {
    const idx = items.findIndex((it) => it.id === itemId);
    if (idx < 0) return;
    // 인덱스로 먼저 그리게 한 뒤(미렌더 항목도 간다) 추정 높이로 내려앉은 오차를 DOM 으로 맞춘다.
    virtuosoRef.current?.scrollToIndex({ index: idx, align: 'start', offset: -PROMPT_JUMP_TOP_GAP });
    settleItemAtTop(() => scrollerElRef.current, itemId);
  }, [items]);
  const jumpToTop = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 0, align: 'start' });
  }, []);
  // 입력 목록이 실제로 바뀔 때만 부모에 알린다 — 콜백이 바뀌면(세션 전환) 같은 목록이어도 다시 알린다.
  const promptOutlineSentRef = useRef<{ cb: (p: readonly PromptRailEntry[]) => void; list: readonly PromptRailEntry[] } | null>(null);
  useEffect(() => {
    if (!onPromptOutline) return;
    const list: PromptRailEntry[] = [];
    for (const it of items) {
      if (it.kind === 'command') list.push({ id: it.id, text: it.prompt, at: it.submittedAt });
    }
    const sent = promptOutlineSentRef.current;
    if (sent && sent.cb === onPromptOutline && samePromptOutline(sent.list, list)) return;
    promptOutlineSentRef.current = { cb: onPromptOutline, list };
    onPromptOutline(list);
  }, [items, onPromptOutline]);
  const getState = useCallback((cb: (snap: StateSnapshot) => void) => {
    virtuosoRef.current?.getState(cb);
  }, []);
  // §5.5 #17 — 검색은 **본문 텍스트만** 훑는다(명령창·도구 입출력·시스템 줄 ❌ — streamSearch.ts).
  const searchMatchIds = useCallback((query: string): string[] => {
    const ids: string[] = [];
    for (const it of items) {
      if (findTextMatches(streamItemFindText(it), query)) ids.push(it.id);
    }
    return ids;
  }, [items]);
  const indexOfItemId = useCallback((id: string): number => items.findIndex((it) => it.id === id), [items]);
  const scrollToItemIndex = useCallback((index: number, offsetPx: number) => {
    virtuosoRef.current?.scrollToIndex({ index, align: 'start', offset: -offsetPx });
  }, []);
  useImperativeHandle(ref, () => ({ scrollToBookmark, scrollToCommand, getState, searchMatchIds, viewedCommandId, indexOfItemId, scrollToItemIndex, promptProbe, jumpToItem, jumpToTop }), [scrollToBookmark, scrollToCommand, getState, searchMatchIds, viewedCommandId, indexOfItemId, scrollToItemIndex, promptProbe, jumpToItem, jumpToTop]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-500">{t('ide.streamRenderer.noActivity')}</p>
      </div>
    );
  }

  // 바닥 추종 집행은 부모(IDEMainArea) DOM 워치독 단독 — followOutput 에 맡기면 모델 좌표가 역주행한다.
  return (
    // §7.11 — 본문 링크를 누르면 **이 스트림의 에이전트**에 프리뷰가 매달리게 소유자를 내려 준다.
    <StreamOwnerAgentId.Provider value={agentId}>
    <Virtuoso
      ref={virtuosoRef}
      className="scrollbar-thin"
      style={{ height: '100%' }}
      scrollerRef={handleScrollerRef}
      data={items}
      // 앞 절단 누적 수 — virtuoso 공식 shift 경로(sizeTree 재정렬 + scrollTop 보정).
      firstItemIndex={firstItemIndex}
      computeItemKey={(_i, item) => item.id}
      itemContent={itemContent}
      components={{ Footer: StreamEndGap }}
      atBottomStateChange={onAtBottomChange}
      atBottomThreshold={40}
      // §5.5 #17-12 — 그려진 범위가 창의 윗끝에 닿으면 그 앞 과거 한 쪽을 불러온다.
      rangeChanged={handleRangeChanged}
      // 복원 스냅샷이 있으면 그 위치/측정값으로, 없으면(첫 진입) 마지막 항목(바닥)에서 시작 — 둘은 배타.
      {...(restoreState
        ? { restoreStateFrom: restoreState }
        : { initialTopMostItemIndex: { index: 'LAST' as const, align: 'end' as const } })}
      // A: 뷰포트 밖 선렌더 버퍼 확대 — 중간 속도 스크롤에서 본문이 미리 준비돼 pop-in 이 줄어든다.
      increaseViewportBy={{ top: 1600, bottom: 2000 }}
      // scrollSeek 자리표시자를 쓰지 마라 — 추종 점프가 임계(800px/s)를 넘겨 깜빡이고, 자라는 마지막 항목은 추정 높이가 틀려 교체마다 튄다.
    />
    </StreamOwnerAgentId.Provider>
  );
}));
