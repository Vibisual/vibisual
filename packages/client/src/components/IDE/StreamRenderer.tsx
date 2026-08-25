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
import { memo, useState, useMemo, useRef, useCallback, useContext, createContext, forwardRef, useImperativeHandle } from 'react';
import { Virtuoso, type VirtuosoHandle, type StateSnapshot } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import { findTextRangeInContainer, scrollRangeIntoCenter, scrollElementIntoCenter, flashElement, findItemElement, markRange } from './bookmarkScroll.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { SubAgentStreamEvent, QueuedCommand, CommandError, AgentReport, AgentQuestions, AgentReview, AgentList, AskUserQuestionRequest } from '@vibisual/shared';
import { SystemNode, parseSystemSubtype, parseSystemTaskInfo } from './SystemNode.js';
import { useAttachmentThumbs } from './attachmentThumb.js';
import { ThinkingLiveLine } from './ThinkingIndicator.js';
import { AgentReportCard } from './AgentReportCard.js';
import { FeedbackButtons } from './FeedbackButtons.js';
import { useGraphStore } from '../../stores/graphStore.js';
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
import { useIDEPaneActions, useIDEPaneKey } from './idePane.js';
import { parseStreamPathCandidate } from './streamPathLinks.js';
import { useWorkspacePathKind } from './useWorkspacePathKind.js';
import { openWorkspaceTarget, planWorkspaceOpen } from './openWorkspaceTarget.js';
import { getInternalApp } from '../../apps/registry.js';
import { toolPreview } from './toolPreview.js';
import {
  mergeCardsIntoItems, IncrementalStreamParser,
  type StreamText, type StreamGroup, type StreamSystem, type StreamResult, type StreamError,
  type StreamCommand, type StreamItemFull,
} from './streamItems.js';
import { describeCommandError, parseStreamErrorContent } from './commandError.js';
import {
  applyStreamDensity, sameDisplayItem, displayItemId, clampStreamText,
  type StreamDisplayItem, type StreamToolGroup,
} from './streamDensity.js';
import { useStreamToggle, streamToggleProps } from './streamToggle.js';
import { streamItemFindText, findTextMatches } from './streamSearch.js';
import {
  STREAM_DIFF_AUTO_EXPAND_MAX_LINES,
  STREAM_COMPACT_TEXT_CLAMP_LINES, STREAM_COMPACT_TEXT_CLAMP_CHARS,
  isReadOnlyHookAgent,
  type StreamDensity,
} from '@vibisual/shared';
import { useVirtuosoFrontShift } from './frontShift.js';
import { readingItemAttrs } from './reading/readingModel.js';

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
  /** 출처 항목(anchorId)으로 가상 리스트를 스크롤하고 그 항목/텍스트를 하이라이트.
   *  `preserveFocus` 는 인-페이지 검색용 — 텍스트를 selection 대신 CSS 하이라이트로 칠해
   *  포커스를 쥔 검색 입력창의 caret 을 건드리지 않는다(기본 false = 북마크 이동, 종전대로 선택). */
  scrollToBookmark: (anchorId: string | undefined, text: string, preserveFocus?: boolean) => void;
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

/**
 * §5.5 #17-27 ⑬ — "지금 그리는 `<code>` 가 코드 블록 안인가".
 *
 * 손잡이가 되는 것은 본문에 박힌 **인라인 코드**뿐이고, 코드 블록 안의 `<code>` 는 손대지 않는다 —
 * 거기 있는 것은 읽으라고 적은 코드이지 열라고 적은 위치가 아니며, 그 자리의 주인은 복사 버튼이다.
 * react-markdown 은 인라인/블록을 같은 `code` 슬롯으로 넘기고 v9 부터 `inline` 플래그를 주지 않으므로,
 * 블록을 그리는 `CodeBlock` 이 자기 안쪽임을 이 컨텍스트로 알린다(`className` 유무 추정은 인덴트 블록에서 틀린다).
 */
