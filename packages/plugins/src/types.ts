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
import type { AgentConfig, AgentEvent, AgentReport, AgentReview, BashEntry, BrainInjectionEvent, BrainSummary, BubbleType, PluginFactMap, PluginManifest, CaptureBubble, RunningSubagentTask, SubAgent, TaskEdge } from '@vibisual/shared';

/** 플러그인 작성자가 shared 를 따로 물지 않게 재수출 — 플러그인은 `../types.js` 하나만 보면 된다. */
export type { PluginManifest, PluginFactMap };

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
  | 'bashCommands'
  | 'pluginFacts';

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
  /**
   * §5.11 v4.65 — **이 프로젝트에서 집행이 실제로 측정한 값**(pluginId → 실측 한 벌).
   *
   * 카드는 클라에 있어 프로젝트 파일을 볼 수 없다. 집행(`buildBlock`)은 서버에서 파일을 훑어 판단하므로,
   * 그 판단 근거를 카드가 같이 그리려면 서버가 내려 준 이 값을 읽어야 한다. 자기 실측은
   * `data.pluginFacts?.[<자기 id>]` 로 꺼낸다(남의 카드 실측도 보이지만, 남의 것을 그리는 것은 카드
   * 경계를 넘는 일이라 하지 않는다).
   *
   * 아직 아무 값도 없을 수 있다 — 그 프로젝트에서 턴이 한 번도 안 돌았거나 꺼져 있던 경우다.
   * **없음을 0 으로 그리지 마라**(그러면 "SSOT 가 없다"는 거짓이 된다).
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
  /**
   * §5.11 v4.67 — 이 창이 손대는 프로젝트 루트. 프로젝트가 안 열려 있으면 null.
   *
   * 켬/끔이 프로젝트별이므로 설정도 프로젝트별이다. 이 값이 없으면 설정 UI 는 "프로젝트를 먼저 여세요"만
   * 말하고 아무것도 저장하지 않아야 한다 — 어디에 저장되는지 모르는 저장 버튼이 가장 나쁘다.
   */
  projectPath?: string | null;
  /**
   * §5.11 v4.67 — 호스트가 여는 **플러그인 전용 REST 창구**.
   *
   * 경로는 `/api/plugins/<이 플러그인 id>/…` 아래로만 간다(호스트가 접두사와 프로젝트 지정을 붙인다).
   * 그래서 플러그인은 서버 주소도, 지금 프로젝트가 무엇인지도 몰라도 되고, 남의 라우트로는 못 간다.
   * 없을 수도 있다(그 슬롯을 안 여는 호스트) — 없으면 설정 UI 는 읽기 전용으로 그린다.
   */
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
 * 집행 슬롯(`agentPrompt`)이 받는 읽기 전용 맥락 — §5.11 v4.57.
 *
 * **파일 접근은 호스트가 넘긴 두 탐침뿐이다.** 플러그인 패키지가 `node:fs` 를 직접 물면 이 패키지가
 * 클라이언트 번들에서도 노드 의존을 끌게 되고, 무엇보다 플러그인이 프로젝트 밖 아무 경로나 읽을 수 있게
 * 된다. 경로 정규화·루트 이탈 차단은 **호스트가 한 번만** 한다(§5.11 "슬롯 경유만").
 */
export interface PluginPromptContext {
  /** 프로젝트 루트 절대경로 = 켬/끔 판정 키(`enabledPluginsByProject`) 와 같은 값. */
  projectPath: string;
  /** 이 턴을 실행하는 세션의 작업 폴더. 워크트리 격리면 projectPath 와 다르다. */
  cwd: string;
  agentId: string;
  agentLabel: string;
  /** 우리가 만든 커스텀/CMD 에이전트인가(false = 외부 훅으로 붙은 세션). */
  customCreated: boolean;
  /** 프로젝트 루트 기준 상대경로가 실제로 있는가. 루트 밖은 호스트가 무조건 false 로 끊는다. */
  fileExists: (relPath: string) => boolean;
  /**
   * 프로젝트 루트 기준 상대 파일. 없으면 null.
   *
   * 호스트가 **전문**을 준다(상한 4MB, 넘으면 앞부분 + 잘렸다는 표시). 문서에서 무엇을 찾을지는
   * 호스트가 알 수 없으므로 앞부분만·앞뒤만 주는 방식은 쓰지 않는다 — 실제로 이 저장소의 SSOT 문서는
   * `Change Log` 헤딩이 파일 정중앙에 있어 두 방식 모두 오판했다.
   */
  readFile: (relPath: string) => string | null;
  /**
   * §5.11 v4.67 — 파일의 마지막 수정 시각(ms). 없거나 못 읽으면 null.
   *
   * **어긋남(drift)을 재려면 내용만으로는 부족하다.** 문서가 코드보다 뒤처졌는지는 "언제 고쳤는가"의
   * 문제이고, 그것을 알려면 시각이 필요하다(`ssot-drift` 가 이름값을 하려면 반드시 있어야 하는 축).
   * 서브프로세스(`git log`)를 부르지 않고 `.git/logs/HEAD` 같은 파일의 시각으로 같은 답을 얻는다.
   *
   * **선택 필드다** — 옛 호스트(이 탐침을 안 넘기는 앱)에 얹어도 플러그인이 그대로 돌아야 하므로,
   * 쓰는 쪽은 항상 없을 수 있다고 보고 없으면 그 축만 조용히 접는다.
   */
  fileMtimeMs?: (relPath: string) => number | null;
}

