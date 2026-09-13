import { describe, it, expect } from 'vitest';

/**
 * 캔버스 컨트롤 디자인 규약의 **집행** — 앞으로 만들 React Flow 뷰도 자동으로 이 규칙 안에 들어온다.
 *
 * React Flow 기본 `<Controls>` 는 흰 사각 버튼(`.react-flow.light` 기본 스킨)이라 우리 화면
 * 어디에 놓아도 혼자 밝게 뜬다. 실제로 `IDEGoalMapView` 한 곳이 그 기본 컨트롤을 쓰고 있었고,
 * 캔버스(`CanvasControls`)와 나란히 두면 같은 앱의 같은 손잡이가 두 벌로 보였다.
 *
 * 규약 둘.
 *  ① `@xyflow/react` 의 `Controls`·`ControlButton` 을 쓰지 않는다 — `canvasControlKit` 의
 *     `CanvasZoomControls` 를 쓴다. 기본 컨트롤은 스타일을 덮어쓸 손잡이가 없어(라이브러리 CSS)
 *     "여기만 조금 어둡게"가 성립하지 않는다.
 *  ② 컨트롤 버튼의 **생김새는 `canvasControlKit.tsx` 한 곳에서만** 정의한다. 같은 모양을 두 곳에
 *     적으면 한쪽만 고쳐지고, 그 어긋남은 두 뷰를 동시에 보기 전까지 아무도 모른다.
 *
 * 소스를 읽지만 `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에는 Node 타입이 없다
 * (`textFieldMenuContract.test.ts` 와 같은 이유·같은 방식).
 */

const tsxSources = import.meta.glob('../../**/*.tsx', { query: '?raw', import: 'default', eager: true });

/** glob 키(이 파일=`src/components/BubbleMap/` 기준 상대 경로)를 src 기준 경로로 편다. */
function toSrcPath(key: string): string {
  const out: string[] = [];
  for (const part of `components/BubbleMap/${key}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function collectSources(): { path: string; text: string }[] {
  return Object.entries(tsxSources as Record<string, string>)
    .map(([key, text]) => ({ path: toSrcPath(key), text }))
    .filter(({ path }) => !/[.]test[.]tsx?$/.test(path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const KIT = 'components/BubbleMap/canvasControlKit.tsx';

/** 한 파일이 `@xyflow/react` 에서 이름으로 가져온 것들 — `type` 접두·`as` 별칭을 벗겨서 준다. */
function xyflowImports(text: string): string[] {
  const names: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*'@xyflow\/react'/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    for (const raw of (m[1] ?? '').split(',')) {
      const name = (raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] ?? '').trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** 산문(주석)에 적힌 `<Controls>` 에 걸리지 않도록 주석을 걷어낸 뒤 본다. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('캔버스 컨트롤 디자인 규약 집행', () => {
  const sources = collectSources();

  it('스캔 대상 소스를 실제로 읽는다', () => {
    // glob 이 조용히 비면 아래 검사가 항상 통과해 규약이 무력해진다.
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some(({ path }) => path === KIT)).toBe(true);
  });

  it('① React Flow 기본 컨트롤을 가져오지 않는다', () => {
    const offenders = sources
      .filter(({ text }) => xyflowImports(text).some((n) => n === 'Controls' || n === 'ControlButton'))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('① 기본 <Controls> 를 렌더하지 않는다', () => {
    const offenders = sources
      .filter(({ text }) => /<Controls[\s/>]/.test(stripComments(text)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('② 컨트롤 버튼·패널·글리프는 kit 한 곳에서만 정의한다', () => {
    for (const symbol of ['Glyph', 'CtrlButton', 'CtrlPanel']) {
      const declaredIn = sources
        .filter(({ text }) => text.includes(`function ${symbol}(`))
        .map(({ path }) => path);
      expect(declaredIn).toEqual([KIT]);
    }
  });

  it('② 단계 지도는 캔버스와 같은 손잡이를 쓴다', () => {
    const goalMap = sources.find(({ path }) => path === 'components/IDE/IDEGoalMapView.tsx');
    expect(goalMap).toBeDefined();
    expect(goalMap?.text).toContain('<CanvasZoomControls');
    expect(goalMap?.text).toContain("from '../BubbleMap/canvasControlKit.js'");
  });

  it('컨트롤 이름표는 i18n 키에서 온다(하드코딩된 영문 title 금지)', () => {
    const kit = sources.find(({ path }) => path === KIT);
    expect(kit).toBeDefined();
    for (const key of ['canvas.controls.zoomIn', 'canvas.controls.zoomOut', 'canvas.controls.fitView']) {
      expect(kit?.text).toContain(`t('${key}')`);
    }
  });
});
