// The consent window opens before the renderer and its i18n instance are ready.
// Keep its strings local to the main process, just like main/strings.ts.

export interface ConsentStrings {
  title: string;
  intro: string;
  language: string;
  summary: string;
  fullTerms: string;
  privacy: string;
  fullTextLanguage: string;
  acceptance: string;
  accept: string;
  decline: string;
  saving: string;
  saveError: string;
  loadError: string;
  retry: string;
  /** `{version}` */
  version: string;
}

export const CONSENT_LANGUAGES = [
  { locale: 'en', name: 'English', file: 'license_en_US.txt' },
  { locale: 'ko', name: '한국어', file: 'license_ko_KR.txt' },
  { locale: 'ja', name: '日本語', file: 'license_ja_JP.txt' },
  { locale: 'zh-CN', name: '简体中文', file: 'license_zh_CN.txt' },
  { locale: 'de', name: 'Deutsch', file: 'license_de_DE.txt' },
  { locale: 'fr', name: 'Français', file: 'license_fr_FR.txt' },
  { locale: 'es', name: 'Español', file: 'license_es_ES.txt' },
  { locale: 'es-419', name: 'Español (Latinoamérica)', file: 'license_es_ES.txt' },
  { locale: 'pt-BR', name: 'Português (Brasil)', file: 'license_pt_BR.txt' },
  { locale: 'it', name: 'Italiano', file: 'license_it_IT.txt' },
  { locale: 'id', name: 'Bahasa Indonesia', file: 'license_id_ID.txt' },
  { locale: 'hi', name: 'हिन्दी', file: 'license_hi_IN.txt' },
] as const;

type ConsentLocale = (typeof CONSENT_LANGUAGES)[number]['locale'];

const en: ConsentStrings = {
  title: 'Welcome to Vibisual',
  intro: 'Choose your language and review the terms before using Vibisual.',
  language: 'Language',
  summary: 'Responsibility notice',
  fullTerms: 'Full EULA',
  privacy: 'Privacy notice',
  fullTextLanguage: 'The full EULA and privacy notice are provided in English.',
  acceptance: 'I agree to the EULA and responsibility notice and acknowledge the privacy notice.',
  accept: 'Agree and continue',
  decline: 'Decline and quit',
  saving: 'Saving your agreement…',
  saveError: 'Your agreement could not be saved. Please try again.',
  loadError: 'The terms could not be loaded. Please try again.',
  retry: 'Try again',
  version: 'EULA {version}',
};

const ko: ConsentStrings = {
  title: 'Vibisual에 오신 것을 환영합니다',
  intro: 'Vibisual을 사용하기 전에 언어를 선택하고 약관을 확인해 주세요.',
  language: '언어',
  summary: '책임 관련 고지',
  fullTerms: '최종 사용자 이용약관 전문',
  privacy: '개인정보 처리 고지',
  fullTextLanguage: '최종 사용자 이용약관 전문과 개인정보 처리 고지는 영어로 제공됩니다.',
  acceptance: '최종 사용자 이용약관과 책임 관련 고지에 동의하며, 개인정보 처리 고지를 확인했습니다.',
  accept: '동의하고 계속',
  decline: '거부하고 종료',
  saving: '동의 내역 저장 중…',
  saveError: '동의 내역을 저장하지 못했습니다. 다시 시도해 주세요.',
  loadError: '약관을 불러오지 못했습니다. 다시 시도해 주세요.',
  retry: '다시 시도',
  version: '최종 사용자 이용약관 {version}',
};

const ja: ConsentStrings = {
  title: 'Vibisualへようこそ',
  intro: 'Vibisualを使用する前に、言語を選択して利用規約をご確認ください。',
  language: '言語',
  summary: '責任に関する通知',
  fullTerms: 'エンドユーザー使用許諾契約の全文',
  privacy: 'プライバシーに関する通知',
  fullTextLanguage: 'エンドユーザー使用許諾契約の全文とプライバシーに関する通知は英語で提供されます。',
  acceptance: 'エンドユーザー使用許諾契約と責任に関する通知に同意し、プライバシーに関する通知を確認しました。',
  accept: '同意して続行',
  decline: '同意せず終了',
  saving: '同意内容を保存中…',
  saveError: '同意内容を保存できませんでした。もう一度お試しください。',
  loadError: '利用規約を読み込めませんでした。もう一度お試しください。',
  retry: '再試行',
  version: 'エンドユーザー使用許諾契約 {version}',
};

