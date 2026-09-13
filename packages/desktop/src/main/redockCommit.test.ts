/**
 * redockCommit.test.ts — §5.5 #17-6 (H-17) **밖의 창이 앱 안으로 들어가는 자리도 뗌 하나다.**
 *
 * (H-12) 는 들어오는 길에 구간을 만들었다 — 앱 안으로 들어온 창은 먼저 윤곽선으로 바뀌고,
 * `REDOCK_DWELL_MS` 를 버텨야 실제로 합쳐졌다. 그런데 그 "버팀이 끝나는 틱"이 **손이 눌린 채로**
 * 창을 바꿨다: 사용자가 앱 위를 지나가기만 해도 창이 들어왔다 나갔다를 되풀이했다(사용자 지시 —
 * "마우스 놓기 전까지 가상의 창 그대로 유지해").
 *
 * 이제 버팀이 끝나면 선이 **밝아지기만** 하고(`stepRedockDwell` 의 `arm`), 실제로 합치는 일은
 * 손을 뗄 때 `finishOverlayFollow` 한 곳에서만 일어난다. 판정 자체는 shared 순수 함수가 쥐므로
 * (`windowDragRegion.test.ts`), 여기서는 **그 규칙을 실제로 그렇게 부르는지**를 소스로 집행한다
 * — `windowManager` 는 electron 에 붙어 있어 여기서 실행할 수 없다(`vitest.config.ts` 의 전제).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'windowManager.ts'), 'utf8');

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe('(H-17) 커서 폴링은 창을 합치지 않는다 — 선을 밝히기만 한다', () => {
  const tick = block(SRC, 'const step = stepRedockDwell({', 'overlayDrags.set(entry.id, {');

  it('버팀이 끝나는 틱에 `redockFollowedOverlay` 를 부르지 않는다', () => {
    expect(tick).not.toContain('redockFollowedOverlay(');
  });

  it('그 틱이 하는 일은 무장이다 — 그리고 같은 그림을 두 번 그리지 않는다', () => {
    expect(tick).toContain('step.arm');
    expect(tick).toContain('!drag.dwellArmed');
    expect(tick).toContain('armRedockDwell(entry, drag)');
  });

  it('들어옴·나감의 종전 두 마디는 그대로 산다 — 구간을 없앤 것이 아니다', () => {
    expect(tick).toContain('step.start');
    expect(tick).toContain('step.cancel');
  });
});

describe('(H-17) 합치는 자리는 뗌 하나뿐이다', () => {
  it('`finishOverlayFollow` 가 선이 떠 있는 판을 합친다', () => {
    const finish = block(SRC, 'function finishOverlayFollow(', 'export function endOverlayDragByWindowId(');
    expect(finish).toContain('if (drag?.dwelling) {');
    expect(finish).toContain('redockFollowedOverlay(entry, drag)');
  });

  it('앱 안에 서는 창은 드래그를 **이어받지 않는다** — 이어받을 손이 없다', () => {
    const redock = block(SRC, 'function redockFollowedOverlay(', 'export function startOverlayDragByWindowId(');
    expect(redock).toContain('dragging: false');
    // 자리·크기는 그대로 넘어가야 한다 — 그것이 "선이 있던 그 자리 그 크기"의 뜻이다.
    expect(redock).toContain('grabX: drag.offX');
    // (H-19) 그 크기는 **장부** 값이다 — 창에 되물은 값을 되쓰면 왕복마다 자란다.
    expect(redock).toContain('width: entry.size.width');
  });
});

describe('(H-17) 놓고 나서 태어난 창은 커서에 매달리지 않는다', () => {
  it('`settled` 면 폴링을 시작하지 않는다 — 매달면 놓은 뒤에도 창이 따라다닌다', () => {
    const spawn = block(SRC, '// (H-17) 놓고 나서 태어난 창은 매달지 않는다', 'broadcastOverlayList();');
    expect(spawn).toContain('!opts.follow.settled');
    expect(spawn).toContain('startOverlayFollow(entry, {');
  });

  it('자리는 여전히 `커서 - 잡은 지점` 이다 — 선과 한 픽셀도 어긋나지 않게', () => {
    const place = block(SRC, 'if (opts.follow) {\n    // (H-4) 커서에 매달릴 창', '} else if (opts.expanded && dropPoint) {');
    expect(place).toContain('cur.x - opts.follow.grabX');
    expect(place).toContain('cur.y - opts.follow.grabY');
  });

  it('이미 밖에 서 있던 창을 놓았을 때도 그 자리로 옮긴다 — 폴링 대신', () => {
    const reuse = block(SRC, 'if (opts.follow && !overlayDrags.has(existing.id)) {', 'finishGhostHandoff();');
    expect(reuse).toContain('if (opts.follow.settled) {');
    // (H-19) 옮기는 길은 `moveOverlayTo` 하나다 — `setPosition` 은 배율에서 부를 때마다 창을 키운다.
    expect(reuse).toContain('moveOverlayTo(existing,');

  });
});
