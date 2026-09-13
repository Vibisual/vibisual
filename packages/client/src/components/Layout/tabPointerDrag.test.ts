import { describe, it, expect } from 'vitest';

/**
 * §5.4 #14-2 — **탭도 꾹 눌러 집어 든다.**
 *
 * 프로젝트 탭(`TabBar`)과 IDE 세션 탭(`IDETabBar`)은 HTML5 네이티브 DnD 를 썼다. 그래서 살짝만
 * 밀어도 탭이 즉시 "뚝 떨어져" 반투명해지고, 손에 붙어 오는 것은 탭이 아니라 브라우저가 찍은
 * 스크린샷(또는 그걸 지우고 대신 띄운 안내 카드)이며, 놓을 때는 되돌아가는 연출이 한 번 더
 * 끼어들었다(사용자 지적 — "때서 붙이는 느낌이 너무 어색해"). 그 셋은 전부 네이티브 DnD 가
 * 정하는 것이라 CSS 로는 손댈 수 없어, 활동바(§5.5 #16-1 (E))가 이미 세운 **포인터 손짓 한 벌**로
 * 옮겼다.
 *
 * 여기서 막는 것은 **되돌아감**이다 — 탭 하나에 `draggable` 을 다시 달면 그 탭만 옛 손맛으로
 * 돌아가고(같은 줄에서 탭마다 감각이 갈린다), 같은 제스처를 두 엔진이 함께 받으면 롱프레스를
 * 재는 중에 네이티브 `dragstart` 가 터져 둘 다 돈다.
 *
 * 클라 테스트에는 DOM 이 없으므로(jsdom 미설치) 렌더가 아니라 **소스 문자열**을 읽는다 —
 * `ideActivityBar.test.ts` 가 쓰는 그 방식 그대로다.
 */