const zhCN: ConsentStrings = {
  title: '欢迎使用 Vibisual',
  intro: '使用 Vibisual 前，请选择语言并阅读相关条款。',
  language: '语言',
  summary: '责任声明',
  fullTerms: '最终用户许可协议全文',
  privacy: '隐私声明',
  fullTextLanguage: '最终用户许可协议全文和隐私声明以英语提供。',
  acceptance: '我同意最终用户许可协议和责任声明，并确认已阅读隐私声明。',
  accept: '同意并继续',
  decline: '拒绝并退出',
  saving: '正在保存同意记录…',
  saveError: '无法保存您的同意记录。请重试。',
  loadError: '无法加载条款。请重试。',
  retry: '重试',
  version: '最终用户许可协议 {version}',
};

const de: ConsentStrings = {
  title: 'Willkommen bei Vibisual',
  intro: 'Wählen Sie Ihre Sprache und lesen Sie die Bedingungen, bevor Sie Vibisual verwenden.',
  language: 'Sprache',
  summary: 'Hinweise zur Verantwortung',
  fullTerms: 'Vollständige Endnutzer-Lizenzvereinbarung',
  privacy: 'Datenschutzhinweise',
  fullTextLanguage: 'Die vollständige Endnutzer-Lizenzvereinbarung und die Datenschutzhinweise werden auf Englisch bereitgestellt.',
  acceptance: 'Ich stimme der Endnutzer-Lizenzvereinbarung und den Hinweisen zur Verantwortung zu und habe die Datenschutzhinweise zur Kenntnis genommen.',
  accept: 'Zustimmen und fortfahren',
  decline: 'Ablehnen und beenden',
  saving: 'Ihre Zustimmung wird gespeichert…',
  saveError: 'Ihre Zustimmung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.',
  loadError: 'Die Bedingungen konnten nicht geladen werden. Bitte versuchen Sie es erneut.',
  retry: 'Erneut versuchen',
  version: 'Endnutzer-Lizenzvereinbarung {version}',
};

const fr: ConsentStrings = {
  title: 'Bienvenue dans Vibisual',
  intro: 'Choisissez votre langue et lisez les conditions avant d’utiliser Vibisual.',
  language: 'Langue',
  summary: 'Avis relatif à la responsabilité',
  fullTerms: 'Contrat de licence utilisateur final complet',
  privacy: 'Avis de confidentialité',
  fullTextLanguage: 'Le contrat de licence utilisateur final complet et l’avis de confidentialité sont fournis en anglais.',
  acceptance: 'J’accepte le contrat de licence utilisateur final et l’avis relatif à la responsabilité, et je reconnais avoir pris connaissance de l’avis de confidentialité.',
  accept: 'Accepter et continuer',
  decline: 'Refuser et quitter',
  saving: 'Enregistrement de votre accord…',
  saveError: 'Votre accord n’a pas pu être enregistré. Veuillez réessayer.',
  loadError: 'Les conditions n’ont pas pu être chargées. Veuillez réessayer.',
  retry: 'Réessayer',
  version: 'Contrat de licence utilisateur final {version}',
};

