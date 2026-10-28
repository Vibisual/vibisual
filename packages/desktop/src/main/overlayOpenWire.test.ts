/**
 * §5.5 #17-6 (H-17) — `vibisual:overlay:open` 창구가 payload 를 다시 지을 때 `openOverlay` 가 읽는 필드(`follow.settled` 포함)를
 * 전부 싣는지 소스로 집행한다. `settled` 가 빠지면 손을 뗀 판이 눌린 판으로 읽혀, 놓는 순간 태어난 창이 커서에 매달려
 * 한 번 더 놓아야 선다(렌더러 쪽 계약은 `dropToCommit.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// Windows 체크아웃은 줄 끝을 CRLF 로 바꾼다(.gitattributes 없음) — 여러 줄 표식이 어긋나지 않게 LF 로 맞춰 읽는다.
const IPC = readFileSync(join(HERE, 'ipc.ts'), 'utf8').replace(/\r\n/g, '\n');
const WM = readFileSync(join(HERE, 'windowManager.ts'), 'utf8').replace(/\r\n/g, '\n');

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

/** 주석을 걷어 낸 뒤 그 타입 블록이 선언한 필드 이름들 — 설명문의 낱말이 섞이지 않게. */
function fieldNames(typeBlock: string): string[] {
  const bare = typeBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...bare.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1] as string);
}

/** 받는 쪽이 읽는 `follow` — 이것이 정본이다(창구는 여기 맞춰 실어야 한다). */
const openOverlayFollow = block(
  block(WM, 'export function openOverlay(opts: {', '}): { windowId: number; reused: boolean } {'),
  'follow?: {',
  '} | undefined;',
);

/** 렌더러에서 건너오는 그 값을 다시 짓는 자리. */
const openHandler = block(IPC, "'vibisual:overlay:open',", "ipcMain.handle('vibisual:overlay:take-handoff'");

describe('(H-17) `overlay:open` 창구는 `follow` 를 통째로 건넨다', () => {
  it('받는 쪽이 읽는 필드가 창구에 **하나도 빠짐없이** 있다', () => {
    const declared = fieldNames(openOverlayFollow);
    // 정본이 비었으면 이 검사 자체가 아무것도 지키지 못한다 — 먼저 그것부터 확인한다.
    expect(declared.length).toBeGreaterThan(3);
    for (const name of declared) {
      expect(openHandler, `창구가 \`follow.${name}\` 을 안 싣는다 — 받는 쪽의 그 갈래가 죽는다`)
        .toContain(`${name}:`);
    }
  });

  it('`settled` 는 **불리언으로 눌러** 넘긴다 — 렌더러가 무엇을 보내든 갈래가 흔들리지 않게', () => {
    expect(openHandler).toContain('settled: !!payload.follow.settled');
  });

  it('창구의 payload 타입에도 `settled` 가 있다 — 타입에서 빠지면 다음 사람이 또 떨어뜨린다', () => {
    const payloadType = block(openHandler, 'payload: {', '): { windowId: number; reused: boolean }');
    expect(payloadType).toContain('settled?: boolean');
  });
});

describe('(H-17) 받는 쪽의 두 갈래는 그 비트 하나로 갈린다', () => {
  it('놓고 나온 창은 매달지 않는다 — 매달면 뗀 뒤에도 커서를 따라다닌다', () => {
    const spawn = block(WM, 'if (opts.follow && !opts.follow.settled) {', 'broadcastOverlayList();');
    expect(spawn).toContain('startOverlayFollow(entry, {');
  });

  it('놓고 나온 창은 **앞으로 세운다** — 비활성으로 뜨면 쓰려고 한 번 더 눌러야 한다', () => {
    const show = block(WM, 'if (opts.follow.settled) { win.show(); win.focus(); }', '\n');
    expect(show).toContain('else win.showInactive()');
  });

  it('이미 서 있던 창을 다시 꺼낸 판도 같은 비트로 갈린다(한 에이전트 한 창)', () => {
    const reuse = block(WM, 'if (opts.follow && !overlayDrags.has(existing.id)) {', 'finishGhostHandoff();');
    expect(reuse).toContain('if (opts.follow.settled) {');
    expect(reuse).toContain('moveOverlayTo(existing,');
    expect(reuse).toContain('startOverlayFollow(existing, {');
  });
});
