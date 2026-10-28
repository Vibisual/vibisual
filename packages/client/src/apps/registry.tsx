/**
 * §5.13 (N) — 내부 앱 레지스트리. 새 앱은 이 배열에 항목 하나다(목록·메뉴·버블 모양·창·여는 파일이 다 여기서 나온다) — 앱이 코어에 남기는 자국은 상수여야 한다.
 * 플러그인(§5.11)과 달리 무거워 기본 번들에 못 넣는다 — 화면 코드는 늦은 `import()` 로만 온다.
 * §5.13 (H) — 설치 단계는 없다. "안 쓰면 비용이 없다"는 늦은 로더가 지킨다(안 부르면 청크가 안 내려온다).
 */

import type { ComponentType, JSX, ReactNode } from 'react';
import type { CommandExecutionRequirements, Conti, ContiRenderStatus, CreationRunLimits, StoryboardPreset, UserDefaults, WorkspaceOpenAppClaim } from '@vibisual/shared';
import type { AppThumbnailSkip } from './thumbnailSkip.js';

/** 앱 창이 받는 것. 무엇을 쓸지는 앱이 정한다 — 코어는 hash 를 그대로 넘길 뿐이다. */
export interface AppShellProps {
  readonly appId: string;
  readonly params: Readonly<Record<string, string>>;
}

/** 화면 하나를 늦게 불러오는 함수. 정적 import 로 바꾸면 부팅 번들이 불어난다. */
export type AppShellLoader = () => Promise<ComponentType<AppShellProps>>;

/**
 * 캔버스 버블 모양(§5.13 (M)). 원은 쓰지 않는다 — 원은 커스텀 에이전트 버블이라 구별이 사라진다(조작 감각은 같게).
 * `film` — 위아래 퍼포레이션 띠의 가로 프레임(영상 앱용, 화면 형태에선 머리줄 위 구멍 한 줄) · `plate` — 4px 모서리 사각 명패(기본값).
 */
export type AppBubbleShape = 'film' | 'plate';

/** §5.13 (Q) — 스토리보드 한 벌을 앱에 넘길 때 건네는 것. 코어는 누가 받는지 모른다(§5.13 (P-4)) — 선언한 앱을 부르고 앱이 자기 id 를 결과에 담는다. */
export interface StoryboardHandoffArgs {
  /** 프로젝트 루트 절대 경로(= projectId). */
  readonly projectId: string;
  readonly conti: Conti;
  readonly preset: StoryboardPreset;
  /** false 면 문서만 만들고 렌더는 걸지 않는다. 기본은 렌더까지. */
  readonly render?: boolean;
}

/** 앱이 돌려주는 산출물. 그대로 `Conti.render` 로 적힌다. */
export interface StoryboardHandoffResult {
  readonly appId: string;
  readonly docId: string;
  readonly jobId?: string;
  readonly status?: ContiRenderStatus;
}

/** 스토리보드를 받을 수 있는 앱이 선언하는 것. 늦은 로더라 안 쓰면 앱 코드가 안 실린다. */
export interface StoryboardCapability {
  readonly accept: (args: StoryboardHandoffArgs) => Promise<StoryboardHandoffResult>;
}

/**
 * §5.4 #36 (F) — 위성 화면 미리보기 한 장(코어는 이 두 모양만 그린다): `picture` — blob URL(밀려나면 revoke), `fit` 은 사진·영상 `cover` · 투명 정지 화면 `contain`.
 * `wave` — 0~1 막대 높이(소리). `durationSec` — 영상·소리 길이(화면 모서리 숫자).
 */
export type AppThumbnail =
  | { readonly kind: 'picture'; readonly url: string; readonly fit?: 'cover' | 'contain'; readonly durationSec?: number }
  | { readonly kind: 'wave'; readonly peaks: readonly number[]; readonly durationSec?: number };

/** 미리보기를 구울 때 받는 것. 크기는 그릴 자리(px × 화면 배율) — 앱은 그 안에 맞춰 굽는다. */
export interface AppThumbnailRequest {
  /** 프로젝트 루트 절대 경로. */
  readonly projectId: string;
  /** 루트 기준 상대 경로(`AppBubble.file`). */
  readonly file: string;
  readonly width: number;
  readonly height: number;
  /** §5.1 #2-1 (G) ① — 이미 아는 파일 크기(bytes, 스냅샷 `fileSize`). 있으면 다시 묻지 않고 `PREVIEW_POLICY.maxBytes` 로 바로 가른다. */
  readonly bytes?: number | undefined;
}

