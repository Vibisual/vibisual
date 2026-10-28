/**
 * §5.13 (T-2) — 컴포지션 결정성 검사 + 시각 맞춤 방식 판정(순수). 샌드박스가 막거나 심이 삼키는 것을 렌더 전에 알린다 — 놓치는 쪽이 비싸 넓게 잡는다(거짓 양성 감수).
 * 결과는 `VideoAsset.lint`(에이전트는 `GET /doc`, 패널은 `panel.videoStudio.lint.<code>`). `message` 는 에이전트용 영문.
 */

import type { CompositionLintEntry, CompositionSeekMode } from '../types.js';
import { unsupportedEngineFeatures } from './engineFeatures.js';
import { parseCompositionMeta, parsePropsDecl } from './meta.js';

export interface ScanOptions {
  /**
   * §5.13 (W) 38-9 — 렌더 엔진의 Chromium 메이저(서버가 도는 실행본). 주면 그보다 새 기능을 `engine-unsupported` 로 알린다.
   * 없으면 검사하지 않는다(엔진을 모르는 자리 — 시험·서버만).
   */
  readonly chromium?: number;
}

export interface CompositionSources {
  /** 진입 HTML 본문. */
  readonly html: string;
  /** 같은 폴더의 스크립트 본문들(.js/.mjs). */
  readonly scripts: readonly string[];
  /** 같은 폴더의 스타일 본문들(.css). */
  readonly styles: readonly string[];
}

export interface CompositionScan {
  readonly lint: readonly CompositionLintEntry[];
  readonly mode: CompositionSeekMode;
}

interface Rule {
  readonly level: CompositionLintEntry['level'];
  readonly code: string;
  readonly message: string;
  /** HTML·스크립트를 합친 본문에 대어 볼 식들. 하나라도 맞으면 한 줄. */
  readonly codePatterns?: readonly RegExp[];
  /** 스타일(HTML 안 `<style>`·style 속성 포함)에 대어 볼 식들. */
  readonly stylePatterns?: readonly RegExp[];
}

