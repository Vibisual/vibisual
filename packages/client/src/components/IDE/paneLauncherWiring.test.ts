/**
 * §5.5 #17-27 ⑱ — [우측 판] 목록 · 빈 탭 · [파일 열기] 의 **자리와 배선**을 소스 규약으로 못 박는다.
 *
 * 클라 시험에는 DOM 이 없으므로 렌더가 아니라 **소스 글자**를 본다(`stageEntry.test.ts` 와 같은 규약).
 * 눈으로만 확인되는 부류라 되돌아가기 쉽다 — 손잡이 자리를 한 칸 옮기거나 빈 탭이 디스크를 읽으러 가는
 * 것은 한 줄이다.
 */
import { describe, expect, it } from 'vitest';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(name: string): string {
  const found = tsx[`./${name}`];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${name}`);
  return found;
}

describe('(a) 손잡이 — 세션 탭 줄 `+`(새 세션) → 탭 정렬 다음 셋째 자리', () => {
  const src = source('IDETabBar.tsx');
  const launcherAt = src.indexOf('<IDEPaneLauncherMenu />');
  const fixedNewAt = src.indexOf('{/* New tab button');
  const sortAt = src.indexOf('<IDETabSortMenu');
  const historyAt = src.indexOf('<HistoryButton />');

  it('탭 줄이 목록 손잡이를 그린다', () => {
    expect(launcherAt, '목록 손잡이를 못 찾음').toBeGreaterThan(-1);
    expect(src.match(/<IDEPaneLauncherMenu\b/g) ?? []).toHaveLength(1);
  });

  it('스크롤 칸 **밖**에 `+` → 탭 정렬 → 목록 → History 순서로 선다(2026-10-08 사용자 지시)', () => {
    expect(fixedNewAt, '고정 + 를 못 찾음').toBeGreaterThan(-1);
    expect(sortAt, '정렬 손잡이를 못 찾음').toBeGreaterThan(-1);
    expect(historyAt, 'History 를 못 찾음').toBeGreaterThan(-1);
    // 스크롤 칸의 마지막 조각(오버레이 썸) 뒤에서 고정 + 가 묶음의 맨 앞이다.
    expect(fixedNewAt).toBeGreaterThan(src.indexOf('ref={thumbRef}'));
    expect(sortAt).toBeGreaterThan(fixedNewAt);
    expect(launcherAt).toBeGreaterThan(sortAt);
    expect(historyAt).toBeGreaterThan(launcherAt);
    // 이웃 사이에 다른 손잡이가 끼지 않는다 — 정렬은 + 바로 오른쪽(#17-41), 목록은 정렬 바로 오른쪽.
    expect(src.slice(fixedNewAt, sortAt)).not.toContain('<IDEPaneLauncherMenu');
    expect(src.slice(sortAt, launcherAt)).not.toContain('<HistoryButton');
  });

  it('훅 버블에도 선다 — 세션을 만드는 손잡이가 아니다(#17-29 는 보기를 막지 않는다)', () => {
    const before = src.slice(Math.max(0, launcherAt - 400), launcherAt);
    expect(before).not.toMatch(/isCustom\s*&&\s*\(?\s*$/u);
  });
});

describe('(b) 무대는 목록에 없다 — 입구는 목표 뷰의 [뷰 보기] 하나(⑪(k))', () => {
  it('목록이 무대를 열지 않는다', () => {
    const src = source('IDEPaneLauncherMenu.tsx');
    expect(src).not.toContain('setStageOpen');
    expect(src).not.toContain('setIDEStageOpen');
  });

  it('목록의 파일 갈래는 shared 표 한 벌을 돈다', () => {
    expect(source('IDEPaneLauncherMenu.tsx')).toContain('EDITOR_PANE_FILE_KINDS.map(');
  });
});

describe('(c)(d) 빈 탭은 판의 탭이다 — 디스크를 읽지 않고 고르기를 그린다', () => {
  const pane = source('IDEEditorPane.tsx');

  it('빈 탭이면 그 키로 디스크를 읽으러 가지 않는다', () => {
    expect(pane).toContain('if (activePath && !openerKind) ensureLoaded(activePath);');
    expect(pane).toContain('const doc = activePath && !openerKind ? docs[activePath] : undefined;');
  });

  it('본문 자리에 고르기를 그린다 — 무대 다음 · 읽는 중 안내보다 앞', () => {
    const stageAt = pane.indexOf('<IDEStageView cornerReserved={maximized} />');
    const openerAt = pane.indexOf('<IDEPaneOpener key={activePath} kind={openerKind} openerKey={activePath} />');
    const loadingAt = pane.indexOf(") : !doc || doc.status === 'loading' ? (");
    expect(openerAt, '고르기 본문을 못 찾음').toBeGreaterThan(-1);
    expect(openerAt).toBeGreaterThan(stageAt);
    expect(openerAt).toBeLessThan(loadingAt);
  });

  it('빈 탭에는 손잡이 줄 · 추종 띠가 서지 않는다(경로가 없다)', () => {
    expect(pane).toContain('{!maximized && !stageActive && !openerKind && (');
    expect(pane).toContain('{!maximized && !stageActive && !openerKind && followOn && (');
  });

  it('판이 서는 판정은 파일 탭과 같은 값이다 — 새 판정이 없다', () => {
    expect(pane).toContain('const paneShown = stageActive || (files.length > 0 && !!activePath);');
  });

  it('탭 줄은 빈 탭을 갈래 글리프와 이름으로 그린다', () => {
    const tabs = source('IDEEditorTabs.tsx');
    expect(tabs).toContain('<PaneKindGlyph kind={opener} />');
    expect(tabs).toContain('t(PANE_KIND_TEXT[opener].label)');
  });

  it('고르면 같은 자리에서 그 파일 탭이 된다 — 채우는 문은 하나', () => {
    const opener = source('IDEPaneOpener.tsx');
    expect(opener).toContain('fillPaneOpener(openerKey, editorFileFromRelPath(entry.relPath, rootPath))');
    // 목록은 판정 한 벌을 쓰는 창구 하나로 받는다(앱 선언은 등록표에서).
    expect(opener).toContain('workspaceFindUrl(rootPath, kind, workspaceOpenClaims())');
  });

  it('초점은 방금 연 빈 탭만 가져간다 — 세션을 오가다 다시 선 탭은 입력창을 뺏지 않는다', () => {
    const opener = source('IDEPaneOpener.tsx');
    expect(opener).toContain('takeOpenerFocus(paneKey, openerKey)');
    expect(opener).not.toContain('autoFocus');
  });
});

describe('(e) 우측에 뜬 보기는 기본으로 파일을 연다', () => {
  const pane = source('IDEEditorPane.tsx');

  it('손잡이 줄에 [파일 열기] 가 선다 — 판에 오는 갈래일 때만', () => {
    expect(pane).toContain('{activeFileKind && (');
    expect(pane).toContain('onClick={handleOpenAnother}');
  });

  it('같은 갈래의 빈 탭을 지금 탭 바로 오른쪽에 세운다 · 판정은 한 벌', () => {
    expect(pane).toContain('openPaneOpener(activeFileKind, active.relPath);');
    expect(pane).toContain('editorPaneKindOf(active.relPath, workspaceOpenClaims())');
  });

  it('빈 탭의 우클릭에는 경로 줄이 없다', () => {
    expect(pane).toContain('isFile: target.opener === undefined');
  });
});