/** 못 구우면 `null`(던져도 같다 — 아이콘 + 파일 이름). 성능 기준(§5.1 #2-1 (G) ①)을 넘어 일부러 안 구웠으면 `THUMB_SKIPPED_TOO_LARGE` — 툴팁이 이유를 말한다. */
export type AppThumbnailRenderer = (req: AppThumbnailRequest) => Promise<AppThumbnail | AppThumbnailSkip | null>;

/**
 * §5.4 #36 (G) — 앱이 위성 화면 안쪽을 그릴 때 받는 것(결과가 담긴 화면에서만). 캔버스에선 간단한 조작(재생·위치·돌려 보기·맞춤·복사)만 — 편집은 앱 창 몫.
 * 공용 부품은 `apps/canvasFaceKit.tsx` 한 벌(앱마다 생김새가 갈리지 않게).
 */
export interface AppCanvasFaceProps {
  /** 프로젝트 루트 절대 경로. */
  readonly projectId: string;
  /** 루트 기준 상대 경로(`AppBubble.file`). 담긴 결과 파일이 없으면 빈 문자열(`faceShowsRef` 앱의 문서 모드). */
  readonly file: string;
  /** §5.13 (L) — 노드가 가리키는 작업 문서(`AppBubble.ref`) — `faceShowsRef` 를 선언한 앱만 받는다. 이름이 `ref` 가 아닌 까닭: React 가 그 prop 을 가로챈다. */
  readonly workRef?: string | undefined;
  /** 노드를 보여 주는 프로젝트의 표시 이름(앱 REST 의 `project` 값). */
  readonly projectName?: string | undefined;
  /** 결과 버전(`AppBubble.fileAt`, 모르면 0). 바뀌면 붙든 재생 자원을 버리고 정지 미리보기로 돌아간다. */
  readonly version: number;
  /** 안쪽 상자 크기(캔버스 px) — 결과 자리 + 아래 조작줄. */
  readonly width: number;
  readonly height: number;
  /** 앱 색(밝은 쪽) — 진행 막대·파형·켠 단추. */
  readonly glow: string;
  /** 앱 아이콘 — 정지 미리보기를 못 구웠을 때 대신 그린다. */
  readonly icon: ReactNode;
  /** 코어가 구워 둔 정지 미리보기(굽는 중·못 구웠으면 `null`). 재생 전·멈춘 뒤에는 이것을 그대로 보인다. */
  readonly thumb: AppThumbnail | null;
  /** 정지 미리보기를 굽는 중인가. */
  readonly thumbLoading: boolean;
}

/** §5.4 #36 (G) — 앱 위성 화면의 안쪽 그림. 늦은 로더로만 온다(안 보이면 안 내려온다). */
export type AppCanvasFace = ComponentType<AppCanvasFaceProps>;

/** §5.4 #36 (C) — 앱 몫 브리프의 입력. 공통 문구("결과 파일을 넣어라")면 영상 노드에도 완성 mp4 를 구워 넣는다 — 필요한 것은 짓고 다듬는 작업 문서다. */
export interface AppAgentBriefArgs {
  /** Original user request, before linked app instructions are appended. */
  readonly request: string;
  /** 프로젝트 루트 절대 경로. */
  readonly projectId: string;
  /** 프로젝트 표시 이름(앱 REST 의 `project` 값 — 에이전트가 그대로 쓴다). */
  readonly projectName: string;
  readonly bubble: {
    readonly id: string;
    /** 노드에 보일 이름(사용자 제목 → 담긴 파일 이름 → 앱 이름). */
    readonly label: string;
    readonly title?: string | undefined;
    /** 지금 묶인 작업 문서(`AppBubble.ref`). */
    readonly ref?: string | undefined;
    /** 지금 담긴 결과 파일(`AppBubble.file`). */
    readonly file?: string | undefined;
  };
}

/**
 * 앱 몫 브리프. `text` 는 프로토콜 블록에 들어갈 그 노드의 줄들(영문 — 에이전트가 읽는 규약)이고,
 * `ref` 를 돌려주면 코어가 노드에 그 작업 문서를 묶는다(없던 문서를 앱이 새로 만들었을 때).
 */
export interface AppAgentBrief {
  readonly text: string;
  readonly ref?: string | undefined;
  readonly executionRequirements?: CommandExecutionRequirements & { readonly runLimits?: CreationRunLimits };
}

/** Required preparation failed: never substitute generic output instructions. */
export class AppAgentPreparationError extends Error {
  constructor(message: string) { super(message); this.name = 'AppAgentPreparationError'; }
}

