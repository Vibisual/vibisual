/**
 * §5.13 (N) — 내부 앱 레지스트리.
 *
 * **앱을 앞으로 계속 늘릴 것**이므로, 앱 하나가 코어에 남기는 자국이 상수여야 한다.
 * 새 앱을 추가하는 일은 이 배열에 항목 하나를 더하는 것으로 끝난다 — Apps 창의 목록도,
 * 우클릭 메뉴의 앱 카테고리도, 캔버스 버블의 색·아이콘·이름도, 더블클릭했을 때 열리는
 * 창도, **어떤 파일을 그 앱이 여는지**도 전부 이 선언 하나에서 나온다.
 *
 * 플러그인(§5.11)과 다르다. 플러그인은 배지·패널·설정 세 슬롯에 기여하는 얇은 층이라
 * 코드가 항상 앱 안에 있다. **내부 앱은 무거워서 기본 번들에 넣을 수 없는 것들**이고,
 * 그래서 화면 코드는 늦은 `import()` 로만 온다.
 *
 * §5.13 (H) 개정 — **설치라는 단계는 없다.** 앱은 프로젝트에 기본으로 귀속되어 있고,
 * 파일을 누르거나 버블을 열면 그 자리에서 바로 열린다. "안 쓰면 비용이 없다"는 규율은
 * 설치 여부가 아니라 **늦은 로더**가 지킨다(안 부르면 그 청크는 내려오지 않는다).
 */

import type { ComponentType, JSX, ReactNode } from 'react';
import type { Conti, ContiRenderStatus, StoryboardPreset, UserDefaults, WorkspaceOpenAppClaim } from '@vibisual/shared';

/** 앱 창이 받는 것. 무엇을 쓸지는 앱이 정한다 — 코어는 hash 를 그대로 넘길 뿐이다. */
export interface AppShellProps {
  readonly appId: string;
  readonly params: Readonly<Record<string, string>>;
}

/** 화면 하나를 늦게 불러오는 함수. 정적 import 로 바꾸면 부팅 번들이 불어난다. */
export type AppShellLoader = () => Promise<ComponentType<AppShellProps>>;

/**
 * 캔버스 버블의 생김새(§5.13 (M) v4.60).
 *
 * **원은 없다.** 커스텀 에이전트 버블이 원이라, 앱 버블이 원이면 캔버스에서 둘을 구별할
 * 방법이 사라진다. 조작 감각(더블클릭·우클릭·드래그)은 에이전트와 같게 두되 형태는 갈라 놓는다.
 *
 * - `film` — 위아래 필름 퍼포레이션 띠(네모 구멍)가 있는 가로 프레임. 영상 앱용. 화면(§5.4 #36 (G))에서는 머리줄 위
 *   가장자리의 네모 구멍 한 줄이 같은 신호를 잇는다.
 * - `plate` — 사각 명패(4px 모서리 — §5.4 #36 (G) 컴팩트). 아직 자기 형태가 없는 앱의 기본값.
 */
export type AppBubbleShape = 'film' | 'plate';

/**
 * §5.13 (Q) — 캔버스의 스토리보드(콘티) 한 벌을 앱에게 넘길 때 건네는 것.
 *
 * 코어는 **어떤 앱이 이것을 받는지 모른다**(§5.13 (P-4)). "받겠다고 선언한 앱"을
 * 레지스트리에서 찾아 부를 뿐이고, 앱은 자기 id 를 결과에 담아 돌려준다.
 */
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
 * §5.4 #36 (F) — 앱 위성 화면에 비출 **미리보기 한 장**. 코어는 이 두 모양만 그린다(앱 이름을 모른다).
 *
 * - `picture` — 앱이 구운 그림의 blob URL. 코어 캐시가 밀어낼 때 되돌린다(`URL.revokeObjectURL`).
 *   `fit` 은 화면에 담는 법 — 사진·영상 프레임은 꽉 채우고(`cover`), 배경이 투명한 정지 화면은 통째로(`contain`).
 * - `wave` — 0~1 로 맞춘 막대 높이들(소리).
 *
 * `durationSec` 은 길이가 있는 결과(영상·소리)의 길이 — 화면 모서리 숫자가 된다.
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
}

/** 못 구우면 `null` — 코어가 아이콘 + 파일 이름으로 대신한다. 던져도 `null` 과 같다. */
export type AppThumbnailRenderer = (req: AppThumbnailRequest) => Promise<AppThumbnail | null>;

