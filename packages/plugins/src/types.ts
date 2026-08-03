/**
 * §5.11 v3.88 — 플러그인 구현 모듈 계약.
 *
 * 매니페스트(`PluginManifest`, shared)는 **선언**이고 이 파일의 모듈 타입은 **구현**이다. 둘을 나눈 이유는
 * PluginsWindow 가 비활성 플러그인의 코드를 건드리지 않고도 목록·설명·기여 종류를 보여줄 수 있어야 하기 때문.
 *
 * **컨텍스트는 읽기 전용 스냅샷만 넘긴다.** 스토어 핸들이나 `set` 함수를 넘기는 순간 플러그인이 코어를
 * 직접 변형할 수 있게 되어 §5.11 의 "슬롯 경유만" 경계가 무너진다.
 */
import type { ReactNode } from 'react';
import type { AgentConfig, AgentEvent, AgentReport, AgentReview, BashEntry, BrainInjectionEvent, BrainSummary, BubbleType, PluginManifest, CaptureBubble, RunningSubagentTask, SubAgent, TaskEdge } from '@vibisual/shared';

/** 플러그인 작성자가 shared 를 따로 물지 않게 재수출 — 플러그인은 `../types.js` 하나만 보면 된다. */
export type { PluginManifest };

/** 호스트가 주입하는 번역 함수 — 플러그인이 react-i18next 를 직접 물지 않게 한다(i18next 인스턴스 이중화 방지). */
export type PluginTranslate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 플러그인이 요구할 수 있는 추가 데이터.
 *
 * 컨텍스트에 전부 실어 보내면 버블 하나당 비용이 플러그인 수와 무관하게 커진다. 그래서 모듈이
 * `needs` 로 선언한 것만 호스트가 계산해 넣는다(선언 안 하면 `data` 는 비어 있다).
 */
export type PluginDataNeed =
  | 'agentEvents'
  | 'subAgents'
  | 'runningTasks'
  | 'agentReports'
  | 'agentReviews'
  | 'brain'
  | 'brainInjections'
  | 'taskEdges'
  | 'captureBubbles'
  | 'bashCommands';

/** `needs` 로 요청한 것만 채워지는 읽기 전용 데이터. */
export interface PluginAgentData {
  agentEvents?: readonly AgentEvent[];
  subAgents?: readonly SubAgent[];
  runningTasks?: readonly RunningSubagentTask[];
  agentReports?: readonly AgentReport[];
  agentReviews?: readonly AgentReview[];
  /** 활성 프로젝트의 기억 요약(§5.10). 프로젝트 단위라 버블과 무관하게 같은 값이 온다. */
  brain?: BrainSummary | null;
  /** 이 에이전트에 기억이 주입된 이벤트들. */
  brainInjections?: readonly BrainInjectionEvent[];
  /** 이 에이전트가 양끝 중 하나인 Task Edge 들. */
  taskEdges?: readonly TaskEdge[];
  /** 지금 캔버스에 떠 있는 화면 캡처 버블들(프로젝트 단위). */
  captureBubbles?: readonly CaptureBubble[];
  /**
   * 이 에이전트의 세션들이 실행한 Bash 기록.
   *
   * 서버는 bash 를 **세션 id** 로 저장하고 에이전트는 자기 세션 목록을 갖고 있으므로, 호스트가 그 둘을
   * 조인해 넘긴다(서버 신규 수집 경로 ❌ — 이미 있는 두 조각을 잇기만 한다).
   */
  bashCommands?: readonly BashEntry[];
}

/** 버블 1개의 읽기 전용 스냅샷. */
export interface PluginBubbleContext {
  bubbleId: string;
  bubbleType: BubbleType;
  label: string;
  /** 우리가 만든 커스텀/CMD 에이전트인지(false = Claude Code 훅으로 등록된 외부 세션). */
  customCreated: boolean;
  /** 에이전트 버블에 한해 존재. 플러그인은 이 값을 **읽기만** 한다. */
  agentConfig?: AgentConfig | undefined;
  /** `PluginClientModule.needs` 로 요청한 데이터만 채워진다. */
  data: PluginAgentData;
  /** 지금 시각(ms). 경과 시간 계산이 렌더마다 흔들리지 않도록 호스트가 한 번만 준다. */
  now: number;
  t: PluginTranslate;
}

/** DetailPanel 섹션 컨텍스트 — 현재는 버블 컨텍스트와 동일. */
export type PluginPanelContext = PluginBubbleContext;

/**
 * 호스트가 허용한 **동작**만 담긴 좁은 채널.
 *
 * 버블·패널 슬롯은 표시 전용을 유지한다. 헤더 기여만 이 채널을 받는데, 그것도 스토어 핸들이 아니라
 * **호스트가 이름 붙여 연 동작**만 준다 — 플러그인이 임의로 코어를 조작하는 길은 끝까지 열지 않는다.
 */
