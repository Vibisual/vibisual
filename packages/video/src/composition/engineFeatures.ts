/**
 * §5.13 (W) 38-9 — 렌더 엔진이 모르는 웹 기능 표(순수).
 *
 * 미리보기·스틸·렌더는 모두 통합 앱의 실행본(지금 Electron 31 = Chromium 126)이 그린다. 에이전트는 최신 브라우저 기준의 CSS·JS 를
 * 쓰기 쉬운데, 엔진이 모르는 선언은 **아무 말 없이 무시된다**(CSS 해석기의 규칙) — 브라우저에서 본 그림과 영상이 달라진다.
 * 탐침이 소스에서 이 표의 기능을 찾고, 엔진 판보다 새 것이면 이름과 함께 경고한다.
 *
 * `since` 는 그 기능이 처음 실린 Chromium 메이저다. **Chromium 126 에 없다는 것은 실측**(2026-10-13 — `CSS.supports`·전역 확인)이고,
 * 정확한 판 번호는 공개 출시 기록을 따른다. 엔진을 올리면 이 표가 저절로 따라간다(새 판에서는 경고가 사라진다).
 */

export interface EngineFeature {
  readonly id: string;
  /** 사람·에이전트가 읽는 이름. */
  readonly label: string;
  /** 처음 실린 Chromium 메이저. */
  readonly since: number;
  /** 스타일(CSS)에서 찾는 식. */
  readonly css?: readonly RegExp[];
  /** 스크립트(HTML 포함)에서 찾는 식. */
  readonly js?: readonly RegExp[];
}

export const ENGINE_FEATURES: readonly EngineFeature[] = [
  { id: 'css-sibling-index', label: 'CSS sibling-index()/sibling-count()', since: 138, css: [/\bsibling-(?:index|count)\s*\(/] },
  { id: 'css-if', label: 'CSS if()', since: 137, css: [/(?:^|[\s:(,])if\s*\(\s*(?:style|media|supports)\s*\(/m] },
  { id: 'css-text-box', label: 'CSS text-box / text-box-trim', since: 133, css: [/\btext-box(?:-trim|-edge)?\s*:/] },
  { id: 'css-calc-size', label: 'CSS calc-size() / interpolate-size', since: 129, css: [/\bcalc-size\s*\(/, /\binterpolate-size\s*:/] },
  { id: 'css-shape', label: 'CSS shape()', since: 135, css: [/\bshape\s*\(\s*from\b/] },
  { id: 'css-corner-shape', label: 'CSS corner-shape', since: 139, css: [/\bcorner-shape\s*:/] },
  { id: 'css-font-size-adjust', label: 'CSS font-size-adjust', since: 127, css: [/\bfont-size-adjust\s*:/] },
  { id: 'css-attr-typed', label: 'CSS typed attr()', since: 133, css: [/\battr\([^)]*\btype\s*\(/] },
  { id: 'css-function', label: 'CSS @function', since: 139, css: [/@function\b/] },
  { id: 'js-promise-try', label: 'Promise.try', since: 128, js: [/\bPromise\.try\s*\(/] },
  { id: 'js-regexp-escape', label: 'RegExp.escape', since: 136, js: [/\bRegExp\.escape\s*\(/] },
  { id: 'js-float16array', label: 'Float16Array', since: 135, js: [/\bFloat16Array\b/] },
  { id: 'js-error-iserror', label: 'Error.isError', since: 134, js: [/\bError\.isError\s*\(/] },
  { id: 'js-uint8array-base64', label: 'Uint8Array.fromBase64/fromHex', since: 140, js: [/\bUint8Array\.from(?:Base64|Hex)\s*\(/] },
  { id: 'canvas-draw-element', label: 'canvas drawElementImage (HTML-in-Canvas)', since: Number.POSITIVE_INFINITY, js: [/\bdrawElementImage\s*\(/, /\blayoutSubtree\b/] },
];

/** 소스에서 찾은 기능 중 엔진(`chromium` 메이저)보다 새 것. 순서는 표 순서. */
export function unsupportedEngineFeatures(code: string, styles: string, chromium: number): EngineFeature[] {
  return ENGINE_FEATURES.filter((f) => {
    if (!(f.since > chromium)) return false;
    const inCss = f.css?.some((re) => re.test(styles) || re.test(code)) ?? false;
    const inJs = f.js?.some((re) => re.test(code)) ?? false;
    return inCss || inJs;
  });
}
