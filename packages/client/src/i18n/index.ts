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

/**
 * §5.11 v4.58 — 플러그인 문자열은 **플러그인 폴더 안**에 산다.
 *
 * 카드 문자열 1,124개(로케일 파일의 42%)가 여기 로케일 JSON 안에 있었다. 그래서 플러그인 폴더를
 * 통째로 복사해도 다른 앱에서는 번역 키가 그대로 노출됐다 — 폴더가 자기 문자열을 안 들고 있었기 때문.
 * 지금은 각 폴더의 `strings.ts` 가 정본이고, 여기서 `panel.plugins` 지붕 아래로 **합치기만** 한다.
 * **키 이름은 하나도 안 바뀐다**(`panel.plugins.<camelId>.*`) — 바뀐 것은 파일 위치뿐이다.
 */
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

export function changeUiLocale(locale: UiLocale): void {
  if (!SUPPORTED_UI_LOCALES.includes(locale)) return;
  void i18n.changeLanguage(locale);
}

export default i18n;