/**
 * §5.4 #36 (G) — 앱 위성 화면의 **안쪽**을 앱이 그릴 때 받는 것. 결과가 담긴 화면에서만 그려진다.
 *
 * 앱은 여기서 **캔버스에서 바로 하는 간단한 조작**(재생·재생 위치·돌려 보기·맞춤·복사)을 낸다. 편집은 하지 않는다 —
 * 편집은 더블클릭·[에디터에서 열기]로 여는 앱 창의 몫이다. 공용 부품(조작줄·단추·재생 위치 막대·정지 미리보기)은
 * `apps/canvasFaceKit.tsx` 한 벌을 쓴다 — 앱마다 생김새가 갈리지 않게.
 */
export interface AppCanvasFaceProps {
  /** 프로젝트 루트 절대 경로. */
  readonly projectId: string;
  /** 루트 기준 상대 경로(`AppBubble.file`). 담긴 결과 파일이 없으면 빈 문자열(`faceShowsRef` 앱의 문서 모드). */
  readonly file: string;
  /**
   * §5.13 (L) — 노드가 가리키는 앱의 **작업 문서**(`AppBubble.ref` — 영상 앱이면 문서 id). `faceShowsRef` 를 선언한
   * 앱만 받는다 — 결과 파일이 아니라 지금 고치는 중인 문서를 비춘다. (이름이 `ref` 가 아닌 까닭: React 가 그 이름을
   * 컴포넌트에 넘기지 않고 가로챈다.)
   */
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

/**
 * §5.4 #36 (C) 개정 — 에이전트에게 **이 노드가 무엇인지** 말하는 앱 몫의 브리프를 지을 때 받는 것.
 *
 * 종전에는 모든 앱 노드에 같은 문구("결과 파일을 만들어 넣어라")를 붙였다. 그래서 영상 앱 노드에도 에이전트가
 * 완성 mp4 를 구워 넣었다 — 사용자가 원한 것은 코드로 짓고 검수·편집하며 다듬는 **작업 문서**였다.
 */
export interface AppAgentBriefArgs {
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
}

export type AppAgentBriefBuilder = (args: AppAgentBriefArgs) => Promise<AppAgentBrief | null>;

/**
 * §5.4 #36 (H) ③ — 앱 노드 아래 **구슬 줄**에 꿸 "연결된 것" 하나. 코어는 이 모양만 그린다(앱 이름을 모른다).
 *
 * - `group` — 묶음. 구슬 줄은 `scene` → `part` 순서로 늘어서고 묶음 사이를 띄운다(코어의 "지난 결과"는 맨 끝에 붙는다).
 * - `kind` — 구슬 안 아이콘과 툴팁의 종류 이름.
 * - `index` — 차례가 있는 것(장면)의 번호(1부터). 있으면 아이콘 대신 번호가 적힌다.
 * - `stage` — 진행 단계. 구슬 테의 모양이 된다(기획 = 점선 · 승인 = 실선 · 짓는 중 = 반쯤 참 · 끝 = 채움).
 * - `active` — AI 가 지금 만지는 것(문서의 활동 표식). 구슬이 숨 쉰다.
 * - `file` — 프로젝트 루트 기준 상대 경로(`/` 구분). 그림·영상이면 구슬 안에 작은 미리보기를 굽는다.
 * - `label` — 툴팁에 쓰는 이름(장면 제목·파일 이름 — 사용자 내용이라 번역하지 않는다).
 */
export type AppLinkedItemKind = 'scene' | 'image' | 'video' | 'audio' | 'model' | 'font' | 'code' | 'text' | 'file';
export type AppLinkedItemStage = 'plan' | 'ready' | 'building' | 'done';

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
  readonly file?: string | undefined;
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

/**
 * 읽은 결과. `key` 는 이 목록의 판본(문서 판본·활동 표식 등) — 앞 결과와 같으면 코어가 다시 그리지 않는다.
 * 못 읽었으면 `null` 을 돌려준다(그 회차는 앞 결과를 그대로 둔다). 던져도 `null` 과 같다.
 */
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
  /**
   * 화면에 그대로 쓰는 **제품 이름**. 번역 대상이 아니라 브랜드다.
   *
   * `nameKey` 가 아직 로케일에 없으면 i18n 이 defaultValue 로 떨어지는데, 그 자리에
   * `id` 를 넣어 두면 버블에 소문자 식별자(`vibistudio`)가 그대로 찍힌다 — 사용자가 보는
   * 것은 제품 이름이어야 한다. 로케일이 채워지면 번역이 이 값을 덮는다.
   */
  readonly name: string;
  readonly descKey: string;
  /** 버블·메뉴 색. Tailwind 클래스가 아니라 색 값 — 캔버스가 인라인으로 쓴다. */
  readonly color: string;
  readonly glow: string;
  /** 메뉴·버블·목록에 쓰는 stroke 아이콘. 이모지 금지. */
  readonly icon: () => JSX.Element;
  /** 캔버스 버블의 형태. 생략하면 `plate` — 어떤 앱도 원(에이전트)으로는 그려지지 않는다. */
  readonly bubbleShape?: AppBubbleShape;
  /** 명패 크기 — 캔버스에 놓아 둔 앱 버블(§5.13 (M) v4.66). 선언이 곧 렌더 치수다. */
  readonly defaultSize: { readonly width: number; readonly height: number };
  /**
   * §5.4 #36 (F) — 앱 위성 **화면** 크기. 에이전트에 이어졌거나 결과를 담은 노드는 명패 대신 이 크기로
   * 그려져 담긴 결과를 비춘다. `defaultSize` 와 같이 선언이 곧 렌더 치수다.
   */
  readonly screenSize: { readonly width: number; readonly height: number };
  /**
   * §5.13 (R-1) — **이 앱이 여는 확장자**(소문자, 마침표 포함).
   *
   * 확장자와 앱의 대응표를 코어에 두지 않기 위한 자리다. 코어(`resolveWorkspaceOpen`)는
   * "받겠다고 선언한 앱이 있는가"만 훑으므로, 앱이 늘어도 클릭 판정 코드는 그대로다.
   *
   * **열 수 있는 것만 적는다.** 브라우저가 디코드하지 못하는 컨테이너(mkv·avi·wma…)를 적으면
   * 눌렀을 때 검은 화면이 뜬다 — 그런 것은 OS 연결 프로그램의 몫이다(§5.13 (R-6)).
   */
  readonly opens?: readonly string[];
  /**
   * §5.13 (S-6) — 이 앱이 `ref` 를 받는 **이름**(창 hash·shell params 의 키).
   *
   * 영상 앱이면 `docId`, 소리면 `clipId` 처럼 뜻이 앱마다 다르므로 앱이 선언한다. 종전에는
   * `open()` 안에만 문자열로 적혀 있어서, **앱 안 창**이 같은 앱을 열려 해도 그 이름을 알 길이
   * 없었다(코어가 앱마다 표를 드는 순간 (P-4) 가 깨진다).
   */
  readonly refKey: string;
  /**
   * 이 앱의 화면들. 키는 `mode`(기본 `main`)이고 값은 늦게 부르는 로더다.
   *
   * **코어의 `main.tsx` 는 앱 이름을 모른다** — `#app=<id>&mode=<mode>` 를 보고 여기서
   * 로더를 꺼내 쓸 뿐이라, 앱이 늘어도 부팅 분기는 하나 그대로다.
   */
  readonly shells: Readonly<Record<string, AppShellLoader>>;
  /**
   * 이 앱의 **독립 OS 창**을 연다(§5.13 (S-5) — 끌어내기·[별도 창으로] 가 부르는 길).
   *
   * `ref` 는 앱이 해석하는 열쇠(영상 앱이면 문서 id)이고, `file` 은 **프로젝트 루트 기준
   * 상대 경로**다(§5.13 (R-2)). 코어는 둘 다 뜻을 모르고 그대로 넘긴다.
   * 창을 못 여는 환경(웹·구버전 preload)이면 false 를 돌려준다 — 조용히 아무 일도
   * 안 일어나는 대신 호출부가 안내를 띄울 수 있게.
   */
  readonly open: (args: AppOpenArgs) => Promise<boolean>;
  /**
   * §5.13 (Q) — 이 앱이 캔버스의 스토리보드를 받아 자기 문서로 옮길 수 있는가.
   *
   * 선언하지 않은 앱은 콘티 보드의 [렌더] 대상에서 그냥 빠진다 — 코어에 분기가 늘지 않는다.
   */
  readonly storyboard?: StoryboardCapability;
  /**
   * §5.4 #36 (C) — 참조 노드로서 **결과로 받는 확장자**(소문자, 마침표 포함).
   *
   * 생략하면 `opens` 를 쓴다. 따로 두는 이유는 (R-9) 이미지 앱처럼 파일 클릭의 갈래(`opens`)는 가로채지
   * 않되 노드에 담길 결과는 받는 앱이 있기 때문이다. 에이전트에게 "이 노드는 무엇을 받는다"를 말할 때 쓴다.
   */
  readonly outputs?: readonly string[];
  /**
   * §5.13 (R-9) → §5.4 #36 (F) 개정 — 화면에 담긴 결과를 **어떻게 비출지** 앱이 굽는 늦은 로더.
   *
   * 첫 판은 `'image'` 한 값(그림만)이었고 영상·3D 는 디코딩 비용 때문에 뺐다. 이제 앱이 자기 디코더로 한 장을
   * 굽고 코어가 기억한다 — 비용은 "보이는 화면만 · 한 번 굽고 캐시 · 동시 건수 상한"(`APP_THUMB`)이 묶는다.
   * 늦은 로더라 그 화면이 보이기 전에는 앱 코드가 내려오지 않는다. 선언하지 않은 앱의 화면은 아이콘 + 파일 이름.
   */
  readonly thumbnail?: () => Promise<AppThumbnailRenderer>;
  /**
   * §5.4 #36 (G) — 결과가 담긴 화면에서 **캔버스에서 바로 하는 간단한 조작**을 그리는 늦은 로더(재생·돌려 보기·맞춤 등).
   * 선언하지 않은 앱의 화면은 정지 미리보기만 보인다. 그 화면이 보일 때만 청크가 내려온다(§5.13 (P-1)).
   */
  readonly canvasFace?: () => Promise<AppCanvasFace>;
  /**
   * §5.13 (L) — 결과 파일 없이 **작업 문서(`ref`)만 묶인 노드**도 `canvasFace` 가 그린다(문서 모드 — 지금 고치는 중인
   * 문서를 비춘다). 선언하지 않은 앱은 종전대로 결과 파일이 있을 때만 그린다.
   */
  readonly faceShowsRef?: boolean;
  /**
   * §5.4 #36 (C) 개정 — 이어진 에이전트에게 이 앱 노드가 무엇인지 말하는 **앱 몫 브리프**(늦은 로더). 선언하지 않은 앱은
   * 종전 공통 문구(결과 파일을 만들어 `/output` 으로 넣어라)를 쓴다. 코어는 앱 이름을 모르고 이 선언만 부른다(§5.13 (P-4)).
   */
  readonly agentBrief?: () => Promise<AppAgentBriefBuilder>;
  /**
   * §5.13 (V) 37-1·37-17 — 이 앱의 **편집 화면(`main`)이 앱 테마를 따른다.** 선언하지 않은 앱 화면은 종전대로 어두운 판에
   * 묶인다(`DARK_THEME_LOCK` — 고정 어두운 바탕을 전제로 칠한 화면). 렌더·일꾼 같은 다른 화면은 선언과 무관하게 묶인다
   * (그림은 테마가 아니다). 코어는 앱 이름을 모르고 이 선언만 본다(§5.13 (P-4)).
   */
  readonly followsTheme?: boolean;
  /**
   * §5.4 #36 (H) ③ — 이 앱 노드에 **연결된 것**(장면·소재 등)을 노드 아래 구슬 줄로 띄울 때 읽는 늦은 로더. 무엇이 버블로
   * 떠야 하는지는 앱이 안다 — 코어는 앱 이름을 모르고 목록만 그린다(§5.13 (P-4)). 선언하지 않은 앱 노드에는 코어의
   * "지난 결과"(`AppBubble.pastFiles`)만 뜬다. 그 노드가 화면에 있을 때만 청크가 내려온다.
   */
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
  title?: string | undefined;
  /**
   * §5.13 (L) — 이 창을 연 캔버스 노드(`AppBubble.id`). 앱이 다른 작업 문서를 고르면 그 노드가 그 문서를 기억한다
   * (다음에 열면 그 문서로 연다). 노드에서 연 것이 아니면 비어 있다.
   */
  bubbleId?: string | undefined;
  /**
   * 밖에 뜰 창의 크기·자리. `fromGhost` 면 §5.13 (S-10) 끌어낸 판이라 main 의 선(가상 창)이 그 자리에
   * 멈춰 서 있다 — main 은 x/y 대신 그 선의 자리·크기를 쓴다(렌더러 좌표는 배율이 다른 모니터에서 어긋난다).
   */
  placement?: { width: number; height: number; x?: number; y?: number; fromGhost?: boolean } | undefined;
}

