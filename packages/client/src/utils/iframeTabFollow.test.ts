/**
 * §7.11 / §3.5 — 열어 둔 프리뷰 탭이 위성 주소를 따라가는가(2026-10-01 사고).
 *
 * A 에서 열어 둔 `localhost:8080` 탭이 옆 프로젝트 B 의 vite(`[::1]:8080`)를 보여 주고 있었다. 서버는 그 위성을
 * 우리 서버에 닿는 `127.0.0.1:8080` 으로 옮기지만, 탭이 연 순간의 주소를 붙들고 있으면 화면은 그대로 남의 것이다.
 */
import { describe, it, expect } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import {
  IFRAME_TAB_FIRST_CHECK_TIMEOUT_MS,
  IFRAME_TAB_RECHECK_MS,
  followIframeTabUrls,
  iframeTabCheckPath,
  iframeTabGuardStep,
  parseIframeTabVerdict,
  satelliteIdOfIframeTab,
  shouldIframeViewFollow,
} from './iframeTabFollow.js';

function sat(id: string, url: string, extra: Partial<BubbleData> = {}): BubbleData {
  return {
    id,
    label: 'localhost:8080',
    bubbleType: 'iframe',
    path: `__special__iframe__s1__8080`,
    status: 'active',
    activity: 1,
    lastActivity: 0,
    url,
    ...extra,
  };
}

const TAB = { id: 'sat-special-4108802361', url: 'http://localhost:8080', label: 'localhost:8080', serverKind: 'frontend' as const };

describe('satelliteIdOfIframeTab', () => {
  it('캔버스 위성 노드 id 의 `sat-` 접두를 벗긴다', () => {
    expect(satelliteIdOfIframeTab('sat-special-4108802361')).toBe('special-4108802361');
    expect(satelliteIdOfIframeTab('special-1')).toBe('special-1');
  });
});

describe('followIframeTabUrls — 스토어의 탭 주소가 위성 주소를 따라간다', () => {
  it('실측: 서버가 위성을 127.0.0.1 로 옮기면 열린 탭 주소도 옮긴다(나머지 칸은 그대로)', () => {
    const tabs = [TAB];
    const next = followIframeTabUrls(tabs, { 'special-4108802361': sat('special-4108802361', 'http://127.0.0.1:8080/') });
    expect(next).not.toBe(tabs);
    expect(next).toEqual([{ ...TAB, url: 'http://127.0.0.1:8080/' }]);
  });

  it('바뀐 것이 없으면 같은 배열을 그대로 돌려준다(구독자를 깨우지 않는다)', () => {
    const tabs = [TAB];
    expect(followIframeTabUrls(tabs, { 'special-4108802361': sat('special-4108802361', TAB.url) })).toBe(tabs);
  });

  it('스냅샷에 위성이 없으면 손대지 않는다 — 배경 프로젝트가 빠진 것·지운 것을 주소 변경으로 읽지 않는다', () => {
    const tabs = [TAB];
    expect(followIframeTabUrls(tabs, {})).toBe(tabs);
  });

  it('iframe 이 아닌 노드·주소 없는 위성은 따르지 않는다', () => {
    const tabs = [TAB];
    expect(followIframeTabUrls(tabs, { 'special-4108802361': sat('special-4108802361', 'http://x/', { bubbleType: 'file' }) })).toBe(tabs);
    expect(followIframeTabUrls(tabs, { 'special-4108802361': sat('special-4108802361', '') })).toBe(tabs);
  });

  it('여러 탭 중 바뀐 탭만 새 객체가 된다', () => {
    const other = { ...TAB, id: 'sat-special-2', url: 'http://localhost:5173' };
    const tabs = [TAB, other];
    const next = followIframeTabUrls(tabs, {
      'special-4108802361': sat('special-4108802361', 'http://127.0.0.1:8080/'),
      'special-2': sat('special-2', 'http://localhost:5173'),
    });
    expect(next[0]?.url).toBe('http://127.0.0.1:8080/');
    expect(next[1]).toBe(other);
  });
});

describe('shouldIframeViewFollow — 화면이 새 탭 주소로 옮겨야 하는가', () => {
  const prev = { tabId: TAB.id, url: 'http://localhost:8080' };

  it('위성 주소를 따라 탭 주소가 바뀌었고 사용자는 그 주소를 보고 있었다 → 옮긴다', () => {
    expect(shouldIframeViewFollow(prev, { ...prev, url: 'http://127.0.0.1:8080/' }, 'http://localhost:8080')).toBe(true);
  });

  it('사용자가 주소창으로 딴 데를 보고 있으면 덮어쓰지 않는다', () => {
    expect(shouldIframeViewFollow(prev, { ...prev, url: 'http://127.0.0.1:8080/' }, 'http://localhost:8080/admin')).toBe(false);
  });

  it('같은 칸을 다른 탭이 이어 쓰면 언제나 그 탭 주소로', () => {
    expect(shouldIframeViewFollow(prev, { tabId: 'sat-special-2', url: 'http://localhost:5173' }, 'http://localhost:8080/admin')).toBe(true);
  });

  it('아무것도 안 바뀌었으면 그대로', () => {
    expect(shouldIframeViewFollow(prev, prev, 'http://localhost:8080')).toBe(false);
  });
});

