import { describe, it, expect } from 'vitest';
import { IDE_EDITOR_WIDTH } from '@vibisual/shared';
import { IDE_BODY, dragEditorWidth, ideSidebarWidth, resolveIDEBodyLayout, type IDEBodyInput } from './ideResponsive.js';

/**
 * 창 안 반응형 판정 회귀 — 사용자 보고("사이즈 조절했더니 아예 벗어나버려")의 재현 조건을 못 박는다.
 *
 * 지켜야 하는 불변량은 하나다: **어떤 창 폭에서도 대화가 하한 아래로 찌부러지지 않는다.**
 * 그 하나가 깨질 때 화면에서는 글자가 세로로 서고 상태바가 사이드바 위로 넘친다.
 */

const base: IDEBodyInput = {
  width: 1200,
  viewportNarrow: false,
  sidebarCollapsed: false,
  sidebarWidth: IDE_BODY.SIDEBAR_W,
  editorOpen: true,
  editorWidth: IDE_EDITOR_WIDTH.DEFAULT,
};

describe('ideSidebarWidth', () => {
  it('주입원 뷰만 한 칸 넓다(w-72), 나머지는 w-52', () => {
    expect(ideSidebarWidth('context')).toBe(IDE_BODY.SIDEBAR_CONTEXT_W);
    expect(ideSidebarWidth('files')).toBe(IDE_BODY.SIDEBAR_W);
    expect(ideSidebarWidth('debug')).toBe(IDE_BODY.SIDEBAR_W);
  });
});

describe('resolveIDEBodyLayout — 아직 못 잰 창', () => {
  it('첫 프레임(width 0)에는 접지 않고 뷰포트 판정을 그대로 쓴다', () => {
    const desktop = resolveIDEBodyLayout({ ...base, width: 0 });
    expect(desktop.measured).toBe(false);
    expect(desktop.navDrawer).toBe(false);
    expect(desktop.editorDrawer).toBe(false);
    expect(desktop.editorWidth).toBe(IDE_EDITOR_WIDTH.DEFAULT);

    const phone = resolveIDEBodyLayout({ ...base, width: 0, viewportNarrow: true });
    expect(phone.navDrawer).toBe(true);
    expect(phone.editorDrawer).toBe(true);
  });
});

describe('resolveIDEBodyLayout — 폰 폭', () => {
  it('창이 아무리 넓어도 종전 서랍 거동을 유지한다(§4 v3.24)', () => {
    const r = resolveIDEBodyLayout({ ...base, width: 1400, viewportNarrow: true });
    expect(r.navDrawer).toBe(true);
    expect(r.sidebarDrawer).toBe(true);
    expect(r.editorDrawer).toBe(true);
    expect(r.streamWidth).toBe(1400);
  });
});

describe('resolveIDEBodyLayout — 넓은 창은 한 픽셀도 안 바뀐다', () => {
  it('1200px 에서는 아무것도 접히지 않고 저장된 편집창 폭 그대로', () => {
    const r = resolveIDEBodyLayout(base);
    expect(r.navDrawer).toBe(false);
    expect(r.sidebarDrawer).toBe(false);
    expect(r.editorDrawer).toBe(false);
    expect(r.editorWidth).toBe(IDE_EDITOR_WIDTH.DEFAULT);
    expect(r.streamWidth).toBe(1200 - IDE_BODY.ACTIVITY_W - IDE_BODY.SIDEBAR_W - IDE_EDITOR_WIDTH.DEFAULT);
  });

  it('편집창을 안 열었으면 그 자리는 전부 대화 몫', () => {
    const r = resolveIDEBodyLayout({ ...base, editorOpen: false });
    expect(r.streamWidth).toBe(1200 - IDE_BODY.ACTIVITY_W - IDE_BODY.SIDEBAR_W);
    expect(r.editorDrawer).toBe(false);
  });
});

