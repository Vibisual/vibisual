import { describe, it, expect } from 'vitest';
import { WORKSPACE_SITE_REPORT_MESSAGE, workspaceSiteUrl } from '@vibisual/shared';

import {
  EMPTY_HTML_PREVIEW_HISTORY,
  canGoBack,
  canGoForward,
  htmlPreviewAddress,
  pushHtmlPreviewHistory,
  readHtmlPreviewReport,
  stepHtmlPreviewHistory,
  withCacheToken,
} from './htmlPreviewNav.js';

/**
 * §5.5 #17-27 ⑮ (b) — 편집창 속 브라우저의 주소·방문 기록.
 *
 * 이 계산이 틀렸을 때의 증상은 전부 조용하다 — "링크를 눌렀는데 주소가 그대로", "뒤로가 영영
 * 안 켜짐", "저장했는데 화면이 안 바뀜". 화면을 띄워 눈으로 잡기 어려운 것들이라 여기서 못 박는다.
 */

const ROOT = 'C:/work/proj';
const PAGE = workspaceSiteUrl(ROOT, 'demo/index.html');
const SUB = workspaceSiteUrl(ROOT, 'demo/sub.html');
const THIRD = workspaceSiteUrl(ROOT, 'demo/third.html');

describe('readHtmlPreviewReport — 우리 창구의 페이지가 보낸 신고만 받는다', () => {
  it('표식과 우리 경로가 모두 맞으면 그 URL', () => {
    expect(readHtmlPreviewReport({ [WORKSPACE_SITE_REPORT_MESSAGE]: true, url: PAGE })).toBe(PAGE);
  });

  it('패키지 앱의 vibproxy:// 주소도 받는다(그쪽이 실사용 경로다)', () => {
    const url = `vibproxy://proxy${PAGE}`;
    expect(readHtmlPreviewReport({ [WORKSPACE_SITE_REPORT_MESSAGE]: true, url })).toBe(url);
  });

  it('표식이 없으면 무시 — iframe 안에서는 남의 스크립트도 돈다', () => {
    expect(readHtmlPreviewReport({ url: PAGE })).toBeNull();
    expect(readHtmlPreviewReport({ type: 'something-else', url: PAGE })).toBeNull();
  });

  it('우리 창구 밖 주소는 무시 — 아무 페이지가 우리 주소 칸에 제 글자를 적지 못한다', () => {
    expect(readHtmlPreviewReport({ [WORKSPACE_SITE_REPORT_MESSAGE]: true, url: 'https://evil.example/x' })).toBeNull();
    expect(readHtmlPreviewReport({ [WORKSPACE_SITE_REPORT_MESSAGE]: true, url: '/api/graph' })).toBeNull();
  });

  it('객체가 아니거나 url 이 없으면 무시', () => {
    expect(readHtmlPreviewReport(null)).toBeNull();
    expect(readHtmlPreviewReport('ping')).toBeNull();
    expect(readHtmlPreviewReport({ [WORKSPACE_SITE_REPORT_MESSAGE]: true })).toBeNull();
    expect(readHtmlPreviewReport({ [WORKSPACE_SITE_REPORT_MESSAGE]: true, url: '' })).toBeNull();
  });
});

describe('htmlPreviewAddress — 주소 칸은 프로젝트 기준 상대 경로', () => {
  it('아직 아무것도 알려 오지 않았으면 열었던 파일', () => {
    expect(htmlPreviewAddress(null, ROOT, 'demo/index.html')).toBe('demo/index.html');
    expect(htmlPreviewAddress('', ROOT, 'demo/index.html')).toBe('demo/index.html');
  });

  it('알려 온 위치를 상대 경로로 적는다', () => {
    expect(htmlPreviewAddress(SUB, ROOT, 'demo/index.html')).toBe('demo/sub.html');
  });

  it('패키지 앱의 vibproxy:// 주소에서도 같은 경로가 나온다', () => {
    expect(htmlPreviewAddress(`vibproxy://proxy${SUB}`, ROOT, 'demo/index.html')).toBe('demo/sub.html');
  });

  it('우리가 붙인 캐시 토큰은 감추고, 페이지 자신의 질의·해시는 남긴다', () => {
    const url = `${workspaceSiteUrl(ROOT, 'demo/index.html', 17)}&tab=2#top`;
    expect(htmlPreviewAddress(url, ROOT, 'demo/index.html')).toBe('demo/index.html?tab=2#top');
  });

  it('루트가 다르면 남의 경로를 적지 않고 열었던 파일로 물러선다', () => {
    const other = workspaceSiteUrl('D:/other', 'x.html');
    expect(htmlPreviewAddress(other, ROOT, 'demo/index.html')).toBe('demo/index.html');
  });

  it('경로 모양만 다른 같은 루트는 같은 것으로 본다(끝 슬래시·역슬래시)', () => {
    expect(htmlPreviewAddress(workspaceSiteUrl('C:\\work\\proj', 'a.html'), ROOT, 'demo/index.html')).toBe('a.html');
    expect(htmlPreviewAddress(workspaceSiteUrl('C:/work/proj/', 'a.html'), ROOT, 'demo/index.html')).toBe('a.html');
  });

  it('우리 창구가 아닌 주소는 열었던 파일로 물러선다', () => {
    expect(htmlPreviewAddress('https://example.com/', ROOT, 'demo/index.html')).toBe('demo/index.html');
  });
});