const InCodeBlock = createContext(false);

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
    // §5.5 읽기 설정 — 이 래퍼가 `.ide-md` 그리드의 직접 자식이므로(안쪽 <pre> 가 아니라) 탈출 표식도
    //   여기 붙는다. C·D 안에서 코드 블록만 읽기 칼럼 밖으로 나가는 지점.
    <div className="ide-breakout group/code relative">
      <InCodeBlock.Provider value={true}>
        <pre ref={preRef} {...rest}>{children}</pre>
      </InCodeBlock.Provider>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        aria-label={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        className={`absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[12px] font-medium transition-opacity ${
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

/** 인라인 코드의 children 에서 **글자 하나**를 꺼낸다. 강조·링크가 섞인 조각은 경로가 아니므로 null. */
function inlineCodeText(children: React.ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string') return children[0];
  return null;
}

/**
 * §5.5 #17-27 ⑬ — 본문에 적힌 경로 = 네 번째 여는 손잡이.
 *
 * 에이전트가 "여기에 있습니다" 하며 적어 준 위치(`assets/test/gpt-image/` · `packages/client/src/App.tsx`)를
 * 눌러서 연다 — **파일이면 내장 편집창(②), 폴더면 시스템 탐색기(⑩ 과 같은 레일)**. 새 열기 레일은 만들지 않는다.
 *
 * 링크가 되는 조건은 **디스크에 실제로 있을 것** 하나다(⑬ (b)). 글자 모양만 보고 칠하면 본문의 명령·타입 조각까지
 * 파란 밑줄을 얻어 누를 수 없는 가짜 손잡이가 되므로, 1차 체(`parseStreamPathCandidate`)를 통과한 후보만
 * 서버에 묻고(경로당 한 번, 모듈 캐시) 답이 오기 전·없다는 답이 온 뒤에는 **종전과 똑같은 인라인 코드**로 그린다.
 */
const MarkdownCode = memo(function MarkdownCode({ children, ...rest }: React.HTMLAttributes<HTMLElement>): React.JSX.Element {
  const { t } = useTranslation();
  const inBlock = useContext(InCodeBlock);
  const rootPath = useIDEProjectRoot();
  // §5.5 #17-1 — 본문에서 누른 경로는 **이 창의** 편집창·실행으로 가야 한다(옆 창 ❌).
  const paneKey = useIDEPaneKey();

  const raw = inlineCodeText(children);
  const candidate = useMemo(
    () => (inBlock || raw === null ? null : parseStreamPathCandidate(raw, rootPath)),
    [inBlock, raw, rootPath],
  );
  const resolved = useWorkspacePathKind(rootPath, candidate?.relPath ?? null);

  const linked = resolved !== null && resolved.kind !== 'missing' ? resolved : null;

  /**
   * ⑬ (i) — 어디로 갈지는 **한 곳**(§5.13 (R-1))이 정한다. 화면은 그 답을 받아 아이콘·툴팁만 고르므로,
   * 앱이 늘어 새 확장자를 받아도 이 컴포넌트는 그대로다.
   */
  const plan = useMemo(
    () =>
      linked && candidate
        ? planWorkspaceOpen({
            relPath: candidate.relPath,
            kind: linked.kind === 'directory' ? 'directory' : 'file',
            ...(linked.executable ? { executable: true } : {}),
          })
        : null,
    [linked, candidate],
  );

  const onOpen = useCallback((e: React.MouseEvent): void => {
    if (!linked || !candidate || rootPath === null) return;
    e.preventDefault();
    e.stopPropagation();
    void openWorkspaceTarget(
      {
        relPath: candidate.relPath,
        absPath: linked.absPath,
        kind: linked.kind === 'directory' ? 'directory' : 'file',
        ...(linked.executable ? { executable: true } : {}),
      },
      rootPath,
      t('ide.streamRenderer.pathLink.runFailed'),
      paneKey,
    );
  }, [linked, candidate, rootPath, t, paneKey]);

  if (!linked || !plan) return <code {...rest}>{children}</code>;

  // 툴팁은 (f) 의 규약 그대로 "전체 경로 + 벌어질 일" — 여는 곳이 갈리면 말도 갈려야 누르기 전에 안다.
  const app = plan.action === 'app' && plan.appId !== undefined ? getInternalApp(plan.appId) : undefined;
  const title =
    plan.action === 'run'
      ? t('ide.streamRenderer.pathLink.runProgram', { path: linked.absPath })
      : plan.action === 'app'
        ? t('ide.streamRenderer.pathLink.openApp', { app: app?.name ?? plan.appId, path: linked.absPath })
        : plan.action === 'external'
          ? t('ide.streamRenderer.pathLink.openExternal', { path: linked.absPath })
          : plan.action === 'folder'
            ? t('ide.streamRenderer.pathLink.openFolder', { path: linked.absPath })
            : t('ide.streamRenderer.pathLink.openFile', { path: linked.absPath });

  return (
    // 칩(배경·모노폰트)은 `<code>` 가 그대로 유지하고, 그 안의 버튼만 링크 색·밑줄을 얻는다 —
    // "코드처럼 보이던 그 조각이 이제 눌린다" 가 한눈에 읽히게(⑬ (f)).
    <code {...rest}>
      <button type="button" onClick={onOpen} title={title} aria-label={title} className="ide-path-link">
        {plan.action === 'run' ? (
          // run — 재생 삼각형(누르면 열리는 것이 아니라 **돈다**는 뜻)
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 4l14 8-14 8z" />
          </svg>
        ) : plan.action === 'app' && app ? (
          // 내부 앱 — **그 앱의 아이콘**을 그대로 쓴다(코어가 앱마다 그림을 들지 않는다, §5.13 (P)).
          //   앱 아이콘은 목록용 치수(h-4)라 인라인 글자 옆에서는 크다 — 이 자리에서만 줄인다.
          <span className="inline-flex [&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">
            <app.icon />
          </span>
        ) : plan.action === 'external' ? (
          // external — 상자 밖으로 나가는 화살표(우리 창이 아니라 바깥에서 열린다)
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
        ) : plan.action === 'folder' ? (
          // folder
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        ) : (
          // file — 모서리 접힌 문서(편집창·그림·PDF 는 전부 우리 창에서 열린다)
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
          </svg>
        )}
        {children}
      </button>
    </code>
  );
});

const mdComponents: Components = { pre: CodeBlock, a: MarkdownLink, code: MarkdownCode };

/** v3.13 — 앞쪽 절단 shift 카운트용 안정 id 추출자(렌더 간 동일 참조 필요 → 모듈 상수).
 *  §5.5 #17-12 — 밀도 변환 뒤의 표시 아이템(묶음 포함)을 받는다. */
const streamItemId = displayItemId;

/** v3.17 — 리스트 끝 여백(px): 마지막 줄이 하단 입력부 경계에 딱 붙어 걸려 보이지 않게.
 *  virtuoso Footer 로 렌더해 리스트(scrollHeight)의 일부가 되므로 DOM 워치독 바닥 접착과 자연히 호환
 *  (스크롤러 padding 은 virtuoso 측정과 어긋나므로 금지). Sub 탭·메인 탭 공용. */
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

/** assistant 텍스트 → 마크다운. "AI 와 나눈 일상 대화"임을 한눈에 — 박스로 감싸면 도구/생각/결과 박스와
 *  뒤섞여 오히려 지저분해 보이므로, **박스를 걷어내고 평범한 본문 텍스트**로 둔다. 다만 "AI 가 말하는 것"임은
 *  왼쪽의 작은 스파클 글리프로만 표식(도구/생각=좌측 세로바 박스, 내 입력=우측 sky 말풍선과 자연히 구분). */
const TextBlock = memo(function TextBlock({ item, density, exempt }: { item: StreamText; density: StreamDensity; exempt: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  // §5.5 #17-21 ② — 간결에서는 앞 N줄(또는 N자)만 남기고 [더 보기]로 접는다.
  //   `exempt`(화면의 마지막 본문)는 지금 하는 말이자 그 턴의 결론이라 자르지 않는다.
  const clamped = useMemo(
    () => (density === 'compact' && !exempt
      ? clampStreamText(item.content, STREAM_COMPACT_TEXT_CLAMP_LINES, STREAM_COMPACT_TEXT_CLAMP_CHARS)
      : null),
    [density, exempt, item.content],
  );
  // 펼침은 #17-16 ④ 모듈 저장소 — 가상 리스트가 언마운트해도 펼쳐 둔 채로 돌아온다.
  const [open, toggleOpen] = useStreamToggle(`text-more-${item.id}`, false);
  const body = clamped && !open ? clamped.text : item.content;
  return (
    // §4 v3.24 — 폰(max-md)에선 좌우 여백 압축(카톡/텔레그램 밀도) — 데스크톱 px-4 유지.
    <div className="px-4 py-1 max-md:px-1.5">
      <div className="flex gap-2">
        <AiSpeakerGlyph />
        <div className="min-w-0 flex-1">
          <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-pre:my-2 prose-headings:text-gray-100 prose-headings:text-[15px] prose-li:my-1 prose-strong:text-gray-100">
            <Markdown remarkPlugins={remarkPlugins} components={mdComponents}>{body}</Markdown>
          </div>
          {clamped && (
            <button
              type="button"
              onClick={toggleOpen}
              className="mt-0.5 flex items-center gap-1 text-[12px] text-gray-500 transition-colors hover:text-gray-300"
            >
              <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              {open ? t('ide.streamRenderer.showLess') : t('ide.streamRenderer.showMoreLines', { count: clamped.hiddenLines })}
            </button>
          )}
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
  const { t } = useTranslation();
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

        {/* 스피너 or hover 힌트 */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {item.isActive && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
          )}
          <span className="hidden text-[12px] text-gray-500 group-hover/hdr:inline">
            {open ? t('ide.streamRenderer.collapse') : t('ide.streamRenderer.expand')}
          </span>
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

/**
 * §5.5 #17-16 — 접힌 묶음이 그리는 **최근 도구 한 줄**. 활성/완료가 **같은 높이**라 도구가 끝나고
 * 다음 도구가 시작돼도 글자만 바뀐다(높이 변화 = 0 → 스크롤이 들쭉날쭉하지 않는다).
 * 진행 중이면 스피너, 아니면 같은 크기의 체크 글리프.
 */
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

/**
 * §5.5 #17-12/#17-16 — 도구 실행 묶음. 헤더는 `명령 실행됨 ×N` 한 줄이고, 접힌 상태에서도 **최근 도구
 * 한 줄**을 함께 그려 "지금 뭘 하는지"가 절대 가려지지 않는다. 펼치면 개별 도구 상자가 그대로 나온다.
 * 도구가 1개일 때부터 이 묶음이 존재하므로(streamDensity), 도구가 늘어도 상자가 교체되지 않는다.
 */
const ToolGroupBlock = memo(function ToolGroupBlock({ item, density }: { item: StreamToolGroup; density: StreamDensity }): React.JSX.Element {
  const { t } = useTranslation();
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
        <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {shownNames.map((name) => (
            <span key={name} className="flex-shrink-0 rounded bg-gray-700/40 px-1 py-0.5 text-[12px] font-medium text-gray-500">
              {name}
            </span>
          ))}
          {restNames > 0 && <span className="flex-shrink-0 text-[12px] text-gray-600">+{restNames}</span>}
        </span>
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

/**
 * §5.5 #17-12 ③ — 실패 사유 한 장. **왜 끝났는지**를 한 문장으로 말하고, 원문(stderr 꼬리·CLI 본문)은
 * 그 아래 코드 폰트로 그대로 보여준다(번역 대상 아님 — 손대면 검색·대조가 안 된다).
 */
function ErrorLine({ item }: { item: StreamError }): React.JSX.Element {
  const { t } = useTranslation();
  const desc = describeCommandError(parseStreamErrorContent(item.content));
  return (
    <div className="mx-2 my-1 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-2.5 max-md:mx-1 max-md:px-2.5">
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-red-300">{t(desc.labelKey, desc.labelParams)}</div>
          {desc.detail && (
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-gray-400">{desc.detail}</pre>
          )}
        </div>
      </div>
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

/** §5.5 #17-12 ③ — 명령 말풍선에 붙는 실패 사유(스트림 폴백 경로). 문장 조립 규칙은 `ErrorLine` 과 같다. */
function CommandErrorNotice({ error }: { error: CommandError }): React.JSX.Element {
  const { t } = useTranslation();
  const desc = describeCommandError(error);
  return (
    <div className="mb-1.5 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2">
      <div className="text-[12px] font-medium text-red-300">{t(desc.labelKey, desc.labelParams)}</div>
      {desc.detail && (
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-gray-400">{desc.detail}</pre>
      )}
    </div>
  );
}

/** 명령 폴백 (스트림 없을 때). 실행 중 인디케이터는 하단 StreamStatusBar 가 담당 — 여기선 프롬프트/결과만. */
function CommandBlock({ item, agentId }: { item: StreamCommand; agentId?: string }): React.JSX.Element {
  const { t } = useTranslation();
  const isError = item.status === 'error';
  // §5.5 #17-18 ⑤ v4.77 — 이 프롬프트의 상태(실행 중/대기 중 + 방식)를 말풍선이 직접 색으로 말하고,
  //   대기 중이면 [대기|합치기|즉시]·삭제 컨트롤까지 말풍선 안에 붙는다(옛 입력창 위 대기 줄 대체).
  const commandState = useMemo<PromptCommandState>(() => ({
    status: (item.status === 'queued' || item.status === 'executing' || item.status === 'error' ? item.status : 'completed'),
    ...(item.dispatchMode ? { dispatchMode: item.dispatchMode } : {}),
    ...(agentId ? { agentId } : {}),
    ...(item.commandId ? { commandId: item.commandId } : {}),
  }), [item.status, item.dispatchMode, item.commandId, agentId]);
  // v2.61 — 전송한 첨부 이미지를 사용자 프롬프트 아래 썸네일로 표시. 클릭 시 전역 라이트박스로 확대.
  // v2.93 — blob preview(메모리) 우선, 없으면 server 파일 라우트로 폴백(별창/새로고침/재시작에서도 표시).
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const thumbs = useAttachmentThumbs(item.attachments);
  return (
    <div className="px-4 py-2 max-md:px-1.5" data-cmd-id={item.id}>
      {/* 프롬프트 — 사용자 입력은 길이와 무관하게 항상 "내 메시지" 말풍선으로. */}
      <CollapsiblePrompt prompt={item.prompt} command={commandState} />
      {/* 앱이 내려가 끊겼다가 보존된 세션으로 다시 이어 돌린 명령 — 그 사실을 말하지 않으면
          사용자에겐 "왜 처음부터 다시 하지?" 또는 "왜 멈춰 있지?" 로 보인다. */}
      {item.restartResumed && (
        <p className="mt-1 text-[12px] text-amber-300/90">{t('ide.streamRenderer.restartResumed')}</p>
      )}
      {/* §5.5 #17-18 v4.68 — 합치기로 덧말이 함께 실렸으면 그 사실을 말한다(따로 보낸 말이
          한 프롬프트로 보이는 이유를 화면이 설명해야 한다). */}
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
              onClick={() => openImageLightbox(a.url)}
              className="h-16 w-16 flex-shrink-0 overflow-hidden rounded border border-gray-700 bg-gray-800 transition-opacity hover:opacity-80"
            >
              <img src={a.url} alt="" className="h-full w-full cursor-zoom-in object-cover" />
            </button>
          ))}
        </div>
      )}
      {/* §5.5 #17-12 ③ — 스트림이 없어(또는 유실돼) 실패 사유를 실어 줄 오류 항목이 없을 때의 표면.
          `error` 를 실어 보내는 쪽(buildCommandItems)이 스트림 유무로 이미 걸러 두었다. */}
      {item.error && <CommandErrorNotice error={item.error} />}
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

/** §5.5 #17-24 ② — 라이브 1줄의 두 라벨(모드로 고른다). */
interface LiveLabels { thinking: string; working: string }

/** 단일 스트림 아이템 → 블록 엘리먼트. 북마크 이동 앵커용 `data-stream-item-id` 래퍼로 감싼다.
 *  zoom — IDE 본문 텍스트 줌 배율. **스크롤러(가상 리스트 뷰포트)가 아니라 각 항목 래퍼**에 걸어,
 *  Virtuoso 가 zoom 반영된 실제 항목 높이를 그대로 측정(가상화·스크롤 계산과 일관)하게 한다. */
function renderStreamItem(item: StreamDisplayItem, liveLabels: LiveLabels, zoom: number, density: StreamDensity, lastTextId: string | null, feedbackCtx?: StreamFeedbackCtx, reviewCtx?: DiffReviewCtx): React.JSX.Element {
  let inner: React.JSX.Element;
  switch (item.kind) {
    // §5.5 #17-21 ② — 마지막 본문(lastTextId)만 간결에서도 통째로 보인다(지금 하는 말 = 결론).
    case 'text':     inner = <TextBlock item={item} density={density} exempt={item.id === lastTextId} />; break;
    case 'tool':     inner = <ToolBlock item={item} density={density} review={reviewCtx} />; break;
    case 'toolgroup': inner = <ToolGroupBlock item={item} density={density} />; break;
    case 'plan':     inner = <PlanBlock item={item} />; break;
    case 'result':   inner = <ResultBlock item={item} feedbackCtx={feedbackCtx} />; break;
    // §5.5 #17-12 ③ — 실패 사유는 어느 밀도에서도 접거나 묶지 않는다(읽어야 할 유일한 원인).
    case 'error':    inner = <ErrorLine item={item} />; break;
    case 'system':   inner = <SystemLine item={item} density={density} />; break;
    case 'command':  inner = <CommandBlock item={item} agentId={feedbackCtx?.agentId} />; break;
    // §5.5 #17-24 ② — 항목은 그대로 두고 라벨·색만 바꾼다(생각 중 ↔ 작업 중).
    case 'thinking-live': inner = <ThinkingLiveLine label={liveLabels[item.mode]} mode={item.mode} />; break;
    // §5.5 #17-18 ⑦-2 — `live` = 이 카드가 속한 턴이 아직 도는 중(헤더 `작업 중` 배지).
    case 'report':   inner = <AgentReportCard report={item.report} review={item.review} live={item.live} />; break;
    case 'question': inner = <AgentQuestionCard questions={item.questions} live={item.live} />; break;
    case 'review':   inner = <AgentReviewCard review={item.review} live={item.live} />; break;
    case 'list':     inner = <AgentListCard list={item.list} live={item.live} />; break;
    case 'ask':      inner = <AskQuestionCard request={item.request} />; break;
  }
  // §5.5 — 놓친 카드 pill 이 관측할 앵커. 카드류(신고/질문/검수/목록)에만 표식.
  //   ⚠ data-card-id 는 stream item.id(`question-${q.id}` 등 접두어 포함)가 아니라 **raw 카드 id** 여야 한다.
  //   pill 의 cards 프롭(unseenCandidateCards)과 메인 탭 앵커가 모두 raw id 라, 접두어 id 로 두면 seen 추적·클릭
  //   점프가 어긋난다(교차 관측 id 불일치 → 봐도 pill 이 안 사라지고, scrollToBookmark(raw) findIndex 가 -1).
  //   §5.5 #17-12 — 신고 카드에 흡수된 검수(item.review)의 앵커는 AgentReportCard 안쪽 구획이 직접 단다.
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

  // §5.5 #17-12 — 3단계: 표시 밀도 변환(연속 동종 도구 묶기 + 옛 계획 접기). identity 안정화 **앞**에 두어
  //   묶음 객체도 참조가 고정되게 한다(뒤에 두면 매 틱 새 묶음 객체 → memo 무효화·전 항목 재측정).
  const density = useGraphStore((s) => s.ideStreamDensity);
  const dense = useMemo(() => applyStreamDensity(merged, density), [merged, density]);

  // v3.09 — 항목 identity 안정화(thinking 떨림 차단). 증분 파서는 자란 항목만 새 객체로 교체하지만,
  //   카드 합류/정렬 단계가 배열을 새로 만들므로 여기서 한 번 더 참조를 고정한다: 직전 렌더에서 같은 id 의
  //   항목과 렌더에 영향 주는 필드가 모두 같으면 **이전 객체 참조를 그대로 재사용** → memo 자식이 유지돼
  //   뷰포트 선렌더 버퍼 전체 재측정이 사라진다(스크롤 추종 로직은 손대지 않음).
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

  // v3.13 — 버퍼 앞쪽 절단(상한 초과 시 오래된 이벤트 일괄 제거)을 virtuoso 에 shift 로 신고. 이게 없으면
  //   인덱스 기반 sizeTree/offsetTree 가 절단마다 통째로 밀려 측정 모델이 붕괴 → pin/followOutput/restoreState
  //   가 전부 틀린 좌표로 계산돼 긴 세션에서 화면이 "위로 말려 올라갔다"(새 이벤트 유입 = 절단 시점).
  //   §5.5 #17-12 — 밀도를 리셋 키로 함께 넘긴다: 밀도 전환은 선두 id 를 통째로 갈아치우므로 절단으로
  //   오인하면 있지도 않은 제거분만큼 스크롤이 보정돼 화면이 튄다.
  const firstItemIndex = useVirtuosoFrontShift(items, streamItemId, density);

  const liveLabels = useMemo<LiveLabels>(
    () => ({ thinking: t('ide.streamRenderer.thinking'), working: t('ide.streamRenderer.working') }),
    [t],
  );
  // IDE 본문 텍스트 줌 — 각 항목 래퍼에 zoom 적용(아래 renderStreamItem). 변경 시 itemContent 정체성이
  //   바뀌어 Virtuoso 가 전 항목을 재측정 → 새 배율로 정착(줌 조작은 드물어 비용 무관).
  const ideTextZoom = useGraphStore((s) => s.ideTextZoom);
  // §5.5 #17-21 ② — 간결에서 유일하게 자르지 않는 본문 = 화면의 **마지막 text**(지금 하는 말이자 결론).
  //   본문이 하나 더 도착하면 직전 것이 자동으로 접히므로 화면 아래쪽만 열려 있는 모양이 유지된다.
  const lastTextId = useMemo(() => {
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k]!;
      if (it.kind === 'text') return it.id;
    }
    return null;
  }, [items]);
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
      renderStreamItem(item, liveLabels, ideTextZoom, density, lastTextId, agentId ? { agentId, ...(subAgentId ? { subAgentId } : {}) } : undefined, reviewCtx),
    [liveLabels, ideTextZoom, density, lastTextId, agentId, subAgentId, reviewCtx],
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
          scrollElementIntoCenter(cont, el);
          flashElement(el);
          const range = findTextRangeInContainer(el, text);
          if (range) markRange(range, preserveFocus);
          return;
        }
      }
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