export type AppAgentBriefBuilder = (args: AppAgentBriefArgs) => Promise<AppAgentBrief | null>;

/** A new task owns a distinct document; pending proposals stay with the old source. */
export interface AppTaskTarget { readonly ref?: string | undefined; readonly file?: string | undefined }
export interface AppTaskDocumentArgs {
  readonly projectId: string;
  readonly projectName: string;
  readonly mode: 'new' | 'copy';
  readonly source: AppTaskTarget;
  readonly title: string;
  /** Stable across transport retries of this one transition. */
  readonly requestId: string;
}
export type AppTaskDocumentBuilder = (args: AppTaskDocumentArgs) => Promise<AppTaskTarget>;

/**
 * §5.4 #36 (H) ③ — 구슬 하나(코어는 이 모양만 그린다). `group` — `scene` → `part` 순, 묶음 사이를 띄우고 "지난 결과"는 맨 끝 · `index` — 장면 번호(1부터, 아이콘 대신)
 * · `stage` — 테 모양(기획 점선 · 승인 실선 · 짓는 중 반쯤 참 · 끝 채움) · `active` — AI 가 지금 만지는 것(숨 쉰다)
 * · `file` — 루트 기준 상대 경로(`/`), 그림·영상이면 미리보기를 굽는다 · `label` — 툴팁 이름(사용자 내용이라 번역하지 않는다).
 */
export type AppLinkedItemKind = 'scene' | 'image' | 'video' | 'audio' | 'model' | 'font' | 'code' | 'text' | 'shape' | 'file';
/** 장면·단계의 진행. `proposed` = 에이전트가 낸 판이 사람의 고르기를 기다린다(3D 의 제안 대기 단계 · 그림의 제안). */
export type AppLinkedItemStage = 'plan' | 'proposed' | 'ready' | 'building' | 'done';

export interface AppLinkedItem {
  /** 노드 안에서 안정적인 id — 다음 읽기에도 같은 것은 같은 id(구슬이 깜빡이지 않게). */
  readonly id: string;
  readonly group: 'scene' | 'part';
  readonly kind: AppLinkedItemKind;
  readonly label: string;
  readonly index?: number | undefined;
  readonly stage?: AppLinkedItemStage | undefined;
  readonly active?: boolean | undefined;
  /** 길이(초) — 툴팁에 덧붙는다. */
  readonly durationSec?: number | undefined;
  /** 구슬 안 그림 파일. 장면·단계 구슬에 있으면 번호는 테두리의 작은 표식으로 내려간다(§5.1 #2-1 (F)). */
  readonly file?: string | undefined;
  /** 이 구슬이 대표하는 그림 수(단계의 캡처 등) — 툴팁에 덧붙는다. */
  readonly pictureCount?: number | undefined;
  /** 번호 구슬이 무엇을 세는가 — 없으면 장면. 만드는 단계(3D) · 고르기 전 제안(그림)은 툴팁이 그 말로 부른다. */
  readonly numbered?: 'step' | 'proposal' | undefined;
}

/** 구슬 줄을 읽을 때 받는 것. */
export interface AppLinkedItemsRequest {
  /** 프로젝트 루트 절대 경로. */
  readonly projectId: string;
  /** 노드를 보여 주는 프로젝트의 표시 이름(앱 REST 의 `project` 값을 이름으로 받는 앱이 쓴다). */
  readonly projectName: string;
  /** 노드에 묶인 작업 문서(`AppBubble.ref`). */
  readonly ref?: string | undefined;
  /** 노드에 담긴 결과 파일(`AppBubble.file`). */
  readonly file?: string | undefined;
}

/** 읽은 결과. `key` = 목록 판본(앞과 같으면 다시 안 그린다). 못 읽으면 `null`(던져도 같다) — 그 회차는 앞 결과를 둔다. */
export interface AppLinkedItemsSnapshot {
  readonly key: string;
  readonly items: readonly AppLinkedItem[];
}

export type AppLinkedItemsReader = (req: AppLinkedItemsRequest) => Promise<AppLinkedItemsSnapshot | null>;

