import { describe, it, expect } from 'vitest';

/**
 * 팝업 닫기 공통 규약의 **집행** — 앞으로 만들 팝업도 자동으로 이 규칙 안에 들어오게 한다.
 *
 * 규약: 팝업 안에서 시작한 제스처는 그 팝업을 닫지 못한다([popupDismiss.ts](./popupDismiss.ts)).
 * 손으로 다시 짜면(백드롭 `onClick={onClose}` / 문서 `mousedown` 리스너) 그 순간 규약 밖으로
 * 나가므로, 새 팝업은 반드시 `useBackdropDismiss` · `useOutsidePressDismiss` 를 쓰게 한다.
 *
 * 소스를 읽지만 `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에는 Node 타입이 없어 테스트가
 * 타입체크에서 막힌다(plugins 쪽 스캔 테스트들이 패키지를 옮겨 간 것과 같은 이유). 대신 Vite 의
 * `import.meta.glob(?raw)` 로 같은 파일들을 문자열로 받는다.
 *
 * 정말 팝업이 아닌 곳(캔버스 노드 본체, 전파만 끊는 스크림, 드래그 취소 리스너)은 아래 예외 표에
 * **이유와 함께** 등록한다 — 예외가 늘면 표가 길어지므로 그 자체가 신호가 된다.
 */

const tsSources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true });
const tsxSources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true });

/** 규약 자체를 구현하는 파일 — 여기서만 실제 리스너를 단다. */
const CONTRACT_FILES = ['hooks/usePopupDismiss.ts', 'hooks/popupDismiss.ts'];

/** 백드롭 예외 — 팝업 닫기가 아닌 `inset-0` 요소. */
const BACKDROP_EXCEPTIONS: Record<string, string> = {
  'components/BubbleMap/BubbleNode.tsx': '버블 본체(캔버스 노드) — 팝업 백드롭이 아니다.',
  'components/IDE/ImageAnnotator.tsx': '주석 편집 위 스크림 — 닫지 않고 전파만 끊는다.',
};

/** 문서 press 리스너 예외 — 팝업 닫기가 아닌 용도. */
const PRESS_LISTENER_EXCEPTIONS: Record<string, string> = {
  'components/BubbleMap/BubbleMap.tsx': 'Task Edge 연결 드래그 취소 — 팝업 닫기가 아니다.',
  'hooks/useInspector.ts': 'Alt 홀드 Inspector 의 요소 집기 — 팝업 닫기가 아니다.',
};

/**
 * glob 키(이 파일=`src/hooks/` 기준 상대 경로, `../components/…` 이거나 같은 폴더면 `./…`)를
 * src 기준 경로로 편다.
 */
function toSrcPath(key: string): string {
  const out: string[] = [];
  for (const part of `hooks/${key}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** 검사 대상 소스 — 테스트 파일과 규약 구현 파일은 뺀다. */
function collectSources(): { path: string; text: string }[] {
  const all = { ...tsSources, ...tsxSources } as Record<string, string>;
  return Object.entries(all)
    .map(([key, text]) => ({ path: toSrcPath(key), text }))
    .filter(({ path }) => !/[.]test[.]tsx?$/.test(path) && !CONTRACT_FILES.includes(path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** `<div …>` 여는 태그 하나를 통째로 집는다(속성 안 `=>` 의 `>` 에 속지 않게 중괄호 깊이를 센다). */
function openingTagAt(src: string, start: number): string | null {
  let depth = 0;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

const TAG_HEAD = /^<(div|button|section|aside)[^A-Za-z]/;

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

function usesSharedBackdrop(tag: string): boolean {
  // `{...backdrop}` / `{...rulesBackdrop}` 스프레드, 또는 `schemaBackdrop.onClick(e)` 위임.
  return /\{[.][.][.]\w*[Bb]ackdrop\}/.test(tag) || /[Bb]ackdrop[.]on(Click|MouseDown)/.test(tag);
}

describe('팝업 닫기 규약 집행', () => {
  const sources = collectSources();

  it('스캔 대상 소스를 실제로 읽는다', () => {
    // glob 이 조용히 비면 아래 두 검사가 항상 통과해 규약이 무력해진다.
    expect(sources.length).toBeGreaterThan(50);
  });

  it('전면 백드롭에서 직접 닫지 않는다 — useBackdropDismiss 를 쓴다', () => {
    const violations: string[] = [];
    for (const { path, text } of sources) {
      if (BACKDROP_EXCEPTIONS[path] !== undefined) continue;
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== '<' || !TAG_HEAD.test(text.slice(i, i + 10))) continue;
        const tag = openingTagAt(text, i);
        if (tag === null) continue;
        const tagStart = i;
        i += tag.length - 1;
        if (!tag.includes('inset-0')) continue;
        if (!tag.includes('onClick=') && !tag.includes('onMouseUp=')) continue;
        if (usesSharedBackdrop(tag)) continue;
        violations.push(`${path}:${lineOf(text, tagStart)}`);
      }
    }
    expect(violations, '백드롭 닫기는 useBackdropDismiss 로 — 직접 onClick 금지').toEqual([]);
  });

  it('문서 전체 press 리스너를 직접 달지 않는다 — useOutsidePressDismiss 를 쓴다', () => {
    const violations: string[] = [];
    const patterns = ['mousedown', 'pointerdown'].flatMap((name) => [
      `document.addEventListener('${name}'`,
      `window.addEventListener('${name}'`,
    ]);
    for (const { path, text } of sources) {
      if (PRESS_LISTENER_EXCEPTIONS[path] !== undefined) continue;
      for (const pattern of patterns) {
        const at = text.indexOf(pattern);
        if (at >= 0) violations.push(`${path}:${lineOf(text, at)}`);
      }
    }
    expect(violations, '바깥 클릭 닫기는 useOutsidePressDismiss 로 — 직접 리스너 금지').toEqual([]);
  });

  it('예외 표에는 이유가 적혀 있다', () => {
    const reasons = [...Object.values(BACKDROP_EXCEPTIONS), ...Object.values(PRESS_LISTENER_EXCEPTIONS)];
    for (const reason of reasons) expect(reason.length).toBeGreaterThan(10);
  });
});