/**
 * §5.13 (S-6) — 앱 화면에 넘길 파라미터 한 벌.
 *
 * **OS 창과 앱 안 창이 같은 것을 받아야 한다.** 두 곳에서 따로 만들면 `docId` 를 한쪽만 실어
 * "밖에서 열면 그 문서, 안에서 열면 빈 화면" 같은 어긋남이 생긴다.
 */
/** §5.13 (L) — 앱 화면 파라미터에서 그 창을 연 캔버스 노드 id 를 싣는 이름(앱이 늘어도 같은 이름). */
export const APP_BUBBLE_PARAM = 'appBubbleId';

export function appShellParams(app: Pick<InternalApp, 'refKey'>, args: AppOpenArgs): Record<string, string> {
  const params: Record<string, string> = { projectId: args.projectId };
  if (args.ref !== undefined && args.ref !== '') params[app.refKey] = args.ref;
  if (args.file !== undefined && args.file !== '') params['file'] = args.file;
  if (args.bubbleId !== undefined && args.bubbleId !== '') params[APP_BUBBLE_PARAM] = args.bubbleId;
  return params;
}

/**
 * 앱의 **독립 OS 창**을 여는 공통 경로(§5.13 (O) 세 통로 중 "창").
 *
 * 앱마다 이 여덟 줄을 베끼면 파라미터 이름이 앱마다 갈린다(`docId` 냐 `doc` 이냐). 여는 방법은
 * 하나여야 하므로 여기 모은다.
 *
 * §5.13 (S-1) — 이제 이 길은 **더블클릭이 아니라 끌어내기**가 부른다. 앱은 앱 안 창으로 먼저
 * 열리고(`apps/appWindows.ts`), 밖이 필요한 사람만 이 문을 지난다.
 */