describe('resolveIDEBodyLayout — 좁아질수록 덜 잃는 것부터 접는다', () => {
  it('① 먼저 편집창이 줄어든다 — 사이드바는 그대로 선다', () => {
    // 편집창을 하한(280)까지 줄이면 대화 하한이 지켜지는 폭.
    const width = IDE_BODY.ACTIVITY_W + IDE_BODY.SIDEBAR_W + IDE_BODY.MIN_STREAM_W + 400;
    const r = resolveIDEBodyLayout({ ...base, width });
    expect(r.sidebarDrawer).toBe(false);
    expect(r.editorDrawer).toBe(false);
    expect(r.editorWidth).toBe(400);
    expect(r.streamWidth).toBe(IDE_BODY.MIN_STREAM_W);
  });

  it('② 편집창 하한으로도 모자라면 사이드바가 서랍으로 — 활동바는 남는다', () => {
    const r = resolveIDEBodyLayout({ ...base, width: 700 });
    expect(r.sidebarDrawer).toBe(true);
    expect(r.navDrawer).toBe(false);
    expect(r.editorDrawer).toBe(false);
    expect(r.streamWidth).toBe(IDE_BODY.MIN_STREAM_W);
    expect(r.editorWidth).toBe(700 - IDE_BODY.ACTIVITY_W - IDE_BODY.MIN_STREAM_W);
  });

  it('③ 그래도 모자라면 편집창이 대화 위를 덮는다', () => {
    const r = resolveIDEBodyLayout({ ...base, width: 560 });
    expect(r.sidebarDrawer).toBe(true);
    expect(r.editorDrawer).toBe(true);
    expect(r.navDrawer).toBe(false);
    expect(r.streamWidth).toBe(560 - IDE_BODY.ACTIVITY_W);
  });

  it('④ 활동바 48px 마저 못 내는 창은 폰과 같은 서랍이 된다', () => {
    const r = resolveIDEBodyLayout({ ...base, width: 300 });
    expect(r.navDrawer).toBe(true);
    expect(r.sidebarDrawer).toBe(true);
    expect(r.editorDrawer).toBe(true);
    expect(r.streamWidth).toBe(300);
  });

  it('사용자가 이미 접어 둔 사이드바는 접는 차례를 건너뛴다', () => {
    const r = resolveIDEBodyLayout({ ...base, width: 700, sidebarCollapsed: true });
    expect(r.sidebarDrawer).toBe(false);
    expect(r.streamWidth).toBe(IDE_BODY.MIN_STREAM_W);
  });

  it('주입원 뷰(w-72)는 한 칸 더 넓어 더 이른 폭에서 접힌다', () => {
    const width = IDE_BODY.ACTIVITY_W + IDE_BODY.SIDEBAR_CONTEXT_W + IDE_BODY.MIN_STREAM_W + 300;
    const wide = resolveIDEBodyLayout({ ...base, width, sidebarWidth: IDE_BODY.SIDEBAR_W });
    const narrow = resolveIDEBodyLayout({ ...base, width, sidebarWidth: IDE_BODY.SIDEBAR_CONTEXT_W });
    expect(wide.sidebarDrawer).toBe(false);
    expect(narrow.sidebarDrawer).toBe(false);
    // 같은 폭이라도 사이드바가 넓으면 편집창이 더 많이 줄어든다.
    expect(narrow.editorWidth).toBeLessThan(wide.editorWidth);
  });
});

describe('resolveIDEBodyLayout — 타이틀바 접힘', () => {
  it('좁은 창은 뷰포트가 넓어도 접는다 — [닫기]가 밀려나지 않게', () => {
    expect(resolveIDEBodyLayout({ ...base, width: IDE_BODY.TITLE_FOLD_W - 1 }).titleBarNarrow).toBe(true);
    expect(resolveIDEBodyLayout({ ...base, width: IDE_BODY.TITLE_FOLD_W }).titleBarNarrow).toBe(false);
    expect(resolveIDEBodyLayout({ ...base, width: 1400 }).titleBarNarrow).toBe(false);
  });

  it('폰은 창 폭과 무관하게 접는다 / 못 쟀으면 뷰포트 판정을 따른다', () => {
    expect(resolveIDEBodyLayout({ ...base, width: 1400, viewportNarrow: true }).titleBarNarrow).toBe(true);
    expect(resolveIDEBodyLayout({ ...base, width: 0 }).titleBarNarrow).toBe(false);
    expect(resolveIDEBodyLayout({ ...base, width: 0, viewportNarrow: true }).titleBarNarrow).toBe(true);
  });

  it('편집창·사이드바 상태가 타이틀바 판정을 흔들지 않는다(창 폭만 본다)', () => {
    const w = 600;
    const variants = [
      resolveIDEBodyLayout({ ...base, width: w }),
      resolveIDEBodyLayout({ ...base, width: w, editorOpen: false }),
      resolveIDEBodyLayout({ ...base, width: w, sidebarCollapsed: true }),
    ];
    for (const v of variants) expect(v.titleBarNarrow).toBe(false);
  });
});

