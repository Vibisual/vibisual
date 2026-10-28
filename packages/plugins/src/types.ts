/**
 * §5.11 — 플러그인 구현 모듈 계약(선언 `PluginManifest` 와 나눠 PluginsWindow 가 비활성 코드를 안 건드린다).
 * **컨텍스트는 읽기 전용 스냅샷만** — 스토어 핸들·`set` 을 넘기면 플러그인이 코어를 바꿔 §5.11 "슬롯 경유만" 경계가 무너진다.
 */
import type { ReactNode } from 'react';
import type { AgentConfig, AgentEvent, AgentReport, AgentReview, AutoGoalSummary, BashEntry, BubbleType, PluginFactMap, PluginManifest, CaptureBubble, RunningSubagentTask, SubAgent, TaskEdge } from '@vibisual/shared';
// §5.11 정독 게이트 — 절 색인·영수증·인용·신뢰도 계약(서버·클라와 같은 한 벌).
import type {
  PlatformName,
  SpecCitation, SpecGateStrength, SpecIndex, SpecReadSpan, SpecReadingRoute,
  SpecReadingSettings, SpecReadingScope, SpecReadingScopeState, SpecRequiredEntry, SpecTrust, SpecUnit, SpecUnitStatus,
} from '@vibisual/shared';

/** 플러그인 작성자가 shared 를 따로 물지 않게 재수출 — 플러그인은 `../types.js` 하나만 보면 된다. */
export type { PluginManifest, PluginFactMap };
export type {
  SpecCitation, SpecGateStrength, SpecIndex, SpecReadSpan, SpecReadingRoute,
  SpecReadingSettings, SpecReadingScope, SpecReadingScopeState, SpecRequiredEntry, SpecTrust, SpecUnit, SpecUnitStatus,
};

/** 호스트가 주입하는 번역 함수 — 플러그인이 react-i18next 를 직접 물지 않게 한다(i18next 인스턴스 이중화 방지). */
export type PluginTranslate = (key: string, options?: Record<string, unknown>) => string;

/** 플러그인이 요구할 수 있는 추가 데이터 — 모듈이 `needs` 로 선언한 것만 호스트가 계산해 넣는다(선언 안 하면 `data` 는 비고, 전부 실으면 버블마다 비용이 커진다). */
export type PluginDataNeed =
  | 'agentEvents'
  | 'subAgents'
  | 'runningTasks'
  | 'agentReports'
  | 'agentReviews'
  | 'autoGoal'
  | 'taskEdges'
  | 'captureBubbles'
  | 'bashCommands'
  | 'pluginFacts';

