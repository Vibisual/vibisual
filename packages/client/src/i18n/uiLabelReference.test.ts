/**
 * uiLabelReference.test.ts — **다른 화면의 라벨 이름을 번역문에 박지 않는다.**
 *
 * 안내문이 "옵션 창의 엔진 칸에서 켜세요" 처럼 **다른 화면을 가리킬** 때가 있다. 그때 그 화면의
 * 이름을 문장 안에 글자로 박으면, 그 라벨은 12개 로케일에서 각자 번역되는데 안내문만 따라가지
 * 못한다 — 화면에는 `옵션 > 엔진` 이라고 떠 있는데 안내문은 `Options > Engines` 를 찾아가라고
 * 말한다. 사용자는 그런 항목을 찾지 못한다.
 *
 * 실제로 한 번 그렇게 났다(2026-09-07, 코덱스 훅 안내문). 번역 지시에 "Options·Engines 는 영문
 * 그대로"라고 적었는데, 그 둘은 고유명사가 아니라 **우리가 번역하는 우리 라벨**이었다.
 * 고유명사(Codex · AGENTS.md · git · OpenAI)와 우리 라벨은 다르게 다뤄야 한다.
 *
 * 그래서 규약을 못 박는다: 다른 화면을 가리키는 문장은 **보간 자리만** 갖고, 실제 이름은
 * 컴포넌트가 `t(라벨키)` 로 넣는다. 라벨 번역이 나중에 바뀌어도 안내문이 저절로 따라온다.
 *
 * 구조 검사(키 개수·변수 일치)로는 이 결함이 **잡히지 않는다.** 12개 로케일이 전부 "제대로 된"
 * 문장을 갖고 있고, 다만 그 문장이 가리키는 곳이 화면에 없을 뿐이기 때문이다.
 */
