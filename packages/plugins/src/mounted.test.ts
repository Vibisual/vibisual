/**
 * §5.11 v4.37 — 호스트 슬롯이 코어 화면에 실제로 물려 있는가.
 *
 * 카드를 111장 만들고 검사를 열 겹으로 둘렀지만, **슬롯이 코어에서 빠지면 전부 화면에 없는 것과 같다.**
 * 그리고 그 사고는 조용히 일어난다 — 빌드도 타입체크도 통과하고, 플러그인 쪽 테스트도 전부 초록이다.
 * 카드가 안 보이는 것을 사람이 알아채는 수밖에 없는데, **전부 기본 비활성이라 안 보이는 게 정상**이라서
 * 알아챌 방법이 없다.
 *
 * 검사 대상은 클라이언트 파일이지만 이 파일은 **plugins 패키지**에 둔다 — 클라이언트 빌드는 테스트까지
 * 컴파일하는데 그 설정에는 Node 타입이 없어 `node:fs` 를 쓸 수 없다. plugins 쪽은 이미 같은 이유로
 * 클라이언트의 `en.json` 을 읽고 있다(`renderAll.test.tsx`).
 *
 * 렌더 동작이 아니라 **배선의 존재**를 본다 — 빠지는 사고의 대부분은 배선이 통째로 사라지는 형태다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_SRC = path.resolve(__dirname, '../../client/src');

/** 슬롯 → 그것을 부르기로 한 코어 파일. 자리를 옮기면 이 표도 함께 고친다. */
const WIRING: { slot: string; file: string; why: string }[] = [
  { slot: 'PluginsWindow', file: 'components/Layout/FileMenu.tsx', why: '켜고 끄는 창으로 들어가는 유일한 입구' },
  { slot: 'PluginBubbleBadgeSlot', file: 'components/BubbleMap/BubbleNode.tsx', why: '버블 위 배지' },
  { slot: 'PluginPanelSectionSlot', file: 'components/Panel/DetailPanel.tsx', why: '버블을 열었을 때의 카드들' },
  { slot: 'PluginHeaderSlot', file: 'components/Layout/Header.tsx', why: '버블에 매이지 않는 전역 항목' },
];

describe('플러그인 슬롯 배선', () => {
  for (const { slot, file, why } of WIRING) {
    it(`${slot} 가 ${file} 에 물려 있다 — ${why}`, () => {
      const full = path.join(CLIENT_SRC, file);
      expect(fs.existsSync(full), `코어 파일이 없다: ${file}`).toBe(true);

      // 그리는지만 본다. import 가 빠지면 타입체크가 먼저 막으므로 여기서 또 확인할 필요가 없다.
      const text = fs.readFileSync(full, 'utf8');
      expect(text.includes(`<${slot}`), `${file} 이 <${slot}> 를 그리지 않는다`).toBe(true);
    });
  }

  it('배선 표가 비어 있지 않다 — 표가 비면 이 검사가 조용히 통과한다', () => {
    expect(WIRING.length).toBe(4);
  });
});

/**
 * §5.11 v4.65 — **집행이 실제로 프롬프트에 실리는 자리**가 서버에 물려 있는가.
 *
 * v4.57 은 집행 블록을 `contextSummary` 한 곳에만 얹었다. 그 값은 `subAgentManager.execute` 에서
 * **첫 스폰에만** 쓰이고, 이어지는 턴(resume)은 `livePreamble` 만 붙는다 — 그래서 "매 턴 실린다"고
 * 적어 둔 것이 실제로는 **세션 첫 턴 1회**였고, 이미 돌고 있는 세션에서 켜면 아무 일도 없었다.
 * 배선이 다시 한 곳으로 줄어드는 것을 막기 위해 두 자리를 모두 못 박는다.
 *
 * 렌더가 아니라 **배선의 존재**를 보는 이유는 위 슬롯 검사와 같다 — 빠지는 사고는 배선이 사라지는 형태다.
 */
describe('집행 주입 지점 배선', () => {
  const SERVER_SRC = path.resolve(__dirname, '../../server/src');

  it('첫 스폰 경로 — 집행 블록이 rulesBlock 에 들어간다', () => {
    const text = fs.readFileSync(path.join(SERVER_SRC, 'index.ts'), 'utf8');
    expect(/const rulesBlock =[^\n]*pluginBlock/.test(text), 'rulesBlock 에 pluginBlock 이 없다').toBe(true);
  });

  it('이어지는 턴 — 집행 블록이 live preamble 로도 넘어간다', () => {
    const text = fs.readFileSync(path.join(SERVER_SRC, 'index.ts'), 'utf8');
    // execute(cmd, cwd, dispatchContext, config, livePreamble, opts) 의 다섯 번째 인자.
    // v4.72 — preamble 조립이 변수(`livePreamble`)로 빠졌다(§5.5 #17-17 목표 블록·의도 규칙이 같은
    //   자리에 합류하면서). 인라인 concat 이든 변수든 **pluginBlock 이 preamble 로 간다**만 지키면 된다.
    const inline = /\.execute\([^)]*edgesBlock \+ pluginBlock/.test(text);
    const viaVar = /const livePreamble =[\s\S]{0,400}?pluginBlock/.test(text)
      && /\.execute\([^)]*livePreamble/.test(text);
    expect(inline || viaVar, 'livePreamble 에 pluginBlock 이 없다').toBe(true);
  });

  it('CMD 세션 — 터미널 매니저가 집행 블록을 rules 파일에 넘긴다', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../../desktop/src/main/terminalManager.ts'), 'utf8');
    expect(text.includes('buildInteractivePluginBlockForAgent'), 'CMD 경로가 집행 블록을 만들지 않는다').toBe(true);
    expect(text.includes('enforcementBlock'), 'rules 파일로 넘기는 인자가 없다').toBe(true);
  });

  /**
   * v4.67 — **네 번째 지점: 훅으로 붙은 외부 세션.**
   *
   * 앞의 셋은 전부 "우리가 띄운 세션"이다. 사용자가 자기 에디터에서 직접 돌리는 Claude Code 세션 —
   * 이 앱이 버블로 그리고 있는 바로 그 세션 — 에는 집행이 한 글자도 안 갔다. `UserPromptSubmit` 응답의
   * `additionalContext` 가 그 통로이고, 서버·훅 양쪽이 다 있어야 닿는다(한쪽만 있으면 조용히 무효다).
   */
  it('훅 세션 — UserPromptSubmit 응답에 집행 블록이 실린다', () => {
    const server = fs.readFileSync(path.join(SERVER_SRC, 'index.ts'), 'utf8');
    expect(server.includes('buildHookEnforcementBlock'), '서버가 훅 응답에 집행을 싣지 않는다').toBe(true);

    const handler = fs.readFileSync(path.resolve(__dirname, '../../../hooks/handler.mjs'), 'utf8');
    expect(handler.includes('isUserPromptSubmit'), '훅 핸들러가 UserPromptSubmit 을 따로 다루지 않는다').toBe(true);
    expect(handler.includes('additionalContext'), '훅 핸들러가 additionalContext 를 돌려주지 않는다').toBe(true);
  });

  it('스냅샷 — 집행 실측이 provider 로 물려 있다(카드가 읽는 통로)', () => {
    const text = fs.readFileSync(path.join(SERVER_SRC, 'index.ts'), 'utf8');
    expect(text.includes('setPluginFactsProvider'), '실측 provider 가 배선되지 않았다').toBe(true);
  });
});