/** `needs` 로 요청한 것만 채워지는 읽기 전용 데이터. */
export interface PluginAgentData {
  agentEvents?: readonly AgentEvent[];
  subAgents?: readonly SubAgent[];
  runningTasks?: readonly RunningSubagentTask[];
  agentReports?: readonly AgentReport[];
  agentReviews?: readonly AgentReview[];
  /**
   * §5.10 — 활성 프로젝트의 자동 목표 요약(되풀이가 절차로 굳은 정도).
   * 프로젝트 단위라 버블과 무관하게 같은 값이 온다. **꺼져 있으면 `null`** 이다 —
   * 0 과 구분해야 카드가 "아직 없다"와 "이 축을 안 쓴다"를 다르게 말할 수 있다.
   */
  autoGoal?: AutoGoalSummary | null;
  /** 이 에이전트가 양끝 중 하나인 Task Edge 들. */
  taskEdges?: readonly TaskEdge[];
  /** 지금 캔버스에 떠 있는 화면 캡처 버블들(프로젝트 단위). */
  captureBubbles?: readonly CaptureBubble[];
  /** 이 에이전트의 세션들이 실행한 Bash 기록 — 호스트가 서버의 세션별 bash 와 에이전트 세션 목록을 조인해 넘긴다(새 수집 경로 ❌). */
  bashCommands?: readonly BashEntry[];
  /**
   * §5.11 — 이 프로젝트에서 집행이 실제로 잰 값(pluginId → 실측 한 벌) — 프로젝트 파일을 못 보는 카드가 집행 근거를 그리는 통로.
   * 자기 것만 `data.pluginFacts?.[<자기 id>]` 로 꺼낸다. 턴이 안 돌았거나 꺼졌으면 없다 — **없음을 0 으로 그리지 마라**.
   */
  pluginFacts?: Readonly<Record<string, PluginFactMap>>;
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
  /** §5.11 — 이 창이 손대는 프로젝트 루트(설정도 프로젝트별). null(프로젝트 미열림)이면 설정 UI 는 아무것도 저장하지 않는다 — 어디 저장될지 모르는 저장 버튼이 가장 나쁘다. */
  projectPath?: string | null;
  /** §5.11 — 호스트가 여는 플러그인 전용 REST 창구 — `/api/plugins/<이 플러그인 id>/…` 아래로만(접두사·프로젝트는 호스트가 붙인다). 없으면 설정 UI 는 읽기 전용. */
  call?: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
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
  /** 렌더 전에 심각도만 알려 준다 — 호스트가 렌더 결과를 열지 않고 문제를 올리고 조용한 카드를 접는다. 없으면 `neutral`. */
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
   * 패널 행 라벨의 지붕 아래 상대 키 — 골격 카드는 `check.<key>`, 손으로 쓴 카드는 실제로 부르는 키(`row.mode` 등).
   * 창은 지붕만 붙여 번역한다 — **새 문자열을 만들지 않는다**(행 이름과 창 설명이 같은 키를 보게).
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
 * 집행 슬롯(`agentPrompt`)의 읽기 전용 맥락(§5.11). **파일 접근은 호스트 탐침뿐** — `node:fs` 를 물면 클라 번들이 노드에 묶이고 프로젝트 밖도 읽힌다.
 * 경로 정규화·루트 이탈 차단은 호스트가 한 번만(§5.11 "슬롯 경유만").
 */
export interface PluginPromptContext {
  /** 프로젝트 루트 절대경로 = 켬/끔 판정 키(`enabledPluginsByProject`) 와 같은 값. */
  projectPath: string;
  /** 이 턴을 실행하는 세션의 작업 폴더. 워크트리 격리면 projectPath 와 다르다. */
  cwd: string;
  agentId: string;
  agentLabel: string;
  /**
   * §5.5 #17-44 ⑧ — 이 턴을 도는 **세션**(`SubAgent.id`). 세션 축이 없는 호출에서는 비어 있다.
   *
   * 켬/끔 3층의 맨 아래 칸을 고르는 열쇠다. **선택 필드**이고(`fileMtimeMs`·`listFiles` 와 같은 규율)
   * 없으면 그 층만 조용히 접혀 에이전트·프로젝트 층으로 판정이 내려간다.
   */
  subAgentId?: string;
  /** 우리가 만든 커스텀/CMD 에이전트인가(false = 외부 훅으로 붙은 세션). */
  customCreated: boolean;
  /** 프로젝트 루트 기준 상대경로가 실제로 있는가. 루트 밖은 호스트가 무조건 false 로 끊는다. */
  fileExists: (relPath: string) => boolean;
  /**
   * 프로젝트 루트 기준 상대 파일(없으면 null). 호스트가 **전문**을 준다(상한 4MB, 넘으면 앞부분 + 잘림 표시)
   * — 앞부분만·앞뒤만 주면 파일 중앙의 `Change Log` 헤딩 같은 것을 놓친다.
   */
  readFile: (relPath: string) => string | null;
  /**
   * §5.11 — 파일의 마지막 수정 시각(ms), 없거나 못 읽으면 null. 어긋남은 "언제 고쳤나"라 필요하다(`.git/logs/HEAD` 시각으로 `git log` 없이).
   * **선택 필드** — 안 넘기는 옛 호스트에서도 돌아야 하니 없으면 그 축만 접는다.
   */
  fileMtimeMs?: (relPath: string) => number | null;
  /**
   * §5.11 정독 게이트 — 폴더를 훑어 루트 기준 상대경로 목록을 돌려준다(후보 이름 나열은 `docs/기획/전투.md` 같은 이름 앞에서 헛돈다).
   * 루트 밖은 호스트가 끊고 양은 `opts` 상한 안에서 자른다(깊은 트리를 다 돌면 UI 정지 — 서버가 메인 프로세스와 한 몸). **선택 필드.**
   */
  listFiles?: (
    relDir: string,
    opts?: { maxDepth?: number; extensions?: readonly string[]; limit?: number },
  ) => string[];
  /**
   * §5.11 정독 게이트 — 이번 턴 사용자 프롬프트 원문.
   *
   * 필수 절을 고르려면 "이번에 무슨 일을 하려는가"를 봐야 하는데, 그것은 파일에 없다. 위 탐침들과
   * 같은 규율로 **선택 필드**이고, 없으면 프롬프트 축 라우팅만 접힌다(경로·명시 매핑 축은 그대로).
   */
  promptText?: string;
  /** 이 세션이 이미 건드린 파일(프로젝트 루트 기준 상대경로) — 경로 축 라우팅의 재료. */
  touchedPaths?: readonly string[];
  /**
   * 이 세션의 **읽기 영수증**(파일 → 열람 구간). 서버가 훅에서 모아 넘긴다.
   *
   * 플러그인은 파일을 볼 수는 있어도 "이 세션이 그 구간을 열었는가"는 알 수 없다 — 그것은 도구 호출
   * 이력이고 호스트만 갖고 있다. 없으면 열람 판정 없이 **목록과 규칙만** 싣는다(그래도 집행은 선다).
   */
  readingSpans?: Readonly<Record<string, readonly SpecReadSpan[]>>;
  /** 이 세션에서 이미 대조를 마친 인용들(중복 요구를 피하고 확증 결과를 블록에 되비친다). */
  readingCitations?: readonly SpecCitation[];
  /**
   * §5.11 정독 게이트 — 호스트가 안 변하는 규칙 줄을 시스템 프롬프트(`--append-system-prompt`)에 실었는가. 참이면 매 턴 블록은 목록·강도만.
   * 시스템 프롬프트가 없는 경로(훅으로 붙은 외부 세션)는 안 넘긴다. **실제로 실을 때만 켠다** — 켜 놓고 안 실으면 규칙이 어디에도 없다.
   */
  promptRulesInSystem?: boolean;
  /** 이 프로젝트의 정독 설정(호스트가 체크포인트에서 읽어 넘긴다). 없으면 파일·기본값으로 떨어진다. */
  specSettings?: SpecReadingSettings;
  /**
   * 이 호스트가 도는 OS — 경로를 키로 쓸 때만(멀티플랫폼 1축). 색인 경로와 훅 열람 경로를 맞추는 케이스 정책은 플러그인이 못 정한다
   * (`process.platform` 은 클라에서도 로드돼 안 읽는다). 안 넘기면 `projectPath` 모양으로 추정, 그것도 못 하면 접지 않는다.
   */
  platform?: PlatformName;
}

/**
 * 플러그인의 **집행** 기여 — 이 프로젝트에서 켜져 있는 동안 에이전트의 매 턴 프롬프트에 실린다.
 *
 * 돌려주는 것은 문자열 한 덩어리뿐이고, 빈 값이면 아무것도 붙지 않는다(무관한 프롬프트 소음 금지 —
 * 켠 프로젝트에서만·낼 말이 있을 때만 실린다).
 */
export interface PluginPromptModule {
  /** id 만 든다 — 골격 매니페스트는 React 카드와 같은 모듈이라 물면 서버가 React 를 끌어온다. 표시용은 `getPluginManifest(id)`(등록부)로. 등록부에 없는 id 는 배럴이 거른다. */
  id: string;
  buildBlock: (ctx: PluginPromptContext) => string | undefined;
  /**
   * §5.11 — 집행이 무엇을 보고 판단했는가(선택). 이 얕은 값이 스냅샷 `pluginFacts[projectPath][id]` 로 내려가 같은 카드 계기판에 보인다.
   * `buildBlock` 과 **같은 판정 함수**에서 파생시켜라(두 번 계산하면 갈린다). 낼 것이 없으면 구현하지 않는다 — 카드가 기본 계기판으로 폴백한다.
   */
  survey?: (ctx: PluginPromptContext) => PluginFactMap | undefined;
}

/**
 * 플러그인의 서버 기여 묶음.
 *
 * 라우트는 `/api/plugins/<id>/*` 하위에만 마운트되며, 호스트가 `requirePluginEnabled(id)` 로 감싸므로
 * 비활성 상태에서 호출되면 409 로 끊긴다(플러그인이 활성 여부를 직접 확인할 필요 없음).
 */
export interface PluginServerModule {
  manifest: PluginManifest;
  /**
   * §5.11 자립 규약 ⑥ — 폴더 안에 사는 REST 창구(틀만 선언, express·파일 접근은 플러그인 쪽에 없다).
   * 호스트가 `PluginServerHost` 로 필요한 것만 건네고 경로 정규화·루트 이탈 차단·원자적 쓰기를 한 번만 한다.
   */
  routes?: readonly PluginRoute[];
  /** @deprecated express Router 직접 반환 — 새 카드는 `routes` 를 쓴다(프레임워크를 폴더 밖에 둔다). */
  createRouter?: () => unknown;
}

/** 한 요청이 플러그인에게 보이는 전부. 프레임워크 객체(req/res)는 넘기지 않는다. */
export interface PluginRouteRequest {
  /** 이 요청이 다루는 프로젝트 루트. 호스트가 `?projectId=` → 마지막 활성 프로젝트 순으로 정한다. */
  projectPath: string | null;
  /** 프로젝트 폴더 이름 — 문서 뼈대처럼 이름이 필요한 곳에 쓴다(경로 조작은 호스트 몫). */
  projectName: string | null;
  /**
   * 파싱된 JSON 본문 — 형태(객체)만 호스트가 맞추고 값은 전부 `unknown` 이라 카드가 하나씩 확인한다
   * (통째 `unknown` 이면 카드마다 캐스트를 적어 자립 규약 ⑤를 어긴다 — 입력 좁히기는 경계의 호스트가 한 번만).
   */
  body: Readonly<Record<string, unknown>>;
  /** 화면 언어(`x-vibisual-locale`). 없으면 `'en'`. */
  locale: string;
}

/** 플러그인이 돌려주는 응답. 상태를 안 주면 200. */
export interface PluginRouteResponse {
  status?: number;
  body: unknown;
}

export interface PluginRoute {
  method: 'get' | 'put' | 'post';
  /** `/api/plugins/<id>/` 뒤에 붙는 부분. 예: `'config'`. */
  path: string;
  handle: (req: PluginRouteRequest, host: PluginServerHost) => PluginRouteResponse;
}

/**
 * 호스트가 서버측 플러그인에게 여는 창구 — **이것 말고는 바깥이 없다.**
 *
 * 클라이언트 쪽 `ctx.call` 과 같은 원칙이다(§5.11 "슬롯 경유만"): 플러그인은 `node:fs` 도 서버 내부
 * 서비스도 모르고, 프로젝트 루트를 벗어나는 길도 없다.
 */
export interface PluginServerHost {
  /** 집행(`buildBlock`)이 받는 것과 같은 좁은 파일 탐침. 루트 밖은 "없는 것"으로 보인다. */
  probe: (projectPath: string) => Pick<PluginPromptContext, 'fileExists' | 'readFile' | 'fileMtimeMs'>;
  /** 프로젝트 안 상대경로에 원자적으로 쓴다. 루트를 벗어나는 경로면 아무것도 쓰지 않고 `false`. */
  writeProjectFile: (projectPath: string, relPath: string, text: string) => boolean;
  /** 이 플러그인이 집행에서 실제로 잰 값. 아직 잰 적이 없으면 `null`. */
  facts: (projectPath: string, pluginId: string) => PluginFactMap | null;
  /** 방금 쓴 내용이 곧바로 반영되도록 읽기·실측 캐시를 비운다(읽기 캐시에 TTL 이 있다). */
  invalidate: (projectPath: string) => void;
  log: (message: string) => void;
}