async function openAppOsWindow(appId: string, refKey: string, args: AppOpenArgs): Promise<boolean> {
  // 노드 id(`bubbleId`)도 `appShellParams` 가 함께 싣는다 — 밖에 나간 창에서 문서를 바꿔도 노드가 그 문서를 기억한다.
  const api = window.api?.app;
  if (!api) return false;
  const params = appShellParams({ refKey }, args);
  if (args.title) params['_windowTitle'] = args.title;
  await api.open(appId, params, args.placement);
  return true;
}

/**
 * 등록된 내부 앱들.
 *
 * 새 앱은 여기에 한 항목만 추가하면 Apps 창·우클릭 메뉴·버블·창 열기·파일 열기가 전부 따라온다.
 */
export const INTERNAL_APPS: readonly InternalApp[] = [
  {
    id: 'vibistudio',
    nameKey: 'panel.apps.vibistudio.name',
    name: 'Vibistudio',
    descKey: 'panel.apps.vibistudio.desc',
    // §5.13 (M) v4.66 — 필름 스톡 그레이파이트 + 실버 엣지.
    //   구 푸시아(#D946EF)는 채도가 높아 캔버스에서 겉돌았고 "제대로 만든 도구"의 인상과
    //   반대였다(사용자 지적). 같은 이유로 이미 한 번 걷어낸 색이다 — §5.10 Brain 버블의
    //   핑크(#EC4899)→인디고. 영상 도구의 표준 인상은 채도 높은 색이 아니라 어두운 무채색
    //   본체 + 금속 엣지이고, 그래야 프레임 안의 흰 퍼포레이션·아이콘이 주인공이 된다.
    color: '#2C3446',
    glow: '#A8B4CC',
    icon: VideoIcon,
    // 영상 앱이므로 필름 프레임. 가로가 긴 것 자체가 "영상"이라는 신호다.
    bubbleShape: 'film',
    // v4.66 — 240×150 의 1/3(사용자 지시). 캔버스의 주인공은 에이전트 버블이고 앱 버블은
    //   "놓아 두는 물건"이라 이 정도가 맞다. 이 치수에서 읽히도록 프레임 안쪽을 다시 짰다.
    defaultSize: { width: 80, height: 50 },
    // §5.4 #36 (F) — 앱 위성 화면. 명패와 같은 1.6:1 이라 필름 프레임 인상이 그대로 커진다.
    screenSize: { width: 208, height: 130 },
    // 앞부분 한 프레임 + 길이. Mediabunny 는 이 앱 청크에만 있다 — 화면이 보일 때만 내려온다.
    thumbnail: async () => (await import('../components/VideoStudio/videoThumbnail.js')).renderVideoThumbnail,
    // §5.4 #36 (G) — 캔버스에서 바로 재생·재생 위치·음소거. 디코더는 브라우저의 것(<video>)이라 무거운 의존성이 없다.
    //   §5.13 (L) — 문서만 묶인 노드는 그 문서의 지금 한 장(포스터)과 길이·판본을 비춘다(문서 모드).
    canvasFace: async () => (await import('../components/VideoStudio/VideoCanvasFace.js')).VideoCanvasFace,
    faceShowsRef: true,
    // §5.4 #36 (C) 개정 — 이 노드는 완성 파일 납품처가 아니라 **작업 문서**다. 에이전트는 문서를 코드(컴포지션)와
    //   데이터로 짓고, 렌더는 사용자가 시킬 때만 한다. 브리프가 문서를 만들어 노드에 묶는다.
    agentBrief: async () => (await import('../components/VideoStudio/vibistudioBrief.js')).buildVibistudioBrief,
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
    opens: ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.weba'],
    refKey: 'clipId',
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
    opens: ['.glb', '.gltf', '.obj', '.stl', '.ply', '.fbx', '.dae', '.3mf'],
    refKey: 'modelId',
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
    outputs: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.avif'],
    // 그 그림을 화면 크기로 줄여 구운 한 장(원본을 노드마다 통째로 디코딩해 들고 있지 않게).
    thumbnail: async () => (await import('../components/Vibimage/imageThumbnail.js')).renderImageThumbnail,
    // §5.4 #36 (G) — 채우기 ↔ 맞춤 · 클립보드로 복사(원본을 PNG 로).
    canvasFace: async () => (await import('../components/Vibimage/ImageCanvasFace.js')).ImageCanvasFace,
    refKey: 'imageId',
    shells: {
      main: async () => (await import('../components/Vibimage/VibimageShell.js')).VibimageShell,
    },
    open: async (args) => openAppOsWindow('vibimage', 'imageId', args),
  },
];