describe('방문 기록 — iframe 의 기록은 오리진이 달라 못 만지므로 우리가 센다', () => {
  it('첫 신고 하나로는 뒤/앞 둘 다 못 간다', () => {
    const h = pushHtmlPreviewHistory(EMPTY_HTML_PREVIEW_HISTORY, PAGE);
    expect(h.entries).toEqual([PAGE]);
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
  });

  it('같은 곳을 다시 신고해도 기록이 늘지 않는다(새로고침은 방문이 아니다)', () => {
    const once = pushHtmlPreviewHistory(EMPTY_HTML_PREVIEW_HISTORY, PAGE);
    const twice = pushHtmlPreviewHistory(once, PAGE);
    expect(twice).toBe(once);
  });

  it('링크를 타면 뒤로가 켜진다', () => {
    let h = pushHtmlPreviewHistory(EMPTY_HTML_PREVIEW_HISTORY, PAGE);
    h = pushHtmlPreviewHistory(h, SUB);
    expect(canGoBack(h)).toBe(true);
    expect(canGoForward(h)).toBe(false);
    expect(h.index).toBe(1);
  });

  it('뒤로 간 뒤 페이지가 그 자리를 신고해도 기록이 자라지 않는다 — 앞으로가 살아 있어야 한다', () => {
    let h = pushHtmlPreviewHistory(EMPTY_HTML_PREVIEW_HISTORY, PAGE);
    h = pushHtmlPreviewHistory(h, SUB);
    const moved = stepHtmlPreviewHistory(h, -1);
    expect(moved?.url).toBe(PAGE);
    const after = pushHtmlPreviewHistory(moved!.history, PAGE);
    expect(after.entries).toEqual([PAGE, SUB]);
    expect(after.index).toBe(0);
    expect(canGoForward(after)).toBe(true);
  });

  it('뒤로 간 상태에서 새 곳으로 가면 앞쪽 기록은 버려진다(브라우저와 같은 규칙)', () => {
    let h = pushHtmlPreviewHistory(EMPTY_HTML_PREVIEW_HISTORY, PAGE);
    h = pushHtmlPreviewHistory(h, SUB);
    h = stepHtmlPreviewHistory(h, -1)!.history;
    h = pushHtmlPreviewHistory(h, THIRD);
    expect(h.entries).toEqual([PAGE, THIRD]);
    expect(h.index).toBe(1);
    expect(canGoForward(h)).toBe(false);
  });

  it('갈 수 없는 방향이면 null — 호출부가 아무 일도 하지 않는다', () => {
    const h = pushHtmlPreviewHistory(EMPTY_HTML_PREVIEW_HISTORY, PAGE);
    expect(stepHtmlPreviewHistory(h, -1)).toBeNull();
    expect(stepHtmlPreviewHistory(h, 1)).toBeNull();
    expect(stepHtmlPreviewHistory(EMPTY_HTML_PREVIEW_HISTORY, -1)).toBeNull();
  });

  it('앞으로 갔다가 다시 뒤로 — 자리만 오간다', () => {
    let h = pushHtmlPreviewHistory(EMPTY_HTML_PREVIEW_HISTORY, PAGE);
    h = pushHtmlPreviewHistory(h, SUB);
    h = stepHtmlPreviewHistory(h, -1)!.history;
    const fwd = stepHtmlPreviewHistory(h, 1);
    expect(fwd?.url).toBe(SUB);
    expect(fwd?.history.entries).toEqual([PAGE, SUB]);
  });
});

describe('withCacheToken — 저장했는데 화면이 그대로인 실패를 막는다', () => {
  it('상대 URL 은 상대로 돌려준다(기준 호스트가 섞이면 iframe 이 밖으로 나간다)', () => {
    const out = withCacheToken(PAGE, 42);
    expect(out.startsWith('/api/workspace-site/')).toBe(true);
    expect(out).toContain('v=42');
  });

  it('vibproxy:// 주소는 스킴·호스트를 그대로 지킨다', () => {
    const out = withCacheToken(`vibproxy://proxy${PAGE}`, 42);
    expect(out.startsWith('vibproxy://proxy/api/workspace-site/')).toBe(true);
    expect(out).toContain('v=42');
  });

  it('루트 인코딩(%3A·%2F)이 살아 있어야 서버가 같은 파일을 찾는다', () => {
    const out = withCacheToken(PAGE, 7);
    expect(out).toContain('%3A');
    expect(out).toContain('%2F');
  });

  it('토큰만 갈아 끼우고 페이지 자신의 질의·해시는 지킨다', () => {
    const out = withCacheToken(`${PAGE}?tab=2#top`, 9);
    expect(out).toContain('tab=2');
    expect(out).toContain('v=9');
    expect(out.endsWith('#top')).toBe(true);
  });

  it('두 번 붙여도 토큰은 하나다(새로고침마다 질의가 자라지 않는다)', () => {
    const twice = withCacheToken(withCacheToken(PAGE, 1), 2);
    expect(twice.match(/v=/g)?.length).toBe(1);
    expect(twice).toContain('v=2');
  });
});
