import { describe, it, expect } from 'vitest';
import indexCss from 'virtual:vibisual-css-source/index';
import { IDE_ACTIVITY_ITEMS, DEFAULT_ACTIVITY_ORDER, activityItem } from './ideActivityItems.js';
import { migrateIDEViewType } from '../../stores/graphStore.js';
import { viewsForProviderKind } from './ideProviderViews.js';

/**
 * §5.5 #16-1 — **활동바가 데이터가 됐다**는 약속을 잠근다.
 *
 * 종전에는 항목이 두 벌로 살았다(배열 넷 + 손으로 적은 JSX 열하나). 그 상태에서는 순서·제외가
 * 구조적으로 불가능했고, 기억 정리 칸만 `mt-auto` 로 바닥에 떨어져 다른 규칙으로 살았다.
 * 여기서 막는 것은 **되돌아감**이다 — 새 칸을 표 밖에 손으로 적으면 그 칸은 순서에도 구성
 * 패널에도 영영 안 나타나는데, 화면에는 멀쩡히 떠 있어서 사람 눈으로는 안 잡힌다.
 *
 * 클라 테스트에는 DOM 이 없으므로(jsdom 미설치) 렌더가 아니라 **소스 문자열**을 읽는다 —
 * `ideProviderViews.test.ts` 가 쓰는 그 방식 그대로다.
 */