/**
 * §5.4 #36 (C) — 참조 노드로서 받는 확장자. `outputs` 가 없으면 `opens`(그 앱이 여는 것이 곧 받는 것).
 * 아이콘·로더를 건드리지 않으므로 앱 코드를 끌어오지 않는다.
 */
export function appOutputExtensions(app: Pick<InternalApp, 'outputs' | 'opens'>): readonly string[] {
  return app.outputs ?? app.opens ?? [];
}

export function getInternalApp(appId: string): InternalApp | undefined {
  return INTERNAL_APPS.find((a) => a.id === appId);
}

/**
 * §5.13 (R-1) — 앱들이 선언한 "내가 여는 확장자" 목록.
 *
 * 클릭 판정(`resolveWorkspaceOpen`)에 그대로 넘긴다. 코어가 표를 들지 않는다는 규약이
 * 실제로 지켜지는 자리이며, 이 함수는 **아이콘·로더를 건드리지 않으므로** 앱 코드를 끌어오지 않는다.
 */
export function workspaceOpenClaims(): readonly WorkspaceOpenAppClaim[] {
  const claims: WorkspaceOpenAppClaim[] = [];
  for (const app of INTERNAL_APPS) {
    if (app.opens && app.opens.length > 0) claims.push({ appId: app.id, opens: app.opens });
  }
  return claims;
}

/**
 * §5.13 (Q) — 스토리보드를 받을 수 있는 앱들.
 *
 * 콘티 보드는 이 목록이 비었는지만 보고 [렌더] 를 켜고 끈다. 앱 이름을 묻지 않으므로
 * 두 번째 영상 앱이 와도 보드 쪽 코드는 그대로다.
 *
 * (H) 개정 전에는 여기서 **설치된 것만** 골랐다. 설치가 사라졌으므로 선언이 곧 자격이다.
 * 인자는 호출부 세 곳의 시그니처를 흔들지 않기 위해 남겨 두고 쓰지 않는다.
 */
export function listStoryboardApps(_defaults?: UserDefaults | null | undefined): readonly InternalApp[] {
  return INTERNAL_APPS.filter((a) => a.storyboard !== undefined);
}