const RULES: readonly Rule[] = [
  {
    level: 'error',
    code: 'network',
    message: 'Network calls (fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon) are blocked in compositions. Put data in the item props or inline it.',
    codePatterns: [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bnew\s+WebSocket\s*\(/, /\bEventSource\s*\(/, /\bsendBeacon\s*\(/],
  },
  {
    level: 'error',
    code: 'external-url',
    message: 'External URLs (http/https or protocol-relative //) are blocked. Copy the file into the composition folder and use a relative path.',
    codePatterns: [
      /\b(?:src|href|poster)\s*=\s*["']\s*(?:https?:)?\/\//i,
      /\bimport\s*(?:[^'"()]*?\bfrom\s*)?["']\s*(?:https?:)?\/\//,
      /\bimport\s*\(\s*["']\s*(?:https?:)?\/\//,
    ],
    stylePatterns: [/url\(\s*["']?\s*(?:https?:)?\/\//i, /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i],
  },
  {
    level: 'error',
    code: 'media-element',
    message: '<audio>/<video> cannot be time-aligned. Put sound on an audio track and video as a footage item in the document.',
    codePatterns: [/<\s*(?:audio|video)\b/i],
  },
  {
    level: 'error',
    code: 'sound-api',
    message: 'AudioContext / speechSynthesis / new Audio() are silenced in compositions. Put sound on an audio track in the document.',
    codePatterns: [/\b(?:webkit)?AudioContext\b/, /\bspeechSynthesis\b/, /\bnew\s+Audio\s*\(/],
  },
  {
    level: 'error',
    code: 'worker',
    message: 'Web Workers are blocked (worker-src none) and run outside the virtual clock.',
    codePatterns: [/\bnew\s+(?:Shared)?Worker\s*\(/],
  },
  {
    level: 'error',
    code: 'storage',
    message: 'localStorage / sessionStorage / indexedDB / cookies are unavailable in the sandbox.',
    codePatterns: [/\b(?:localStorage|sessionStorage|indexedDB)\b/, /\bdocument\.cookie\b/],
  },
  // §5.13 (W) 38-9 — `module-script` 경고를 두지 않는다: 샌드박스 iframe + vibproxy 에서 `type="module"`·import map 이 로드된다
  // (실측 2026-10-13, Electron 31). 경고하면 에이전트가 ES 모듈 전용 라이브러리를 피한다.
  {
    level: 'warn',
    code: 'css-transition',
    message: 'CSS transitions follow wall-clock style changes and are not seekable. Use @keyframes or element.animate().',
    stylePatterns: [/(?:^|[;{\s"'])transition\s*:/m],
  },
  // §5.13 (Y) 40-8 ④ — 연출 **성능**(38-8 규약의 짝). 막지 않고 알린다 — 합성기가 혼자 처리하는 것은 transform·opacity 뿐이고,
  //   전체 화면 크기의 배경 위치·필터·큰 흐림 그림자를 프레임마다 바꾸면 그 화면 전체를 프레임마다 다시 칠한다.
  {
    level: 'warn',
    code: 'perf-background-position',
    message: 'Animating background-position repaints the whole layer every frame. Move a layer with transform: translate() instead (the compositor moves it without repainting).',
    codePatterns: [/\.style\.backgroundPosition\s*=/, /setProperty\s*\(\s*["']background-position["']/],
    stylePatterns: [/@keyframes[^{]*\{[^@]*?background-position\s*:/],
  },
  {
    level: 'warn',
    code: 'perf-animated-filter',
    message: 'Changing filter (blur, etc.) every frame re-renders the filtered area each frame. Keep the filter fixed and animate opacity or transform, or pre-render the blurred look once.',
    codePatterns: [/\.style\.(?:filter|backdropFilter)\s*=/, /setProperty\s*\(\s*["'](?:backdrop-)?filter["']/],
    stylePatterns: [/@keyframes[^{]*\{[^@]*?(?:^|[;{\s])(?:backdrop-)?filter\s*:/m],
  },
  {
    level: 'warn',
    code: 'perf-blur-shadow',
    message: 'A large blurred box-shadow is expensive to repaint. Draw the glow once on its own layer and fade or move that layer with opacity/transform.',
    codePatterns: [/\.style\.boxShadow\s*=/],
    stylePatterns: [/box-shadow\s*:[^;{}]*?\b(?:[4-9]\d|\d{3,})px/],
  },
  {
    level: 'warn',
    code: 'perf-put-image-data',
    message: 'putImageData over a full-screen canvas every frame is CPU-bound. Draw small tiles once and move them with transform, or draw with canvas paths.',
    codePatterns: [/\.putImageData\s*\(/],
  },
  {
    level: 'warn',
    code: 'input-wait',
    message: 'Code that starts on click/keydown/pointerdown never runs in a video — nobody clicks. Start it on load or from the time t.',
    codePatterns: [
      /addEventListener\s*\(\s*["'](?:click|dblclick|pointerdown|pointerup|mousedown|mouseup|keydown|keyup|touchstart)["']/,
      /\bon(?:click|keydown|pointerdown|mousedown|touchstart)\s*=/i,
    ],
  },
];

/** `<style>` 블록과 style 속성 값을 모은다 — HTML 안의 CSS 도 스타일 규칙으로 본다. */
function inlineStyles(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) out.push(m[1] ?? '');
  for (const m of html.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) out.push(m[1] ?? m[2] ?? '');
  return out;
}

/** 프레임 콜백(가상 시계의 rAF·타이머)에 기대는가 — 그러면 순방향 전용이다. */
const FRAME_CALLBACKS = /\b(?:requestAnimationFrame|setInterval|setTimeout|requestIdleCallback)\s*\(/;
/** 가상 시계·시드 난수로 바뀌는 호출 — 알려만 준다. */
const VIRTUAL_CLOCK = /\b(?:Date\.now|performance\.now|Math\.random)\s*\(|\bnew\s+Date\s*\(\s*\)/;
/** 시각을 받는 길이 있는가 — `__vibi.seek` · 타임라인 객체 · CSS/Web Animations. */
const SEEK_HOOKS = /__vibi\s*\.\s*(?:seek|timelines)\b|\b__timelines\b|@keyframes\b|\.animate\s*\(/;
/** §5.13 (Y) 40-8 ③ — 시각을 스스로 받는 길(`__vibi.seek` 함수 · 타임라인 객체)이 있는가 — 있으면 rAF·타이머를 써도 아무 시점으로 맞춘다. */
const SEEK_DRIVEN = /__vibi\s*\.\s*seek\s*=|__vibi\s*\.\s*timelines\b|\b__timelines\b/;

export function scanComposition(sources: CompositionSources, options: ScanOptions = {}): CompositionScan {
  const code = [sources.html, ...sources.scripts].join('\n');
  const styles = [...inlineStyles(sources.html), ...sources.styles].join('\n');
  const lint: CompositionLintEntry[] = [];

  for (const rule of RULES) {
    const hitCode = rule.codePatterns?.some((re) => re.test(code)) ?? false;
    const hitStyle = rule.stylePatterns?.some((re) => re.test(styles)) ?? false;
    if (hitCode || hitStyle) lint.push({ level: rule.level, code: rule.code, message: rule.message });
  }

  // §5.13 (W) 38-9 — 렌더 엔진이 모르는 기능(조용히 무시돼 브라우저에서 본 그림과 영상이 달라진다).
  if (options.chromium !== undefined && Number.isFinite(options.chromium)) {
    const missing = unsupportedEngineFeatures(code, styles, options.chromium);
    if (missing.length > 0) {
      lint.push({
        level: 'warn',
        code: 'engine-unsupported',
        message: `The renderer is Chromium ${options.chromium}; these are ignored there: ${missing.map((f) => f.label).join(', ')}. Use an older equivalent and check with /still or /strip.`,
      });
    }
  }

  const declared = parseCompositionMeta(sources.html);
  if (declared.duration === undefined) {
    lint.push({
      level: 'warn',
      code: 'no-duration',
      message: 'No <meta name="vibi:duration" content="seconds">. duration:"auto" cannot be resolved — declare it or give the item a numeric duration.',
    });
  }

  // §5.13 (V) 37-5 — 값 선언. 틀리면 오류(손잡이가 서지 않는다), 없으면 안내(사람이 JSON 칸으로만 고치게 된다).
  const props = parsePropsDecl(sources.html);
  if (props.found && props.errors.length > 0) {
    lint.push({ level: 'error', code: 'props-decl-invalid', message: `vibi-props: ${props.errors.slice(0, 4).join(' ')}` });
  } else if (!props.found) {
    lint.push({
      level: 'info',
      code: 'no-props-decl',
      message: 'No <script type="application/json" id="vibi-props">. Declare every value a person may want to change (text, numbers, colors, fonts, images, timing) so Vibistudio can show editing controls.',
    });
  }

  const usesFrames = FRAME_CALLBACKS.test(code);
  // §5.13 (Y) 40-8 ③ — 시각을 스스로 받는 컴포지션(`__vibi.seek` · 타임라인)은 rAF·타이머를 써도 아무 시점으로 맞춘다(런타임과 같은 판정).
  const seekDriven = SEEK_DRIVEN.test(code);
  if (usesFrames) {
    lint.push(seekDriven
      ? {
        level: 'info',
        code: 'frame-callbacks-seekable',
        message: 'Uses requestAnimationFrame/timers but answers seeks itself (window.__vibi.seek or timelines), so it stays random-access. Frame callbacks still run on the 60 Hz virtual clock; anything they draw must also follow t.',
      }
      : {
        level: 'info',
        code: 'frame-callbacks',
        message: 'Uses requestAnimationFrame/timers: they run on a 60 Hz virtual clock, so the composition is forward-only (seeking backwards replays from 0). Prefer window.__vibi.seek(t) or CSS animations for instant seeking.',
      });
  }
  if (VIRTUAL_CLOCK.test(code)) {
    lint.push({
      level: 'info',
      code: 'virtual-clock',
      message: 'Date.now/performance.now/Math.random are virtualized (deterministic per document).',
    });
  }
  if (!usesFrames && !SEEK_HOOKS.test(code + styles)) {
    lint.push({
      level: 'warn',
      code: 'no-motion',
      message: 'No seekable motion found (no @keyframes, element.animate, window.__vibi.seek or timelines). The frame may never change over time.',
    });
  }

  return { lint, mode: usesFrames && !seekDriven ? 'forward' : 'random' };
}