export interface InternalApp {
  /** `AppBubble.appId` 에 저장되는 값. 바꾸면 기존 버블이 앱을 못 찾는다. */
  readonly id: string;
  /** i18n 키(`panel.apps.<id>.name`). */
  readonly nameKey: string;
  /** 화면에 쓰는 제품 이름(번역 ❌, 브랜드). `nameKey` 가 로케일에 없을 때의 defaultValue 라, `id` 를 넣으면 소문자 식별자가 버블에 찍힌다. */
  readonly name: string;
  readonly descKey: string;
  /** 버블·메뉴 색. Tailwind 클래스가 아니라 색 값 — 캔버스가 인라인으로 쓴다. */
  readonly color: string;
  readonly glow: string;
  /** 메뉴·버블·목록에 쓰는 stroke 아이콘. 이모지 금지. */
  readonly icon: () => JSX.Element;
  /** 캔버스 버블의 형태. 생략하면 `plate` — 어떤 앱도 원(에이전트)으로는 그려지지 않는다. */
  readonly bubbleShape?: AppBubbleShape;
  /** 명패 크기(§5.13 (M)) — 선언이 곧 렌더 치수다. */
  readonly defaultSize: { readonly width: number; readonly height: number };
  /** §5.4 #36 (F) — 위성 화면 크기(이어졌거나 결과를 담은 노드). `defaultSize` 처럼 선언이 곧 렌더 치수다. */
  readonly screenSize: { readonly width: number; readonly height: number };
  /**
   * §5.13 (R-1) — 이 앱이 여는 확장자(소문자, 마침표 포함). 코어(`resolveWorkspaceOpen`)는 선언만 훑는다.
   * 브라우저가 못 푸는 컨테이너(mkv·avi·wma…)는 적지 않는다 — 검은 화면이 된다(OS 연결 프로그램 몫 — §5.13 (R-6)).
   */
  readonly opens?: readonly string[];
  /** §5.13 (S-6) — `ref` 를 받는 이름(창 hash·shell params 키 — `docId`·`clipId` 등). 앱이 선언해야 앱 안 창도 알고 코어가 표를 들지 않는다((P-4)). */
  readonly refKey: string;
  /** 화면들 — 키 `mode`(기본 `main`), 값은 늦은 로더. 코어 `main.tsx` 는 `#app=<id>&mode=<mode>` 로 여기서 꺼낼 뿐이다. */
  readonly shells: Readonly<Record<string, AppShellLoader>>;
  /**
   * 독립 OS 창을 연다(§5.13 (S-5) 끌어내기·[별도 창으로]). `ref`·`file`(루트 기준 상대 — (R-2))은 코어가 뜻을 모르고 넘긴다.
   * 못 여는 환경(웹·구버전 preload)이면 false — 호출부가 안내를 띄울 수 있게.
   */
  readonly open: (args: AppOpenArgs) => Promise<boolean>;
  /** §5.13 (Q) — 스토리보드를 자기 문서로 받을 수 있는가. 선언이 없으면 콘티 보드의 [렌더] 대상에서 빠진다. */
  readonly storyboard?: StoryboardCapability;
  /** §5.4 #36 (C) — 노드 결과로 받는 확장자(생략하면 `opens`). (R-9) 이미지 앱처럼 파일 클릭은 가로채지 않되 결과는 받는 앱이 있어 따로 둔다. */
  readonly outputs?: readonly string[];
  /**
   * §5.1 #2-1 (A) — 프로젝트 밖 파일을 보기 전용(아무것도 쓰지 않음)으로 연다 — 바깥 미디어 더블클릭은 이 선언이 있는 앱만 연다(`file` 은 절대경로).
   * 그 파일로 프로젝트 문서를 짓는 편집기(영상·소리·3D)는 선언하지 않는다 — 바깥 파일은 폴더로 들어간다.
   */
  readonly viewsOutsideFiles?: boolean;
  /** §5.13 (R-9) · §5.4 #36 (F) — 결과 미리보기를 굽는 늦은 로더(앱 디코더로 한 장, 코어가 기억 — 비용은 `APP_THUMB` 이 묶는다). 없으면 아이콘 + 파일 이름. */
  readonly thumbnail?: () => Promise<AppThumbnailRenderer>;
  /** §5.1 #2-1 (G) ⑦ — 받는 확장자(`outputs ?? opens`) 중 굽는 함수가 못 푸는 것 — 처음부터 아이콘이다(요청 0건). 여는 것·색·더블클릭은 그대로. */
  readonly thumbnailSkips?: readonly string[];
  /** §5.4 #36 (G) — 결과 화면에서 캔버스 간단 조작(재생·돌려 보기·맞춤 등)을 그리는 늦은 로더. 없으면 정지 미리보기만, 보일 때만 청크(§5.13 (P-1)). */
  readonly canvasFace?: () => Promise<AppCanvasFace>;
  /** §5.13 (L) — `ref` 만 묶인 노드도 `canvasFace` 가 그린다(문서 모드). 선언이 없으면 결과 파일이 있을 때만. */
  readonly faceShowsRef?: boolean;
  /** §5.4 #36 (C) — 이어진 에이전트에게 노드를 설명하는 앱 몫 브리프(늦은 로더). 없으면 공통 문구(결과 파일을 만들어 `/output` 으로). */
  readonly agentBrief?: () => Promise<AppAgentBriefBuilder>;
  /** Prepare an independent document without rebinding or clearing the source node. */
  readonly taskDocument?: () => Promise<AppTaskDocumentBuilder>;
  /** §5.13 (V) 37-1·37-17 — 편집 화면(`main`)이 앱 테마를 따른다. 없으면 `DARK_THEME_LOCK`. 렌더·일꾼 화면은 늘 묶인다(그림은 테마가 아니다). */
  readonly followsTheme?: boolean;
  /** §5.4 #36 (H) ③ — 노드 아래 구슬 줄(장면·소재 등)을 읽는 늦은 로더 — 노드가 화면에 있을 때만 청크. 없으면 코어의 "지난 결과"(`AppBubble.pastFiles`)만 뜬다. */
  readonly linkedItems?: () => Promise<AppLinkedItemsReader>;
}

function VideoIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m10 9 5 3-5 3z" />
    </svg>
  );
}

/** 소리 — 파형 막대. 음표를 쓰지 않는 이유는 이 앱이 다루는 것이 악보가 아니라 **파형**이기 때문이다. */
function WaveIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 11v2" />
    </svg>
  );
}

/** 3D — 등각 정육면체. */
function CubeIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="M12 2.6 21 7.3v9.4L12 21.4 3 16.7V7.3z" />
      <path d="M3 7.3 12 12l9-4.7M12 12v9.4" />
    </svg>
  );
}

/** 이미지 — 액자 속 산과 해(lucide `image` 와 같은 문법의 stroke). */
function ImageIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </svg>
  );
}

/** 앱 화면이 받는 값. 앱이 해석하는 열쇠 이름(`refKey`)은 앱 선언에서 온다. */
export interface AppOpenArgs {
  projectId: string;
  ref?: string | undefined;
  file?: string | undefined;
  /** Durable editor draft identity, including models that do not have a source document yet. */
  draftKey?: string | undefined;
  title?: string | undefined;
  /** §5.13 (L) — 이 창을 연 노드(`AppBubble.id`) — 다른 문서를 고르면 그 노드가 기억한다. 노드에서 연 것이 아니면 비어 있다. */
  bubbleId?: string | undefined;
  /** 밖에 뜰 창의 크기·자리. `fromGhost`(§5.13 (S-10))면 main 이 x/y 대신 멈춰 선 선의 자리·크기를 쓴다 — 렌더러 좌표는 배율이 다른 모니터에서 어긋난다. */
  placement?: { width: number; height: number; x?: number; y?: number; fromGhost?: boolean } | undefined;
}

/** §5.13 (S-6) — 앱 화면 파라미터 한 벌 — OS 창과 앱 안 창이 같이 써야 한다(따로면 한쪽만 `docId` 를 실어 "안에서 열면 빈 화면"이 된다). */
/** §5.13 (L) — 앱 화면 파라미터에서 그 창을 연 캔버스 노드 id 를 싣는 이름(앱이 늘어도 같은 이름). */
export const APP_BUBBLE_PARAM = 'appBubbleId';

export function appShellParams(app: Pick<InternalApp, 'refKey'>, args: AppOpenArgs): Record<string, string> {
  const params: Record<string, string> = { projectId: args.projectId };
  if (args.ref !== undefined && args.ref !== '') params[app.refKey] = args.ref;
  if (args.file !== undefined && args.file !== '') params['file'] = args.file;
  if (args.draftKey !== undefined && args.draftKey !== '') params['draftKey'] = args.draftKey;
  if (args.bubbleId !== undefined && args.bubbleId !== '') params[APP_BUBBLE_PARAM] = args.bubbleId;
  return params;
}

/** 앱 OS 창을 여는 공통 경로(§5.13 (O) "창") — 앱마다 베끼면 파라미터 이름이 갈린다(`docId` 냐 `doc` 이냐). (S-1) 더블클릭이 아니라 끌어내기가 부른다. */
async function openAppOsWindow(appId: string, refKey: string, args: AppOpenArgs): Promise<boolean> {
  // 노드 id(`bubbleId`)도 `appShellParams` 가 함께 싣는다 — 밖에 나간 창에서 문서를 바꿔도 노드가 그 문서를 기억한다.
  const api = window.api?.app;
  if (!api) return false;
  const params = appShellParams({ refKey }, args);
  if (args.title) params['_windowTitle'] = args.title;
  await api.open(appId, params, args.placement);
  return true;
}

