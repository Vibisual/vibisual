/**
 * overlaySlot.test.ts — §5.5 #17-6 (H-10) **빠르게 오갈 때** 무너지던 자리들의 회귀.
 *
 * 앱 안 IDE 창을 밖으로 빼고 다시 넣는 손짓을 **빠르게** 반복하면, 창을 닫으라고 말한 순간과
 * 실제로 닫히는 순간 사이의 틈에서 세 가지가 한꺼번에 무너졌다(사용자 보고 — "빠르게 왔다갔다
 * 하면 바로 에러나고 마우스에 화면이 달려버린다"):
 *   ⓐ 닫히는 중인 창을 "이미 있는 창"으로 알고 다시 씀 → 새 창이 서지 않은 채 죽어 IDE 가 사라짐
 *   ⓑ 늦게 온 `closed` 가 그 사이 들어선 새 창의 자리를 지움 → 뗌 신호가 닿지 못해 창이 커서에 달라붙음
 *   ⓒ 윤곽선(가상 창)의 주인이 `ready-to-show` 에서 정해져, 그 전에 합쳐지면 선이 고아가 됨
 *
 * 판정은 `overlaySlot.ts` 순수 함수가 쥐고, 그 규칙을 **실제로 부르는지**는 소스로 집행한다
 * (windowManager 는 electron 에 붙어 있어 여기서 실행할 수 없다 — `vitest.config.ts` 의 전제).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isOverlaySlotUsable,
  overlayAttentionOnReuse,
  overlayFollowsMainFocus,
  overlayRaiseSteps,
  overlayReuseActivation,
  overlayTopMostFor,
  releaseSlotIfOwner,
} from './overlaySlot';

const HERE = dirname(fileURLToPath(import.meta.url));

// Windows 체크아웃은 줄 끝을 CRLF 로 바꾼다(.gitattributes 없음) — 여러 줄 표식이 어긋나지 않게 LF 로 맞춰 읽는다.
function source(name: string): string {
  return readFileSync(join(HERE, name), 'utf8').replace(/\r\n/g, '\n');
}

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe('isOverlaySlotUsable — 닫히는 중인 창은 없는 것으로 본다', () => {
  it('멀쩡히 서 있는 창은 다시 쓴다(한 에이전트 한 창)', () => {
    expect(isOverlaySlotUsable({ closing: false, destroyed: false })).toBe(true);
  });

  it('닫으라고 말해 둔 창은 못 쓴다 — `closed` 가 아직 안 왔을 뿐이다', () => {
    expect(isOverlaySlotUsable({ closing: true, destroyed: false })).toBe(false);
  });

  it('이미 죽은 창도 못 쓴다', () => {
    expect(isOverlaySlotUsable({ closing: false, destroyed: true })).toBe(false);
  });

  it('빈 자리는 당연히 못 쓴다(새로 세운다)', () => {
    expect(isOverlaySlotUsable(null)).toBe(false);
    expect(isOverlaySlotUsable(undefined)).toBe(false);
  });
});

describe('releaseSlotIfOwner — 늦게 온 `closed` 가 남의 창을 지우지 않는다', () => {
  it('내 것이면 놓는다', () => {
    const map = new Map<string, object>();
    const mine = { id: 1 };
    map.set('agent-1', mine);
    expect(releaseSlotIfOwner(map, 'agent-1', mine)).toBe(true);
    expect(map.has('agent-1')).toBe(false);
  });

  it('그 사이 새 창이 들어섰으면 **건드리지 않는다** — 지우면 그 창이 커서에 달라붙는다', () => {
    const map = new Map<string, object>();
    const old = { id: 1 };
    const fresh = { id: 2 };
    map.set('agent-1', old);
    map.set('agent-1', fresh); // 빠른 왕복 — 옛 창의 `closed` 보다 새 창의 등록이 먼저 왔다
    expect(releaseSlotIfOwner(map, 'agent-1', old)).toBe(false);
    expect(map.get('agent-1')).toBe(fresh);
  });

  it('없는 칸을 놓으라고 해도 조용히 지나간다(여러 번 불려도 안전)', () => {
    const map = new Map<string, object>();
    expect(releaseSlotIfOwner(map, 'agent-1', { id: 1 })).toBe(false);
  });
});

describe('overlayReuseActivation — 매달린 채 나가는 판은 앞으로 세우지 않는다', () => {
  it('`follow` 면 활성화하지 않는다 — (H-4) ⑥ 캡처를 뺏기면 이동·뗌이 도착하지 않는다', () => {
    expect(overlayReuseActivation(true)).toBe('inactive');
  });

  it('그냥 여는 판은 종전대로 앞에 세운다', () => {
    expect(overlayReuseActivation(false)).toBe('foreground');
  });

  it('(H-17) `settled` 는 손이 **이미 떠난** 판 — 걷어 갈 캡처가 없어 앞으로 세운다', () => {
    // 여기서 `inactive` 로 남기면 방금 놓은 창이 뒤에 떠 "놓았는데 안 보인다"가 된다.
    // (H-25) 의 예열 길이 바로 이 갈래로 들어온다 — 뗌이 재사용 갈래를 타기 때문이다.
    expect(overlayReuseActivation(true, true)).toBe('foreground');
    expect(overlayReuseActivation(true, false)).toBe('inactive');
  });
});

describe('windowManager 소스 집행 — 규칙을 실제로 부르는가', () => {
  const wm = source('windowManager.ts');

  it('`openOverlay` 의 재사용은 `isOverlaySlotUsable` 를 거친다(맨 `isDestroyed()` 판정 ❌)', () => {
    const reuse = block(wm, 'const existing = overlaysByAgentId.get(opts.agentId);', 'return { windowId: existing.id');
    expect(reuse).toContain('isOverlaySlotUsable(');
  });

  it('재사용의 활성화 갈래는 `overlayReuseActivation` 한 곳이 정한다 — 밟을 손짓은 그 목록이 정한다', () => {
    // (H-16) 종전에는 여기서 `showInactive()`/`show()+focus()` 를 직접 갈랐다. 이제는 밟을 순서
    //   전체를 `overlayRaiseSteps` 가 정하고(OS 마다 다르다) 이곳은 실행만 한다 — 갈림이 두 곳에
    //   있으면 한쪽만 고쳐지는 날이 온다.
    const reuse = block(wm, 'const existing = overlaysByAgentId.get(opts.agentId);', 'return { windowId: existing.id');
    expect(reuse).toContain('overlayReuseActivation(');
    expect(reuse).toContain('raiseOverlayWindow(existing, activation);');
    expect(reuse).not.toContain('existing.window.showInactive();');
    expect(reuse).not.toContain('existing.window.focus();');
  });

  it('윤곽선의 주인은 **창을 만들 때** 정해진다 — `ready-to-show` 를 기다리지 않는다', () => {
    // 그 전에 합쳐져 닫히면 주인이 없어 선이 고아가 된다(클릭통과라 사용자가 없앨 수 없다).
    const created = block(wm, 'overlaysByWindowId.set(win.id, entry);', "win.on('ready-to-show'");
    expect(created).toContain('isPopOutGhostVisible()');
    expect(created).toContain('armGhostHandoff(win.id)');
  });

  it('되돌아온 창은 **선을 넘겨 두고** 그 자리에서 닫힌다 — `closed` 를 기다리지 않는다', () => {
    // (H-10) 은 여기서 선을 곧바로 걷었다. (H-12) 로 들어오는 길에도 구간이 생기면서, 선은
    //   앱 안 창이 그 자리를 이어받아 다 그릴 때까지 살아 있어야 한다 — 주인을 **메인 창**으로
    //   적어 두므로 방금 닫는 이 독립 창의 `closed` 가 그 선을 걷지 않는다.
    const redock = block(wm, 'function redockFollowedOverlay(', '\nexport function startOverlayDragByWindowId');
    // (H-15) 그물의 **길이는 들어오는 길의 것**이다 — 나가는 길의 4초를 그대로 쓰면, 렌더러가
    //   말 못 한 판에서 클릭통과 선이 그만큼 커서에 붙어 있다(사용자에게는 그것이 곧 고장이다).
    expect(redock).toContain('armGhostHandoff(getMainWindow()?.id ?? -1, GHOST_REDOCK_FALLBACK_MS);');
    expect(redock).toContain('closeOverlayEntry(entry);');
    // 합치는 성공 경로에서 선을 바로 걷으면 창이 서기까지 손 아래가 빈다(고치려던 그 구간).
    expect(redock).not.toContain('finishGhostHandoff();\n  closeOverlayEntry(entry);');
  });

  // ─── §5.5 #17-6 (H-12) 들어오는 길의 구간 ───────────────────────────────────
  //
  // 판정은 shared 순수 함수(`stepRedockDwell`)가 쥐고 서버 테스트가 고정한다. 여기서 볼 것은
  // main 이 그 판정을 **실제로 그렇게 쓰는가** 하나다 — 세 마디를 각각 다른 일에 이어야 한다.

  it('들어오는 판정은 `stepRedockDwell` 하나가 쥔다 — 절벽(`stepAppEntry`) 직접 호출 ❌', () => {
    const follow = block(wm, 'function startOverlayFollow(', '\nfunction finishOverlayFollow(');
    expect(follow).toContain('stepRedockDwell(');
    expect(follow).not.toContain('stepAppEntry(');
    // 세 마디가 각각 제 일로 간다(하나라도 빠지면 구간이 아니라 지연이 된다).
    // (H-17) 셋째 마디는 **무장**이다 — 합치는 일은 손을 뗄 때 한 곳으로 옮겼다(사용자 지시).
    //   자세한 계약은 `redockCommit.test.ts`.
    expect(follow).toContain('if (step.start) beginRedockDwell(entry, drag);');
    expect(follow).toContain('else if (step.cancel) cancelRedockDwell(entry, drag);');
    expect(follow).toContain('else if (step.arm && !drag.dwellArmed) armRedockDwell(entry, drag);');
  });

  it('들어온 순간에는 창을 **숨기고 선을 세운다** — 둘이 겹쳐 뜨지 않게', () => {
    const begin = block(wm, 'function beginRedockDwell(', '\n/**');
    expect(begin).toContain('showPopOutGhost(');
    expect(begin).toContain('win.hide()');
    // 무장(밝은 선)은 "지금 놓아도 그대로"라는 뜻이다 — 여기는 아직 확정이 아니다.
    expect(begin).toContain('armed: false');
  });

  it('선을 세우지 못하는 환경에서는 **구간 없이 곧바로** 합친다 — 기다리기만 하지 않게', () => {
    const begin = block(wm, 'function beginRedockDwell(', '\n/**');
    expect(begin).toContain('if (!shown)');
    expect(begin).toContain('redockFollowedOverlay(entry, drag);');
  });

  it('버티다 나가면 선을 걷고 **창을 되살린다** — 선만 남으면 그 IDE 가 어디에도 없다', () => {
    const cancel = block(wm, 'function cancelRedockDwell(', '\n/**');
    expect(cancel).toContain('finishGhostHandoff();');
    // 표시 스위치는 하나뿐이다((D)) — `show()` 를 직접 부르면 숨김 상태를 무시하고 되살아난다.
    expect(cancel).toContain('applyOverlayVisibility(entry, false);');
    expect(cancel).not.toContain('entry.window.show()');
  });

  it('합칠 곳이 없으면(메인 창이 닫혔다) 숨겨 둔 창을 반드시 되살린다', () => {
    const redock = block(wm, 'function redockFollowedOverlay(', '\nexport function startOverlayDragByWindowId');
    const fail = block(redock, 'if (!ok) {', '\n  }');
    expect(fail).toContain('cancelRedockDwell(entry, drag);');
  });

  it('버티는 도중에 손을 떼면 **합친다** — 깊숙이 끌어다 놓은 손짓이 막히지 않게', () => {
    const finish = block(wm, 'function finishOverlayFollow(', '\nexport function endOverlayDragByWindowId');
    expect(finish).toContain('if (drag?.dwelling) {');
    expect(finish).toContain('redockFollowedOverlay(entry, drag);');
  });

  it('`closed` 는 **내가 쥔 칸만** 놓는다(조건 없는 delete ❌)', () => {
    const closed = block(wm, "win.on('closed', () => {", 'broadcastOverlayList();\n  });');
    expect(closed).toContain('detachOverlaySlot(entry)');
    expect(closed).not.toContain('overlaysByAgentId.delete(');
    expect(closed).not.toContain('overlaysByWindowId.delete(');
  });

  it('오버레이를 닫는 길은 하나다 — 자리를 먼저 놓고 시계를 걷은 뒤 닫는다', () => {
    const closeEntry = block(wm, 'function closeOverlayEntry(', '\nexport function');
    expect(closeEntry).toContain('detachOverlaySlot(entry)');
    expect(closeEntry).toContain('stopOverlayDrag(entry.id)');
    // 닫기를 부르는 자리들이 각자 `window.close()` 를 부르지 않는다(정리를 빠뜨린 판이 남는다).
    const byAgent = block(wm, 'export function closeOverlayByAgentId(', '\nexport function closeOverlayByWindowId');
    expect(byAgent).toContain('closeOverlayEntry(entry)');
    expect(byAgent).not.toContain('entry.window.close()');
  });
});

describe('ipc 소스 집행 — 렌더러가 선을 걷으면 그물도 함께 풀린다', () => {
  it('`ghost-hide` 는 `dismissPopOutGhost` 로 간다 — 선만 걷고 그물을 남기지 않는다', () => {
    // (H-12) 들어오는 길에서는 이어받은 앱 안 창이 다 그린 뒤 이것을 부른다. 그때 4초 그물이
    //   함께 풀리지 않으면 다음 판의 선을 엉뚱한 때에 걷는다.
    const ipc = source('ipc.ts');
    expect(ipc).toContain("ipcMain.handle('vibisual:overlay:ghost-hide', (): boolean => dismissPopOutGhost());");
  });
});

describe('ghostFrame 소스 집행 — 다시 쓰는 선은 수명도 다시 잰다', () => {
  it('이미 떠 있는 선을 갈아 끼울 때 상한 타이머를 다시 건다', () => {
    // 여러 번 오가면 같은 창을 계속 갈아 끼우는데, 상한이 첫 판에서부터 흐르면 아직 끌고 있는
    // 손 아래에서 선이 그냥 사라진다(그물이 기능을 끊는다).
    const gf = source('ghostFrame.ts');
    const reuse = block(gf, 'if (ghost && !ghost.window.isDestroyed()) {', 'return true;');
    expect(reuse).toContain('clearTimeout(ghost.lifeTimer)');
    expect(reuse).toContain('GHOST_MAX_LIFE_MS');
  });

  it('(H-12) 선에 적는 한 줄은 `textContent` 로 들어간다 — 렌더러가 지어 넘긴 글이다', () => {
    const gf = source('ghostFrame.ts');
    const applyHint = block(gf, 'function applyHint(', '\n/**');
    expect(applyHint).toContain('textContent=');
    expect(applyHint).toContain('JSON.stringify(g.hint)');
    // 문자열을 코드에 그대로 이어 붙이면 따옴표 하나에 이 창이 깨진다.
    expect(applyHint).not.toContain('+g.hint+');
  });

  it('(H-12) 한 줄이 없으면 그 자리를 아예 안 그린다 — 빈 띠가 남지 않게', () => {
    const gf = source('ghostFrame.ts');
    expect(gf).toContain('body.nohint .hint{display:none}');
  });
});

// ─── §5.5 #17-6 (H-16) 밖의 그 창을 **앞으로 세우기** ────────────────────────────
//
// (H-13) 은 "앱 안에서 IDE 를 여는 손짓 = 밖의 그 창을 앞으로 세우기" 까지 정했는데, 세우는
// 손짓이 `show()` + `focus()` 둘뿐이라 다른 프로그램 뒤에 깔린 창이 그대로 깔려 있는 경우가
// 있었다(사용자 보고). 세 OS 가 각각 다른 이유로 그렇게 되므로, 밟을 순서를 순수 함수가 쥐고
// 여기서 세 OS 를 전부 시험한다 — 실기가 없는 우리에겐 이것이 분기를 확인하는 유일한 방법이다.
describe('overlayRaiseSteps — 앞세우기가 밟는 순서', () => {
  it('Windows: 보이기 → 포커스 뒤에 **상시-위 재단언 → 맨 위로** 가 온다', () => {
    // `show`·`focus` 자체가 상태 전이라 topmost 를 조용히 푼다(§17-6 (E) v2.80) — 먼저 박으면
    //   그 전이가 도로 풀어 버린다. 그리고 층을 박는 것과 그 층 안에서 맨 위로 오는 것은 다른 일이다.
    const steps = overlayRaiseSteps({ platform: 'win32', activation: 'foreground', minimized: false });
    expect(steps).toEqual(['show', 'focus', 'reassertTop', 'moveTop']);
  });

  it('macOS: 포커스 **앞에** 앱 활성화가 들어간다 — 창만 포커스하면 앱은 뒤에 남는다', () => {
    const steps = overlayRaiseSteps({ platform: 'darwin', activation: 'foreground', minimized: false });
    expect(steps).toEqual(['show', 'activateApp', 'focus', 'reassertTop', 'moveTop']);
    expect(steps.indexOf('activateApp')).toBeLessThan(steps.indexOf('focus'));
  });

  it('Linux: mac 의 앱 활성화는 없다 — 창 포커스가 곧 앱 포커스다', () => {
    const steps = overlayRaiseSteps({ platform: 'linux', activation: 'foreground', minimized: false });
    expect(steps).toEqual(['show', 'focus', 'reassertTop', 'moveTop']);
    expect(steps).not.toContain('activateApp');
  });

  it('최소화된 창은 **맨 먼저** 되살린다 — 최소화된 창은 자리도 Z 순서도 뜻이 없다', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const steps = overlayRaiseSteps({ platform, activation: 'foreground', minimized: true });
      expect(steps[0], platform).toBe('restore');
    }
  });

  it('매달린 채 나가는 판(§17-6 (H-4) ⑥)은 **어느 OS 에서도** 활성화하지 않는다', () => {
    // 활성화되는 순간 OS 가 메인 창의 마우스 캡처를 걷어, 아직 눌려 있는 손짓의 이동·뗌이
    //   어디에도 도착하지 않는다(창이 커서에 달라붙은 채 남는다) — 맨 위로 올리지도 않는다.
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const steps = overlayRaiseSteps({ platform, activation: 'inactive', minimized: false });
      expect(steps, platform).toEqual(['showInactive', 'reassertTop']);
      expect(steps, platform).not.toContain('focus');
      expect(steps, platform).not.toContain('activateApp');
      expect(steps, platform).not.toContain('moveTop');
    }
  });

  it('매달린 판이 최소화돼 있으면 되살리기만 앞에 붙는다(활성화는 여전히 ❌)', () => {
    const steps = overlayRaiseSteps({ platform: 'win32', activation: 'inactive', minimized: true });
    expect(steps).toEqual(['restore', 'showInactive', 'reassertTop']);
  });
});

describe('overlayAttentionOnReuse — "눌렸다"는 기척을 누구에게 보내는가', () => {
  it('앱 안에서 부른 판에만 보낸다 — 앞으로 오는 것만으로는 손짓이 닿았는지 안 보인다', () => {
    expect(overlayAttentionOnReuse('foreground')).toBe(true);
  });

  it('매달린 판에는 보내지 않는다 — 그때 보고 있는 것은 커서를 따라오는 창이지 기척이 아니다', () => {
    expect(overlayAttentionOnReuse('inactive')).toBe(false);
  });
});

describe('(H-16) 소스 집행 — 세우는 일과 비추는 일이 제 자리에 있는가', () => {
  const wm = source('windowManager.ts');
  const reuse = block(
    wm,
    'const existing = overlaysByAgentId.get(opts.agentId);',
    'return { windowId: existing.id',
  );

  it('밟는 쪽은 `process.platform` 을 **인자로 넘긴다** — 함수 안에서 읽으면 영영 검증되지 않는다', () => {
    const exec = block(wm, 'function raiseOverlayWindow(', '\n}');
    expect(exec).toContain('overlayRaiseSteps({');
    expect(exec).toContain('platform: process.platform,');
    // 손짓은 전부 여기서만 실행된다 — 목록에 없는 손짓이 몰래 끼면 세 OS 시험이 헛것이 된다.
    for (const call of ['win.restore()', 'win.showInactive()', 'win.show()', 'win.focus()', 'win.moveTop()']) {
      expect(exec, call).toContain(call);
    }
    expect(exec).toContain("app.focus({ steal: true })");
  });

  it('펼치기 **뒤에** 한 번 더 밟는다 — 그 전이가 층과 Z 순서를 흩뜨린다', () => {
    expect(reuse.match(/raiseOverlayWindow\(existing, activation\);/g)?.length ?? 0).toBe(2);
    const expand = reuse.indexOf('expandOverlayByWindowId(existing.id)');
    const lastRaise = reuse.lastIndexOf('raiseOverlayWindow(existing, activation);');
    expect(expand).toBeGreaterThan(-1);
    expect(lastRaise).toBeGreaterThan(expand);
  });

  it('기척은 판정 함수를 거쳐 그 창의 렌더러로 간다 — 포커스 전용 IPC 를 새로 만들지 않는다', () => {
    // (H-13) 의 규율: 세우는 길은 `overlay:open` 재사용 경로 하나다. 기척은 그 길 **위에서**
    //   함께 나가는 알림일 뿐이라 새 길이 아니다(main 에는 그림이 없어 신호만 보낸다).
    expect(reuse).toContain('overlayAttentionOnReuse(activation)');
    expect(reuse).toContain("existing.window.webContents.send('vibisual:overlay:attention'");
  });

  it('죽은 렌더러에는 보내지 않는다 — 죽는 찰나에 닿으면 `open()` 의 약속이 깨진다', () => {
    expect(reuse).toContain('!existing.window.webContents.isDestroyed()');
  });
});

describe('(E) overlayTopMostFor — 층은 펼침 여부 하나로 갈린다', () => {
  it('접힌 버블은 상시-위다 — 오버레이의 본질이 붙는 것은 버블이다', () => {
    expect(overlayTopMostFor(false)).toEqual({ alwaysOnTop: true, level: 'screen-saver' });
  });

  it('펼친 IDE 는 보통 층이다 — 화면을 덮는 작업 창까지 위에 박히면 그 옆에서 다른 앱을 못 쓴다', () => {
    expect(overlayTopMostFor(true)).toEqual({ alwaysOnTop: false });
  });

  it('그래서 버블은 여전히 펼친 IDE 위에 뜬다 — 두 층 사이를 따로 조율할 것이 없다', () => {
    expect(overlayTopMostFor(false).alwaysOnTop).toBe(true);
    expect(overlayTopMostFor(true).alwaysOnTop).toBe(false);
  });
});

describe('(E-2) overlayFollowsMainFocus — 본체 창을 고를 때 따라 올라오는 창', () => {
  const base = {
    expanded: true,
    visible: true,
    minimized: false,
    closing: false,
    destroyed: false,
    warming: false,
  };

  it('펼쳐져 보이는 창은 따라 올라온다 — 작업표시줄에 없어 깔리면 되돌릴 길이 없다', () => {
    expect(overlayFollowsMainFocus(base)).toBe(true);
  });

  it('접힌 버블은 건드리지 않는다 — 이미 상시-위 층이라 올릴 일이 없다', () => {
    expect(overlayFollowsMainFocus({ ...base, expanded: false })).toBe(false);
  });

  it('감춰 둔 창을 되살리지 않는다 — 전역 토글·"이 버블만 숨기기"가 감춘 것이다', () => {
    expect(overlayFollowsMainFocus({ ...base, visible: false })).toBe(false);
  });

  it('최소화한 창은 그대로 둔다 — 올린다고 복원되지도 않고, 복원은 사용자가 할 일이다', () => {
    expect(overlayFollowsMainFocus({ ...base, minimized: true })).toBe(false);
  });

  it('닫히는 중이거나 이미 죽은 창은 건드리지 않는다((H-10) 의 그 틈)', () => {
    expect(overlayFollowsMainFocus({ ...base, closing: true })).toBe(false);
    expect(overlayFollowsMainFocus({ ...base, destroyed: true })).toBe(false);
  });

  it('예열 창은 아직 태어나지 않았다((H-25) ② — 어느 길로도 보이지 않는다)', () => {
    expect(overlayFollowsMainFocus({ ...base, warming: true })).toBe(false);
  });
});

describe('(E)·(E-2) 소스 집행 — 층을 박는 자리가 규칙을 빠뜨리지 않는가', () => {
  const wm = source('windowManager.ts');

  it('층 값을 정하는 곳은 `overlayTopMostFor` 하나다 — 창은 그 답을 실행만 한다', () => {
    const fn = block(wm, 'function keepOverlayOnTop(', '\n}');
    expect(fn).toContain('overlayTopMostFor(expanded)');
    // 값을 손으로 다시 적으면 갈림이 두 곳이 된다((E) v2.80 이 겪은 그 회귀).
    expect(fn).not.toContain("'screen-saver'");
  });

  it('오버레이 창의 층 재단언은 **한 곳도 빠짐없이** `expanded` 를 넘긴다', () => {
    // 인자 하나짜리 호출이 하나라도 남으면 그 전이만 옛 규칙(늘 상시-위)으로 돈다 —
    //   그 창을 띄워 보기 전에는 드러나지 않는 부류의 누락이다.
    expect(wm).not.toMatch(/keepOverlayOnTop\([^,)]*\)/);
  });

  it('커서 팝업 메뉴는 그 갈림 밖이다 — 늘 상시-위(대상 창 뒤로 숨으면 고를 수가 없다)', () => {
    const menu = block(wm, 'function keepOverlayMenuOnTop(', '\n}');
    expect(menu).toContain("setAlwaysOnTop(true, 'screen-saver')");
    // 정의 1 + 메뉴 창을 세우는 세 자리.
    expect(wm.match(/keepOverlayMenuOnTop\(/g)?.length ?? 0).toBe(4);
  });

  it('펼치기·접기가 그 전이의 층을 스스로 박는다 — 층이 갈리는 두 지점이다', () => {
    const expand = block(wm, 'export function expandOverlayByWindowId(', '\n}');
    const collapse = block(wm, 'export function collapseOverlayByWindowId(', '\n}');
    expect(expand).toContain('entry.expanded = true;');
    expect(expand).toContain('keepOverlayOnTop(win, entry.expanded);');
    expect(collapse).toContain('entry.expanded = false;');
    expect(collapse).toContain('keepOverlayOnTop(win, entry.expanded);');
  });

  it('따라 올리기는 Z 순서만 건드린다 — 포커스는 사용자가 고른 본체 창의 것이다', () => {
    const fn = block(wm, 'export function raiseExpandedOverlaysForMainFocus(', '\n}');
    expect(fn).toContain('overlayFollowsMainFocus({');
    expect(fn).toContain('win.moveTop()');
    // 활성화하면 방금 고른 본체 창에서 타이핑이 새 나간다.
    expect(fn).not.toContain('win.focus()');
    expect(fn).not.toContain('app.focus(');
    expect(fn).not.toContain('win.show()');
  });

  it('본체 창이 포커스를 받는 그 자리에서 부른다 — 두 번째는 그때도 포커스일 때만', () => {
    const idx = source('index.ts');
    const focus = block(idx, "mainWindow.on('focus'", '\n  });');
    expect(focus.match(/raiseExpandedOverlaysForMainFocus\(\);/g)?.length ?? 0).toBe(2);
    // Windows 의 전면화가 끝나기 전에 밟은 첫 번째를 OS 가 되돌릴 수 있어 한 번 더 밟는데,
    //   그 사이 사용자가 다른 앱으로 갔으면 올릴 이유가 없다.
    expect(focus).toContain('!mainWindow.isFocused()');
  });
});
