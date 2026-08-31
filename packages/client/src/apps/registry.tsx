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

import type { ComponentType, JSX } from 'react';
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
 * - `film` — 위아래 필름 퍼포레이션 띠 + 재생 삼각형이 있는 가로 프레임. 영상 앱용.
 * - `plate` — 라운드 사각 명패. 아직 자기 형태가 없는 앱의 기본값.
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
  readonly defaultSize: { readonly width: number; readonly height: number };
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
  readonly open: (args: { projectId: string; ref?: string | undefined; file?: string | undefined }) => Promise<boolean>;
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

/** 앱 화면이 받는 값. 앱이 해석하는 열쇠 이름(`refKey`)은 앱 선언에서 온다. */
export interface AppOpenArgs {
  projectId: string;
  ref?: string | undefined;
  file?: string | undefined;
}

/**
 * §5.13 (S-6) — 앱 화면에 넘길 파라미터 한 벌.
 *
 * **OS 창과 앱 안 창이 같은 것을 받아야 한다.** 두 곳에서 따로 만들면 `docId` 를 한쪽만 실어
 * "밖에서 열면 그 문서, 안에서 열면 빈 화면" 같은 어긋남이 생긴다.
 */
export function appShellParams(app: Pick<InternalApp, 'refKey'>, args: AppOpenArgs): Record<string, string> {
  const params: Record<string, string> = { projectId: args.projectId };
  if (args.ref !== undefined && args.ref !== '') params[app.refKey] = args.ref;
  if (args.file !== undefined && args.file !== '') params['file'] = args.file;
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
  const api = window.api?.app;
  if (!api) return false;
  await api.open(appId, appShellParams({ refKey }, args));
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
    // 동봉 ffmpeg 에 데먹서가 있어 **그냥 열리는** 것들(H.264-in-MKV 재생 실측 확인).
    //   여기 없는 avi·wmv·flv 등은 (R-8) 변환 갈래가 받는다 — 바깥으로 내보내지 않는다.
    opens: ['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.mkv', '.3gp', '.3g2'],
    refKey: 'docId',
    shells: {
      // 편집 창.
      main: async () => (await import('../components/VideoStudio/VideoStudioShell.js')).VideoStudioShell,
      // 보이지 않는 오프스크린 렌더 무대(§5.13 (F)) — 사람이 보는 화면이 아니다.
      render: async () => (await import('../components/VideoStudio/VideoRenderShell.js')).VideoRenderShell,
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
    opens: ['.glb', '.gltf', '.obj', '.stl', '.ply', '.fbx', '.dae', '.3mf'],
    refKey: 'modelId',
    shells: {
      main: async () => (await import('../components/Vibi3D/Vibi3DShell.js')).Vibi3DShell,
    },
    open: async (args) => openAppOsWindow('vibi3d', 'modelId', args),
  },
];

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