const sources = import.meta.glob(
  [
    '../Layout/TabBar.tsx',
    '../IDE/IDETabBar.tsx',
    '../IDE/useSplitDrop.ts',
    '../IDE/IDESplitCell.tsx',
    '../IDE/IDESplitView.tsx',
    '../IDE/sessionDragBus.ts',
    '../../hooks/usePointerDragReorder.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const src = (name: string): string => {
  const hit = Object.entries(sources).find(([path]) => path.endsWith(`/${name}`));
  if (!hit) throw new Error(`소스를 못 찾았다: ${name}`);
  return hit[1];
};

describe('§5.4 #14-2 탭은 꾹 눌러 집어 든다', () => {
  for (const file of ['TabBar.tsx', 'IDETabBar.tsx']) {
    it(`${file} — 네이티브 DnD 로 돌아가지 않는다`, () => {
      const s = src(file);
      // 탭에 `draggable` 을 다시 달면 그 탭만 옛 손맛이 된다(같은 줄에서 감각이 갈린다).
      expect(s).not.toMatch(/^\s*draggable\s*$/m);
      // 네이티브 핸들러를 JSX 에 다시 달면 같은 제스처를 두 엔진이 함께 받는다.
      expect(s).not.toMatch(/onDragStart=\{/);
      expect(s).not.toMatch(/onDragOver=\{/);
      expect(s).not.toMatch(/onDragEnd=\{/);
      // 짐을 싣던 창구도 함께 사라졌다 — 값은 이제 버스가 그냥 들고 있는다.
      //   (주석에서 그 이름을 되짚는 것은 괜찮다. 막는 것은 **다시 쓰는 것**이다.)
      expect(s).not.toMatch(/\be\.dataTransfer\b/);
    });

    it(`${file} — 손짓은 공용 훅 한 벌을 쓴다`, () => {
      const s = src(file);
      expect(s).toContain('usePointerDragReorder');
      // 줄이 가로로 섰으므로 축은 'x' 다(활동바만 'y').
      expect(s).toMatch(/axis:\s*'x'/);
      // 밀어내기 재생은 종전 그대로 — 손맛의 나머지 절반이다(§5.4 #14-2 (B)).
      expect(s).toContain('useTabPushAnimation');
      // 끌고 난 직후의 click 을 삼키지 않으면 자리를 옮기면서 그 탭까지 열린다.
      expect(s).toContain('consumeClick');
    });

    it(`${file} — 탭 본체가 떠나도 자리는 남는다(겉칸 + 점선 홈)`, () => {
      const s = src(file);
      // 미는 노드와 숨기는 노드가 같으면 `opacity-0` 이 점선 홈까지 지운다 — 그래서 겉칸이 있다.
      expect(s).toMatch(/border-dashed/);
      expect(s).toMatch(/isDragging \? 'opacity-0'/);
      // 종전의 `opacity-40`(원본이 흐려진 채 제자리에 남는 네이티브 연출)은 폐기.
      expect(s).not.toContain("isDragging ? 'opacity-40'");
    });

    it(`${file} — 손에 들린 탭은 body 로 내보낸다`, () => {
      const s = src(file);
      // IDE 창·탭 줄 모두 조상에 `transform` 이 걸릴 수 있다(캔버스의 자식 — §5.5 #17-6).
      // 거기서 `fixed` 를 쓰면 뷰포트가 아니라 그 변환 기준이 돼 고스트가 커서에서 어긋난다.
      expect(s).toContain('createPortal');
      // 고스트 안에는 라벨 + 안내 문구가 함께 들어가므로 두 표식 사이가 꽤 멀다.
      expect(s).toMatch(/ghostRef[\s\S]{0,2500}document\.body/);
    });

    it(`${file} — 손에 든 탭의 크기가 원본 그대로다(흉내 낸 미니어처 ❌)`, () => {
      const s = src(file);
      // §5.4 #14-2 (F-2) — 치수는 훅이 **집어 든 순간 재서** 물려준다. 고스트 쪽에 폭을 박아 두면
      //   안에 든 것(라벨 자리·닫기 버튼·핀/기본/루프 글리프)이 조금만 달라도 어긋나고, 집어 드는
      //   순간 크기가 툭 튄다 — 세션 탭이 원본의 절반으로 줄던 그 증상이다(사용자 지적).
      expect(s).toMatch(/style=\{\w+\.dragSize \?\? undefined\}/);
      // 종전처럼 고스트에 폭을 박아 두는 것은 폐기 — 다시 생기면 그 줄만 도로 흉내 내기가 된다.
      //   (**실제 className 만** 잡는다. 주석에서 옛 값을 되짚는 것은 괜찮다 — 왜 폐기했는지를
      //    적어 두는 자리가 바로 거기다.)
      expect(s).not.toContain('flex h-8 items-center gap-1.5 rounded border border-blue-400/70');
      expect(s).not.toContain('flex w-32 items-center gap-1.5 rounded-t-md');
    });
  }

  it('TabBar — 별창 분리(#14-1)는 그대로다. 판정 좌표만 포인터로 옮겼다', () => {
    const s = src('TabBar.tsx');
    expect(s).toContain('HEADER_SAFE_HEIGHT');
    expect(s).toContain('api.window');
    expect(s).toContain('.detach(');
    // screen 좌표는 BrowserWindow 좌상단 기준이라 반드시 포인터 이벤트의 것을 넘겨야 한다.
    expect(s).toMatch(/detachTab\(key, p\.screenX, p\.screenY\)/);
    // 순서가 그대로여도 놓은 자리가 헤더 띠 밖이면 별창이다 — 두 일은 배타적이지 않다.
    expect(s).toMatch(/if \(next\) setTabOrder/);
  });

  it('TabBar — 새 순서는 보이는 자리에만 되꽂는다(별창으로 빠진 탭이 사이에 껴 있어도)', () => {
    const s = src('TabBar.tsx');
    expect(s).toContain('applyVisibleOrder');
    expect(s).toContain('visibleKeys');
  });

  it('IDETabBar — 본문 위 분할(#17-34)이 포인터 경로로 이어졌다', () => {
    const s = src('IDETabBar.tsx');
    expect(s).toContain('beginPointerSessionDrag');
    expect(s).toContain('movePointerSessionDrag');
    expect(s).toContain('endPointerSessionDrag');
    // `Esc`·창 포커스 상실로 끝나면 미리보기가 화면에 얼어붙지 않게 함께 걷어야 한다.
    expect(s).toContain('cancelPointerSessionDrag');
    // 훅 에이전트의 메인 탭(세션 `null`)도 같은 손짓으로 끌린다.
    expect(s).toContain('MAIN_TAB_DRAG_KEY');
  });

  it('IDETabBar — 순서 커밋은 손으로 끈 것과 정렬 버튼이 같은 문으로 나간다(§5.5 #17-41)', () => {
    const s = src('IDETabBar.tsx');
    expect(s).toMatch(/commitOrder = useCallback/);
    expect(s).toMatch(/if \(next\) commitOrder\(next\)/);
    // 커밋 왕복 동안 화면을 붙드는 로컬 순서는 그대로다(§5.4 #14-2 (C)).
    expect(s).toContain('applyLocalOrder');
  });

  it('useSplitDrop — 두 경로가 **같은 판정**을 쓴다(네이티브 짐 · 포인터 세션)', () => {
    const s = src('useSplitDrop.ts');
    // 칸 머리띠는 아직 네이티브 DnD 라 그 경로가 살아 있어야 한다.
    expect(s).toContain('onDragOver');
    expect(s).toContain('registerSessionDropTarget');
    // 미리보기와 실제 드롭이 같은 함수를 부른다 — 두 벌이면 파란 박스는 왼쪽을 가리키는데
    // 실제로는 오른쪽에 붙는 상태가 생긴다(#17-34 가 못박은 규약).
    expect(s).toContain('judgePointer');
    expect(s).toMatch(/pointerOver[\s\S]{0,200}judgePointer/);
    expect(s).toMatch(/pointerDrop[\s\S]{0,200}judgePointer/);
    // 막는 이유 셋은 네이티브 경로와 같은 순서다.
    expect(s).toMatch(/judgePointer[\s\S]{0,700}'foreign'[\s\S]{0,300}'same'[\s\S]{0,300}'tooSmall'[\s\S]{0,200}'limit'/);
  });

  it('떨어질 자리를 단 곳 — 칸과 "아직 안 나뉜 창" 둘 다', () => {
    expect(src('IDESplitCell.tsx')).toMatch(/ref=\{dropRef\}/);
    expect(src('IDESplitView.tsx')).toMatch(/ref=\{dropRef\}/);
  });

  it('겹친 자리에서는 가장 깊은 것 하나만 받는다 — 파란 박스가 둘이면 어디 앉을지가 갈린다', () => {
    const s = src('sessionDragBus.ts');
    expect(s).toMatch(/inside\.find\(\(t\) => !inside\.some/);
    // 문서에서 떨어진 자리는 셈에서 빠진다(칸이 닫혀도 유령이 남지 않게).
    expect(s).toContain('isConnected');
  });

  it('치수를 내주는 곳은 훅 하나다 — 집어 든 그 순간 원본을 잰다', () => {
    const s = src('usePointerDragReorder.ts');
    // 롱프레스가 성립하는 그 자리에서 이미 `rect` 를 잡고 있다(잡은 지점 계산용) — 덤으로 쓴다.
    expect(s).toMatch(/setDragSize\(\{ width: rect\.width, height: rect\.height \}\)/);
    // 끝나면 비운다 — 안 비우면 다음에 집어 들기 전까지 낡은 치수가 남는다.
    expect(s).toContain('setDragSize(null)');
    expect(s).toMatch(/dragSize: \{ width: number; height: number \} \| null/);
    expect(s).toMatch(/return \{ dragKey, localOrder, dragSize, ghostRef/);
  });

  it('끄는 동안 창 이동 영역이 비켜선다 — 헤더 위에서 손짓이 끊기지 않게', () => {
    // 탭 줄은 헤더(`app-drag`) 바로 아래라 이 자리가 특히 중요하다 — 탭을 위로 조금만 올려도
    // OS 캡션에 들어가고, 그러면 `pointermove`·`pointerup` 이 렌더러에 오지 않는다.
    expect(src('usePointerDragReorder.ts')).toContain('vib-pointer-drag');
  });
});