/**
 * 플러그인의 **집행** 기여 — 이 프로젝트에서 켜져 있는 동안 에이전트의 매 턴 프롬프트에 실린다.
 *
 * 돌려주는 것은 문자열 한 덩어리뿐이고, 빈 값이면 아무것도 붙지 않는다(무관한 프롬프트 소음 금지 —
 * 켠 프로젝트에서만·낼 말이 있을 때만 실린다).
 */
export interface PluginPromptModule {
  /**
   * 매니페스트 통째가 아니라 **id 만** 든다.
   *
   * 골격(`defineInspector`)이 만든 매니페스트는 React 카드와 같은 모듈에 있어서, 그것을 물면 서버가
   * 프롬프트 한 줄 만들려고 React 를 끌어온다. 관문에 필요한 것은 켬/끔 판정 키 하나뿐이므로 id 만 받고,
   * 표시용 정보가 필요하면 `getPluginManifest(id)`(등록부, React 무관)로 찾는다.
   * 등록부에 없는 id 는 배럴이 걸러낸다.
   */
  id: string;
  buildBlock: (ctx: PluginPromptContext) => string | undefined;
  /**
   * §5.11 v4.65 — **집행이 무엇을 보고 그렇게 판단했는가**(선택).
   *
   * 프롬프트에 실은 문장만으로는 사용자가 켠 결과를 확인할 수 없다. 여기서 낸 얕은 값 한 벌이
   * 스냅샷 `pluginFacts[projectPath][id]` 로 내려가 **같은 카드의 계기판에 그대로** 표시된다.
   * 그래야 "프롬프트는 이 문서를 SSOT 로 싣는데 화면은 다른 것을 센다"가 생기지 않는다.
   *
   * 규율: `buildBlock` 과 **같은 판정 함수**에서 파생시켜라(두 번 계산하면 둘이 갈린다).
   * 낼 것이 없으면 구현하지 않으면 된다 — 없으면 카드가 종전 계기판으로 폴백한다.
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
   * §5.11 자립 규약 ⑥ — **폴더 안에 사는 REST 창구.**
   *
   * 종전에는 `createRouter` 하나뿐이었고, 그것을 쓰려면 플러그인이 express 를 물어야 했다. 그래서 첫
   * 서버 기여(`ssot-drift` 설정 창구)는 이 배럴을 우회해 호스트 코어에 손으로 붙었고, 그 폴더를 다른 앱에
   * 복사해도 서버 쪽은 따라가지 않았다 — 자립 규약이 클라이언트에서만 지켜지고 있었다는 뜻이다.
   *
   * 여기서는 **틀만 선언**한다. 프레임워크(express)도, 파일 접근도 플러그인 쪽에 없다 — 호스트가
   * `PluginServerHost` 로 필요한 것만 건네고, 경로 정규화·루트 이탈 차단·원자적 쓰기는 호스트가 한 번만 한다.
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
   * 파싱된 JSON 본문 — **값은 전부 `unknown`** 이라 카드가 하나씩 확인하고 써야 한다.
   *
   * 형태(객체)만 호스트가 맞춰 준다. `unknown` 그대로 주면 카드마다 `as { doc?: unknown }` 같은 캐스트를
   * 적게 되고, 그 한 줄이 자립 규약 ⑤(타입 우회 금지)를 어긴다 — 신뢰할 수 없는 입력을 좁히는 일은
   * 경계에 선 호스트가 한 번만 하는 것이 맞다.
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