/** 등록된 내부 앱 — 새 앱은 항목 하나면 Apps 창·우클릭 메뉴·버블·창 열기·파일 열기가 따라온다. */
export const INTERNAL_APPS: readonly InternalApp[] = [
  {
    id: 'vibistudio',
    nameKey: 'panel.apps.vibistudio.name',
    name: 'Vibistudio',
    descKey: 'panel.apps.vibistudio.desc',
    // §5.13 (M) — 그레이파이트 + 실버 엣지. 채도 높은 색(예: #D946EF)은 캔버스에서 겉돈다 — 무채색 본체라야 프레임 안 흰 퍼포레이션·아이콘이 산다.
    color: '#2C3446',
    glow: '#A8B4CC',
    icon: VideoIcon,
    // 영상 앱이므로 필름 프레임. 가로가 긴 것 자체가 "영상"이라는 신호다.
    bubbleShape: 'film',
    // 240×150 의 1/3 — 앱 버블은 놓아 두는 물건이다(주인공은 에이전트 버블). 이 치수에서 읽히게 프레임 안쪽을 짰다.
    defaultSize: { width: 80, height: 50 },
    // §5.4 #36 (F) — 앱 위성 화면. 명패와 같은 1.6:1 이라 필름 프레임 인상이 그대로 커진다.
    screenSize: { width: 208, height: 130 },
    // 앞부분 한 프레임 + 길이. Mediabunny 는 이 앱 청크에만 있다 — 화면이 보일 때만 내려온다.
    thumbnail: async () => (await import('../components/VideoStudio/videoThumbnail.js')).renderVideoThumbnail,
    // §5.1 #2-1 (G) ⑦ — Mediabunny 1.61.5 의 Ogg 디먹서는 Vorbis·Opus 소리만 알고 영상 코덱에 Theora 가 없다 — `.ogv` 는
    //   받고 풀다 매번 실패했다. 굽지 않고 아이콘으로 둔다(여는 것은 `opens` 그대로).
    thumbnailSkips: ['.ogv'],
    // §5.4 #36 (G) — 캔버스에서 바로 재생·재생 위치·음소거. 디코더는 브라우저의 것(<video>)이라 무거운 의존성이 없다.
    //   §5.13 (L) — 문서만 묶인 노드는 그 문서의 지금 한 장(포스터)과 길이·판본을 비춘다(문서 모드).
    canvasFace: async () => (await import('../components/VideoStudio/VideoCanvasFace.js')).VideoCanvasFace,
    faceShowsRef: true,
    // §5.4 #36 (C) 개정 — 이 노드는 완성 파일 납품처가 아니라 **작업 문서**다. 에이전트는 문서를 코드(컴포지션)와
    //   데이터로 짓고, 렌더는 사용자가 시킬 때만 한다. 브리프가 문서를 만들어 노드에 묶는다.
    agentBrief: async () => (await import('../components/VideoStudio/vibistudioBrief.js')).buildVibistudioBrief,
    taskDocument: async () => (await import('../components/VideoStudio/videoTaskDocument.js')).prepareVideoTaskDocument,
    // §5.13 (V) 37-1 — 편집 화면은 다크/라이트 테마를 따른다(미리보기 무대 안의 그림은 그대로 어둡다).
    followsTheme: true,
    // §5.4 #36 (H) ③ — 노드 아래 구슬 줄: 장면(시간 순 · 단계 · AI 가 만지는 장면)과 소재(컴포지션 코드·그림·영상·소리·글꼴).
    linkedItems: async () => (await import('../components/VideoStudio/videoLinkedItems.js')).readVibistudioLinkedItems,
    // 동봉 ffmpeg 에 데먹서가 있어 **그냥 열리는** 것들(H.264-in-MKV 재생 실측 확인).
    //   여기 없는 avi·wmv·flv 등은 (R-8) 변환 갈래가 받는다 — 바깥으로 내보내지 않는다.
    opens: ['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.mkv', '.3gp', '.3g2'],
    refKey: 'docId',
    shells: {
      // 편집 창.
      main: async () => (await import('../components/VideoStudio/VideoStudioShell.js')).VideoStudioShell,
      // 보이지 않는 오프스크린 렌더 무대(§5.13 (F)) — 사람이 보는 화면이 아니다.
      render: async () => (await import('../components/VideoStudio/VideoRenderShell.js')).VideoRenderShell,
      // §5.13 (T-4) — 창 없는 렌더 일꾼. 스틸·프레임 띠·렌더 일감을 집어 처리한다(스튜디오가 닫혀 있어도).
      worker: async () => (await import('../components/VideoStudio/VideoWorkerShell.js')).VideoWorkerShell,
    },
    open: async (args) => openAppOsWindow('vibistudio', 'docId', args),
    // §5.13 (Q) — 콘티를 받아 타임라인 문서로 옮긴다. 늦은 로더라 안 부르면 안 실린다.
    storyboard: {
      accept: async (args) => (await import('../components/VideoStudio/contiHandoff.js')).acceptStoryboard(args),
    },
  },
  {
    id: 'vibisound',
    nameKey: 'panel.apps.vibisound.name',
    name: 'Vibisound',
    descKey: 'panel.apps.vibisound.desc',
    // 스튜디오 방음재의 인상 — 어두운 청록 본체 + 형광 없는 민트 엣지. 영상 앱(청회색)과
    // 한 가족으로 보이되 캔버스에서 구별은 되는 거리.
    color: '#22383A',
    glow: '#8FD3C7',
    icon: WaveIcon,
    defaultSize: { width: 80, height: 50 },
    screenSize: { width: 208, height: 130 },
    // 파형 + 길이 — 이 앱의 파형 함수(`computePeaks`)를 그대로 쓴다.
    thumbnail: async () => (await import('../components/Vibisound/soundThumbnail.js')).renderSoundThumbnail,
    // §5.4 #36 (G) — 캔버스에서 바로 듣기 · 파형을 눌러 위치 옮기기. 들은 만큼 파형이 밝아진다.
    canvasFace: async () => (await import('../components/Vibisound/SoundCanvasFace.js')).SoundCanvasFace,
    // §5.4 #36 (H) ③ — 노드 아래 구슬 줄: 묶인 문서의 원본 소리들(이름·길이).
    linkedItems: async () => (await import('../components/Vibisound/soundLinkedItems.js')).readVibisoundLinkedItems,
    // §5.1 #2-1 (G) ⑦ — mp4 소리의 다른 이름(`.m4b` 오디오북 · `.m4r` 벨소리)도 같은 엔진이 푼다.
    opens: ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.weba', '.m4b', '.m4r'],
    refKey: 'clipId',
    agentBrief: async () => (await import('../components/Vibisound/soundAgentBrief.js')).buildSoundAgentBrief,
    taskDocument: async () => (await import('../components/Vibisound/soundTaskDocument.js')).prepareSoundTaskDocument,
    shells: {
      main: async () => (await import('../components/Vibisound/VibisoundShell.js')).VibisoundShell,
    },
    open: async (args) => openAppOsWindow('vibisound', 'clipId', args),
  },
  {
    id: 'vibi3d',
    nameKey: 'panel.apps.vibi3d.name',
    name: 'Vibi3D',
    descKey: 'panel.apps.vibi3d.desc',
    // 뷰포트 배경의 인상 — 짙은 보라 회색 본체 + 라벤더 엣지.
    color: '#2E2A3E',
    glow: '#B9A8E0',
    icon: CubeIcon,
    defaultSize: { width: 80, height: 50 },
    screenSize: { width: 208, height: 130 },
    // 한 장 찍은 정지 화면 — 이 앱의 모델 로더로 읽고, 찍자마자 WebGL 문맥을 버린다.
    thumbnail: async () => (await import('../components/Vibi3D/modelThumbnail.js')).renderModelThumbnail,
    // §5.4 #36 (G) — 끌어 돌려 보기 · 자동 회전. 손을 떼고 잠시 지나면 문맥을 돌려주고 그 각도를 한 장으로 남긴다.
    canvasFace: async () => (await import('../components/Vibi3D/ModelCanvasFace.js')).ModelCanvasFace,
    faceShowsRef: true,
    // §5.1 #2-1 (G) ⑦ — VRM 은 glb 그릇이라 같은 로더가 읽는다(`modelIO` 의 glb 갈래).
    opens: ['.glb', '.gltf', '.obj', '.stl', '.ply', '.fbx', '.dae', '.3mf', '.vrm'],
    refKey: 'modelId',
    agentBrief: async () => (await import('../components/Vibi3D/vibi3dBrief.js')).buildVibi3DBrief,
    taskDocument: async () => (await import('../components/Vibi3D/modelTaskDocument.js')).prepareModelTaskDocument,
    linkedItems: async () => (await import('../components/Vibi3D/modelLinkedItems.js')).readVibi3DLinkedItems,
    shells: {
      main: async () => (await import('../components/Vibi3D/Vibi3DShell.js')).Vibi3DShell,
    },
    open: async (args) => openAppOsWindow('vibi3d', 'modelId', args),
  },
  {
    // §5.13 (R-9) — 이미지. 캔버스 참조 노드(§5.4 #36)의 네 번째 갈래.
    id: 'vibimage',
    nameKey: 'panel.apps.vibimage.name',
    name: 'Vibimage',
    descKey: 'panel.apps.vibimage.desc',
    // 인화지의 인상 — 따뜻한 흑갈색 본체 + 모래빛 엣지. 영상(청회)·소리(청록)·3D(보라회)와 한 가족이되 구별된다.
    color: '#2F2A24',
    glow: '#E6C79C',
    icon: ImageIcon,
    defaultSize: { width: 80, height: 50 },
    screenSize: { width: 208, height: 130 },
    // `opens` 는 일부러 비운다 — 선언하면 파일 클릭의 그림 미리보기(라이트박스 주석 도구, §5.5 #17-25)
    //   갈래를 이 앱이 가로챈다. 이 앱은 **노드에 담긴 그림**을 여는 자리다(§5.13 (R-9)).
    // §5.1 #2-1 (G) ⑦ — 브라우저가 그대로 푸는 이름만 다른 형식(JPEG 의 다른 확장자 · 움직이는 PNG).
    outputs: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.avif', '.jfif', '.jpe', '.apng'],
    // §5.1 #2-1 (A) — 그림은 (R-9) 보기 화면(아무것도 쓰지 않음)으로 열리므로 프로젝트 밖 그림도 연다. 바깥 그림에선 [편집]을 숨긴다(셸).
    viewsOutsideFiles: true,
    // 그 그림을 화면 크기로 줄여 구운 한 장(원본을 노드마다 통째로 디코딩해 들고 있지 않게).
    thumbnail: async () => (await import('../components/Vibimage/imageThumbnail.js')).renderImageThumbnail,
    // §5.4 #36 (G) — 채우기 ↔ 맞춤 · 클립보드로 복사(원본을 PNG 로).
    canvasFace: async () => (await import('../components/Vibimage/ImageCanvasFace.js')).ImageCanvasFace,
    faceShowsRef: true,
    refKey: 'imageId',
    agentBrief: async () => (await import('../components/Vibimage/imageAgentBrief.js')).buildVibimageBrief,
    taskDocument: async () => (await import('../components/Vibimage/imageTaskDocument.js')).prepareImageTaskDocument,
    // §5.4 #36 (H) ③ · §5.1 #2-1 (F) 앱별 — 노드 아래 구슬 줄: 제안 대기(번호 · 점선 테) · 레이어(그림은 미리보기 · 글 · 도형).
    linkedItems: async () => (await import('../components/Vibimage/imageLinkedItems.js')).readVibimageLinkedItems,
    shells: {
      main: async () => (await import('../components/Vibimage/VibimageShell.js')).VibimageShell,
    },
    open: async (args) => openAppOsWindow('vibimage', 'imageId', args),
  },
];

