import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_UI_LOCALE, SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import type { UiLocale } from '@vibisual/shared';
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

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ko: { translation: ko },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
    es: { translation: es },
    'es-419': { translation: es419 },
    fr: { translation: fr },
    de: { translation: de },
    hi: { translation: hi },
    id: { translation: id },
    it: { translation: it },
    'pt-BR': { translation: ptBR },
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
