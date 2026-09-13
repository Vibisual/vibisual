import { describe, it, expect } from 'vitest';
import {
  PREVIEW_ALT_CAPTURE_MESSAGE,
  PREVIEW_ALT_MESSAGE,
  PREVIEW_HOVER_MESSAGE,
  PREVIEW_PICK_SOURCE,
  PREVIEW_SCROLLBAR_ACTIVE_ATTR,
  PREVIEW_SCROLLBAR_HOLD_MS,
  PREVIEW_SCROLLBAR_TRACK_VAR,
  previewScrollbarInjection,
  WORKSPACE_SITE_INSPECT_REQUEST,
} from '@vibisual/shared';

import { buildPreviewInjectionTail, buildPreviewPickerScript } from './previewPicker.js';

/**
 * §7.11 (G) — 프리뷰 안에서 누른 Alt 가 부모(우리 창)에게 넘어오는가.
 *
 * 문자열이 들어 있는지만 보면 "코드는 있는데 안 도는" 상태를 못 잡는다 — 그래서 조각을 **실제로
 * 실행**해 놓고 키를 눌러 본다. 주입 코드는 ES5 범위라 아래 최소한의 가짜 창구만 있으면 돈다.
 */

interface FakeEventTarget {
  addEventListener: (type: string, fn: (e: unknown) => void, capture?: boolean) => void;
  fire: (type: string, event: unknown) => void;
}

function fakeTarget(): FakeEventTarget {
  const map = new Map<string, ((e: unknown) => void)[]>();
  return {
    addEventListener(type, fn) {
      const list = map.get(type) ?? [];
      list.push(fn);
      map.set(type, list);
    },
    fire(type, event) {
      for (const fn of map.get(type) ?? []) fn(event);
    },
  };
}

interface KeyProbe {
  key: string;
  shiftKey?: boolean;
  prevented: boolean;
  stopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
  stopImmediatePropagation: () => void;
}

function keyEvent(key: string, shiftKey = false): KeyProbe {
  const e: KeyProbe = {
    key,
    shiftKey,
    prevented: false,
    stopped: false,
    preventDefault: () => { e.prevented = true; },
    stopPropagation: () => { e.stopped = true; },
    stopImmediatePropagation: () => { e.stopped = true; },
  };
  return e;
}

/** 주입 조각을 실제로 돌려 준다 — 돌려주는 것은 문서/창 창구와 부모가 받은 편지함. */
function runPickerScript(): {
  doc: FakeEventTarget;
  win: FakeEventTarget;
  posted: Record<string, unknown>[];
} {
  const html = buildPreviewPickerScript('/iframe-proxy/localhost:3456', 'localhost:3456');
  const body = html.replace(/^<script>\n?/, '').replace(/\n?<\/script>$/, '');
  const doc = fakeTarget();
  const win = fakeTarget();
  const posted: Record<string, unknown>[] = [];
  const documentStub = {
    addEventListener: doc.addEventListener,
    createElement: () => ({ style: {}, setAttribute: () => { /* noop */ } }),
    documentElement: { style: {} },
    body: { appendChild: () => { /* noop */ } },
  };
  const windowStub = { addEventListener: win.addEventListener, __vibisualPicker: false };
  const parentStub = { postMessage: (m: Record<string, unknown>) => { posted.push(m); } };
  const locationStub = { pathname: '/', search: '', protocol: 'http:' };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const run = new Function('window', 'document', 'parent', 'location', body) as (
    w: unknown, d: unknown, p: unknown, l: unknown,
  ) => void;
  run(windowStub, documentStub, parentStub, locationStub);
  return { doc, win, posted };
}