const es: ConsentStrings = {
  title: 'Bienvenido a Vibisual',
  intro: 'Elige tu idioma y lee las condiciones antes de usar Vibisual.',
  language: 'Idioma',
  summary: 'Aviso de responsabilidad',
  fullTerms: 'Contrato de licencia de usuario final completo',
  privacy: 'Aviso de privacidad',
  fullTextLanguage: 'El contrato de licencia de usuario final completo y el aviso de privacidad se proporcionan en inglés.',
  acceptance: 'Acepto el contrato de licencia de usuario final y el aviso de responsabilidad, y confirmo que he leído el aviso de privacidad.',
  accept: 'Aceptar y continuar',
  decline: 'Rechazar y salir',
  saving: 'Guardando tu aceptación…',
  saveError: 'No se ha podido guardar tu aceptación. Vuelve a intentarlo.',
  loadError: 'No se han podido cargar las condiciones. Vuelve a intentarlo.',
  retry: 'Volver a intentarlo',
  version: 'Contrato de licencia de usuario final {version}',
};

const es419: ConsentStrings = {
  title: 'Bienvenido a Vibisual',
  intro: 'Elige tu idioma y lee los términos antes de usar Vibisual.',
  language: 'Idioma',
  summary: 'Aviso de responsabilidad',
  fullTerms: 'Contrato de licencia de usuario final completo',
  privacy: 'Aviso de privacidad',
  fullTextLanguage: 'El contrato de licencia de usuario final completo y el aviso de privacidad se proporcionan en inglés.',
  acceptance: 'Acepto el contrato de licencia de usuario final y el aviso de responsabilidad, y confirmo que leí el aviso de privacidad.',
  accept: 'Aceptar y continuar',
  decline: 'Rechazar y salir',
  saving: 'Guardando tu aceptación…',
  saveError: 'No se pudo guardar tu aceptación. Inténtalo de nuevo.',
  loadError: 'No se pudieron cargar los términos. Inténtalo de nuevo.',
  retry: 'Intentar de nuevo',
  version: 'Contrato de licencia de usuario final {version}',
};

const ptBR: ConsentStrings = {
  title: 'Boas-vindas ao Vibisual',
  intro: 'Escolha seu idioma e leia os termos antes de usar o Vibisual.',
  language: 'Idioma',
  summary: 'Aviso de responsabilidade',
  fullTerms: 'Contrato de licença de usuário final completo',
  privacy: 'Aviso de privacidade',
  fullTextLanguage: 'O contrato de licença de usuário final completo e o aviso de privacidade são fornecidos em inglês.',
  acceptance: 'Concordo com o contrato de licença de usuário final e com o aviso de responsabilidade, e confirmo que li o aviso de privacidade.',
  accept: 'Concordar e continuar',
  decline: 'Recusar e sair',
  saving: 'Salvando sua concordância…',
  saveError: 'Não foi possível salvar sua concordância. Tente novamente.',
  loadError: 'Não foi possível carregar os termos. Tente novamente.',
  retry: 'Tentar novamente',
  version: 'Contrato de licença de usuário final {version}',
};

const it: ConsentStrings = {
  title: 'Benvenuto in Vibisual',
  intro: 'Scegli la lingua e leggi i termini prima di utilizzare Vibisual.',
  language: 'Lingua',
  summary: 'Informativa sulla responsabilità',
  fullTerms: 'Contratto di licenza con l’utente finale completo',
  privacy: 'Informativa sulla privacy',
  fullTextLanguage: 'Il contratto di licenza con l’utente finale completo e l’informativa sulla privacy sono forniti in inglese.',
  acceptance: 'Accetto il contratto di licenza con l’utente finale e l’informativa sulla responsabilità e confermo di aver letto l’informativa sulla privacy.',
  accept: 'Accetta e continua',
  decline: 'Rifiuta ed esci',
  saving: 'Salvataggio dell’accettazione…',
  saveError: 'Impossibile salvare l’accettazione. Riprova.',
  loadError: 'Impossibile caricare i termini. Riprova.',
  retry: 'Riprova',
  version: 'Contratto di licenza con l’utente finale {version}',
};

