/**
 * detachedGhostLanding.test.ts — §5.4 #14-1 (H) **떼어 낸 탭의 별창은 멈춘 선의 자리·크기 그대로 선다.**
 *
 * 탭을 띠 밖으로 끄는 동안 커서에 매달리는 것은 곧 설 별창 크기의 선(가상 창)이고, 그 선은 앱
 * 경계 밖까지 main 의 클릭통과 창(`ghostFrame.ts`)이 잇는다. 손을 떼면 렌더러가 선을 그 자리에
 * 멈추고 `detach({ fromGhost: true })` 를 부른다. 여기서는 main 이 **그 약속을 실제로 지키는지**를
 * 소스로 집행한다 — `windowManager` 는 electron 에 붙어 있어 여기서 실행할 수 없다(`redockCommit.test.ts`
 * 와 같은 전제). 기하 자체(선 크기·잡은 지점·자리)는 shared 순수 함수가 쥐고 server 의
 * `detachedWindowFrame.test.ts` 가 고정한다.
 *
 * 무너지는 자리는 셋이다 — ⓐ 선을 안 읽고 커서 기준으로 세우면 놓는 순간 창이 선과 다른 자리·크기로
 * 튄다 ⓑ 창이 보이기 전에 선을 걷으면 놓은 자리가 빈다 ⓒ 창이 못 서거나 이미 있던 창을 다시 쓰면
 * 멈춘 선을 걷을 주인이 없다(클릭통과라 사용자가 없앨 수 없다).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DETACHED_WINDOW } from '@vibisual/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
// Windows 체크아웃은 줄 끝을 CRLF 로 바꾼다 — 여러 줄 표식이 어긋나지 않게 LF 로 맞춰 읽는다.
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8').replace(/\r\n/g, '\n');
const WM = read('windowManager.ts');
const IPC = read('ipc.ts');
const PRELOAD = read('../preload/index.ts');
const GHOST = read('ghostFrame.ts');

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

const OPEN = block(WM, 'export function openDetached(', 'export function closeByTabKey(');

describe('(H) openDetached — 선이 있으면 그 자리·크기 그대로', () => {
  it('선의 경계는 `fromGhost` 가 참일 때만 읽는다 — 우클릭 [별창으로 분리]는 종전 커서 자리', () => {
    expect(OPEN).toContain('opts.fromGhost === true ? popOutGhostBounds() : null');
  });

  it('자리·크기는 shared 의 한 함수가 정한다(선과 창이 같은 규칙을 본다)', () => {
    expect(OPEN).toContain('detachedWindowPlacement({ ghost: ghostBounds, cursor: opts.cursor ?? null })');
    expect(OPEN).toContain('width: placement.width');
    expect(OPEN).toContain('height: placement.height');
    expect(OPEN).toMatch(/x: placement\.x, y: placement\.y/);
  });

  it('별창 크기를 이 파일에 따로 박지 않는다 — 두 벌이면 선은 1100 인데 창은 다른 크기로 선다', () => {
    expect(WM).not.toMatch(/POPUP_DEFAULT_[WH]\s*=/);
    expect(WM).toContain('const POPUP_MIN_W = DETACHED_WINDOW.minWidth;');
    expect(WM).toContain('const POPUP_MIN_H = DETACHED_WINDOW.minHeight;');
  });
});

describe('(H) 선 → 별창 인계 — 창이 보인 뒤에 걷는다', () => {
  it('새 창을 선의 주인으로 세운다(선이 있을 때만)', () => {
    expect(OPEN).toContain('if (ghostBounds) armGhostHandoff(win.id);');
  });

  it('창이 보인 **뒤**에 걷는다 — show 다음에 인계를 끝낸다', () => {
    const ready = block(OPEN, "win.on('ready-to-show'", '});');
    const show = ready.indexOf('win.show()');
    const finish = ready.indexOf('finishGhostHandoffOnceShown(win.id)');
    expect(show).toBeGreaterThan(-1);
    expect(finish).toBeGreaterThan(show);
    expect(ready).toContain('if (ghostBounds) finishGhostHandoffOnceShown(win.id)');
  });

  it('주인을 세우는 자리가 창을 보이는 자리보다 앞선다(보이기 전 닫혀도 걷을 주인이 있다)', () => {
    expect(OPEN.indexOf('armGhostHandoff(win.id)')).toBeLessThan(OPEN.indexOf("win.on('ready-to-show'"));
  });

  it('보이기 전에 닫혔으면 기다리던 선을 걷는다', () => {
    const closed = block(OPEN, "win.on('closed'", 'notifyChange();');
    expect(closed).toContain('if (isGhostHandoffTarget(win.id)) finishGhostHandoff();');
  });

  it('문서를 못 실었으면 그물(4초)까지 끌지 않고 걷는다', () => {
    const load = block(OPEN, 'win.loadFile(', "win.webContents.once('did-finish-load'");
    expect(load).toContain('.catch(');
    expect(load).toContain('if (isGhostHandoffTarget(win.id)) finishGhostHandoff();');
  });

  it('이미 있던 별창을 다시 쓰면 이어받을 새 창이 없으니 선을 걷는다', () => {
    const reuse = block(OPEN, 'if (existing && !existing.window.isDestroyed()) {', 'return { windowId: existing.id, reused: true };');
    expect(reuse).toContain('if (ghostBounds) finishGhostHandoff();');
  });
});

describe('(H) 통로 — 렌더러가 무엇을 보내든 참일 때만', () => {
  it('ipc 는 `fromGhost` 를 엄격한 참으로만 넘긴다', () => {
    const detach = block(IPC, "'vibisual:window:detach',", "ipcMain.handle('vibisual:window:close-detached'");
    expect(detach).toContain('fromGhost: payload.fromGhost === true');
  });

  it('preload 의 짐 모양에 `fromGhost` 가 있다(선택 속성 — 구버전 렌더러는 종전 자리)', () => {
    // 끝은 줄 첫머리의 `}` — 안쪽 `cursor?: { x; y }` 의 중괄호에서 끊기지 않게.
    const wire = block(PRELOAD, 'export interface DetachPayloadWire {', '\n}');
    expect(wire).toMatch(/fromGhost\?: boolean;/);
  });
});

describe('(H) 선의 이름 띠와 shared 의 잡은 지점 규칙이 같은 그림을 본다', () => {
  it('이름 띠 높이 34px — 잡은 지점의 세로를 그 띠 안으로 묶는 기준', () => {
    expect(GHOST).toMatch(/\.bar\{[^}]*height:34px/);
    expect(DETACHED_WINDOW.ghostBarHeight).toBe(34);
  });

  it('이름 들여쓰기 = 여백 10 + 점 8 + 틈 6 — 탭 이름(10)과의 차가 `labelAlignPx`', () => {
    // 무장 규칙(`body.armed .bar{…}`)이 먼저 나오므로 띠 자체의 규칙(`position:fixed` 로 시작)을 집는다.
    const bar = GHOST.match(/\.bar\{position:fixed[^}]*\}/)?.[0] ?? '';
    expect(bar).toContain('padding:0 10px');
    expect(bar).toContain('gap:6px');
    expect(GHOST).toMatch(/\.dot\{width:8px;height:8px/);
    expect(DETACHED_WINDOW.labelAlignPx).toBe(10 + 8 + 6 - 10);
  });
});