describe('previewPicker — Alt 다리 (§7.11 (G))', () => {
  it('프리뷰 안에서 Alt 를 누르면 부모에게 신고한다 (기본 = 우리 것이 강제)', () => {
    const { doc, posted } = runPickerScript();
    const down = keyEvent('Alt', true);
    doc.fire('keydown', down);

    expect(posted).toEqual([
      { source: PREVIEW_PICK_SOURCE, type: PREVIEW_ALT_MESSAGE, down: true, shift: true },
    ]);
    // 안쪽 앱이 같은 Alt 를 자기 단축키로 쓰지 못하게 여기서 끊는다.
    expect(down.prevented).toBe(true);
    expect(down.stopped).toBe(true);
  });

  it('눌린 채 반복되는 Alt 는 한 번만 신고한다', () => {
    const { doc, posted } = runPickerScript();
    doc.fire('keydown', keyEvent('Alt'));
    doc.fire('keydown', keyEvent('Alt'));
    doc.fire('keydown', keyEvent('Alt'));
    expect(posted).toHaveLength(1);
  });

  it('Alt 를 떼면 뗌도 신고한다 (부모가 포커스를 못 가져간 경우의 길)', () => {
    const { doc, posted } = runPickerScript();
    doc.fire('keydown', keyEvent('Alt'));
    doc.fire('keyup', keyEvent('Alt'));
    expect(posted[1]).toEqual({
      source: PREVIEW_PICK_SOURCE, type: PREVIEW_ALT_MESSAGE, down: false, shift: false,
    });
  });

  it('포커스를 뺏겨도(blur) 눌림만 풀고 뗌은 보내지 않는다 — 방금 켠 인스펙터가 꺼지면 안 된다', () => {
    const { doc, win, posted } = runPickerScript();
    doc.fire('keydown', keyEvent('Alt'));
    win.fire('blur', {});
    expect(posted).toHaveLength(1);
    // 눌림이 풀렸으므로 다음 Alt 는 다시 신고된다.
    doc.fire('keydown', keyEvent('Alt'));
    expect(posted).toHaveLength(2);
  });

  it('부모가 Alt 를 양보하면(alt-capture off) 신고하지 않고 키도 안 뺏는다', () => {
    const { doc, win, posted } = runPickerScript();
    win.fire('message', {
      data: { source: PREVIEW_PICK_SOURCE, type: PREVIEW_ALT_CAPTURE_MESSAGE, on: false },
    });
    const down = keyEvent('Alt');
    doc.fire('keydown', down);

    expect(posted).toHaveLength(0);
    expect(down.prevented).toBe(false);
    expect(down.stopped).toBe(false);
  });

  it('양보했다가 되가져오면(alt-capture on) 다시 신고한다', () => {
    const { doc, win, posted } = runPickerScript();
    win.fire('message', {
      data: { source: PREVIEW_PICK_SOURCE, type: PREVIEW_ALT_CAPTURE_MESSAGE, on: false },
    });
    win.fire('message', {
      data: { source: PREVIEW_PICK_SOURCE, type: PREVIEW_ALT_CAPTURE_MESSAGE, on: true },
    });
    doc.fire('keydown', keyEvent('Alt'));
    expect(posted).toHaveLength(1);
  });

  it('출처 표식이 없는 남의 postMessage 로는 Alt 규칙이 바뀌지 않는다', () => {
    const { doc, win, posted } = runPickerScript();
    win.fire('message', { data: { type: PREVIEW_ALT_CAPTURE_MESSAGE, on: false } });
    win.fire('message', { data: { source: 'someone-else', type: PREVIEW_ALT_CAPTURE_MESSAGE, on: false } });
    doc.fire('keydown', keyEvent('Alt'));
    expect(posted).toHaveLength(1);
  });

  it('Alt 가 아닌 키는 건드리지 않는다', () => {
    const { doc, posted } = runPickerScript();
    const down = keyEvent('a');
    doc.fire('keydown', down);
    expect(posted).toHaveLength(0);
    expect(down.prevented).toBe(false);
  });
});

/**
 * §7.16 — 마우스가 프리뷰 **안**에 있다는 것을 부모가 아는가.
 *
 * 부모 문서는 마우스가 iframe 위로 들어간 순간 아무 것도 받지 못한다 — 그래서 프리뷰를 담은 우리
 * 스크롤 상자의 `:hover` 가 서지 않고, 기본 숨김인 스크롤바는 굴릴 때만 떴다. 이 다리가 그 hover 를
 * 대신 세우므로, 여기가 끊기면 증상이 조용히 되돌아온다.
 */
