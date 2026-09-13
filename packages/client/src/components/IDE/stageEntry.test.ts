/**
 * §5.5 #17-17 ⑪(k) — **무대로 가는 입구는 하나다**를 소스 규약으로 못 박는다.
 *
 * 이 규칙은 눈으로만 확인되는 부류라 되돌아가기 쉽다 — 활동바에 칸 하나를 다시 내는 것은 20줄이고,
 * 그렇게 되면 뜻이 겹치는 칸이 다시 둘 서고 지도는 다시 208px 사이드바에 갇힌다(그것이 (k) 를 쓰게 된
 * 원래 상태다). 화면 시험이 없는 자리라 소스 스캔이 유일한 방어다.
 *
 * 클라 테스트에는 DOM 이 없으므로 렌더가 아니라 **소스 글자**를 본다.
 */

import { describe, expect, it } from 'vitest';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const stores = import.meta.glob('../../stores/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
/** ⑳ — 좌표·선 판정의 순수 모듈. 걷어낸 세로 정렬 판정이 되살아나지 않았는지 여기서 본다. */
const pure = import.meta.glob('./goalDropTarget.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
/** ⑯ — 문구 규약은 소스가 아니라 로케일에 산다. 12 로케일을 한꺼번에 본다(한 벌만 고치면 나머지가 남는다). */
/** ㉔ — 단축키 스코프 판정은 훅에 산다(무대가 편집 판 **안**으로 들어가면서 이 자리가 규약이 됐다). */
const hooks = import.meta.glob('../../hooks/useCommand.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const locales = import.meta.glob('../../i18n/locales/*.json', { eager: true, import: 'default' }) as Record<
  string,
  { ide: { stage: Record<string, string>; follow: Record<string, string> } }
>;

function source(name: string): string {
  const found = tsx[`./${name}`] ?? stores[`../../stores/${name}`] ?? pure[`./${name}`] ?? hooks[`../../hooks/${name}`];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${name}`);
  return found;
}

describe('⑪(k) 활동바는 「단계 지도」 칸을 갖지 않는다', () => {
  it('활동바에 goalMap 항목이 없다', () => {
    expect(source('IDEActivityBar.tsx')).not.toContain('goalMap');
  });

  it('사이드바 뷰 표에도 없다 — 지도는 사이드바가 아니라 우측 무대가 그린다', () => {
    expect(source('IDESidebar.tsx')).not.toContain('goalMap:');
  });

  it("IDEViewType 에서 'goalMap' 이 빠졌다", () => {
    const src = source('graphStore.ts');
    const at = src.indexOf('export type IDEViewType');
    expect(at, 'IDEViewType 선언을 못 찾음').toBeGreaterThan(-1);
    const decl = src.slice(at, src.indexOf(';', at));
    expect(decl).not.toContain('goalMap');
  });

  it("저장돼 있던 'goalMap' 은 목표로 내려앉는다 — 길을 잃지 않게", () => {
    const src = source('graphStore.ts');
    expect(src).toContain("if (v === 'goalMap') return 'goal';");
  });
});

describe('⑪(k) 입구는 목표 뷰의 [뷰 보기] 하나', () => {
  it('목표 뷰가 무대를 여는 버튼을 갖는다', () => {
    const src = source('IDESidebar.tsx');
    expect(src).toContain("t('ide.goal.openStage')");
    expect(src).toContain('setStageOpen()');
  });

  it('무대는 창 단위 상태를 읽는다 — 컴포넌트 로컬이면 사이드바가 접힐 때마다 닫힌다', () => {
    expect(source('IDESidebar.tsx')).toContain('o.stageOpen');
  });
});

describe('㉔ 우측에 서는 판은 하나 — 무대는 그 판의 탭이다', () => {
  // ⑪(k)·⑮ 시절 무대는 편집창과 **나란히 서는 자기 폭의 패널**이었다(껍데기·폭 손잡이·머리줄·[닫기]
  // 를 따로 들었다). 둘 다 열면 대화가 두 번 좁아졌고, 같은 자리에 뜨는 것들이 서로 다른 문법으로
  // 열리고 닫혔다(사용자 지시 "이쪽에 열리는 탭들은 전부 하나의 탭 안에 들어가야지").
  // 되돌아가기 쉬운 부류라 — 판을 하나 더 세우는 것은 10줄이다 — 소스 스캔으로 못 박는다.

  it('IDE 창이 우측 판을 하나만 그린다 — 무대가 두 번째 판으로 서지 않는다', () => {
    const src = source('AgentIDEOverlay.tsx');
    expect(src).toContain('<IDEEditorPane />');
    expect(src).not.toContain('<IDEStagePane />');
    expect(src).not.toContain('<IDEStageView />');
  });

  it('무대는 껍데기를 갖지 않는다 — 자리·폭·덮개 판정은 전부 판이 쥔다', () => {
    const src = source('IDEStageView.tsx');
    expect(src).not.toContain('order-last');
    expect(src).not.toContain('absolute inset-y-0 right-0 z-20');
    expect(src).not.toContain("navDrawer ? 'left-0' : 'left-12'");
    // 끄는 변이 둘이면 판도 둘이다 — 손잡이는 판이 쥔 하나뿐이어야 한다.
    expect(src).not.toContain('cursor-col-resize');
    expect(src).not.toContain('ideStageWidth');
  });

  it('무대 몸통은 판 안을 채운다 — 그리는 조건은 "이 창이 누구인가" 하나다', () => {
    const src = source('IDEStageView.tsx');
    expect(src).toContain('if (!agentId) return null;');
    expect(src).toContain('className="flex min-h-0 flex-1 flex-col"');
  });

  it('판이 무대 탭을 세우고, 고르면 무대 몸통이 **본문 자리**에 선다', () => {
    const src = source('IDEEditorPane.tsx');
    expect(src).toContain("import { IDEStageView } from './IDEStageView.js'");
    expect(src).toContain('stageTab={stageOpen ? {');
    expect(src).toContain('<IDEStageView />');
  });

  it('무엇을 비추는가는 값 하나가 쥔다 — "무대이면서 파일" 인 조합이 없다', () => {
    const src = source('IDEEditorPane.tsx');
    expect(src).toContain('const stageActive = stageOpen && activePath === null;');
    // 무대 탭을 고르는 것 = 활성 파일을 비우는 것(새 플래그를 만들지 않았다).
    expect(src).toContain('onSelect: () => setActive(null)');
  });

  it('탭 줄이 무대 탭을 파일 탭보다 **앞**에 그린다', () => {
    const src = source('IDEEditorTabs.tsx');
    expect(src).toContain('stageTab?: StageTabProps;');
    const stageAt = src.indexOf('{stageTab && (');
    const filesAt = src.indexOf('{files.map((file) => {');
    expect(stageAt, '무대 탭 렌더를 못 찾음').toBeGreaterThan(-1);
    expect(filesAt, '파일 탭 렌더를 못 찾음').toBeGreaterThan(-1);
    expect(stageAt).toBeLessThan(filesAt);
  });

  it('판이 서는 조건에 무대 축이 들어 있다 — 파일이 하나도 없어도 무대만으로 뜬다', () => {
    expect(source('IDEEditorPane.tsx'))
      .toContain('if (!stageActive && (files.length === 0 || !activePath)) return null;');
  });

  it('[판 닫기] 는 무대까지 내린다 — 무대만 남은 판에서 헛버튼이 되지 않게', () => {
    expect(source('IDEEditorPane.tsx')).toContain('if (stageOpen) setStageOpen(false);');
  });

  it('반응형 판정이 무대 폭까지 본다 — 종전에는 무대만큼 눌려도 아무것도 안 접혔다', () => {
    const src = source('AgentIDEOverlay.tsx');
    expect(src).toContain('const paneOpen = editorOpenCount > 0 || stageOpen;');
    expect(src).toContain('editorOpen: paneOpen,');
  });

  it('저장하는 폭은 한 벌뿐이다 — 탭을 옮길 때마다 판이 넓어졌다 좁아지지 않게', () => {
    const src = source('graphStore.ts');
    expect(src).not.toContain('ideStageWidth:');
    expect(src).not.toContain('setIdeStageWidth');
  });

  it('여닫는 것이 곧 탭을 고르고 놓는 일이다 — 열면 앞으로, 닫으면 남은 파일로', () => {
    const src = source('graphStore.ts');
    const at = src.indexOf('setIDEStageOpen: (open, paneKey)');
    expect(at, 'setIDEStageOpen 을 못 찾음').toBeGreaterThan(-1);
    const body = src.slice(at, at + 1000);
    expect(body).toContain('const activeEditorPath = next');
    expect(body).toContain('cur.editorFiles[0]?.relPath ?? null');
  });

  it('세션을 옮겨도 무대에 남는다 — 파일 스태시(⑯)가 지도를 덮지 않는다', () => {
    const src = source('graphStore.ts');
    expect(src).toContain('const stageStays = cur.stageOpen && cur.activeEditorPath === null;');
    expect(src).toContain('const activeEditorPath = stageStays ? null : scoped.activeEditorPath;');
  });

  it('[뷰 보기] 는 "무대를 앞으로" 다 — 파일 탭을 보고 있으면 닫지 않고 무대로 가져온다', () => {
    // 무대가 열려 있어도 판이 파일을 비추고 있으면 화면에 없는 것과 같다. 그때 토글이 "닫아라"로
    // 읽히면 사용자는 무대를 보려고 **두 번** 눌러야 한다(한 번은 닫고, 한 번은 다시 열고).
    const src = source('graphStore.ts');
    expect(src).toContain('const showing = cur.stageOpen && cur.activeEditorPath === null;');
    expect(src).toContain('const next = open ?? !showing;');
  });

  it('사이드바 버튼이 눌린 것으로 보이는 때 = 지금 보이는 때', () => {
    const src = source('IDESidebar.tsx');
    expect(src).toContain('o.stageOpen && o.activeEditorPath === null');
    expect(src).toContain('aria-pressed={stageShowing}');
  });

  it('무대 안의 키는 편집 스코프가 아니다 — 비추는 것이 스코프를 정한다', () => {
    // 판이 하나가 되면서 무대도 `data-ide-editor-pane` 안이 됐다. 그대로 두면 `Ctrl+S` 가
    // 열린 파일도 없이 편집창 저장으로 잡힌다.
    const src = source('useCommand.ts');
    const editorAt = src.indexOf("el.closest('[data-ide-editor-pane]')");
    const stageAt = src.indexOf("el.closest('[data-ide-stage-pane]')");
    expect(editorAt, '편집 판 판정을 못 찾음').toBeGreaterThan(-1);
    expect(stageAt, '무대 표식 판정을 못 찾음').toBeGreaterThan(-1);
    // 더 좁은 것(무대)이 **안쪽**에서 먼저 답한다.
    expect(stageAt).toBeGreaterThan(editorAt);
    expect(src).toContain("if (el.closest('[data-ide-stage-pane]')) return scopeChain('ide');");
  });
});

describe('⑪(j) 추종은 사용자 제스처로만 끊긴다', () => {
  it('프로그램이 옮긴 화면(event 없음)은 추종을 끄지 않는다', () => {
    const src = source('IDEGoalMapView.tsx');
    expect(src).toContain('onMoveStart={(event) => { if (event) onUserMove(); }}');
  });

  it('카메라는 React Flow 안쪽에서 움직인다 — 새 렌더러를 만들지 않는다', () => {
    const src = source('IDEGoalMapView.tsx');
    expect(src).toContain('useReactFlow');
    expect(src).toContain('setCenter(');
  });
});

describe('⑯ 추종은 하나다 — 무대 머리에 두 번째 [추종] 이 서지 않는다', () => {
  it('무대 머리에 [추종] 버튼이 없다', () => {
    // 똑같이 생긴 [추종] 이 화면에 둘이면, 무대를 열고 닫을 때마다 그 하나가 자리를 옮겨 다니는
    // 것으로 보인다(사용자 지시). 버튼이 사라졌으므로 그 버튼만 쓰던 문자열도 남지 않는다.
    expect(source('IDEStageView.tsx')).not.toContain('ide.stage.follow');
  });

  it('무대는 툴바 [추종] 과 **같은 스위치**를 읽는다 — 따라가는 축이 하나다', () => {
    const src = source('IDEStageView.tsx');
    expect(src).toContain('followSessionKey');
    expect(src).toContain('s.ideEditorFollow[followKey] === true');
    expect(src).toContain('s.setIdeEditorFollow');
  });

  it('손으로 지도를 끌면 그 하나가 꺼진다(⑪(j) 규칙 불변)', () => {
    expect(source('IDEStageView.tsx')).toContain('setFollow(followKey, false)');
  });

  it('세션을 옮겨도 추종을 되돌리지 않는다 — 세션마다 따로 사는 값이다', () => {
    const src = source('IDEStageView.tsx');
    expect(src).toContain('useEffect(() => { setPinnedStepId(null); }, [activeSessionId]);');
  });

  it('그 하나는 대화 툴바에 남는다 — 무대가 열려도 자리가 바뀌지 않는 그 자리다', () => {
    expect(source('IDEMainArea.tsx')).toContain('function StreamFollowToggle');
  });

  it('로케일에 죽은 무대 추종 문자열이 남지 않았다', () => {
    for (const [path, json] of Object.entries(locales)) {
      const stage = (json.ide?.stage ?? {}) as Record<string, unknown>;
      for (const dead of ['follow', 'followOn', 'followOff']) {
        expect(Object.keys(stage), `${path} 에 ide.stage.${dead} 가 남아 있다`).not.toContain(dead);
      }
    }
  });

  it('툴바 문구가 두 축을 함께 말한다 — 편집만 말하면 무대가 왜 움직였는지 설명되지 않는다', () => {
    for (const [path, json] of Object.entries(locales)) {
      const stageWord = String(json.ide.stage.title).toLowerCase();
      expect(String(json.ide.follow.tipOn).toLowerCase(), path).toContain(stageWord);
      expect(String(json.ide.follow.tipOff).toLowerCase(), path).toContain(stageWord);
    }
  });
});

describe('⑪(i) 장면 그림은 우리가 그린 path 로만 그린다', () => {
  // ⑪(n) — 그림 조각이 `StageGlyph.tsx` 한 곳으로 모였다. 그리는 자리 전부를 훑는다 —
  //   한 곳만 보면 새로 생긴 자리에서 규칙이 조용히 새어 나간다.
  //   ⑪(o) 로 대화 카드가 회수돼 자리는 셋이다.
  const stageSources = ['StageGlyph.tsx', 'IDEStageView.tsx', 'IDEGoalMapView.tsx'];

  for (const name of stageSources) {
    it(`${name} 에 <img> 가 없다 — 웹 이미지를 받지 않는다(라이선스)`, () => {
      const src = source(name);
      expect(src).not.toContain('<img');
      expect(src).not.toContain('dangerouslySetInnerHTML');
    });
  }

  it('장면은 96 좌표계를 shared 상수에서 받는다(화면이 자기 숫자를 새로 정하지 않는다)', () => {
    expect(source('StageGlyph.tsx')).toContain('VISUAL_SCENE_VIEWBOX');
  });

  it('그림 조각은 한 벌뿐이다 — 무대와 지도가 같은 조각을 쓴다', () => {
    for (const name of ['IDEStageView.tsx', 'IDEGoalMapView.tsx']) {
      expect(source(name), name).toContain("from './StageGlyph.js'");
    }
  });
});

describe('⑪(o) 무대 블록은 대화에 아무것도 남기지 않는다 — 보는 곳은 무대 하나', () => {
  it('코드 블록 슬롯이 무대 언어를 가로채 조용히 삼킨다', () => {
    const src = source('StreamRenderer.tsx');
    expect(src).toContain('isStageBlockLang');
    expect(src).toContain('if (isStageBlock) return null;');
  });

  it('대화 카드 파일 자체가 없다 — 남겨 두면 다시 배선된다', () => {
    expect(Object.keys(tsx)).not.toContain('./StageBlockCard.tsx');
    expect(source('StreamRenderer.tsx')).not.toContain('StageBlockCard');
  });

  it('코드 덩어리로도 새지 않는다 — 삼키는 갈림이 <pre> 보다 앞이다', () => {
    const src = source('StreamRenderer.tsx');
    expect(src.indexOf('if (isStageBlock) return null;')).toBeLessThan(src.indexOf('<pre ref={preRef}'));
  });

  it('갈림은 훅을 전부 부른 뒤에 선다 — 조건부 훅이면 리액트가 상태를 어긋나게 붙인다', () => {
    const src = source('StreamRenderer.tsx');
    expect(src.indexOf('const onCopy = useCallback(')).toBeLessThan(
      src.indexOf('if (isStageBlock) return null;'),
    );
  });

  it('⑪(k) 그대로 — 무대를 여는 자리는 목표 뷰의 [뷰 보기] 하나다', () => {
    // 대화 카드에 있던 [열기] 버튼이 사라졌으므로 여는 호출은 사이드바 한 곳뿐이다
    //   (`setStageOpen(false)` 는 무대 자신의 닫기라 여는 축이 아니다).
    const openers = Object.entries(tsx)
      .filter(([, src]) => src.includes('setStageOpen()') || src.includes('setStageOpen(true)'))
      .map(([name]) => name);
    expect(openers).toEqual(['./IDESidebar.tsx']);
  });
});

describe('⑭(a) 무대에서 아래 세 칸이 걷혔다 — 몸통은 캔버스 하나다', () => {
  it('화면 골격 칸이 없다 — 대부분의 단계에서 빈 안내 한 줄로 36% 를 차지하던 자리다', () => {
    const src = source('IDEStageView.tsx');
    expect(src).not.toContain('h-[36%]');
    expect(src).not.toContain('StageNotice');
    expect(src).not.toContain('chromeOf');
  });

  it('종류 서랍·행동 팔레트가 없다 — 파일 자체가 남아 있으면 다시 배선된다', () => {
    expect(Object.keys(tsx)).not.toContain('./StageKindDrawer.tsx');
    expect(Object.keys(tsx)).not.toContain('./StageActionPalette.tsx');
    const src = source('IDEStageView.tsx');
    expect(src).not.toContain('StageKindDrawer');
    expect(src).not.toContain('StageActionPalette');
  });

  it('캔버스가 남은 몸통을 통째로 갖는다', () => {
    const src = source('IDEStageView.tsx');
    const at = src.indexOf('<IDEGoalMapView');
    expect(at, '지도를 못 찾음').toBeGreaterThan(-1);
    // 지도를 감싼 칸이 `flex-1` 이고, 그 아래로 자리를 먹는 형제(고정 높이 칸)가 없다.
    expect(src).toContain('relative min-h-0 flex-1');
    expect(src.slice(at)).not.toContain('flex-shrink-0 flex-col border-t');
  });

  it('⑭(b) 장면·레일은 지워지지 않고 캔버스 위로 떠 있다', () => {
    const src = source('IDEStageView.tsx');
    expect(src).toContain('<StageRail');
    expect(src).toContain('absolute inset-x-0 bottom-0');
    expect(src).toContain('absolute left-2 top-2');
  });
});

describe('⑭(c) 조작 창구는 우클릭 하나 — 걷어낸 세 칸의 일이 여기로 왔다', () => {
  it('빈 자리와 노드 위가 다른 갈래다', () => {
    const src = source('IDEGoalMapView.tsx');
    expect(src).toContain('onPaneContextMenu={onPaneContextMenu}');
    expect(src).toContain('onNodeContextMenu={onNodeContextMenu}');
    // 기본 브라우저 메뉴가 대신 뜨면 우리 메뉴는 영영 안 보인다.
    expect(src).toContain('e.preventDefault();');
  });

  it('메뉴가 여섯 원천과 행 손잡이를 전부 나른다 — 어느 하나가 빠지면 그 일은 부를 길이 사라진다', () => {
    const src = source('StageCanvasMenu.tsx');
    expect(src).toContain('GOAL_FLOW_TEMPLATES');       // 흐름(⑪(m))
    expect(src).toContain('onAddAction');               // 배운 행동(⑫(a))
    expect(src).toContain('onAddKindStep');             // 종류(⑪(i))
    expect(src).toContain('onAddStep');                 // 직접 쓰기(⑪(d))
    expect(src).toContain('`ide.stage.flow.${tpl.id}.steps.${s.key}`'); // 본문은 로케일에서
    expect(src).toContain('onAddSkill');                // 설치된 스킬(⑰(d))
    expect(src).toContain('onAddAutoGoalSkill');        // 자동 목표 스킬(⑲)
    expect(src).toContain('onToggleParallel');          // 나란히 놓기/줄에서 떼기(⑰(a))
  });

  it('걷어낸 서랍의 생애 손잡이가 그대로 있다 — 고정·휴지통·꺼내기', () => {
    const src = source('StageCanvasMenu.tsx');
    expect(src).toContain("t('ide.stage.kinds.trashed'");
    expect(src).toContain("t('ide.stage.kinds.restore')");
    expect(src).toContain('onTrashKind(card.key, false)');
    // 씨앗은 버릴 수 없다 — 눌러도 아무 일 없는 손잡이는 없는 손잡이보다 나쁘다(⑪(i)).
    expect(src).toContain('{!card.seed && (');
  });

  it('종류를 바꾸는 길은 여전히 **좁은 문**이다 — 넓은 문은 목록을 통째로 사용자 소유로 박는다(⑪(i))', () => {
    const src = source('IDEGoalMapView.tsx');
    const at = src.indexOf('const onPickKind');
    expect(at, 'onPickKind 를 못 찾음').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('const onAddAction', at));
    expect(body).toContain('setGoalStepKind(');
    expect(body).not.toContain('setUserGoalSteps');
  });

  it('메뉴는 스토어를 직접 만지지 않는다 — 부르는 문이 두 벌이 되면 그중 하나는 뒤처진다', () => {
    const src = source('StageCanvasMenu.tsx');
    expect(src).not.toContain('useGraphStore');
  });
});

describe('⑭(d) 자유 배치 — 자리는 클라 로컬, 서버에는 순서만', () => {
  it('⑳ 끌어 놓은 것은 **자리만** 남는다 — 좌표도 차례도 서버로 가지 않는다', () => {
    const src = source('IDEGoalMapView.tsx');
    const at = src.indexOf('const onNodeDragStop');
    expect(at, 'onNodeDragStop 을 못 찾음').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('const applyWire', at));
    expect(body).toContain('setGoalNodePosition(');
    // 놓는 순간 차례를 다시 판정해 보내던 종전 손짓이 되돌아오면 보기 좋게 옮긴 손짓이 실행을 바꾼다.
    expect(body).not.toContain('setUserGoalSteps(');
    expect(body).not.toContain('rowsByPosition(');
    // 좌표 자체가 전송 페이로드에 실리면 안 된다(`position` 을 그대로 보내는 꼴).
    expect(body).not.toMatch(/steps:\s*[^}]*position/u);
  });

  it('자리는 폭·밀도와 같은 축이다 — localStorage 에 살고 서버로 가지 않는다', () => {
    const src = source('graphStore.ts');
    expect(src).toContain("const GOAL_NODE_LAYOUT_KEY = 'vibisual:goalNodeLayout';");
    expect(src).toContain('saveJSON(GOAL_NODE_LAYOUT_KEY, next);');
    // 키 개수에 상한이 없으면 그것만으로 언젠가 용량 결함이 된다.
    expect(src).toContain('GOAL_LAYOUT_SESSIONS_MAX');
  });

  it('자리를 잃어도 돌아올 길이 있다 — [자동 정렬]이 파생 배치를 되돌린다', () => {
    expect(source('IDEGoalMapView.tsx')).toContain('clearGoalNodeLayout(activeSessionId)');
    expect(source('StageCanvasMenu.tsx')).toContain("t('ide.stage.menu.autoLayout')");
  });

  it('노드를 끄는 것은 사용자 제스처다 — 추종이 그때 꺼진다(⑪(j))', () => {
    expect(source('IDEGoalMapView.tsx')).toContain('onNodeDragStart={() => onUserMove()}');
  });
});

describe('⑭(e) 우클릭을 메뉴에 주려면 팬은 왼쪽·가운데다', () => {
  it('팬 버튼이 명시돼 있다 — 우클릭 끌기는 OS 마다 다른 손짓이 된다', () => {
    expect(source('IDEGoalMapView.tsx')).toContain('panOnDrag={[0, 1]}');
  });
});

describe('⑰ 흐름은 갈라진다 — 나란히 놓으면 병렬 행 · 목표 변천 · 스킬 원천', () => {
  it('(a) 캔버스는 행(순서 + 표식)으로 접어 보낸다 — 판정은 goalDropTarget 한 벌뿐이다', () => {
    const src = source('IDEGoalMapView.tsx');
    expect(src).toContain('PARALLEL_BAND');
    expect(src).toContain('placeNewAt(');   // 우클릭 끼워 넣기 — 노드 옆이면 한 행(⑰(a)②)
    expect(src).toContain('wireAfter(');    // 핀 잇기(⑳) — 차례는 이 문으로만 바뀐다
    // 행 표식은 페이로드의 `parallel` 하나다 — 그래프 구조를 새로 들이지 않는다.
    expect(src).toContain('...(s.parallel ? { parallel: true } : {})');
  });

  it('(a) [나란히 놓기]/[줄에서 떼기]는 사용자 문으로 가고 손으로 놓은 자리를 잊는다 — 파생 배치가 이웃 옆에 세운다', () => {
    const src = source('IDEGoalMapView.tsx');
    const at = src.indexOf('const onToggleParallel');
    expect(at, 'onToggleParallel 을 못 찾음').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n  const ', at + 10));
    expect(body).toContain('setUserGoalSteps(');
    expect(body).toContain('forgetGoalNodePosition(');
    expect(body).not.toContain('setGoalStepKind(');
  });

  it('(a) 첫 단계는 나란히 놓을 앞 단계가 없다 — 메뉴 줄은 stepIndex > 0 에서만 선다', () => {
    const src = source('StageCanvasMenu.tsx');
    expect(src).toContain('stepIndex > 0');
    expect(src).toContain("t(parallelOn ? 'ide.stage.menu.parallelOff' : 'ide.stage.menu.parallelOn')");
    expect(src).toContain("t('ide.stage.menu.parallelHint')");
  });

  it('(a) 표식은 무대 노드와 사이드바 목록 양쪽에 선다 — 한 곳만 보이면 다른 곳은 없는 줄 안다', () => {
    expect(source('IDEGoalMapView.tsx')).toContain("t('ide.stage.parallel.badge')");
    expect(source('IDESidebar.tsx')).toContain("t('ide.stage.parallel.badge')");
  });

  it('(c) 무대 머리가 목표 변천과 도는 서브에이전트 수를 보인다 — 새 스토어 없이 있는 값에서 센다', () => {
    const src = source('IDEStageView.tsx');
    expect(src).toContain("t('ide.stage.history.chip'");
    expect(src).toContain('goal.pastTexts');
    expect(src).toContain('countSessionTasks(');
    expect(src).toContain("t('ide.stage.subagentsRunning'");
    // 변천 목록은 그 세션의 것이라 세션을 옮기면 접힌다(⑯ 의 고정 효과 줄은 따로 그대로 둔다).
    expect(src).toContain('useEffect(() => { setHistoryOpen(false); }, [activeSessionId]);');
  });

  it('(d) 빈 자리 메뉴의 스킬 원천은 있는 훅·REST 를 다시 쓴다 — 스냅샷·스토어에 싣지 않는다', () => {
    const src = source('IDEGoalMapView.tsx');
    expect(src).toContain('useAvailableSkills(');
    expect(src).toContain('resolveSkillPluginState(');
    expect(src).toContain('/api/auto-goal/state?');
    // 조회 키는 **경로**다 — 표시명으로 물으면 같은 폴더가 다른 이름으로 떠 있을 때 빈 목록이 온다.
    expect(src).toContain('projectPath, agentId');
    expect(source('graphStore.ts')).not.toContain('autoGoalSkills');
  });

  it('(a) 자리를 잊는 문이 스토어에 있다 — 세션 배치에서 그 노드 하나만 지운다', () => {
    const src = source('graphStore.ts');
    expect(src).toContain('forgetGoalNodePosition');
    expect(src).toContain('const { [stepId]: _dropped, ...rest } = cur;');
  });

  it('로케일 12벌 전부에 행·변천·스킬 문구가 있고 개수 자리표시자가 산다', () => {
    for (const [path, json] of Object.entries(locales)) {
      const stage = json.ide.stage as unknown as {
        menu: Record<string, string>;
        history: Record<string, string>;
        parallel: Record<string, string>;
        subagentsRunning: string;
      };
      for (const key of ['parallelOn', 'parallelOff', 'parallelHint', 'groupSkills', 'skillsEmpty', 'groupAutoGoalSkills', 'autoGoalSkillsEmpty']) {
        expect(stage.menu[key], `${path} ide.stage.menu.${key}`).toBeTruthy();
      }
      expect(stage.parallel.badge, `${path} ide.stage.parallel.badge`).toBeTruthy();
      for (const key of ['chip', 'title', 'current', 'empty']) {
        expect(stage.history[key], `${path} ide.stage.history.${key}`).toBeTruthy();
      }
      expect(stage.history.chip, path).toContain('{{count}}');
      expect(stage.subagentsRunning, path).toContain('{{count}}');
    }
  });
});

/**
 * §5.5 #17-17 ⑲ — **목록이 저절로 섞이던 사슬을 끊은 자리들.**
 *
 * 사슬은 셋이 이어져 있었다: ① 순서를 바꾸는 것만으로 목록 전체가 사용자 소유로 박히고 →
 * ② 사용자 소유가 된 단계는 세션이 지우지 못해 라운드가 바뀌어도 남고 → ③ 무대에 삭제 손잡이가
 * 없어 사용자도 못 뺐다. 여기에 파생 배치가 손 놓은 자리를 덮는 겹침이 얹혀 "마음대로 섞인" 화면이
 * 됐다. 셋 다 눈으로만 드러나는 부류라 소스로 못 박는다(①·② 의 서버 쪽은 서버 테스트가 본다).
 */
describe('⑲ 무대 목록은 저절로 섞이지 않는다', () => {
  it('(b) 노드 메뉴에 [단계 지우기]가 있다 — 없으면 한 번 들어온 단계를 뺄 길이 없다', () => {
    const menu = source('StageCanvasMenu.tsx');
    expect(menu).toContain("t('ide.stage.menu.deleteStep')");
    expect(menu).toContain('onDeleteStep(step.id)');
    const view = source('IDEGoalMapView.tsx');
    expect(view).toContain('onDeleteStep={onDeleteStep}');
    // 되돌릴 수 없는 조작이라 한 번 묻는다.
    expect(view).toContain("window.confirm(t('ide.stage.menu.deleteStepConfirm'");
    // 지운 단계의 좌표도 함께 잊는다 — 남으면 죽은 좌표가 된다.
    const at = view.indexOf('const onDeleteStep');
    expect(at, 'onDeleteStep 을 못 찾음').toBeGreaterThan(-1);
    expect(view.slice(at, view.indexOf('\n  const ', at + 10))).toContain('forgetGoalNodePosition(');
  });

  it('(c) 파생 배치는 순수 모듈이 낸다 — `행 번호 × 간격` 격자는 사라졌다', () => {
    const view = source('IDEGoalMapView.tsx');
    expect(view).toContain('derivePositions(');
    // 격자 산식이 뷰로 되돌아오면 손이 놓은 자리를 다시 덮는다.
    expect(view).not.toMatch(/y:\s*row\s*\*\s*GAP_Y/u);
  });

  it('(b) 삭제 문구가 12 로케일에 전부 있다 — 한 벌만 고치면 나머지가 빈칸으로 뜬다', () => {
    for (const [path, mod] of Object.entries(locales)) {
      const menu = mod.ide.stage.menu as unknown as Record<string, string>;
      for (const key of ['deleteStep', 'deleteStepHint', 'deleteStepConfirm']) {
        expect(menu[key], `${path} ide.stage.menu.${key}`).toBeTruthy();
      }
      expect(menu.deleteStepConfirm, path).toContain('{{text}}');
    }
  });
});

/**
 * §5.5 #17-17 ⑳ — **자리는 자리고, 흐름은 선이다.**
 *
 * 끌어 놓으면 자리만 바뀌고, 차례는 핀(작은 원)을 끌어 다른 단계에 꽂아야 바뀐다. 종전의 "세로가
 * 차례를 정한다"가 뷰로 되돌아오면 보기 좋게 옮긴 손짓이 실행을 바꾼다 — 눈으로만 드러나는 부류라
 * 소스로 못 박는다.
 */
describe('⑳ 흐름은 핀을 끌어 꽂아야 바뀐다', () => {
  it('핀 연결이 켜져 있고 새 선·옮겨 꽂기 둘 다 같은 문으로 간다', () => {
    const src = source('IDEGoalMapView.tsx');
    expect(src).toContain('nodesConnectable={canEdit}');
    expect(src).not.toContain('nodesConnectable={false}');
    expect(src).toContain('onConnect={onConnect}');
    expect(src).toContain('edgesReconnectable={canEdit}');
    expect(src).toContain('onReconnect={onReconnect}');
    // 두 손짓이 한 함수로 모인다 — 갈라지면 한쪽만 고쳐져 어긋난다.
    expect(src).toContain('const onConnect = useCallback((c: Connection) => applyWire(c.source, c.target), [applyWire]);');
    // ㉖(e) — 옮겨 꽂기는 **옛 선을 끊고** 같은 문으로 다시 잇는다(문은 여전히 `applyWire` 하나다).
    expect(src).toContain('removeGoalWire(activeSessionId, old.source, old.target);');
    expect(src).toContain('applyWire(c.source, c.target, removeWire(wires, old.source, old.target));');
  });

  it('선 잇기는 순수 판정(wireAfter)을 거쳐 사용자 문으로 간다 — 보낼 것이 없으면 왕복도 없다', () => {
    const src = source('IDEGoalMapView.tsx');
    const at = src.indexOf('const applyWire');
    expect(at, 'applyWire 를 못 찾음').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('const onConnect', at));
    expect(body).toContain('wireAfter(');
    expect(body).toContain('setUserGoalSteps(');
    expect(body).toContain('if (!rows) return;');
  });

  it('자기 자신에게는 꽂히지 않는다', () => {
    expect(source('IDEGoalMapView.tsx')).toContain('isValidConnection={isValidConnection}');
  });

  it('세로 정렬로 차례를 얻던 판정은 순수 모듈에서도 사라졌다 — 남아 있으면 다시 배선된다', () => {
    const pureSrc = source('goalDropTarget.ts');
    for (const gone of ['orderByPosition', 'rowsByPosition', 'layoutWithNew', 'insertIndexAt']) {
      expect(pureSrc, gone).not.toContain(`export function ${gone}`);
    }
    expect(pureSrc).toContain('export function wireAfter');
    expect(pureSrc).toContain('export function placeNewAt');
  });

  it('핀은 두 개(들어오는 선·나가는 선)이고 잡을 수 있게 설명이 붙는다', () => {
    const src = source('IDEGoalMapView.tsx');
    // ㉖(h) — 툴팁이 끊는 법까지 안내하므로 단축키 라벨을 인자로 받는다(멀티플랫폼 5축).
    expect(src).toContain("t('ide.stage.pin.in', { shortcut: shortcutLabel('Ctrl') })");
    expect(src).toContain("t('ide.stage.pin.out', { shortcut: shortcutLabel('Ctrl') })");
    expect(src).toContain('type="target"');
    expect(src).toContain('type="source"');
  });

  it('끌고 가는 선도 화면 좌표 굵기다(⑱) — 줌이 걸려도 보인다', () => {
    const src = source('IDEGoalMapView.tsx');
    const at = src.indexOf('connectionLineStyle={{');
    expect(at, 'connectionLineStyle 을 못 찾음').toBeGreaterThan(-1);
    expect(src.slice(at, src.indexOf('}}', at))).toContain("vectorEffect: 'non-scaling-stroke'");
  });

  it('핀 문구가 12 로케일에 전부 있다 — 한 벌만 고치면 나머지가 빈칸으로 뜬다', () => {
    for (const [path, json] of Object.entries(locales)) {
      const pin = (json.ide.stage as unknown as { pin?: Record<string, string> }).pin;
      expect(pin?.in, `${path} ide.stage.pin.in`).toBeTruthy();
      expect(pin?.out, `${path} ide.stage.pin.out`).toBeTruthy();
    }
  });
});

describe('㉒ 무대는 실황을 갖는다 — 그 단계가 만드는 것이 그 자리에 선다', () => {
  it('무대가 실황 칸을 부른다', () => {
    const src = source('IDEStageView.tsx');
    expect(src).toContain("import { StageLiveSurface } from './StageLiveSurface.js'");
    expect(src).toContain('<StageLiveSurface');
    expect(src).toContain('surface={surface}');
  });

  it('실황은 캔버스 **밖**에 선다 — 지도를 덮지 않는다', () => {
    const src = source('IDEStageView.tsx');
    const canvasEnd = src.indexOf("label={t('ide.stage.rail')}");
    const live = src.indexOf('<StageLiveSurface');
    expect(canvasEnd, '레일을 못 찾음').toBeGreaterThan(-1);
    expect(live, '실황 칸을 못 찾음').toBeGreaterThan(canvasEnd);
  });

  it('비출 것이 없으면 칸이 서지 않는다 — ⑭(a) 가 걷어낸 그 증상(빈 안내 한 줄)의 재발 방지', () => {
    const src = source('StageLiveSurface.tsx');
    expect(src).toContain('if (!hasContent) return null;');
    // 판정은 훅을 전부 부른 **뒤**에 선다(조기 반환이 훅 위로 올라가면 렌더가 깨진다).
    expect(src.indexOf('const hasContent')).toBeGreaterThan(src.indexOf('useWorkspaceImage('));
  });

  it('실황은 **자기 추종 스위치를 만들지 않는다** — ㉒(e) 는 ⑯ 이 접은 그 축에 얹힌다', () => {
    const src = source('StageLiveSurface.tsx');
    expect(src).not.toContain('setIdeEditorFollow');
    expect(src).not.toContain('followSessionKey');
  });

  it('산출물은 **내부 앱 화면 그대로** 펴진다 — 새 뷰어를 짓지 않았다', () => {
    const src = source('StageLiveSurface.tsx');
    expect(src).toContain('<AppShellHost');
    expect(src).toContain('fill');
    // 앱 이름을 컴포넌트가 알지 않는다 — 골격 → 앱 id 는 shared 표가 쥔다(§5.13 규약).
    expect(src).not.toContain("'vibi3d'");
    expect(src).not.toContain("'vibistudio'");
    expect(src).not.toContain("'vibisound'");
    expect(src).toContain('surfaceAppId(');
  });

  it('그림은 편집창과 같은 창구로 받는다 — `<img src>` 직접 걸기 ❌(패키징된 앱에서 조용히 실패한다)', () => {
    const src = source('StageLiveSurface.tsx');
    expect(src).toContain('useWorkspaceImage(');
    expect(src).toContain('<IDEImagePreview');
    expect(src).not.toContain('<img ');
  });

  it('진단 줄은 실행 출력 패널과 **같은 조각**이다 — 두 벌이 되면 한쪽만 색을 얻는다', () => {
    const src = source('StageLiveSurface.tsx');
    expect(src).toContain('<ProblemOutputLine');
    expect(src).toContain('matchProblemLine(');
  });

  it('확장자 표를 무대가 들지 않는다 — 앱이 선언한 것을 받는다(§5.13 (R-1))', () => {
    const src = source('StageLiveSurface.tsx');
    expect(src).toContain('workspaceOpenClaims()');
  });

  it('실황 접기는 무대 폭과 같은 자리에 산다(㉒(e)) — 세션마다 갈라 두지 않는다', () => {
    const store = source('graphStore.ts');
    expect(store).toContain('ideStageLive: boolean');
    expect(store).toContain('setIdeStageLive');
    expect(store).toContain("const IDE_STAGE_LIVE_KEY = 'vibisual:ideStageLive'");
  });

  it('골격 이름·실황 문구가 12 로케일에 전부 있다 — 한 벌만 고치면 나머지가 빈칸으로 뜬다', () => {
    const SURFACES = ['source', 'log', 'diff', 'web', 'terminal', 'docs', 'image', 'model3d', 'video', 'audio', 'none'];
    for (const [path, json] of Object.entries(locales)) {
      const stage = json.ide.stage as unknown as {
        surfaceName?: Record<string, string>;
        surfaceBlurb?: Record<string, string>;
        live?: Record<string, string>;
      };
      for (const key of SURFACES) {
        expect(stage.surfaceName?.[key], `${path} ide.stage.surfaceName.${key}`).toBeTruthy();
        expect(stage.surfaceBlurb?.[key], `${path} ide.stage.surfaceBlurb.${key}`).toBeTruthy();
      }
      for (const key of ['collapse', 'expand', 'count', 'search']) {
        expect(stage.live?.[key], `${path} ide.stage.live.${key}`).toBeTruthy();
      }
    }
  });
});
