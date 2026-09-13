/**
 * §3.7 v2.10 — **창이 돌아오면 드래그 영역을 다시 신고한다.**
 *
 * 사용자 보고: "헤더 이 근처를 잡고 앱 이동이 가능해야 하는데, 뭔가 최소화시키거나 앱이 새로
 * 켜지거나 그럴 때 간헐적으로 잡고 이동이 안 돼."
 *
 * OS 가 아는 드래그 영역은 CSS 가 아니라 **렌더러가 신고한 사각형 목록**이고, Chromium 은 그
 * 목록이 달라졌을 때만 보낸다. 창이 숨었다 돌아오는 사이 그 신고를 한 번 놓치면 헤더는 정적이라
 * 다시 신고할 계기가 영영 오지 않는다 — CSS 는 `app-drag` 그대로인데 OS 만 모르는 상태로 굳는다.
 * (그때 사용자가 **인스펙터로 헤더 안쪽 요소를 집을 수 있었다**는 것이 그 증거다. 드래그 영역은
 * 캡션으로 판정돼 마우스 이벤트가 렌더러에 오지 않으므로, 집혔다면 그 자리는 영역이 아니었다.)
 *
 * 판정은 순수 함수에 있고, 계기·토글은 배선에 있다. 클라이언트 테스트에는 jsdom 이 없어
 * (`vitest.config.ts`) 실제 토글을 재현할 수 없으므로, 되돌아가면 증상이 그대로 되살아나는
 * **규약과 배선**을 고정한다(`titlebarDragSelection.test.ts` 와 같은 문법).
 */

import { describe, expect, it } from 'vitest';
import {
  DRAG_REGION_CAPTION_MISS_COOLDOWN_MS,
  DRAG_REGION_CSS_PROPS,
  DRAG_REGION_REFRESH_DELAYS_MS,
  DRAG_REGION_RESTORE_TIMEOUT_MS,
  DRAG_REGION_SIGHTING_POLL_MS,
  DRAG_REGION_SIGHTING_TIMEOUT_MS,
  DRAG_REGION_TOGGLE_VALUE,
  shouldDeferDragRegionRepaint,
  shouldHealCaptionMiss,
  shouldRepaintDragRegions,
  type DragRegionCaptionMissInput,
} from './dragRegionRefresh.js';

