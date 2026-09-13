/**
 * popOutWarm.test.ts — §5.5 #17-6 (H-25) **나가는 창은 놓기 전에 태어난다.**
 *
 * (H-17) 로 "창이 바뀌는 자리는 뗌 하나"가 되면서 **창을 짓는 일까지** 그 한 순간으로 옮겨졌다.
 * 손을 뗀 그 프레임에 `new BrowserWindow` → 번들 파싱 → WS 연결 → 스냅샷 → `takeHandoff` →
 * IDE 마운트가 통째로 몰린다((H-7) 이 이미 적어 둔 그 길이고, (H-15) 가 그것을 기다리는 그물을
 * 4초로 잡아 둔 그 까닭이다). 끄는 동안은 선 하나만 움직여 매끄러운데 놓는 순간에만 그 초가
 * 한꺼번에 지불되므로, 사용자에게는 그 지점만 유독 무겁다(사용자 보고 — "손 떼면 두두둑").
 *
 * 고침은 그 일을 **미리 하는 것**이다. 이 파일은 창을 띄우지 않고 그 계약만 소스로 고정한다 —
 * 특히 "미리 지은 창이 **보이면 안 된다**"는 쪽을 길마다 따로 잠근다(보이면 윤곽선과 겹쳐,
 * (H-6) ③ 이 없애기로 한 "무엇이 진짜인지 모르는 화면"이 그대로 돌아온다).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WM = readFileSync(join(__dirname, 'windowManager.ts'), 'utf8');
const IPC = readFileSync(join(__dirname, 'ipc.ts'), 'utf8');

/** 두 표식 사이만 잘라 본다 — 파일의 닮은 자리(`ready-to-show` 는 네 곳에 있다)와 섞이지 않게. */
function between(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작 표식을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from + startMarker.length);
  expect(to, `끝 표식을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

/** 그 함수의 본문만 — 서명부터 첫 열의 닫는 중괄호까지. */
function fn(src: string, signature: string): string {
  return between(src, signature, '\n}');
}

describe('② 예열로 지은 창은 아직 태어나지 않은 것으로 친다', () => {
  it('목록에서 빠진다 — 놓기도 전에 헤더 개수·창 목록이 흔들리면 안 된다', () => {
    expect(fn(WM, 'export function listOverlays(')).toContain('if (e.warming) continue;');
  });

  it('전역 표시 토글이 **어느 길로도** 건드리지 않는다 — 윤곽선과 겹쳐 뜨면 무엇이 진짜인지 모른다', () => {
    const vis = fn(WM, 'function applyOverlayVisibility(');
    expect(vis).toContain('if (entry.warming) return;');
    // 가드는 `isDestroyed` 판정 **뒤**, 실제로 보이게 하는 줄들 **앞**이어야 뜻이 있다.
    expect(vis.indexOf('if (entry.warming) return;')).toBeLessThan(vis.indexOf('if (overlayShouldShow())'));
  });

  it('`ready-to-show` 가 보여주지 않는다 — 창을 세우는 자리는 뗌(재사용 갈래) 하나다', () => {
    // 이 파일에는 `ready-to-show` 가 여러 곳 있다 — 오버레이를 만드는 그 자리만 본다.
    const ready = between(
      WM,
      'if (opts.follow && isPopOutGhostVisible()) armGhostHandoff(win.id);',
      '} else if (opts.expanded) {',
    );
    expect(ready).toContain("win.on('ready-to-show', () => {");
    expect(ready).toContain('if (entry.warming) return;');
    // 띄우는 세 갈래(`show`·`focus`·`showInactive`)보다 앞이어야 한다.
    expect(ready.indexOf('if (entry.warming) return;')).toBeLessThan(ready.indexOf('win.showInactive()'));
  });

  it('예열은 전역 스위치를 켜지 않는다 — 켜면 놓기도 전에 다른 오버레이들까지 함께 나타난다', () => {
    const head = between(WM, 'export function openOverlay(opts: {', 'const existing = overlaysByAgentId.get');
    expect(head).toContain('warm?: boolean | undefined;');
    expect(head).toContain('if (opts.expanded && !opts.warm && !overlaysUserVisible) {');
  });

  it('태어나는 창의 두 비트는 `warm` 이 정한다', () => {
    const entry = between(WM, 'const entry: OverlayEntry = {', 'overlaysByAgentId.set(opts.agentId, entry);');
    expect(entry).toContain('warming: !!opts.warm,');
    expect(entry).toContain('shellReady: false,');
  });
});

describe('③④ 뗌은 종전 길(재사용 갈래)을 그대로 탄다', () => {
  const reuse = between(WM, 'const existing = overlaysByAgentId.get(opts.agentId);', 'return { windowId: existing.id');

  it('감춰 둔 비트를 **세우는 손짓보다 먼저** 푼다 — 안 그러면 그 길이 창을 도로 감춘다', () => {
    expect(reuse).toContain('const wasWarming = existing.warming;');
    expect(reuse.indexOf('existing.warming = false;')).toBeLessThan(reuse.indexOf('raiseOverlayWindow('));
  });

  it('예열 동안 미뤄 둔 전역 스위치를 그때 켠다 — 손으로 꺼낸 창은 반드시 보여야 한다', () => {
    const born = between(reuse, 'if (wasWarming) {', 'const activation =');
    expect(born).toContain('overlaysUserVisible = true;');
    expect(born).toContain('applyAllOverlayVisibility();');
  });

  it('윤곽선을 걷는 시점은 **그 창이 다 그렸는지**로 가른다 — 기다리는 것은 예열 창뿐이다', () => {
    expect(reuse).toContain('if (wasWarming && !existing.shellReady) armGhostHandoff(existing.id);');
    expect(reuse).toContain('else finishGhostHandoff();');
  });

  it('예열 길은 `settled` 로 들어온다 — 갈림은 `overlayReuseActivation` 한 곳이 쥔다', () => {
    expect(reuse).toContain('overlayReuseActivation(!!opts.follow, !!opts.follow?.settled)');
  });
});

describe('④ 다 그렸다는 사실은 인계와 따로 적어 둔다', () => {
  it('`shell-ready` 는 윤곽선의 주인이 아니어도 비트를 남긴다 — 예열 창이 바로 그 경우다', () => {
    const ready = fn(WM, 'export function overlayShellReady(');
    expect(ready).toContain('entry.shellReady = true;');
    // 기록이 **주인 판정보다 앞**이어야 한다 — 뒤에 두면 예열 창의 신호가 통째로 버려지고,
    // 예열이 다 끝난 판에서도 뗌이 종전처럼 그물을 기다린다.
    expect(ready.indexOf('entry.shellReady = true;')).toBeLessThan(ready.indexOf('isGhostHandoffTarget('));
  });
});

describe('⑤⑥ 거두기와 폴백', () => {
  it('`cancelWarmOverlay` 는 **예열 중인 창만** 닫는다 — 태어난 창을 닫으면 IDE 가 사라진다', () => {
    const cancel = fn(WM, 'export function cancelWarmOverlay(');
    expect(cancel).toContain('if (!entry || !entry.warming) return false;');
    expect(cancel).toContain('closeOverlayEntry(entry);');
  });

  it('`hasOverlayForAgent` 는 닫히는 중인 창을 없는 것으로 본다((H-10) 과 같은 판정)', () => {
    expect(fn(WM, 'export function hasOverlayForAgent(')).toContain('isOverlaySlotUsable(');
  });

  it('이미 창이 있으면 예열하지 않는다 — 재사용 갈래가 놓기도 전에 그 창을 앞으로 세운다', () => {
    const warm = between(IPC, "'vibisual:overlay:warm',", "ipcMain.handle('vibisual:overlay:warm-cancel'");
    expect(warm).toContain('if (hasOverlayForAgent(payload.agentId)) return false;');
    expect(warm).toContain('warm: true,');
    // 실패해도 종전 동작으로 떨어진다(⑥) — 빨라지지 않을 뿐 못 나가지는 않는다.
    expect(warm).toContain('} catch {');
  });

  it('예열 창은 **선의 주인이 아니다** — `follow` 를 싣지 않는다', () => {
    // 주인이 되면 (H-10) 의 "태어날 때 주인을 정한다"가 발동해, 아직 커서를 따라가야 할 윤곽선이
    // 이 보이지 않는 창에 넘어간다. 그러면 실제로 나가는 순간 걷을 선이 이미 없다.
    const warm = between(IPC, "'vibisual:overlay:warm',", "ipcMain.handle('vibisual:overlay:warm-cancel'");
    expect(warm).not.toContain('follow');
    // 창을 만드는 자리의 그 판정도 `follow` 를 전제로 남아 있어야 한다.
    expect(WM).toContain('if (opts.follow && isPopOutGhostVisible()) armGhostHandoff(win.id);');
  });

  it('두 창구 다 빈 인자·빈 문자열을 거른다 — 바깥에서 부르는 사람이 창을 짓게 하지 않는다', () => {
    const warm = between(IPC, "'vibisual:overlay:warm',", "ipcMain.handle('vibisual:overlay:warm-cancel'");
    expect(warm).toContain("typeof payload.agentId !== 'string' || payload.agentId.length === 0");
    expect(warm).toContain("typeof payload.projectId !== 'string' || payload.projectId.length === 0");
    expect(warm).toContain('Number.isFinite(payload.size.width)');
    const cancel = between(IPC, "ipcMain.handle('vibisual:overlay:warm-cancel'", '});');
    expect(cancel).toContain("typeof agentId === 'string' && agentId.length > 0");
  });

  it('두 창구가 해제 목록에도 있다 — 남으면 다음 등록이 중복으로 터진다', () => {
    expect(IPC).toContain("ipcMain.removeHandler('vibisual:overlay:warm');");
    expect(IPC).toContain("ipcMain.removeHandler('vibisual:overlay:warm-cancel');");
  });
});