const activityBarSource = import.meta.glob('./IDEActivityBar.tsx', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const customizeSource = import.meta.glob('./IDEActivityBarCustomize.tsx', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const storeSource = import.meta.glob('../../stores/graphStore.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/**
 * §5.4 #14-2 — 제스처 자체는 **활동바 안에 있지 않다.** 프로젝트 탭·IDE 세션 탭이 같은 손맛을
 * 써야 하므로 한 벌(`hooks/usePointerDragReorder.ts` + 순수 기하 `pointerDragGeom.ts`)로 옮겼다.
 * 그래서 아래 회귀는 **두 층**을 나눠 본다 — 훅에는 "손짓이 어떻게 도는가", 활동바에는 "그 훅을
 * 세로축으로 쓰고, 저장은 보이는 자리에만 되꽂는다"는 활동바만의 약속.
 */
const dragHookSource = import.meta.glob('../../hooks/usePointerDragReorder.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const barSrc = (): string => Object.values(activityBarSource)[0] ?? '';
const customizeSrc = (): string => Object.values(customizeSource)[0] ?? '';
const dragSrc = (): string => Object.values(dragHookSource)[0] ?? '';
/**
 * 스타일시트 원문은 **설정이 넘겨 주는 통로**로 받는다 — `?raw` 도 `?inline` 도 빈 문자열이 온다
 * (실측 길이 0: `.css` 는 Tailwind 플러그인과 vitest 의 CSS 스텁을 차례로 지나며 원문이 사라진다).
 * 클라 tsconfig 에는 Node 타입이 없어 `node:fs` 로 직접 열 수도 없다 —
 * `titlebarDragSelection.test.ts` 가 쓰는 그 통로를 그대로 쓴다(`vitest.config.ts`).
 */
const cssSrc = (): string => indexCss;

describe('§5.5 #16-1 활동바 정본 표', () => {
  it('표의 모든 칸이 실재하는 뷰다 — 저장·복원이 조용히 되돌리지 않는다', () => {
    for (const item of IDE_ACTIVITY_ITEMS) {
      // 유니온에만 넣고 `migrateIDEViewType` 의 `known` 배열을 빼먹으면 다시 켤 때 'mcp' 로 돌아간다.
      expect(migrateIDEViewType(item.view), item.view).toBe(item.view);
    }
  });

  it('IDE 뷰가 하나도 빠지지 않았다 — 표 밖의 칸은 순서·구성에서 영영 사라진다', () => {
    // `migrateIDEViewType` 이 들고 있는 정본 목록을 소스에서 읽어 표와 맞댄다.
    const src = Object.values(storeSource)[0] ?? '';
    const decl = src.match(/const known: IDEViewType\[\] = \[([^\]]+)\]/);
    expect(decl, 'graphStore 에 known 목록이 있어야 한다').toBeTruthy();
    const known = (decl?.[1] ?? '').split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect(known.length).toBeGreaterThan(0);
    expect([...DEFAULT_ACTIVITY_ORDER].sort()).toEqual([...known].sort());
  });

  it('중복 없이 한 칸씩만 선다', () => {
    expect(new Set(DEFAULT_ACTIVITY_ORDER).size).toBe(DEFAULT_ACTIVITY_ORDER.length);
  });

  it('활성 색은 완전한 클래스명이다 — Tailwind 는 조립한 이름을 만들지 못한다', () => {
    for (const item of IDE_ACTIVITY_ITEMS) {
      expect(item.accent, item.view).toMatch(/^border-[a-z]+-\d{3}$/);
      expect(item.accent).not.toContain('${');
    }
  });

  it('엔진별 목록에 있는 칸은 전부 표에 있다 (§5.19 (G) · §5.25 (M))', () => {
    for (const kind of ['codex-cli', 'local-model']) {
      for (const view of viewsForProviderKind(kind) ?? []) {
        expect(activityItem(view), `${kind} / ${view}`).toBeTruthy();
      }
    }
  });
});

describe('§5.5 #16-1 활동바 화면 규약', () => {
  it('항목은 표 하나에서만 나온다 — 손으로 적은 칸을 다시 늘리지 않는다', () => {
    const src = barSrc();
    // 그리는 자리는 `shown.map` 한 곳이다(`shown` = 서버 순서 위에 끌던 로컬 순서를 덧씌운 것).
    // 종전처럼 `{show('x') && <button` 을 다시 늘리면 그 칸은 순서에도 구성 패널에도 안 잡히면서
    // 화면에만 뜬다.
    expect(src).toContain('shown.map(');
    expect(src).toMatch(/const shown = useMemo\(/);
    expect(src).not.toMatch(/\{show\('[a-zA-Z]+'\)\s*&&/);
  });

  it('창 높이에 맞춰 목록이 스크롤된다 (사용자 지시 2026-09-09)', () => {
    const src = barSrc();
    // `min-h-0` 이 없으면 flex 자식이 내용 높이만큼 버텨 `overflow-y-auto` 가 먹지 않는다
    // (창을 줄이면 아래쪽 칸이 그대로 잘려 손이 닿지 않는다).
    expect(src).toMatch(/min-h-0[^"]*overflow-y-auto|overflow-y-auto[^"]*min-h-0/);
  });

  it('구성 버튼은 목록 위에 고정으로 남는다 — 스크롤해도 입구가 움직이지 않는다 (§16-1 (D))', () => {
    const src = barSrc();
    const button = src.indexOf("aria-label={t('ide.activityBar.customize')}");
    const list = src.indexOf('ref={listRef}');
    expect(button, '구성 버튼이 있어야 한다').toBeGreaterThan(-1);
    expect(list, '스크롤 목록이 있어야 한다').toBeGreaterThan(-1);
    // 버튼이 스크롤 상자 **안**으로 들어가면 목록과 함께 흘러가 "늘 같은 자리"가 깨진다.
    expect(button).toBeLessThan(list);
  });

  it('스크롤바가 아이콘의 가운데선을 밀지 않는다 — 폭 점유 0 + 오버레이 썸 (사용자 지시 2026-09-09)', () => {
    const src = barSrc();
    // 네이티브 세로 스크롤바는 **레이아웃을 점유해** 목록의 내용 상자만 좁힌다. 폭 48px 짜리 바에서
    //   그만큼 아이콘 열이 왼쪽으로 기울어, 위에 고정된 구성 버튼과 축이 어긋났다(사용자 보고).
    //   `.scrollbar-thin` 은 폭을 5px 로 줄인 것처럼 보이지만 Chromium 121+ 는 `scrollbar-width` 가
    //   있으면 그 webkit 폭 지정을 무시하므로, 얇게 만드는 것으로는 기울기가 사라지지 않는다.
    expect(src).toContain('scrollbar-overlay');
    // 주석에서 그 이름을 설명하는 것은 괜찮다 — 막는 것은 **클래스로 다시 쓰는 것**이다.
    expect(src).not.toMatch(/className="[^"]*scrollbar-thin/);
    // 대신 썸을 별도 DOM 으로 띄운다 — 스크롤 상자 **밖**이어야 내용과 함께 흘러가지 않는다.
    expect(src).toContain('thumbRef');
    expect(src).toMatch(/pointer-events-none absolute right-0 top-0 w-\[3px\]/);
    const list = src.indexOf('ref={listRef}');
    const thumb = src.indexOf('ref={thumbRef}');
    expect(thumb).toBeGreaterThan(list);
    // 길이·자리는 리렌더가 아니라 DOM 직접 갱신이다(스크롤마다 60Hz 리렌더 ❌).
    expect(src).toContain('updateScrollThumb');
    expect(src).toMatch(/th\.style\.height = /);
  });

  it('꾹 누르면 자리를 옮긴다 — 손짓은 공용 훅 한 벌, 저장은 보이는 자리에만', () => {
    const src = barSrc();
    // 제스처를 여기 다시 적으면 탭바와 손맛이 갈린다(§5.4 #14-2 가 한 벌로 묶은 이유).
    expect(src).toContain('usePointerDragReorder');
    // 옮긴 결과는 **보이는 목록 기준**이라 전체 순서의 그 자리들에만 되꽂아야 한다.
    expect(src).toContain('applyVisibleOrder');
    // 끌고 난 직후의 click 을 삼키지 않으면 자리를 옮기면서 그 뷰까지 열린다.
    expect(src).toContain('consumeClick');

    const hook = dragSrc();
    expect(hook).toContain('longPressMs');
    expect(hook).toContain('setPointerCapture');
    expect(hook).toContain('suppressClickRef');
  });

  it('아이콘이 손에 붙어 따라온다 — 고스트는 body 로 내보내고 렌더 없이 움직인다 (사용자 지시)', () => {
    const src = barSrc();
    // 활동바는 DOM 상 캔버스의 자식이라 조상에 `transform` 이 걸려 있다 — 거기서 `fixed` 를 쓰면
    // 뷰포트가 아니라 그 변환 기준이 돼 고스트가 커서에서 어긋난다(§5.5 #17-6).
    expect(src).toContain('createPortal');
    expect(src).toContain('document.body');
    expect(src).toContain('drag.ghostRef');

    // 크기도 흉내 내지 않고 **재서 물려받는다**(§5.4 #14-2 (F-2)). 종전 `h-10 w-10` 은 원본
    // 버튼과 우연히 같았을 뿐이라, 버튼이 커지면 조용히 어긋난다 — 세션 탭이 그래서 절반으로
    // 줄었다. 세 줄(활동바·프로젝트 탭·세션 탭)이 같은 자리에서 치수를 받는다.
    expect(src).toContain('drag.dragSize');
    expect(src).not.toMatch(/ghostRef[\s\S]{0,400}h-10 w-10 scale-110/);

    const hook = dragSrc();
    // 프레임마다 도는 자리라 자리는 상태가 아니라 transform 한 줄이다(60Hz 리렌더 ❌).
    expect(hook).toMatch(/ghostRef\.current[\s\S]{0,400}style\.transform/);
    // 잡은 지점을 빼야 손 아래에서 순간이동하지 않는다.
    expect(hook).toContain('grabRef');
  });

  it('삽입선이 아니라 밀린다 — 세로축 밀어내기는 탭바와 같은 한 벌을 쓴다 (§6)', () => {
    const src = barSrc();
    expect(src).toContain('useTabPushAnimation');
    expect(src).toMatch(/axis:\s*'y'/);
    // 종전의 파란 삽입선(위/아래 한 줄)은 사라졌다 — 자리는 밀림으로만 말한다.
    expect(src).not.toContain('dropBefore');
    expect(src).not.toContain('dropAfter');
    // 중앙선 판정은 축 중립 순수 함수 하나가 갖는다(가로 전용 사본 ❌).
    expect(dragSrc()).toContain('resolveAxisReorder');
  });

  it('중앙선은 레이아웃 좌표로 잰다 — 재생 중인 rect 로 재면 밀린 칸이 되밀린다', () => {
    // `getBoundingClientRect()` 는 달리는 transform 을 포함한 값이라 떨림(oscillation)을 만든다.
    expect(dragSrc()).toMatch(/measureSlots[\s\S]{0,900}offsetTop/);
    // 목록이 `offsetParent` 여야 `offsetTop` 이 곧 줄의 자리가 된다.
    expect(barSrc()).toMatch(/ref=\{listRef\}[\s\S]{0,400}\brelative\b/);
  });

  it('벗어나거나 자리가 갈렸다고 취소되지 않는다 — 끌기의 이벤트원은 창이다 (사용자 보고)', () => {
    const src = barSrc();
    // 자리가 한 번 갈리면 React 가 그 줄의 DOM 노드를 옮기고, 그때 브라우저가 캡처를 자동으로
    // 푼다. 그 `lostpointercapture` 를 취소로 읽으면 위아래로 한 번 오간 것만으로 끌던 것이
    // 손에서 사라진다 — 이 두 줄이 그 되돌아감을 막는다.
    expect(src).not.toContain('onLostPointerCapture');
    expect(src).not.toContain('onPointerCancel=');

    const hook = dragSrc();
    // 이동·놓기·취소는 전부 창이 받는다(버튼은 누르기만).
    expect(hook).toContain("window.addEventListener('pointermove'");
    expect(hook).toContain("window.addEventListener('pointerup'");
    expect(hook).toContain("window.addEventListener('pointercancel'");
    // 캡처가 풀린 것을 **취소로 읽지 않는다** — 주석으로 설명하는 것은 괜찮고, 막는 것은 그 이벤트를
    // 실제로 듣는 일이다(그 한 줄이 "위아래로 한 번 오가면 끌기가 사라지는" 증상을 되살린다).
    expect(hook).not.toMatch(/addEventListener\('lostpointercapture'|onLostPointerCapture/);
    // 벗어나기가 취소가 아니게 된 대신, 되돌리는 손잡이 하나(Esc)는 반드시 있어야 한다.
    expect(hook).toMatch(/'Escape'/);
  });

  it('꾹 누르기 취소는 그 줄이 스크롤되는 축만 본다 — 직교축 떨림은 취소가 아니다', () => {
    // 활동바는 세로로 선 줄이다 — 그 한 글자가 "세로 이동만 취소로 센다"를 정한다.
    expect(barSrc()).toMatch(/axis:\s*'y'/);
    // 판정 자체는 축 중립 순수 함수가 갖고, 값 검증은 `pointerDragGeom.test.ts` 가 한다.
    expect(dragSrc()).toContain('pressSurvivesMove');
    // 좌표 두 축을 여기서 직접 비교하는 사본이 되살아나면 손맛이 다시 갈린다.
    expect(barSrc()).not.toMatch(/Math\.abs\(e\.client[XY] - press\./);
  });

  it('끄는 동안에는 창 이동 영역이 비켜선다 — 헤더 위에서 손짓이 끊기지 않게', () => {
    // `-webkit-app-region: drag` 인 자리는 OS 캡션이라 `pointermove` 가 렌더러에 오지 않는다.
    // 그대로 두면 탭·아이콘을 그 위로 가져가는 순간 고스트가 얼어붙고 `pointerup` 도 안 온다.
    expect(dragSrc()).toContain('vib-pointer-drag');
    const css = cssSrc();
    expect(css).toMatch(/body\.vib-pointer-drag \.app-drag[\s\S]{0,200}app-region: no-drag/);
    // 항상 끄면 창을 못 옮긴다 — 규칙은 **드래그 중 body 클래스** 아래에만 있어야 한다.
    expect(css).toMatch(/body\.vib-pointer-drag \{[\s\S]{0,200}cursor: grabbing/);
  });

  it('구성 패널은 두 목록을 나란히 둔다 — 제외한 것도 보이고 도로 올릴 수 있다', () => {
    const src = customizeSrc();
    expect(src).toContain('ide.activityBar.shownSection');
    expect(src).toContain('ide.activityBar.excludedSection');
    // 되돌릴 수 없으면 그건 삭제다 — 올리는 손잡이가 반드시 함께 있어야 한다.
    expect(src).toContain('setHiddenState(view, true)');
    expect(src).toContain('setHiddenState(view, false)');
  });

  it('내려놓은 칸도 이 엔진에 있는 것만 보여 준다 (없는 기능의 입구는 거짓말이다)', () => {
    // `excluded` 목록이 `show(v)` 를 통과한 것만 담아야, 눌러도 아무 일 없는 죽은 줄이 안 생긴다.
    expect(barSrc()).toMatch(/hiddenList\.includes\(v\)\s*&&\s*show\(v\)/);
  });

  it('아이콘은 활동바와 구성 패널이 같은 글리프를 쓴다', () => {
    // 패널에서 고르는 그림과 활동바에 서는 그림이 다르면 무엇을 내려놓는지 알 수 없다.
    expect(barSrc()).toContain('ActivityIcon');
    expect(customizeSrc()).toContain('ActivityIcon');
  });
});