/** §5.4 #36 (C) — 받는 확장자(`outputs ?? opens`). 아이콘·로더를 건드리지 않아 앱 코드를 끌어오지 않는다. */
export function appOutputExtensions(app: Pick<InternalApp, 'outputs' | 'opens'>): readonly string[] {
  return app.outputs ?? app.opens ?? [];
}

export function getInternalApp(appId: string): InternalApp | undefined {
  return INTERNAL_APPS.find((a) => a.id === appId);
}

/** §5.13 (R-1) — 앱들이 선언한 여는 확장자 목록(`resolveWorkspaceOpen` 용). 아이콘·로더를 건드리지 않아 앱 코드를 끌어오지 않는다. */
export function workspaceOpenClaims(): readonly WorkspaceOpenAppClaim[] {
  const claims: WorkspaceOpenAppClaim[] = [];
  for (const app of INTERNAL_APPS) {
    if (app.opens && app.opens.length > 0) claims.push({ appId: app.id, opens: app.opens });
  }
  return claims;
}

/** §5.13 (Q) — 스토리보드를 받는 앱들(보드는 비었는지만 본다). (H) 설치가 없어 선언이 곧 자격 — 인자는 호출부 세 곳의 시그니처 때문에 남겨 두고 쓰지 않는다. */
export function listStoryboardApps(_defaults?: UserDefaults | null | undefined): readonly InternalApp[] {
  return INTERNAL_APPS.filter((a) => a.storyboard !== undefined);
}
