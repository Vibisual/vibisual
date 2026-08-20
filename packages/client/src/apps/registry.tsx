/**
 * §5.13 (N) — 내부 앱 레지스트리.
 *
 * **앱을 앞으로 계속 늘릴 것**이므로, 앱 하나가 코어에 남기는 자국이 상수여야 한다.
 * 새 앱을 추가하는 일은 이 배열에 항목 하나를 더하는 것으로 끝난다 — Apps 창의 목록도,
 * 설치 여부 판정도, 우클릭 메뉴의 앱 카테고리도, 캔버스 버블의 색·아이콘·이름도,
 * 더블클릭했을 때 열리는 창도 전부 이 선언 하나에서 나온다.
 *
 * 플러그인(§5.11)과 다르다. 플러그인은 배지·패널·설정 세 슬롯에 기여하는 얇은 층이라
 * 코드가 항상 앱 안에 있다. **내부 앱은 무거워서 기본 번들에 넣을 수 없는 것들**이고,
 * 그래서 "설치"라는 단계가 따로 있다.
 */

import type { ComponentType, JSX } from 'react';
import type { Conti, ContiRenderStatus, StoryboardPreset, UserDefaults } from '@vibisual/shared';

/** 앱 창이 받는 것. 무엇을 쓸지는 앱이 정한다 — 코어는 hash 를 그대로 넘길 뿐이다. */
export interface AppShellProps {
  readonly appId: string;
  readonly params: Readonly<Record<string, string>>;
}

/** 화면 하나를 늦게 불러오는 함수. 정적 import 로 바꾸면 부팅 번들이 불어난다. */
export type AppShellLoader = () => Promise<ComponentType<AppShellProps>>;

export interface InternalAppInstallInfo {
  /** 대략 용량. 사람이 읽는 문자열이라 정확한 바이트가 아니라 감을 준다. */
  readonly sizeHint: string;
  /** 설치하면 무엇이 생기는지 — i18n 키 배열. 원문을 여기 적지 않는다. */
  readonly pointKeys: readonly string[];
}

/**
 * 캔버스 버블의 생김새(§5.13 (M) v4.60).
 *
 * **원은 없다.** 커스텀 에이전트 버블이 원이라, 앱 버블이 원이면 캔버스에서 둘을 구별할
 * 방법이 사라진다. 조작 감각(더블클릭·우클릭·드래그)은 에이전트와 같게 두되 형태는 갈라 놓는다.
 *
 * - `film` — 위아래 필름 퍼포레이션 띠 + 재생 삼각형이 있는 가로 프레임. 영상 앱용.
 * - `plate` — 라운드 사각 명패. 아직 자기 형태가 없는 앱의 기본값.
 */
export type AppBubbleShape = 'film' | 'plate';

/**
 * §5.13 (Q) — 캔버스의 스토리보드(콘티) 한 벌을 앱에게 넘길 때 건네는 것.
 *
 * 코어는 **어떤 앱이 이것을 받는지 모른다**(§5.13 (P-4)). "받겠다고 선언한 설치된 앱"을
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

export interface InternalApp {
  /** `AppBubble.appId` 와 `UserDefaults.installedApps` 에 저장되는 값. 바꾸면 기존 것이 앱을 못 찾는다. */
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
  readonly defaultSize: { readonly width: number; readonly height: number };
  /** 설치 안내에 쓰는 정보. */
  readonly install: InternalAppInstallInfo;
  /**
   * 이 앱의 화면들. 키는 `mode`(기본 `main`)이고 값은 늦게 부르는 로더다.
   *
   * **코어의 `main.tsx` 는 앱 이름을 모른다** — `#app=<id>&mode=<mode>` 를 보고 여기서
   * 로더를 꺼내 쓸 뿐이라, 앱이 늘어도 부팅 분기는 하나 그대로다.
   */
  readonly shells: Readonly<Record<string, AppShellLoader>>;
  /**
   * 이 앱의 창을 연다.
   *
   * `ref` 는 앱이 해석하는 열쇠(영상 앱이면 문서 id)다. 코어는 뜻을 모른다.
   * 창을 못 여는 환경(웹·구버전 preload)이면 false 를 돌려준다 — 조용히 아무 일도
   * 안 일어나는 대신 호출부가 안내를 띄울 수 있게.
   */
  readonly open: (args: { projectId: string; ref?: string | undefined }) => Promise<boolean>;
  /**
   * §5.13 (Q) — 이 앱이 캔버스의 스토리보드를 받아 자기 문서로 옮길 수 있는가.
   *
   * 선언하지 않은 앱은 콘티 보드의 [렌더] 대상에서 그냥 빠진다 — 코어에 분기가 늘지 않는다.
   */
  readonly storyboard?: StoryboardCapability;
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

/**
 * 등록된 내부 앱들.
 *
 * 새 앱은 여기에 한 항목만 추가하면 Apps 창·우클릭 메뉴·버블·창 열기가 전부 따라온다.
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
    install: {
      sizeHint: '~1.1 MB',
      pointKeys: [
        'panel.apps.vibistudio.point1',
        'panel.apps.vibistudio.point2',
        'panel.apps.vibistudio.point3',
      ],
    },
    shells: {
      // 편집 창.
      main: async () => (await import('../components/VideoStudio/VideoStudioShell.js')).VideoStudioShell,
      // 보이지 않는 오프스크린 렌더 무대(§5.13 (F)) — 사람이 보는 화면이 아니다.
      render: async () => (await import('../components/VideoStudio/VideoRenderShell.js')).VideoRenderShell,
    },
    open: async ({ projectId, ref }) => {
      const api = window.api?.app;
      if (!api) return false;
      await api.open('vibistudio', ref === undefined ? { projectId } : { projectId, docId: ref });
      return true;
    },
    // §5.13 (Q) — 콘티를 받아 타임라인 문서로 옮긴다. 늦은 로더라 안 부르면 안 실린다.
    storyboard: {
      accept: async (args) => (await import('../components/VideoStudio/contiHandoff.js')).acceptStoryboard(args),
    },
  },
];

export function getInternalApp(appId: string): InternalApp | undefined {
  return INTERNAL_APPS.find((a) => a.id === appId);
}

/**
 * 설치된 앱 id 집합.
 *
 * 구버전 필드(`videoStudio.installed`)도 함께 본다 — 이미 설치를 눌렀던 사용자가
 * 업데이트 한 번으로 설치가 풀린 것처럼 보이면 안 된다. 새로 쓰지는 않는다.
 */
export function resolveInstalledApps(defaults: UserDefaults | null | undefined): Set<string> {
  const set = new Set(defaults?.installedApps ?? []);
  if (defaults?.videoStudio?.installed === true) set.add('vibistudio');
  return set;
}

export function isAppInstalled(appId: string, defaults: UserDefaults | null | undefined): boolean {
  return resolveInstalledApps(defaults).has(appId);
}

/**
 * §5.13 (Q) — 스토리보드를 받을 수 있는 **설치된** 앱들.
 *
 * 콘티 보드는 이 목록이 비었는지만 보고 [렌더] 를 켜고 끈다. 앱 이름을 묻지 않으므로
 * 두 번째 영상 앱이 와도 보드 쪽 코드는 그대로다.
 */
export function listStoryboardApps(defaults: UserDefaults | null | undefined): readonly InternalApp[] {
  const installed = resolveInstalledApps(defaults);
  return INTERNAL_APPS.filter((a) => a.storyboard !== undefined && installed.has(a.id));
}