describe('previewPicker — 마우스 다리 (§7.16)', () => {
  it('마우스가 들어오면 부모에게 신고한다', () => {
    const { doc, posted } = runPickerScript();
    doc.fire('mouseover', { relatedTarget: null });
    expect(posted).toEqual([{ source: PREVIEW_PICK_SOURCE, type: PREVIEW_HOVER_MESSAGE, on: true }]);
  });

  it('안에서 옮겨 다니는 동안은 다시 신고하지 않는다 — `mouseover` 는 수없이 온다', () => {
    const { doc, posted } = runPickerScript();
    doc.fire('mouseover', { relatedTarget: null });
    doc.fire('mouseover', { relatedTarget: {} });
    doc.fire('mouseover', { relatedTarget: {} });
    expect(posted).toHaveLength(1);
  });

  it('요소에서 요소로 넘어가는 것은 나간 것이 아니다 (`relatedTarget` 이 남아 있다)', () => {
    const { doc, posted } = runPickerScript();
    doc.fire('mouseover', { relatedTarget: null });
    doc.fire('mouseout', { relatedTarget: {} });
    expect(posted).toHaveLength(1);
  });

  it('문서를 벗어나면 나갔다고 신고한다 — 안 보내면 스크롤바가 영영 떠 있는다', () => {
    const { doc, posted } = runPickerScript();
    doc.fire('mouseover', { relatedTarget: null });
    doc.fire('mouseout', { relatedTarget: null });
    expect(posted[1]).toEqual({ source: PREVIEW_PICK_SOURCE, type: PREVIEW_HOVER_MESSAGE, on: false });
    // 나간 뒤 다시 들어오면 또 신고된다(표식이 한쪽에 걸려 있지 않다).
    doc.fire('mouseover', { relatedTarget: null });
    expect(posted).toHaveLength(3);
  });

  it('들어온 적이 없으면 나감도 보내지 않는다', () => {
    const { doc, posted } = runPickerScript();
    doc.fire('mouseout', { relatedTarget: null });
    expect(posted).toHaveLength(0);
  });

  it('요소 집기가 꺼져 있어도 이 다리는 산다 — 스크롤바는 집기와 무관하다', () => {
    const { doc, posted } = runPickerScript();
    // `pick-mode` 를 한 번도 켜지 않은 상태가 평소다.
    doc.fire('mouseover', { relatedTarget: null });
    expect(posted).toHaveLength(1);
  });
});

describe('previewPicker — 프록시 주입 한 벌', () => {
  it('요소 집기와 인스펙터 응답 조각이 함께 나간다', () => {
    const tail = buildPreviewInjectionTail('/iframe-proxy/localhost:3456', 'localhost:3456');
    // Alt 다리(요소 집기 조각)
    expect(tail).toContain(PREVIEW_ALT_MESSAGE);
    expect(tail).toContain('__vibisualPicker');
    // 좌표를 물으면 요소를 답하는 조각 — 이게 없으면 Alt 는 켜지는데 강조할 상자가 없다.
    expect(tail).toContain(WORKSPACE_SITE_INSPECT_REQUEST);
  });

  it('스크롤바 톤도 같은 꾸러미로 나간다 — 안쪽 문서엔 부모 CSS 가 닿지 않는다', () => {
    const tail = buildPreviewInjectionTail('/iframe-proxy/localhost:3456', 'localhost:3456');
    expect(tail).toContain(previewScrollbarInjection());
    // 스크롤바 조각은 **맨 뒤**여야 한다 — 페이지 스타일시트보다 늦게 서야 기본값을 덮는다.
    expect(tail.endsWith(previewScrollbarInjection())).toBe(true);
  });
});