describe('dragEditorWidth — 손잡이가 손을 따라온다', () => {
  const drag = { startX: 900, startWidth: 400, max: 700 };

  it('왼쪽으로 끌면 넓어지고, 오른쪽으로 끌면 좁아진다(편집창이 오른쪽에 붙어 있으므로)', () => {
    expect(dragEditorWidth(drag, 900)).toBe(400);
    expect(dragEditorWidth(drag, 800)).toBe(500);
    expect(dragEditorWidth(drag, 1000)).toBe(300);
  });

  it('하한·상한에서 멈춘다', () => {
    expect(dragEditorWidth(drag, 100)).toBe(700);
    expect(dragEditorWidth(drag, 5000)).toBe(IDE_EDITOR_WIDTH.MIN);
  });

  it('끝까지 밀었다 되돌리면 **그 자리에서 바로** 따라온다(증분 누적이면 늦게 반응한다)', () => {
    // 상한을 한참 넘겨 끌었다가 되돌아온 지점 — 처음부터의 이동량으로 재므로 지연이 없다.
    dragEditorWidth(drag, -2000);
    expect(dragEditorWidth(drag, 850)).toBe(450);
  });

  it('언제나 정수 px — 소수 폭은 텍스트를 흐리게 만든다', () => {
    expect(Number.isInteger(dragEditorWidth(drag, 833.7))).toBe(true);
  });
});

describe('resolveIDEBodyLayout — 불변량', () => {
  it('어떤 창 폭에서도 대화는 하한 아래로 찌부러지지 않는다', () => {
    for (let width = 200; width <= 2000; width += 7) {
      for (const sidebarCollapsed of [false, true]) {
        for (const editorOpen of [false, true]) {
          for (const sidebarWidth of [IDE_BODY.SIDEBAR_W, IDE_BODY.SIDEBAR_CONTEXT_W]) {
            const r = resolveIDEBodyLayout({
              ...base, width, sidebarCollapsed, editorOpen, sidebarWidth,
            });
            // 창 자체가 하한보다 좁으면 더 낼 자리가 없다 — 그때는 창 폭 전부가 대화 몫이어야 한다.
            const floor = Math.min(IDE_BODY.MIN_STREAM_W, width);
            expect(
              r.streamWidth,
              `width=${width} collapsed=${sidebarCollapsed} editor=${editorOpen} side=${sidebarWidth}`,
            ).toBeGreaterThanOrEqual(floor);
          }
        }
      }
    }
  });

  it('저장해 둔 편집창 폭보다 넓어지는 일은 없다(사용자 설정을 늘려 쓰지 않는다)', () => {
    for (let width = 400; width <= 2000; width += 13) {
      const r = resolveIDEBodyLayout({ ...base, width, editorWidth: 360 });
      expect(r.editorWidth).toBeLessThanOrEqual(360);
      expect(r.editorWidth).toBeGreaterThanOrEqual(IDE_EDITOR_WIDTH.MIN);
    }
  });

  it('활동바가 서랍이면 사이드바도 반드시 서랍이다(활동바 뒤에 목록만 남는 상태 ❌)', () => {
    for (let width = 200; width <= 1200; width += 11) {
      const r = resolveIDEBodyLayout({ ...base, width });
      if (r.navDrawer) expect(r.sidebarDrawer).toBe(true);
    }
  });

  it('끌 수 있는 상한은 대화 하한을 깨지 않는다', () => {
    for (let width = 500; width <= 2000; width += 17) {
      const r = resolveIDEBodyLayout({ ...base, width });
      const used = (r.navDrawer ? 0 : IDE_BODY.ACTIVITY_W) + (r.sidebarDrawer ? 0 : IDE_BODY.SIDEBAR_W);
      if (r.editorMaxWidth > IDE_EDITOR_WIDTH.MIN) {
        expect(width - used - r.editorMaxWidth).toBeGreaterThanOrEqual(IDE_BODY.MIN_STREAM_W);
      }
    }
  });
});
