/**
 * §4 자동 업데이트 — 헤더의 [업데이트] 버튼(phase `downloaded`)은 짧은 한 단어(`header.update.restartShort`)로 서고,
 * 버전·재시작 설명은 호버 툴팁(`restartTooltip`)으로 넘긴다. 긴 "재시작하여 업데이트"는 확인 모달의 확정 버튼에만 남는다.
 *
 *  ① 그 한 단어는 **그 언어로** 나온다. 짧은 라벨을 새로 넣으며 12개 로케일 전부에 영어 "Update" 가 들어가, 같은 알약이
 *     앞 단계(`available` "업데이트 0.2.2" · `downloading` "업데이트 42%")에서는 자기 언어로 나오다가 받기가 끝나는
 *     순간 영어로 바뀌었다(2026-09-29 QA). 한 낱말이라 `untranslatedCopy.test.ts` 의 문장 검사에도 걸리지 않는다.
 *  ② 접근성 이름은 보이는 글자 그대로다. 툴팁 문장을 `aria-label` 로 덮으면 이름("Version 0.2.2 is ready — restart
 *     to apply")에 보이는 라벨이 없어, 음성 제어로 그 이름을 불러도 버튼을 못 찾는다(WCAG 2.5.3 Label in Name).
 *
 * ⚠ 이 스위트에는 DOM 이 없다(jsdom 미설치). 컴포넌트는 소스 스캔으로 본다.
 */
import { describe, it, expect } from 'vitest';
import { SUPPORTED_UI_LOCALES } from '@vibisual/shared';

type UpdateCopy = { available?: string; restartShort?: string; restartTooltip?: string };

const LOCALES = import.meta.glob<{ header?: { update?: UpdateCopy } }>('/src/i18n/locales/*.json', { eager: true, import: 'default' });
const SOURCES = import.meta.glob<string>(['/src/components/Layout/UpdateButton.tsx'], { query: '?raw', import: 'default', eager: true });

function copyOf(locale: string): UpdateCopy {
  const dict = LOCALES[`/src/i18n/locales/${locale}.json`];
  expect(dict, `${locale}.json 을 못 읽었다`).toBeTruthy();
  return dict?.header?.update ?? {};
}

describe('① 짧은 [업데이트] 라벨은 그 언어로', () => {
  it('앞 단계 알약을 번역한 언어는 마지막 단계의 한 단어도 번역한다 — 받기가 끝나는 순간 영어로 바뀌지 않는다', () => {
    const en = copyOf('en');
    expect(en.restartShort).toBe('Update');
    const checked: string[] = [];
    for (const locale of SUPPORTED_UI_LOCALES) {
      if (locale === 'en') continue;
      const copy = copyOf(locale);
      expect(copy.restartShort, `${locale}: restartShort 가 없다`).toBeTruthy();
      // 독일어처럼 앞 단계도 "Update" 를 그대로 쓰는 언어는 그 낱말이 그 언어의 말이다.
      if (copy.available === en.available) continue;
      expect(copy.restartShort, `${locale}: "${copy.available}" 다음에 영어 "${en.restartShort}"`).not.toBe(en.restartShort);
      checked.push(locale);
    }
    // 전제가 조용히 무너지지 않게 — 번역한 로케일이 실제로 여럿 검사됐다.
    expect(checked.length).toBeGreaterThanOrEqual(10);
  });
});

describe('② 접근성 이름은 보이는 글자', () => {
  it('헤더 버튼은 aria-label 로 이름을 덮지 않고, 설명은 title 툴팁으로 둔다', () => {
    const src = (SOURCES['/src/components/Layout/UpdateButton.tsx'] ?? '').replace(/\r\n/g, '\n');
    expect(src.length, 'UpdateButton.tsx 를 원문으로 못 읽었다').toBeGreaterThan(0);
    const from = src.indexOf('onClick={() => setConfirmOpen(true)}');
    expect(from, '헤더 버튼을 못 찾았다').toBeGreaterThan(-1);
    const button = src.slice(from, src.indexOf('</button>', from));
    expect(button).toContain("title={t('header.update.restartTooltip', { version: readyVersion })}");
    expect(button).toContain("{t('header.update.restartShort')}");
    expect(button).not.toContain('aria-label=');
  });
});
