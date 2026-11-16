import { describe, expect, it } from 'vitest';

/**
 * §4 겹침 층 표 — 새로 생기는 것도 자기 층을 골라 들어가게 막는 가드. 층 숫자를 파일에 직접 적으면 여기서 실패한다.
 * `node:fs` 를 쓰지 않는다(클라 tsconfig 에 Node 타입이 없다 — `inspectorOverlayLayer.test.ts` 와 같은 방식).
 */
const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** 층 표 자신과, CSS 상한을 일부러 적는 Alt 인스펙터 덮개(§5.4 #15). */
const EXEMPT = /(^|\/)(zLayers\.ts|InspectorOverlay\.tsx)$/;
/** 모달 층 이름표 — 부모 쌓임 맥락에 갇히면 소용없으므로 body 포털이 함께 있어야 한다. */
const MODAL_TOKEN = /\bz-(dialog|dialog-over|usage|usage-over|overlay|lightbox)\b/;
/** 부르는 쪽이 body 로 포털하는 모달(그 파일에는 포털이 없다) · 앱 뿌리에 바로 서는 덮개. */
const PORTALED_BY_CALLER = /(^|\/)(UsagePopup|CostMapPopup|AuditTimelinePopup|ImageAnnotator|AttentionFlash)\.tsx$/;
/** 캔버스 안(React Flow 노드·맞춤선)의 값은 그 판 안에서만 돈다. */
const IN_CANVAS = /(^|\/)BubbleMap\/(BubbleMap|CaptureSnapGuides)\.tsx$/;

const files = Object.entries(sources).filter(([file]) => !/[.]test[.]tsx?$/.test(file) && !EXEMPT.test(file));

const isComment = (line: string): boolean => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);

const HINT = '층 숫자를 직접 적지 말고 theme/zLayers.ts 의 이름을 쓰세요(z-dialog·z-menu·z-tooltip… 또는 Z_LAYER.X). 맞는 층이 없으면 표에 줄을 더합니다.';

describe('§4 겹침 층 표 — 숫자를 직접 적지 않는다', () => {
  it('시험이 실제로 소스를 읽고 있다', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('fixed 로 서는 것은 숫자 z 클래스를 쓰지 않는다', () => {
    const raw = /\bz-(\[\d[\d_]*\]|\d+)(?![\w-])/;
    const out: string[] = [];
    for (const [file, text] of files) {
      text.split(/\r?\n/).forEach((line, i) => {
        if (!isComment(line) && /\bfixed\b/.test(line) && raw.test(line)) out.push(`${file}:${i + 1}`);
      });
    }
    expect(out, HINT).toEqual([]);
  });

  it('100 이상의 z 숫자는 어디에도 직접 적지 않는다', () => {
    const big = [/\bz-\[(\d[\d_]*)\]/g, /\bzIndex:\s*(\d[\d_]*)/g, /\bz-index:\s*(\d[\d_]*)/g, /\b[A-Z][A-Z0-9_]*Z(?:_BASE)?\s*=\s*(\d[\d_]*)/g];
    const out: string[] = [];
    for (const [file, text] of files) {
      if (IN_CANVAS.test(file)) continue;
      for (const line of text.split(/\r?\n/)) {
        if (isComment(line)) continue;
        for (const re of big) {
          for (const m of line.matchAll(re)) {
            if (Number(m[1]!.replace(/_/g, '')) >= 100) out.push(`${file}: ${m[0]}`);
          }
        }
      }
    }
    expect(out, HINT).toEqual([]);
  });

  it('모달 층 이름표를 쓰는 파일은 body 로 포털한다', () => {
    const out = files
      .filter(([file, text]) => MODAL_TOKEN.test(text) && !PORTALED_BY_CALLER.test(file) && !/\bcreatePortal\b|\bLayerRoot\b/.test(text))
      .map(([file]) => file);
    expect(out, 'LayerRoot(components/Layout/LayerRoot.tsx)를 뿌리로 쓰거나 createPortal 로 body 에 붙이세요.').toEqual([]);
  });
});
