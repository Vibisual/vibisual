/**
 * §5.5 #17-27 ⑰ — 편집창 최대화를 소스 규약으로 못 박는다.
 *
 * 걷히는 줄(탭·경로·주소)과 구석의 [원래대로] 는 눈으로만 확인되는 부류라, 줄 하나를 새로 세우면서
 * `maximized` 조건을 빠뜨리기 쉽다 — 그러면 최대화해도 그 줄만 남는다. 클라 테스트에는 DOM 이
 * 없으므로 렌더가 아니라 **소스 글자**를 본다(`stageEntry.test.ts` 와 같은 방식).
 */

import { describe, expect, it } from 'vitest';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const locales = import.meta.glob('../../i18n/locales/*.json', { eager: true, import: 'default' }) as Record<
  string,
  { ide: { editor: Record<string, string> } }
>;

function source(name: string): string {
  const found = tsx[`./${name}`];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${name}`);
  return found;
}

describe('⑰ 편집창 최대화 — 탭·경로·주소 줄을 걷고 본문만', () => {
  it('[최대화] 는 탭 줄의 [패널 닫기] 바로 왼쪽에 선다', () => {
    const src = source('IDEEditorTabs.tsx');
    const maxAt = src.indexOf("t('ide.editor.maximizePane')");
    const closeAt = src.indexOf("t('ide.editor.closePane')");
    expect(maxAt, '[최대화] 를 못 찾음').toBeGreaterThan(-1);
    expect(closeAt, '[패널 닫기] 를 못 찾음').toBeGreaterThan(-1);
    expect(maxAt).toBeLessThan(closeAt);
    // 사이에 다른 버튼이 끼면 "옆" 이 아니다.
    expect(src.slice(maxAt, closeAt).match(/<button/g) ?? []).toHaveLength(1);
  });

  it('최대화 중에는 탭 줄·추종 띠·손잡이(경로) 줄이 서지 않는다', () => {
    const src = source('IDEEditorPane.tsx');
    // 줄끝은 보지 않는다 — Windows 러너의 체크아웃은 CRLF 일 수 있다.
    expect(src).toMatch(/\{!maximized && \(\s*<IDEEditorTabs/);
    expect(src).toContain('{!maximized && !stageActive && followOn && (');
    expect(src).toContain('{!maximized && !stageActive && (');
  });

  it('HTML 페이지의 브라우저 줄(주소 칸)도 걷히되, iframe 은 자리째 남는다', () => {
    expect(source('IDEEditorPane.tsx')).toContain('barHidden={maximized}');
    const html = source('IDEHtmlPreview.tsx');
    expect(html).toContain('{!barHidden && (');
    // 줄만 조건부이고 iframe 은 조건 밖이다 — 최대화를 켜고 끌 때 페이지가 다시 실리지 않게.
    const iframeAt = html.indexOf('<iframe');
    const lastCond = html.lastIndexOf('{!barHidden && (');
    expect(iframeAt).toBeGreaterThan(lastCond);
    expect(html.slice(lastCond, iframeAt)).toMatch(/^\s*\)\}\s*$/m);
  });

  it('[원래대로] 는 판 오른쪽 위 구석의 층에 숨어 있다가 마우스를 올리면 떠오른다', () => {
    const src = source('IDEEditorPane.tsx');
    expect(src).toContain('group/restore absolute right-0 top-0');
    expect(src).toContain('group-hover/restore:opacity-100');
    expect(src).toContain('focus-visible:opacity-100');
    expect(src).toContain("t('ide.editor.restorePane')");
  });

  it('그 층은 본문을 감추는 겹 **밖**에 선다 — 실행 출력이 떠도 최대화를 풀 길이 남는다', () => {
    const src = source('IDEEditorPane.tsx');
    // #17-20 ④ 실행 출력이 판 안으로 들어오면서, 기존 본문은 초안·페이지를 잃지 않으려고 마운트한
    // 채 `hidden` 으로 덮인다. 그 겹 **안**에 [원래대로] 층을 두면 최대화 중에 출력을 연 순간
    // 손잡이가 함께 사라져, 출력을 닫기 전에는 최대화를 풀 수 없다(구석에 마우스를 올려도 없다).
    const hideAt = src.indexOf("className={runOutput ? 'hidden'");
    const restoreAt = src.indexOf('{maximized && !runOutput && (');
    expect(hideAt, '감추는 겹을 못 찾았다').toBeGreaterThan(-1);
    expect(restoreAt, '[원래대로] 층을 못 찾았다').toBeGreaterThan(-1);
    // 겹이 닫히는 자리는 태그를 세어 찾는다 — 들여쓰기·주석 문구에 기대면 줄 하나만 옮겨도 헛통과한다.
    // 세기는 **여는 `<`부터** 시작해야 한다. `hideAt` 은 그 태그의 `className=` 을 가리키므로 거기서
    // 출발하면 겹 자신의 `<div` 가 안 세어져 깊이가 0 에서 시작하고, 첫 자식 한 쌍에서 곧장 0 으로
    // 떨어져 엉뚱한 줄을 "닫는 자리"로 집는다 — 그러면 이 시험은 무엇을 옮겨도 통과한다.
    const hideTagAt = src.lastIndexOf('<div', hideAt);
    expect(hideTagAt, '감추는 겹의 여는 태그를 못 찾았다').toBeGreaterThan(-1);
    const tag = /<\/?div\b[^>]*>/g;
    tag.lastIndex = hideTagAt;
    let depth = 0;
    let closeAt = -1;
    for (let m = tag.exec(src); m; m = tag.exec(src)) {
      if (m[0].startsWith('</')) {
        depth -= 1;
        if (depth === 0) { closeAt = m.index; break; }
      } else if (!m[0].endsWith('/>')) depth += 1;
    }
    expect(closeAt, '감추는 겹의 닫는 자리를 못 찾았다').toBeGreaterThan(-1);
    // 세기가 제 짝을 집었는지 먼저 확인한다 — 속성 안의 `>` 하나에 태그 정규식이 미끄러지면 닫는
    // 자리가 앞당겨지고, 그 순간 아래 비교는 다시 아무것도 재지 않게 된다. 무대는 겹의 끝자락에 있다.
    expect(src.slice(hideTagAt, closeAt), '감추는 겹의 닫는 자리를 잘못 집었다').toContain(
      '<IDEStageView cornerReserved={maximized} />',
    );
    expect(restoreAt, '[원래대로] 층이 감추는 겹 안에 있다').toBeGreaterThan(closeAt);
  });

  it('판이 내려가면 최대화도 풀린다(영속 ❌ — 다음에 열 때 탭 줄 없이 뜨지 않게)', () => {
    const src = source('IDEEditorPane.tsx');
    expect(src).toContain('if (!paneShown) handleRestore();');
    expect(src).toContain('const paneShown = stageActive || (files.length > 0 && !!activePath);');
  });

  it('무대는 손잡이 줄 오른쪽을 구석 층 자리만큼 비운다', () => {
    expect(source('IDEEditorPane.tsx')).toContain('<IDEStageView cornerReserved={maximized} />');
    expect(source('IDEStageView.tsx')).toContain("cornerReserved ? 'pr-14' : 'pr-2'");
  });

  it('문구는 12 로케일 전부에 있다', () => {
    const entries = Object.entries(locales);
    expect(entries).toHaveLength(12);
    for (const [file, json] of entries) {
      expect(json.ide.editor.maximizePane, `${file} maximizePane`).toBeTruthy();
      expect(json.ide.editor.restorePane, `${file} restorePane`).toBeTruthy();
    }
  });
});
