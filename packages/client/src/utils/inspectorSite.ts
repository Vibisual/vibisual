import {
  WORKSPACE_SITE_INSPECT_REQUEST,
  WORKSPACE_SITE_INSPECT_RESULT,
  parseWorkspaceSitePath,
  type WorkspaceSiteInspectHit,
} from '@vibisual/shared';

/**
 * inspectorSite.ts — §5.5 #17-27 ⑮ (i) **미리보기 페이지 안의 요소를 Alt 로 집는다.**
 *
 * 인스펙터(`useInspector`)는 iframe 안까지 들어가지만, 그 길은 `contentDocument` 를 읽을 수
 * 있을 때만 열린다. 편집창의 페이지 미리보기는 패키지 앱에서 `vibproxy://` 라 우리 창과
 * **오리진이 다르고**, 그래서 인스펙터는 그 자리에서 조용히 포기했다 — 사용자가 얻는 것은
 * iframe 을 그린 React 컴포넌트(`IDEHtmlPreview`)뿐이라, 정작 가리킨 요소는 어디에도 없었다.
 *
 * 벽을 넘는 방법은 창구를 하나 더 파는 것이 아니라 **이미 있는 대화**를 쓰는 것이다: 서버가
 * 내보내는 HTML 에 이미 위치 신고 조각이 실려 있으므로(⑮ (b)), 거기에 "좌표를 물으면 요소를
 * 답한다"를 얹고 이쪽에서 묻는다. 답에는 **원본의 줄:칸**이 들어 있다 — 그 파일은 우리가
 * 내보내면서 시작 태그마다 자리를 적어 두기 때문이다(`annotateWorkspaceSiteSource`).
 */

/** 답을 기다리는 상한(ms). 넘으면 없는 셈 친다 — 페이지가 죽어 있어도 인스펙터는 살아 있어야 한다. */
const PROBE_TIMEOUT_MS = 300;

export interface SiteProbeResult {
  hit: WorkspaceSiteInspectHit;
  /** 그 페이지의 주소 — 링크를 타고 옮겨 갔을 수 있으므로 **답에 실려 온 것**을 쓴다. */
  url: string;
}

let probeSeq = 0;

/**
 * iframe 안의 페이지에 "이 좌표의 요소" 를 묻는다. 좌표는 **iframe 로컬**(CSS px)이다.
 *
 * @param depth 그 요소에서 부모로 몇 번 올라갈지(휠로 조절하는 그 값).
 */
export function probeWorkspaceSite(
  iframeEl: HTMLIFrameElement,
  x: number,
  y: number,
  depth: number,
): Promise<SiteProbeResult | null> {
  const win = iframeEl.contentWindow;
  if (!win) return Promise.resolve(null);
  const id = ++probeSeq;
  return new Promise<SiteProbeResult | null>((resolve) => {
    let timer = 0;
    let settled = false;
    const finish = (value: SiteProbeResult | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (e: MessageEvent): void => {
      // 답은 **우리가 물은 그 창**에서, **우리가 준 번호**로만 받는다(늦게 온 옛 답 무시).
      if (e.source !== win) return;
      const data = e.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;
      if (data[WORKSPACE_SITE_INSPECT_RESULT] !== true || data.id !== id) return;
      const hit = (data.hit ?? null) as WorkspaceSiteInspectHit | null;
      finish(hit ? { hit, url: typeof data.url === 'string' ? data.url : '' } : null);
    };
    window.addEventListener('message', onMessage);
    timer = window.setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    try {
      win.postMessage({ [WORKSPACE_SITE_INSPECT_REQUEST]: true, id, x, y, depth }, '*');
    } catch {
      finish(null); // 창이 막 사라졌다 — 없는 셈 친다.
    }
  });
}

/**
 * 그 페이지가 어느 파일인가 — 답에 실려 온 주소에서 프로젝트 기준 상대 경로를 뽑는다.
 * 우리 창구의 주소가 아니면(페이지가 밖으로 나갔다) `null`.
 */
export function siteRelPathFromUrl(url: string): string | null {
  if (url === '') return null;
  let pathname: string;
  try {
    // 상대 주소로도 올 수 있으므로 기준을 준다(기준 자체는 판정에 쓰이지 않는다 —
    //   `htmlPreviewNav.sitePathnameOf` 와 같은 규칙).
    pathname = new URL(url, 'http://vibisual.invalid').pathname;
  } catch {
    return null;
  }
  const parsed = parseWorkspaceSitePath(pathname);
  if (!parsed || parsed.relPath === '') return null;
  return parsed.relPath;
}

/** 잘린 한 줄 요약 — 복사했을 때 화면에 잠깐 뜨는 그 글자(앱 요소의 것과 같은 모양). */
export function siteHitSummary(hit: WorkspaceSiteInspectHit): string {
  let out = `<${hit.tag}`;
  if (hit.id) out += `#${hit.id}`;
  else {
    const cls = hit.cls.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) out += `.${cls}`;
  }
  return `${out}>`;
}

/**
 * 페이지 요소 → 클립보드 글. 앱 요소의 티어 표기(`buildClipboardText`)와 **같은 어휘**를 쓴다 —
 * 받는 쪽(사람이든 에이전트든)이 두 가지 형식을 배울 이유가 없다.
 *
 * 첫 줄이 곧 답이다: `[Source] <파일>:<줄>:<칸>`. 스크립트가 만든 요소라 자기 자리가 없으면
 * **가장 가까운 조상의 자리**를 주고 몇 단계 위인지 함께 적는다 — "정확하지 않다"를 숨기지
 * 않는 편이, 없는 줄 번호를 지어내는 것보다 쓸모 있다.
 */
export function buildSiteClipboardText(hit: WorkspaceSiteInspectHit, url: string): string {
  const relPath = siteRelPathFromUrl(url);
  const lines: string[] = [];

  if (relPath !== null && hit.at !== null) {
    const suffix = hit.atHops > 0
      ? ` (ancestor +${String(hit.atHops)} — this element was created at runtime)`
      : '';
    lines.push(`[Source] ${relPath}:${hit.at}${suffix}`);
  } else if (relPath !== null) {
    lines.push(`[Page] ${relPath}`);
  } else if (url !== '') {
    lines.push(`[Page] ${url}`);
  }

  let tagLine = `[Tag] <${hit.tag}`;
  if (hit.id) tagLine += `#${hit.id}`;
  lines.push(`${tagLine}>`);

  if (hit.text) lines.push(`[Text] "${hit.text}"`);
  if (hit.attrs.length > 0) lines.push(`[Attrs] ${hit.attrs.join(' ')}`);
  if (hit.path) lines.push(`[Path] ${hit.path}`);
  if (relPath !== null) lines.push('[Hint] Read source file for full context.');

  return lines.join('\n');
}