const id: ConsentStrings = {
  title: 'Selamat datang di Vibisual',
  intro: 'Pilih bahasa Anda dan baca ketentuan sebelum menggunakan Vibisual.',
  language: 'Bahasa',
  summary: 'Pemberitahuan tanggung jawab',
  fullTerms: 'Perjanjian lisensi pengguna akhir lengkap',
  privacy: 'Pemberitahuan privasi',
  fullTextLanguage: 'Perjanjian lisensi pengguna akhir lengkap dan pemberitahuan privasi disediakan dalam bahasa Inggris.',
  acceptance: 'Saya menyetujui perjanjian lisensi pengguna akhir dan pemberitahuan tanggung jawab, serta menyatakan telah membaca pemberitahuan privasi.',
  accept: 'Setuju dan lanjutkan',
  decline: 'Tolak dan keluar',
  saving: 'Menyimpan persetujuan Anda…',
  saveError: 'Persetujuan Anda tidak dapat disimpan. Silakan coba lagi.',
  loadError: 'Ketentuan tidak dapat dimuat. Silakan coba lagi.',
  retry: 'Coba lagi',
  version: 'Perjanjian lisensi pengguna akhir {version}',
};

const hi: ConsentStrings = {
  title: 'Vibisual में आपका स्वागत है',
  intro: 'Vibisual का उपयोग करने से पहले अपनी भाषा चुनें और शर्तें पढ़ें।',
  language: 'भाषा',
  summary: 'ज़िम्मेदारी संबंधी सूचना',
  fullTerms: 'अंतिम उपयोगकर्ता लाइसेंस अनुबंध का पूरा पाठ',
  privacy: 'गोपनीयता सूचना',
  fullTextLanguage: 'अंतिम उपयोगकर्ता लाइसेंस अनुबंध का पूरा पाठ और गोपनीयता सूचना अंग्रेज़ी में उपलब्ध हैं।',
  acceptance: 'अंतिम उपयोगकर्ता लाइसेंस अनुबंध और ज़िम्मेदारी संबंधी सूचना से मेरी सहमति है, और मैंने गोपनीयता सूचना पढ़ ली है।',
  accept: 'सहमत होकर जारी रखें',
  decline: 'अस्वीकार करके बाहर निकलें',
  saving: 'आपकी सहमति सहेजी जा रही है…',
  saveError: 'आपकी सहमति सहेजी नहीं जा सकी। कृपया फिर से कोशिश करें।',
  loadError: 'शर्तें लोड नहीं हो सकीं। कृपया फिर से कोशिश करें।',
  retry: 'फिर से कोशिश करें',
  version: 'अंतिम उपयोगकर्ता लाइसेंस अनुबंध {version}',
};

const TABLE: Record<ConsentLocale, ConsentStrings> = {
  en, ko, ja, 'zh-CN': zhCN, de, fr, es, 'es-419': es419, 'pt-BR': ptBR, it, id, hi,
};

const LATIN_AMERICAN_SPANISH_REGIONS = new Set([
  '419', 'ar', 'bo', 'br', 'bz', 'cl', 'co', 'cr', 'cu', 'do', 'ec', 'gt',
  'hn', 'mx', 'ni', 'pa', 'pe', 'pr', 'py', 'sv', 'us', 'uy', 've',
]);

/** Select the closest supported language from an OS locale; fall back to English. */
export function consentLocale(locale: string): string {
  const normalized = locale.trim().replace(/_/g, '-').replace(/[.@].*$/, '').toLowerCase();
  const exact = CONSENT_LANGUAGES.find(({ locale: supported }) => supported.toLowerCase() === normalized);
  if (exact) return exact.locale;

  const [language, ...subtags] = normalized.split('-');
  if (language === 'zh') return 'zh-CN';
  if (language === 'pt') return 'pt-BR';
  if (language === 'es') {
    // A script subtag can precede the region (for example es-Latn-MX).
    const region = subtags.find((subtag) => /^[a-z]{2}$|^\d{3}$/.test(subtag));
    return region && LATIN_AMERICAN_SPANISH_REGIONS.has(region) ? 'es-419' : 'es';
  }

  return CONSENT_LANGUAGES.find(({ locale: supported }) => supported === language)?.locale ?? 'en';
}

export function consentStrings(locale: string): ConsentStrings {
  return TABLE[consentLocale(locale) as ConsentLocale];
}