import { describe, it, expect } from 'vitest';
import { SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import en from './locales/en.json';
import ko from './locales/ko.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import es from './locales/es.json';
import es419 from './locales/es-419.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import hi from './locales/hi.json';
import id from './locales/id.json';
import itIT from './locales/it.json';
import ptBR from './locales/pt-BR.json';

const BUNDLES: Record<string, unknown> = {
  en, ko, ja, 'zh-CN': zhCN, es, 'es-419': es419, fr, de, hi, id, it: itIT, 'pt-BR': ptBR,
};

const read = (bundle: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    bundle,
  );

interface LabelReference {
  /** 다른 화면을 가리키는 문장. */
  key: string;
  /** `보간 변수 이름` → `그 자리에 들어갈 실제 라벨의 키`. 라벨 키도 로케일마다 있어야 한다. */
  slots: Readonly<Record<string, string>>;
  /**
   * 번역문에 남아 있으면 안 되는 영문 라벨 글자. 보간 자리를 지우고 남은 문장에서 검사한다 —
   * 남아 있다면 그 로케일에서만 화면에 없는 이름을 부르게 된다.
   */
  forbidden: readonly string[];
}

const LABEL_REFERENCES: readonly LabelReference[] = [
  {
    // §5.25 (M) — 코덱스 훅 목록 아래 안내문. 우리 훅을 켜고 끄는 자리는 옵션창 엔진 칸 하나뿐이라
    // 이 문장이 그리로 보낸다. 라벨 둘 다 번역 대상이라 반드시 보간이어야 한다.
    key: 'ide.codex.hooks.switchHint',
    slots: { options: 'panel.options.title', engines: 'panel.options.engines.title' },
    forbidden: ['Options', 'Engines'],
  },
  {
    // §6 — 단축키 오버레이 아래줄. "전체 목록은 저기"라고 보내는 자리라, 그 탭 이름이 화면과
    // 어긋나면 사용자가 찾지 못한다. 탭 이름은 카테고리 라벨에서 그대로 받아 적는다.
    key: 'common.shortcuts.overlayFooter',
    slots: { options: 'panel.options.title', keyboard: 'panel.options.categories.keyboard' },
    forbidden: ['Options', 'Keyboard'],
  },
  {
    // §6 — 가이드의 단축키 절 아래줄. 위와 같은 곳을 가리킨다.
    key: 'panel.guide.shortcuts.remapNote',
    slots: { options: 'panel.options.title', keyboard: 'panel.options.categories.keyboard' },
    forbidden: ['Options', 'Keyboard'],
  },
  {
    // §5.5 #17-25 ④-2 — 클립보드 이미지 쓰기가 없는 환경에서 뜨는 안내문. 남는 길이 [PNG
    // 내려받기] 하나뿐이라 그리로 보내는데, 그 버튼 이름도 12 로케일에서 각자 번역된다.
    key: 'ide.imageAnnotate.copyUnsupported',
    slots: { download: 'ide.imageAnnotate.download' },
    forbidden: ['Download'],
  },
  {
    // §5.4 #14-3 — 탭 닫기 확인 팝업의 안내줄. [닫기] 가 지금 무엇을 하는지(멈추느냐 마느냐는
    // 위의 체크 한 칸이 정한다)를 말하는 문장이라, 버튼과 옵션 이름을 글자로 박으면 번역된
    // 화면에서 없는 이름을 가리키게 된다.
    key: 'header.tab.confirmCloseHint',
    slots: { close: 'header.tab.confirmCloseConfirm', force: 'header.tab.confirmCloseForceAll' },
    forbidden: ['Close', 'Force-stop every agent'],
  },
  {
    // §4 (외부 접속 뒷정리) — 껐는데도 공유기에 남아 있을 수동 포워딩 규칙을 지우라는 안내.
    // "무엇이 꺼졌는가"를 그 칸의 이름으로 짚어 주는 문장이라, 이름이 화면과 어긋나면 사용자는
    // 자기가 무엇을 껐는지조차 못 맞춘다. 이 안내는 접속이 다 꺼진 뒤에 뜨는 마지막 화면이다.
    key: 'panel.mobileAccess.forwardCleanupBody',
    slots: { external: 'panel.mobileAccess.externalTitle' },
    forbidden: ['Access from outside'],
  },
  {
    // §5.5 #17-2 보강 — / 목록 맨 위의 경고줄. 다시 켜는 자리가 활동바의 주입원 칸 하나뿐이라
    // 그리로 보내는데, 그 칸 이름도 12 로케일에서 각자 번역된다.
    key: 'ide.mainArea.slashDisabledByContext',
    slots: { contextSources: 'ide.activityBar.context' },
    forbidden: ['Context sources'],
  },
  {
    // §5.26 (F)(b) — 압축이 거절됐을 때 상태바 도움말. 사유가 있는 자리(주입원 칸)를 짚어 준다.
    key: 'ide.statusBar.contextRejectedTip',
    slots: { contextSources: 'ide.activityBar.context' },
    forbidden: ['Context sources'],
  },
  {
    // §4 (Thinking on/off) — 확장 사고를 꺼 뒀을 때 상태바에 뜨는 칸의 도움말. 다시 켜는 자리를
    // **세 곳** 부른다(체크 칸 이름 · 에이전트 설정창 · 옵션창 Agent 기본값 탭) — 넷 다 우리가
    // 번역하는 우리 라벨이라, 하나라도 글자로 박으면 그 로케일에서만 없는 이름을 찾아가게 된다.
    key: 'ide.statusBar.thinkingOffTip',
    slots: {
      thinking: 'panel.agentConfig.thinking.label',
      agentSettings: 'panel.agentConfig.title',
      file: 'panel.fileMenu.file',
      options: 'panel.options.title',
      agentDefaults: 'panel.options.categories.agent',
    },
    forbidden: ['Extended thinking', 'Agent Settings', 'Options', 'Agent Defaults'],
  },
  {
    // §5.10 (P) — 가이드의 「절차 감지」 절, 켜는 법. 3층 스위치가 있는 자리가 활동바의 그 칸
    // 하나뿐이라 문장이 그리로 보내는데, 칸 이름도 12 로케일에서 각자 번역된다. 이 칸은 한때
    // `목표` 뷰 안에 있었고 그 시절 문장이 "Goal view" 를 글자로 박고 있었다 — 칸이 갈린 지금
    // 그 이름을 그대로 두면 없는 곳으로 보내게 되므로, 둘 다 금지어로 잠근다.
    key: 'panel.guide.autoGoal.turnOnD',
    slots: { procedures: 'ide.activityBar.autoGoal' },
    forbidden: ['Procedure detection', 'Goal view'],
  },
];

describe('화면 라벨을 가리키는 문장 — 이름은 박지 않고 받아 적는다', () => {
  it('검사 대상 로케일이 지원 목록과 같다 — 언어가 늘면 여기도 늘어야 한다', () => {
    expect(Object.keys(BUNDLES).sort()).toEqual([...SUPPORTED_UI_LOCALES].sort());
  });

  for (const locale of Object.keys(BUNDLES)) {
    for (const { key, slots, forbidden } of LABEL_REFERENCES) {
      it(`${locale} — ${key} 가 라벨 이름을 보간으로 받는다`, () => {
        const value = read(BUNDLES[locale], key);
        expect(typeof value, `${locale} 에 ${key} 가 없다`).toBe('string');
        let text = value as string;

        for (const slot of Object.keys(slots)) {
          expect(
            text.includes(`{{${slot}}}`),
            `${locale}/${key} 에 {{${slot}}} 가 없다: ${text}`,
          ).toBe(true);
          text = text.split(`{{${slot}}}`).join('');
        }

        for (const word of forbidden) {
          expect(
            text.includes(word),
            `${locale}/${key} 에 영문 라벨 "${word}" 가 박혀 있다 — 화면은 번역된 이름을 쓴다: ${String(value)}`,
          ).toBe(false);
        }
      });

      it(`${locale} — ${key} 가 가리키는 라벨이 이 로케일에 있다`, () => {
        // 라벨 키가 이 로케일에 없으면 i18next 가 en 으로 떨어뜨려 문장 안에서만 영어가 섞인다.
        for (const labelKey of Object.values(slots)) {
          const label = read(BUNDLES[locale], labelKey);
          expect(typeof label, `${locale} 에 ${labelKey} 가 없다(문장 안에서 영어로 떨어진다)`).toBe('string');
          expect((label as string).trim().length, `${locale}/${labelKey} 가 비었다`).toBeGreaterThan(0);
        }
      });
    }
  }
});
