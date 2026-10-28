/**
 * §4 — 헤더 [업데이트](phase `downloaded`)는 한 단어 `header.update.restartShort`, 설명은 `restartTooltip`.
 * ① 한 단어도 로케일마다 번역돼야 한다(`untranslatedCopy.test.ts` 문장 검사에 안 걸린다) ② 접근성 이름은 보이는 글자(`aria-label` ❌, WCAG 2.5.3).
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
