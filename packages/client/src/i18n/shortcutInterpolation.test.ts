/**
 * shortcutInterpolation.test.ts — **단축키는 번역문에 박지 않는다.**
 *
 * 단축키 라벨은 플랫폼마다 다르다(mac 은 `⌘`). 그런데 `Ctrl+Enter` 같은 글자가 번역문 **안에**
 * 박혀 있으면 코드가 아무리 플랫폼을 봐도 화면은 영영 `Ctrl+…` 로 뜬다. 게다가 그 문장은 로케일
 * 12개에 복제돼 있어 한 곳만 고치면 나머지 11개 언어에서 조용히 어긋난다.
 *
 * 그래서 규약을 이 테스트로 못 박는다: 단축키가 들어가는 문장은 **보간 변수 자리만** 갖고,
 * 실제 글자는 `shortcutLabel()` 이 넣는다. 12개 로케일 전부 같은 변수를 가져야 한다 —
 * 한 로케일에서 변수 이름을 놓치면 그 언어에서만 `{{shortcut}}` 이 날것으로 노출된다.
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

/** 단축키가 들어가는 문장 → 그 문장이 반드시 가져야 할 보간 변수. */
const SHORTCUT_STRINGS: ReadonlyArray<{ key: string; vars: readonly string[]; everyLocale: boolean }> = [
  { key: 'panel.permissionPrompt.shortcutHint', vars: ['shortcut'], everyLocale: true },
  { key: 'panel.contiBoard.zoomReset', vars: ['shortcut'], everyLocale: true },
  { key: 'panel.guide.navigation.copyD', vars: ['copy', 'paste'], everyLocale: true },
  { key: 'panel.guide.shortcuts.copyD', vars: ['copy', 'paste'], everyLocale: true },
  { key: 'panel.guide.shortcuts.sessionTabsD', vars: ['cycle', 'cycleBack', 'pageNext', 'pagePrev', 'first', 'last'], everyLocale: true },
  { key: 'ide.imageAnnotate.hintDraw', vars: ['shortcut'], everyLocale: true },
  { key: 'ide.imageAnnotate.undo', vars: ['shortcut'], everyLocale: true },
  { key: 'ide.imageAnnotate.redo', vars: ['shortcut'], everyLocale: true },
  { key: 'ide.editor.save', vars: ['shortcut'], everyLocale: true },
  { key: 'panel.commandQueue.placeholder', vars: ['paste'], everyLocale: true },
  { key: 'ide.diff.commentPlaceholder', vars: ['shortcut'], everyLocale: true },
  { key: 'common.preview.pickPlaceholder', vars: ['shortcut'], everyLocale: true },
  // en 에만 있고 나머지는 en 으로 폴백하는 키 — 있는 로케일에서만 검사한다.
  { key: 'panel.options.advanced.terminalScrollbackDesc', vars: ['shortcut'], everyLocale: false },
  // 창 배치 힌트 두 개는 en·ko 에만 있다. 변수 이름이 컴포넌트와 어긋나면 화면에 `{{max}}` 가
  // 날것으로 뜬다 — 실제로 한 번 어긋날 뻔했다(로케일은 `maximize`, 컴포넌트는 `max`).
  { key: 'header.ideWindows.shortcutHint', vars: ['dock', 'max', 'next'], everyLocale: false },
  { key: 'ide.overlay.dockShortcutHint', vars: ['dock', 'undock'], everyLocale: false },
];

/** 번역문 안에 남아 있으면 안 되는 하드코딩 단축키 표기(독일어 `Strg`, 일본어 전각 포함). */
const HARDCODED = /Ctrl\s*\+|Strg\s*\+|Cmd\s*\+|⌘/;

describe('단축키 문자열 — 로케일 12종이 같은 보간 변수를 갖는다', () => {
  it('검사 대상 로케일이 지원 목록과 같다 — 언어가 늘면 여기도 늘어야 한다', () => {
    expect(Object.keys(BUNDLES).sort()).toEqual([...SUPPORTED_UI_LOCALES].sort());
  });

  for (const locale of Object.keys(BUNDLES)) {
    for (const { key, vars, everyLocale } of SHORTCUT_STRINGS) {
      it(`${locale} — ${key}`, () => {
        const value = read(BUNDLES[locale], key);
        if (!everyLocale && value === undefined) return; // en 폴백에 맡기는 키
        expect(typeof value, `${locale} 에 ${key} 가 없다`).toBe('string');
        const text = value as string;
        for (const v of vars) {
          expect(text.includes(`{{${v}}}`), `${locale}/${key} 에 {{${v}}} 가 없다: ${text}`).toBe(true);
        }
        expect(HARDCODED.test(text), `${locale}/${key} 에 단축키가 박혀 있다: ${text}`).toBe(false);
      });
    }
  }
});