export interface PluginActions {
  /** 돌고 있는 모든 세션을 멈추고 예약된 루프까지 끊는다. 멈춘 에이전트 수를 돌려준다. */
  stopEverything: () => Promise<number>;
}

/** 헤더 기여 컨텍스트 — 특정 버블에 매이지 않는다. */
export interface PluginHeaderContext {
  t: PluginTranslate;
  now: number;
  /** 지금 살아 있는 세션을 가진 에이전트 수. */
  liveAgents: number;
  actions: PluginActions;
}

export interface PluginHeaderItem {
  key: string;
  /** 평상시엔 숨기고 필요할 때만 띄우고 싶으면 여기서 거른다. */
  match?: (ctx: PluginHeaderContext) => boolean;
  render: (ctx: PluginHeaderContext) => ReactNode;
}

/** PluginsWindow 우측의 플러그인 자체 설정 컨텍스트. */
export interface PluginSettingsContext {
  enabled: boolean;
  t: PluginTranslate;
}

export interface PluginBubbleBadge {
  /** 같은 플러그인 안에서 유일한 키(React key). */
  key: string;
  /** 이 버블에 배지를 그릴지. false 면 render 호출 자체를 건너뛴다. */
  match: (ctx: PluginBubbleContext) => boolean;
  render: (ctx: PluginBubbleContext) => ReactNode;
}

/** 카드의 심각도 — 호스트가 정렬·접힘을 정하는 유일한 근거다. */
export type PluginSeverity = 'bad' | 'warn' | 'neutral' | 'good';

export interface PluginPanelSection {
  key: string;
  match: (ctx: PluginPanelContext) => boolean;
  render: (ctx: PluginPanelContext) => ReactNode;
  /**
   * 카드를 그리기 **전에** 심각도만 알려 준다.
   *
   * 카드가 111종이 되면 켠 것을 다 펼쳐 두는 것은 못 쓴다. 호스트가 문제부터 위로 올리고 조용한 카드는
   * 접어 두려면 렌더 결과를 열어 보지 않고도 등급을 알아야 하므로, 이 함수만 따로 받는다.
   * 없으면 `neutral` 로 본다.
   */
  severity?: (ctx: PluginPanelContext) => PluginSeverity;
}

/** 플러그인의 클라이언트 기여 묶음. */
/**
 * Plugins 창이 "이 카드를 켜면 뭘 보게 되는가"를 보여 주기 위해 읽는 정보.
 *
 * 설명을 따로 지어 쓰지 않는다 — **카드가 실제로 그리는 행의 i18n 키**를 그대로 넘긴다.
 * 그래야 예시가 화면과 어긋나지 않고, 12개 로케일 번역도 이미 되어 있다.
 */
export interface PluginUsage {
  /** i18n 지붕(`panel.plugins.<camelId>`). */
  i18nKey: string;
  /**
   * 이 카드가 패널에 그리는 행 라벨들의 **지붕 아래 상대 키**.
   *
   * 골격(`defineInspector`)이 만든 카드는 `check.<key>`, 손으로 쓴 카드는 그 카드가 실제로 부르는 키
   * (`row.mode` · `class.mutating` · `leg.data` …)를 그대로 넣는다. 창은 여기에 지붕만 붙여 번역하므로
   * **새 문자열을 만들지 않는다** — 화면에 뜨는 행 이름과 창의 설명이 같은 키를 보게 하는 것이 목적이다.
   */
  checkKeys: string[];
  /** 배지를 다는 조건이 있는가 — "문제일 때만 뜬다"를 알려 주기 위해. */
  badgeIsConditional: boolean;
}

export interface PluginClientModule {
  manifest: PluginManifest;
  /** 창에 보여 줄 사용 정보. 골격(`defineInspector`)이 자동으로 채운다. */
  usage?: PluginUsage;
  /** 이 플러그인이 컨텍스트에 채워 달라고 요청하는 데이터. 선언한 것만 온다. */
  needs?: PluginDataNeed[];
  bubbleBadges?: PluginBubbleBadge[];
  panelSections?: PluginPanelSection[];
  headerItems?: PluginHeaderItem[];
  settingsSection?: (ctx: PluginSettingsContext) => ReactNode;
}

/**
 * 플러그인의 서버 기여 묶음.
 *
 * 라우트는 `/api/plugins/<id>/*` 하위에만 마운트되며, 호스트가 `requirePluginEnabled(id)` 로 감싸므로
 * 비활성 상태에서 호출되면 409 로 끊긴다(플러그인이 활성 여부를 직접 확인할 필요 없음).
 */
export interface PluginServerModule {
  manifest: PluginManifest;
  /** express Router 를 반환. 타입 의존을 피하려고 `unknown` 으로 받고 호스트가 캐스팅한다. */
  createRouter?: () => unknown;
}