const utilSources = import.meta.glob('./*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const bootSources = import.meta.glob('../main.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(map: Record<string, string>, key: string): string {
  const found = map[key];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${key}`);
  return found;
}

const keepalive = (): string => source(utilSources, './dragRegionKeepalive.ts');
const boot = (): string => source(bootSources, '../main.tsx');

describe('재신고 판정', () => {
  it('보이고 손을 떼고 있으면 지금 한다', () => {
    expect(shouldRepaintDragRegions({ visible: true, pointerDown: false })).toBe(true);
  });

  it('숨어 있으면 하지 않는다 — 토글은 두 판의 라이프사이클을 지나야 하는데 그 판이 안 돈다', () => {
    expect(shouldRepaintDragRegions({ visible: false, pointerDown: false })).toBe(false);
  });

  it('손이 눌려 있으면 하지 않는다 — 진행 중인 손짓 위에서 영역을 흔들지 않는다', () => {
    expect(shouldRepaintDragRegions({ visible: true, pointerDown: true })).toBe(false);
  });

  it('못 한 것은 버리는 것이 아니라 미루는 것이다', () => {
    for (const visible of [true, false]) {
      for (const pointerDown of [true, false]) {
        const input = { visible, pointerDown };
        expect(shouldDeferDragRegionRepaint(input)).toBe(!shouldRepaintDragRegions(input));
      }
    }
  });
});

describe('토글 규약', () => {
  it('흔드는 값은 지금 값과 달라야 하고, 실패해도 덜 위험한 쪽이다', () => {
    // `drag` 로 흔들면 되돌리기 실패 시 그 자리가 통째로 캡션이 되어 안의 버튼이 전부 죽는다.
    expect(DRAG_REGION_TOGGLE_VALUE).toBe('no-drag');
  });

  it('두 이름을 함께 흔든다 — 한쪽만 흔들면 그 엔진에서는 값이 안 바뀌어 신고가 안 나간다', () => {
    expect(DRAG_REGION_CSS_PROPS).toContain('-webkit-app-region');
    expect(DRAG_REGION_CSS_PROPS).toContain('app-region');
  });

  it('되돌리기에는 시간 그물이 있다 — 못 되돌리면 그 창은 영영 안 움직인다', () => {
    expect(DRAG_REGION_RESTORE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DRAG_REGION_RESTORE_TIMEOUT_MS).toBeLessThanOrEqual(1000);
    expect(keepalive(), '시간 그물 배선이 없습니다').toMatch(/setTimeout\(restore, DRAG_REGION_RESTORE_TIMEOUT_MS\)/);
  });

  it('첫 기동 되짚기는 즉시부터 시작해 3초 안에 끝난다', () => {
    expect(DRAG_REGION_REFRESH_DELAYS_MS[0]).toBe(0);
    expect(Math.max(...DRAG_REGION_REFRESH_DELAYS_MS)).toBeLessThanOrEqual(3000);
    const sorted = [...DRAG_REGION_REFRESH_DELAYS_MS].sort((a, b) => a - b);
    expect(DRAG_REGION_REFRESH_DELAYS_MS).toEqual(sorted);
  });

  it('rAF 를 두 판 겹친다 — 한 판에서 넣었다 빼면 최종 목록이 같아 아무것도 안 나간다', () => {
    expect(keepalive()).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(restore\)\)/);
  });

  it('흔드는 대상은 CSS 가 정의한 드래그 영역 그 자체다', () => {
    expect(keepalive()).toMatch(/querySelectorAll<HTMLElement>\('\.app-drag'\)/);
  });
});

describe('계기 배선', () => {
  it('창이 다시 보일 때·포커스를 받을 때 다시 신고한다', () => {
    const src = keepalive();
    expect(src).toMatch(/addEventListener\('visibilitychange'/);
    expect(src).toMatch(/addEventListener\('focus'/);
  });

  it('미뤄 둔 것은 손을 뗄 때 처리한다(규약 2가 버리는 규약이 되지 않게)', () => {
    const src = keepalive();
    expect(src).toMatch(/addEventListener\('pointerup'/);
    expect(src).toMatch(/addEventListener\('pointercancel'/);
    expect(src).toMatch(/deferred/);
  });

  it('창을 끄는 중에 쏟아지는 계기는 걸지 않는다 — 그 드래그를 우리가 끊는다', () => {
    const src = keepalive();
    expect(src).not.toMatch(/addEventListener\('resize'/);
    expect(src).not.toMatch(/addEventListener\('move/);
  });

  it('main 이 알려 주는 창 상태 전이도 계기다 — 최소화 복원은 이 길이 확실하다', () => {
    expect(keepalive()).toMatch(/onDragRegionsRefresh/);
  });

  it('부팅 지점에서 한 번만 설치한다 — 타이틀바를 가진 창이 메인 하나가 아니다', () => {
    // shell 안(App/DetachedShell/CommandCenterShell…)에 두면 새 창이 늘 때 반드시 하나 빠진다.
    expect(boot()).toMatch(/installDragRegionKeepalive\(\)/);
  });
});

/**
 * 규약 4 — **흔들 대상이 없었던 것도 "못 한 것"이다.**
 *
 * 위 되짚기 시각(`DRAG_REGION_REFRESH_DELAYS_MS`)은 **부팅 지점(모듈 로드)** 기준이라, 첫 기동의
 * 렌더러가 i18n·스토어 복원·전송로 설치를 먼저 하느라 헤더를 3초보다 늦게 그리면 네 번이 전부
 * 빈 문서 위에서 돈다. 그 뒤 창은 이미 보이고 포커스도 받은 상태라 다른 계기도 오지 않는다 —
 * 사용자 보고 "지금도 방금 앱을 열었는데 여기 클릭해서 우리 창이 바로 안 움직여".
 */
describe('타이틀바가 늦게 그려질 때', () => {
  it('흔들 대상이 없었으면 미뤄 둔다 — 조용히 흘리면 되짚기가 빈 문서 위에서 끝난다', () => {
    expect(keepalive(), '못 한 것을 미루지 않습니다').toMatch(/deferred = !toggleOnce\(\)/);
    expect(keepalive(), 'toggleOnce 가 성패를 돌려주지 않습니다').toMatch(/function toggleOnce\(\): boolean/);
  });

  it('그려질 때까지 되짚되 상한이 있다 — 영원히 도는 타이머를 남기지 않는다', () => {
    expect(DRAG_REGION_SIGHTING_POLL_MS).toBeGreaterThan(0);
    expect(DRAG_REGION_SIGHTING_TIMEOUT_MS)
      .toBeGreaterThan(Math.max(...DRAG_REGION_REFRESH_DELAYS_MS));
    const src = keepalive();
    expect(src).toMatch(/setInterval\(/);
    expect(src, '되짚기를 멈추는 길이 없습니다').toMatch(/clearInterval\(sightingTimer\)/);
  });
});

/**
 * **어긋남을 추측하지 않고 관측한다.**
 *
 * 드래그 영역으로 등록된 자리는 Windows 가 캡션으로 판정해 마우스 이벤트를 렌더러에 주지 않는다.
 * 그러므로 그 자리에서 손짓이 우리에게 왔다는 것 자체가 "지금 OS 가 이 자리를 모른다"는 뜻이다 —
 * 증상이 일어나는 그 순간에만 켜지고 정상일 때는 영영 켜지지 않는 신호다.
 */
describe('어긋남 자가치유', () => {
  const base: DragRegionCaptionMissInput = {
    osBacked: true,
    overDragRegion: true,
    pointerDown: false,
    sinceLastHealMs: DRAG_REGION_CAPTION_MISS_COOLDOWN_MS,
  };

  it('드래그 영역 위에서 손짓이 도착하면 되살린다', () => {
    expect(shouldHealCaptionMiss(base)).toBe(true);
  });

  it('웹/브라우저에는 캡션이 없다 — 걸면 헤더 위를 지날 때마다 영원히 흔든다', () => {
    expect(shouldHealCaptionMiss({ ...base, osBacked: false })).toBe(false);
  });

  it('`app-nodrag` 로 되돌린 자리는 증거가 아니다 — 원래 손짓이 오는 곳이다', () => {
    expect(shouldHealCaptionMiss({ ...base, overDragRegion: false })).toBe(false);
  });

  it('눌려 있는 동안에는 흔들지 않는다(규약 2)', () => {
    expect(shouldHealCaptionMiss({ ...base, pointerDown: true })).toBe(false);
  });

  it('되살린 직후에는 쉰다 — 무제한으로 돌면 고치려는 그 손짓을 우리가 끊는다', () => {
    expect(DRAG_REGION_CAPTION_MISS_COOLDOWN_MS).toBeGreaterThan(0);
    expect(shouldHealCaptionMiss({ ...base, sinceLastHealMs: 0 })).toBe(false);
  });

  it('계기는 `pointerover` 다 — `pointermove` 는 앱 전체에서 초당 수십 번 쏟아진다', () => {
    const src = keepalive();
    expect(src).toMatch(/addEventListener\('pointerover'/);
    expect(src).not.toMatch(/addEventListener\('pointermove'/);
  });

  it('자리 판정은 CSS 가 쓰는 그 두 이름 그대로 본다 — 따로 세우면 조용히 갈라진다', () => {
    expect(keepalive()).toMatch(/closest\('\.app-drag, \.app-nodrag'\)/);
  });

  it('누른 손짓이 도착한 것도 증거다 — 그때는 뗄 때까지 미뤄 둔다', () => {
    expect(keepalive()).toMatch(/isDragRegionTarget\(e\.target\)\) deferred = true/);
  });
});
