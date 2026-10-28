import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_UI_LOCALE, SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import type { UiLocale } from '@vibisual/shared';
import { pluginLocaleResources } from '@vibisual/plugins/locales';
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
import it from './locales/it.json';
import ptBR from './locales/pt-BR.json';

/** §5.11 — 플러그인 문자열의 정본은 **플러그인 폴더 안**(각 `strings.ts` — 폴더를 복사하면 함께 간다). 여기서는 `panel.plugins` 아래로 합치기만 한다. */
function withPlugins(base: Record<string, unknown>, locale: string): Record<string, unknown> {
  const panel = (base.panel ?? {}) as Record<string, unknown>;
  const plugins = (panel.plugins ?? {}) as Record<string, unknown>;
  return {
    ...base,
    // 호스트 창 뼈대(title·category·검색 …)는 여전히 로케일 파일에 있고, 카드 문자열만 얹는다.
    panel: { ...panel, plugins: { ...plugins, ...pluginLocaleResources(locale) } },
  };
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: withPlugins(en, 'en') },
    ko: { translation: withPlugins(ko, 'ko') },
    ja: { translation: withPlugins(ja, 'ja') },
    'zh-CN': { translation: withPlugins(zhCN, 'zh-CN') },
    es: { translation: withPlugins(es, 'es') },
    'es-419': { translation: withPlugins(es419, 'es-419') },
    fr: { translation: withPlugins(fr, 'fr') },
    de: { translation: withPlugins(de, 'de') },
    hi: { translation: withPlugins(hi, 'hi') },
    id: { translation: withPlugins(id, 'id') },
    it: { translation: withPlugins(it, 'it') },
    'pt-BR': { translation: withPlugins(ptBR, 'pt-BR') },
  },
  lng: DEFAULT_UI_LOCALE,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

/**
 * §5.5 #17-22 ⑤-3 — **`<html lang>` 은 UI 언어를 따라간다** — CSS `:lang()` 폴백 글꼴 차례(한자 통합)·Chromium 의 OS 글꼴 찾기·스크린리더가 읽는다.
 * `languageChanged` 에 건다(`changeUiLocale` ❌) — 서버 설정 복원 등 다른 길로 바뀌어도 따라오게.
 */
function syncDocumentLang(locale: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

i18n.on('languageChanged', syncDocumentLang);
syncDocumentLang(i18n.language || DEFAULT_UI_LOCALE);

export function changeUiLocale(locale: UiLocale): void {
  if (!SUPPORTED_UI_LOCALES.includes(locale)) return;
  void i18n.changeLanguage(locale);
}

export default i18n;
