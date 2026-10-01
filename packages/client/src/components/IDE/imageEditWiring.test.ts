/**
 * §5.5 #17-25 — 그림 편집(라이트박스)의 **화면 배선**.
 *
 *  ① Esc 는 라이트박스의 것 — IDE 창의 Esc 처리는 라이트박스가 **화면에 떠 있으면** 비켜선다(종전엔 Esc 한 번에
 *     IDE 창이 통째로 닫히며 안 보낸 표시까지 묻지도 않고 사라졌다). 판정이 store 가 아니라 화면인 까닭 = 연 창이
 *     먼저 닫혀 그릴 호스트가 없는 라이트박스가 store 에 남으면, 보이지도 않는 그것이 다른 창의 Esc 를 삼킨다.
 *     라이트박스 뿌리는 단축키 대화상자 스코프를 단다 — body 로 portal 되어 IDE 창 밖에 서므로 표식이 없으면
 *     캔버스 스코프로 읽혀, 창에 초점을 둔 채 누른 `Delete` 가 캔버스에서 골라 둔 버블을 지웠다.
 *  ② 호스트는 연 자리와 맞을 때만 그리고, 여는 곳은 전부 누른 자리를 함께 적는다.
 *  ③ 원형 자르기가 구운 배지 번호를 다음 배지가 잇는다.
 *  ④ [원형]이 자유 비율에서 스스로 맞춘 1:1 은 도구를 나가면 거둔다.
 *
 * 판정·번호 규칙은 순수 함수 시험이 본다(`imageLightboxOrigin.test.ts`·`imageAnnotate.test.ts`·`imageEdit.test.ts`).
 * 여기는 그 함수들이 화면에 **이어져 있는지**만 본다.
 *
 * ⚠ 이 스위트에는 DOM 이 없다(jsdom 미설치). 컴포넌트는 소스 스캔으로 본다 — `editorRoomWiring.test.ts` 와 같은 계열.
 */
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob<string>(
  [
    '/src/components/IDE/AgentIDEOverlay.tsx',
    '/src/components/IDE/ImageAnnotator.tsx',
    '/src/components/IDE/IDEMainArea.tsx',
    '/src/components/IDE/IDEEditorPane.tsx',
    '/src/components/IDE/StreamImageThumb.tsx',
    '/src/components/IDE/StreamRenderer.tsx',
    '/src/components/IDE/VerifyRunEvidence.tsx',
    '/src/components/IDE/imageEdit.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);

function read(name: string): string {
  const src = SOURCES[`/src/components/IDE/${name}`];
  expect(typeof src, `${name} 를 원문으로 못 읽었다 — 이 스캔의 전제가 깨졌다`).toBe('string');
  expect((src ?? '').length).toBeGreaterThan(0);
  return (src ?? '').replace(/\r\n/g, '\n');
}

function slice(text: string, startMarker: string, endMarker: string): string {
  const from = text.indexOf(startMarker);
  expect(from, '시작점을 못 찾았다: ' + startMarker).toBeGreaterThan(-1);
  const to = text.indexOf(endMarker, from);
  expect(to, '끝점을 못 찾았다: ' + endMarker).toBeGreaterThan(from);
  return text.slice(from, to + endMarker.length);
}

/** `name(` 으로 시작하는 호출마다 괄호 안 인자를 최상위 쉼표로 나눠 돌려준다(`a.name(`·`xname(` 은 건너뛴다). */
function callArgs(text: string, name: string): string[][] {
  const out: string[][] = [];
  const opener = `${name}(`;
  for (let at = text.indexOf(opener); at >= 0; at = text.indexOf(opener, at + 1)) {
    const before = text[at - 1] ?? '';
    if (/[\w$.]/.test(before)) continue;
    const args: string[] = [];
    let depth = 0;
    let cur = '';
    for (let i = at + opener.length; i < text.length; i++) {
      const ch = text[i] as string;
      if (depth === 0 && ch === ')') break;
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      if (ch === ')' || ch === '}' || ch === ']') depth--;
      if (depth === 0 && ch === ',') {
        args.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) args.push(cur.trim());
    out.push(args);
  }
  return out;
}

describe('① Esc 는 라이트박스의 것', () => {
  const handler = (): string =>
    slice(read('AgentIDEOverlay.tsx'), 'function handleKey(e: KeyboardEvent): void {', "window.addEventListener('keydown', handleKey);");

  it('IDE 창의 Esc 처리는 라이트박스가 화면에 떠 있으면 창을 닫지 않는다', () => {
    const body = handler();
    const guard = body.indexOf("if (e.key === 'Escape' && document.querySelector('.vibi-image-lightbox')) return;");
    expect(guard, '라이트박스 비켜서기가 없다').toBeGreaterThan(-1);
    expect(body.indexOf("if (e.key === 'Escape') closeOverlay();"), '비켜서기가 창 닫기보다 먼저여야 한다').toBeGreaterThan(guard);
  });

  it('판정은 store 가 아니라 화면이다 — 그릴 호스트가 없는 라이트박스가 Esc 를 삼키지 않게', () => {
    expect(handler()).not.toContain('getState().imageLightbox');
  });

  it('라이트박스 뿌리는 그 표식과 단축키 대화상자 스코프를 단다', () => {
    const root = slice(read('ImageAnnotator.tsx'), 'ref={rootRef}', '\n    >');
    expect(root).toMatch(/className="vibi-image-lightbox /);
    expect(root).toContain('data-shortcut-scope="dialog"');
  });
});

describe('② 라이트박스는 연 자리 하나에만', () => {
  it('호스트는 연 자리와 맞을 때만 그린다', () => {
    const host = slice(read('IDEMainArea.tsx'), 'function ImageLightboxHost(', 'createPortal(');
    expect(host).toContain('const spot = useImageLightboxHostSpot();');
    expect(host).toContain('if (!lightbox || !lightboxHostMatches(lightbox.origin, spot)) return null;');
  });

  it('여는 곳은 전부 누른 자리를 함께 적는다', () => {
    const OPENERS: Array<{ file: string; call: string; count: number }> = [
      { file: 'IDEEditorPane.tsx', call: 'openImageLightbox', count: 1 },
      { file: 'IDEMainArea.tsx', call: 'openImageLightbox', count: 2 },
      { file: 'StreamImageThumb.tsx', call: 'openImageLightbox', count: 1 },
      { file: 'StreamRenderer.tsx', call: 'openImageLightbox', count: 1 },
      { file: 'VerifyRunEvidence.tsx', call: 'openImage', count: 2 },
    ];
    for (const { file, call, count } of OPENERS) {
      const src = read(file);
      expect(src, `${file}: 자리는 useImageLightboxOrigin 에서 받는다`).toContain('const lightboxOrigin = useImageLightboxOrigin();');
      const calls = callArgs(src, call);
      expect(calls, `${file}: ${call}( 호출 수`).toHaveLength(count);
      for (const args of calls) expect(args[1], `${file}: ${args.join(', ')}`).toBe('lightboxOrigin()');
    }
  });
});

describe('③ 원형 자르기 뒤의 배지 번호', () => {
  it('원형 자르기는 구운 배지의 번호를 남기고, 사각 자르기는 앞서 구운 번호를 그대로 넘긴다', () => {
    const src = read('imageEdit.ts');
    const ellipse = slice(src, "if (op.shape === 'ellipse') {", '\n      }\n');
    expect(ellipse).toContain('badgeFloor: bakedBadgeFloor(frame)');
    const rect = slice(src, 'items: translateAnnotations(frame.items, -box.x, -box.y),', '\n        },');
    expect(rect).toContain('...(frame.badgeFloor ? { badgeFloor: frame.badgeFloor } : {})');
  });

  it('편집기는 번호를 스택에서 읽고, 굽기에 넘기고, 굽기 결과의 번호를 스택에 싣는다', () => {
    const src = read('ImageAnnotator.tsx');
    expect(src).toContain('const badgeFloor = history.badgeFloor ?? 0;');
    expect(src).toContain('badgeIndex: nextBadgeIndex(items, badgeFloor),');
    expect(src).not.toMatch(/nextBadgeIndex\(items\)/);
    const layerFrame = slice(src, 'transparent: frame.base ? frame.base.transparent : originalTransparent,', '};');
    expect(layerFrame).toContain('...(frame.badgeFloor ? { badgeFloor: frame.badgeFloor } : {})');
    const commit = slice(src, 'const commitOp = useCallback(', '}, [currentLayerFrame');
    expect(commit).toContain('const nextFloor = next.badgeFloor ?? 0;');
    expect(commit).toContain('commitFrame(h, { items: next.items, base, marks, ...(nextFloor ? { badgeFloor: nextFloor } : {}) })');
  });
});

describe('④ [원형]이 맞춘 1:1 은 도구와 함께 거둔다', () => {
  it('도구를 바꾸면(자르기를 마치거나 나가면) 스스로 맞춘 1:1 을 자유 비율로 되돌린다', () => {
    const select = slice(read('ImageAnnotator.tsx'), 'const selectTool = useCallback(', '}, [setTextDraftBoth]);');
    expect(select).toContain("setCropShape('rect');");
    expect(select).toMatch(/if \(autoSquareRef\.current\) \{\s*autoSquareRef\.current = false;\s*setCropAspect\('free'\);\s*\}/);
  });

  it('사용자가 고른 비율은 남긴다 — 직접 고르면 스스로 맞춘 표식부터 지운다', () => {
    const aspect = slice(read('ImageAnnotator.tsx'), 'const handleAspect = useCallback(', '}, [natural]);');
    const clear = aspect.indexOf('autoSquareRef.current = false;');
    expect(clear).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(aspect.indexOf('setCropAspect(next);'));
  });

  it('[원형]이 자유 비율에서 1:1 을 맞출 때만 표식을 단다 — handleAspect 가 지운 다음에', () => {
    const shape = slice(read('ImageAnnotator.tsx'), 'const handleShape = useCallback(', '}, [cropAspect, handleAspect]);');
    expect(shape).toMatch(/if \(next === 'ellipse' && cropAspect === 'free'\) \{\s*handleAspect\('1:1'\);\s*autoSquareRef\.current = true;\s*\}/);
  });
});