describe('previewScrollbarInjection — 프리뷰 안쪽 문서의 스크롤바', () => {
  const html = previewScrollbarInjection();

  it('대기 상태에서는 보이지 않는다 (기본 숨김)', () => {
    // 자리는 잡되(`thin`) 색이 없어야 "아무것도 안 했는데 그어져 있는" 그 스크롤바가 사라진다.
    expect(html).toContain('*{scrollbar-width:thin;scrollbar-color:transparent transparent}');
    expect(html).toContain('*::-webkit-scrollbar-thumb{background:transparent');
  });

  it('마우스를 대면 뜬다', () => {
    expect(html).toContain('*:hover{scrollbar-color:rgba(100, 116, 139, 0.35) transparent}');
    expect(html).toContain('*:hover::-webkit-scrollbar-thumb{background:rgba(100, 116, 139, 0.3)}');
  });

  it('굴리기만 해도 뜬다 — hover 가 오지 않는 손(휠·터치·키보드)의 몫', () => {
    expect(html).toContain(`[${PREVIEW_SCROLLBAR_ACTIVE_ATTR}]{scrollbar-color:`);
    // 표식을 붙이는 쪽이 없으면 그 셀렉터는 영원히 걸리지 않는다.
    expect(html).toContain('addEventListener("scroll"');
    expect(html).toContain(String(PREVIEW_SCROLLBAR_HOLD_MS));
    // `scroll` 은 버블하지 않는다 — 캡처로 듣지 않으면 안쪽 상자의 스크롤이 오지 않는다.
    expect(html).toContain('}, true);');
  });

  it('스크롤바 말고는 건드리지 않는다', () => {
    // `*` 에 전이를 걸면 페이지가 자기 요소에 걸어 둔 애니메이션이 함께 죽는다.
    expect(html).not.toContain('*{transition');
    // 덮어쓰기를 특정도로 이기려 들지 않는다 — 페이지가 직접 꾸민 스크롤바는 그대로 둔다.
    expect(html).not.toContain('!important');
    // 글꼴·레이아웃 속성이 섞여 들어가면 그건 더 이상 스크롤바 조각이 아니다.
    for (const prop of ['font-family', 'background-color', 'display:', 'position:']) {
      expect(html).not.toContain(prop);
    }
  });

  it('한 문서에 두 번 서지 않는다', () => {
    expect(html).toContain('__vibisualScrollbar');
  });

  /**
   * 세 번째 신고에서야 잡힌 함정 — **썸만 숨겨서는 화면이 그대로다.**
   *
   * 문서 스크롤바의 트랙은 페이지 배경이 칠해 주지 않는다. 그래서 트랙을 투명하게 두면 그 자리에서
   * **iframe 요소의 배경(`bg-white`)** 이 그대로 드러나, 썸이 사라져도 오른쪽에 흰 띠가 남는다 —
   * 고치기 전과 눈으로 구별되지 않는다. 이 검사가 그 되돌림을 막는다.
   */
  it('문서 스크롤바의 트랙은 페이지 배경으로 칠한다 — 투명하면 iframe 의 흰 배경이 드러난다', () => {
    const track = `var(${PREVIEW_SCROLLBAR_TRACK_VAR}, transparent)`;
    expect(html).toContain(`html{scrollbar-color:transparent ${track}}`);
    expect(html).toContain(`html:hover{scrollbar-color:rgba(100, 116, 139, 0.35) ${track}}`);
    expect(html).toContain(`html[${PREVIEW_SCROLLBAR_ACTIVE_ATTR}]{scrollbar-color:rgba(100, 116, 139, 0.35) ${track}}`);
    expect(html).toContain(`html::-webkit-scrollbar-track{background:${track}}`);
    // 값을 채우는 쪽이 없으면 그 변수는 영원히 비어 있고, 트랙은 다시 투명(= 흰 띠)이 된다.
    expect(html).toContain('setProperty(TRACK');
    expect(html).toContain('backgroundColor');
  });

  it('안쪽 상자의 트랙은 투명한 채로 둔다 — 그 상자 배경이 이미 트랙까지 칠한다', () => {
    expect(html).toContain('*{scrollbar-width:thin;scrollbar-color:transparent transparent}');
    expect(html).toContain('*::-webkit-scrollbar-track{background:transparent');
  });

  it('네이티브 스크롤바를 없애지는 않는다 — 없애면 끌어서 스크롤하던 손이 함께 사라진다', () => {
    expect(html).not.toContain('scrollbar-width:none');
    expect(html).not.toContain('display:none');
  });
});