describe('iframeTabCheckPath — 불러오기 전에 묻는 요청(연 프로젝트 기준)', () => {
  it('연 프로젝트·위성 id·주소를 함께 싣는다(위성 id 는 `sat-` 를 벗긴 서버 id)', () => {
    const path = iframeTabCheckPath({ tabId: 'sat-special-4108802361', projectPath: 'C:/work/app-a', url: 'http://localhost:8080/?a=1&b=2' });
    expect(path).not.toBeNull();
    const q = new URLSearchParams(String(path).split('?')[1]);
    expect(String(path).startsWith('/api/iframe-tab-check?')).toBe(true);
    expect(q.get('project')).toBe('C:/work/app-a');
    expect(q.get('satellite')).toBe('special-4108802361');
    expect(q.get('url')).toBe('http://localhost:8080/?a=1&b=2');
  });

  it('프로젝트를 모르는 옛 탭은 위성 id 로만 묻는다', () => {
    const q = new URLSearchParams(String(iframeTabCheckPath({ tabId: 'sat-special-1', url: 'http://localhost:8080' })).split('?')[1]);
    expect(q.has('project')).toBe(false);
    expect(q.get('satellite')).toBe('special-1');
  });

  it('물을 근거가 하나도 없으면 묻지 않는다(null — 그대로 보여 준다)', () => {
    expect(iframeTabCheckPath({ tabId: 'custom-tab', url: 'http://localhost:8080' })).toBeNull();
  });
});

describe('parseIframeTabVerdict — 모양이 어긋난 응답은 막지 않는다', () => {
  it('세 판정을 그대로 읽는다', () => {
    expect(parseIframeTabVerdict({ action: 'block' })).toEqual({ action: 'block' });
    expect(parseIframeTabVerdict({ action: 'follow', url: 'http://127.0.0.1:8080/' })).toEqual({ action: 'follow', url: 'http://127.0.0.1:8080/' });
    expect(parseIframeTabVerdict({ action: 'show' })).toEqual({ action: 'show' });
  });

  it('주소 없는 follow·모르는 값·빈 응답은 show', () => {
    expect(parseIframeTabVerdict({ action: 'follow' })).toEqual({ action: 'show' });
    expect(parseIframeTabVerdict({ action: 'follow', url: '' })).toEqual({ action: 'show' });
    expect(parseIframeTabVerdict({ action: 'nope' })).toEqual({ action: 'show' });
    expect(parseIframeTabVerdict(null)).toEqual({ action: 'show' });
    expect(parseIframeTabVerdict('block')).toEqual({ action: 'show' });
  });
});

describe('iframeTabGuardStep — 판정 하나를 화면에 옮기는 규칙', () => {
  it('첫 확인이 시간 초과·실패면 보여 준다(판정 불가로 막지 않는다)', () => {
    expect(iframeTabGuardStep(null, true)).toEqual({ kind: 'set', action: 'show' });
  });

  it('그 뒤의 시간 초과는 지금 상태를 유지한다 — 느린 확인 한 번이 막아 둔 화면을 남의 화면으로 되돌리면 안 된다', () => {
    expect(iframeTabGuardStep(null, false)).toEqual({ kind: 'keep' });
  });

  it('block·show 는 그대로, follow 는 탭 주소를 옮긴다', () => {
    expect(iframeTabGuardStep({ action: 'block' }, false)).toEqual({ kind: 'set', action: 'block' });
    expect(iframeTabGuardStep({ action: 'show' }, true)).toEqual({ kind: 'set', action: 'show' });
    expect(iframeTabGuardStep({ action: 'follow', url: 'http://127.0.0.1:8080/' }, true)).toEqual({ kind: 'follow', url: 'http://127.0.0.1:8080/' });
  });

  it('다시 묻는 간격은 서버 리스너 캐시 수명과 같고, 첫 확인 상한은 그보다 짧다', () => {
    expect(IFRAME_TAB_RECHECK_MS).toBe(5_000);
    expect(IFRAME_TAB_FIRST_CHECK_TIMEOUT_MS).toBeLessThan(IFRAME_TAB_RECHECK_MS);
  });
});
