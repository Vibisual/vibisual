/**
 * redockRelease.test.ts — §5.5 #17-6 (H-23) **들어오는 길의 뗌은 숨은 창이 들을 수 없다.**
 *
 * (H-12) ① 이 세운 "들어온 순간 독립 창은 숨는다"가, 그 판의 **뗌을 듣던 유일한 창**을 함께
 * 없앴다 — 들어오는 판의 손은 그 독립 창에서 눌렸으므로 리스너가 전부 거기 달려 있고, 창이
 * 숨으면 OS 가 그 창의 마우스 캡처를 걷어 그 렌더러에 뗌이 영영 닿지 않는다. 그래서
 * (H-17) ③ 이 합치는 자리로 모아 둔 `finishOverlayFollow` 가 불리지 않았다:
 *
 *   ⓐ 선이 커서에 붙은 채 남는다(사용자 보고 — "마우스를 때도 손에 붙어있는 버그가 있어").
 *   ⓑ 선마저 수명으로 걷히고 나면 숨은 창이 그대로 남아 **그 IDE 가 화면 어디에도 없다**
 *      (사용자 보고 — "다시 잡고 들어오는 순간 에러가나").
 *
 * 이 파일은 창을 띄우지 않고 main 이 그 둘을 막는 계약만 소스로 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Windows 체크아웃은 줄 끝을 CRLF 로 바꾼다(.gitattributes 없음) — 여러 줄 표식이 어긋나지 않게 LF 로 맞춰 읽는다.
const WM = readFileSync(join(__dirname, 'windowManager.ts'), 'utf8').replace(/\r\n/g, '\n');
const GHOST = readFileSync(join(__dirname, 'ghostFrame.ts'), 'utf8').replace(/\r\n/g, '\n');

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from + startMarker.length);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe('① 매달림 신호는 누구의 판인지 말하고, 들어올 수 있는 판은 메인 창에도 간다', () => {
  const send = block(WM, 'function sendFollowDragState(', '\n/**');

  it('신호에 `agentId` 를 싣는다 — 메인 창은 자기 판이 아니라 **남의 판**을 대신 듣는다', () => {
    expect(send).toContain('const payload = { following, agentId: entry.agentId };');
  });

  it('메인 창에도 같은 신호를 보낸다 — 신호를 새로 만들지 않는다(두 이름이면 한쪽만 고쳐진다)', () => {
    expect(send).toContain("main.webContents.send('vibisual:overlay:follow-drag-state', payload);");
    // 매달린 창 쪽은 종전 그대로 — (H-4) ⑥ 의 두 귀 중 하나를 떼면 안 된다.
    expect(send).toContain("win.webContents.send('vibisual:overlay:follow-drag-state', payload);");
  });

  it('메인 창이 죽었으면 조용히 지나간다 — 뗌 그물이 없다고 드래그가 실패해서는 안 된다', () => {
    expect(send).toContain('if (!main || main.isDestroyed() || main.webContents.isDestroyed()) return;');
  });

  it('**켜는** 신호는 되돌아올 수 있는 판만 메인 창으로 간다 — 버블 드래그는 앱 안에 들어올 일이 없다', () => {
    const follow = block(WM, 'function startOverlayFollow(', '\nfunction finishOverlayFollow(');
    expect(follow).toContain('sendFollowDragState(entry, true, init.redockOnEnter);');
  });

  it('**끄는** 신호는 늘 메인 창까지 간다 — 못 푼 그물은 다음 손짓의 뗌을 먹는다', () => {
    const finish = block(WM, 'function finishOverlayFollow(', '\nexport function endOverlayDragByWindowId');
    expect(finish).toContain('sendFollowDragState(entry, false, true);');
    // 창이 죽었어도 메인 창의 그물은 풀어야 한다 — 그 반환보다 **먼저**.
    const upTo = finish.indexOf('if (entry.window.isDestroyed()) return true;');
    expect(upTo, '`isDestroyed` 반환 줄을 못 찾음').toBeGreaterThan(-1);
    expect(finish.slice(0, upTo)).toContain('sendFollowDragState(entry, false, true);');
  });

  it('합쳐서 끝난 판도 메인 창의 그물을 푼다 — 창은 닫히지만 메인 창은 다음 손짓을 받는다', () => {
    const redock = block(WM, 'function redockFollowedOverlay(', '\nexport function startOverlayDragByWindowId');
    // 실패 갈래(되살리기)와 성공 갈래(합침) 둘 다에서 나가야 한다.
    expect(redock.match(/sendFollowDragState\(entry, false, true\);/g)?.length ?? 0).toBe(2);
  });
});

describe('③ 아무도 말하지 않으면 main 이 스스로 푼다 — 숨긴 창을 영영 숨긴 채 두지 않는다', () => {
  const begin = block(WM, 'function beginRedockDwell(', '\n/**');

  it('들어온 순간 상한 시계를 건다', () => {
    expect(begin).toContain('drag.holdTimer = setTimeout(');
    expect(begin).toContain('REDOCK_DWELL_HOLD_MAX_MS');
  });

  it('상한이 터지면 **되살린다** — 부르지 않은 합침은 되돌릴 손잡이가 없다', () => {
    const fire = block(begin, 'drag.holdTimer = setTimeout(', '}, REDOCK_DWELL_HOLD_MAX_MS);');
    expect(fire).toContain('cancelRedockDwell(entry, drag);');
    expect(fire).not.toContain('redockFollowedOverlay(');
    // 되살린 판의 그물도 함께 푼다(메인 창에 걸어 둔 것).
    expect(fire).toContain('sendFollowDragState(entry, false, true);');
  });

  it('그사이 판이 끝났거나 다시 밖으로 나갔으면 아무 일도 하지 않는다', () => {
    const fire = block(begin, 'drag.holdTimer = setTimeout(', '}, REDOCK_DWELL_HOLD_MAX_MS);');
    expect(fire).toContain('if (overlayDrags.get(entry.id) !== drag || !drag.dwelling) return;');
  });

  it('상한은 선의 수명보다 **짧다** — 선이 먼저 걷히면 그 뒤로 화면이 통째로 빈다', () => {
    const hold = /REDOCK_DWELL_HOLD_MAX_MS\s*=\s*([0-9_]+)/.exec(WM)?.[1];
    const life = /GHOST_MAX_LIFE_MS\s*=\s*([0-9_]+)/.exec(GHOST)?.[1];
    expect(hold, '상한 상수를 못 찾음').toBeTruthy();
    expect(life, '선의 수명 상수를 못 찾음').toBeTruthy();
    expect(Number(hold!.replace(/_/g, ''))).toBeLessThan(Number(life!.replace(/_/g, '')));
  });

  it('판이 끝나는 두 자리에서 시계를 멎는다 — 남으면 다음 판의 창을 엉뚱한 때에 되세운다', () => {
    const stop = block(WM, 'function stopOverlayDrag(', '\n/**');
    expect(stop).toContain('clearRedockHold(drag);');
    const cancel = block(WM, 'function cancelRedockDwell(', '\n/**');
    expect(cancel).toContain('clearRedockHold(drag);');
    // 되살리기의 종전 계약((H-12))은 그대로다 — 표시 스위치는 하나뿐이다((D)).
    expect(cancel).toContain('applyOverlayVisibility(entry, false);');
  });
});
