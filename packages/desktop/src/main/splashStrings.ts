// §3.7 · §9 「시작 화면(스플래시)」 — 스플래시 창과 본체 로드 실패 상자의 문구. 렌더러(i18next)보다 먼저 그려져 파일이 자기 표를 든다.
// 언어는 지난 실행의 `splash.json`, 없으면 OS 언어. `@vibisual/shared` 를 import 하지 않는다 — bootstrap 이 정적으로 끌어와 첫 청크에 통째로 실린다.
// 로케일 목록 일치는 `splashStrings.test.ts` 가 지킨다.

export const SPLASH_LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'es', 'es-419', 'fr', 'de', 'hi', 'id', 'it', 'pt-BR'] as const;
export type SplashLocale = (typeof SPLASH_LOCALES)[number];

/** 키가 늘면 12개 로케일을 전부 채워야 타입이 통과한다(그게 목적이다). */
export interface SplashStrings {
  /** 시작 진입점이 막 띄웠을 때. */
  starting: string;
  /** 본체 모듈을 읽는 중. */
  loading: string;
  /** 서버 코어 기동(프로젝트 복원 전). */
  services: string;
  /** 프로젝트 복원 — `{done}` `{total}` */
  projects: string;
  /** 복원 뒤 나머지 기동(세션·감시·타이머). */
  sessions: string;
  /** 에이전트 연결(훅 리스너·설치). */
  connecting: string;
  /** 본체 창 화면을 준비하는 중. */
  workspace: string;
  /** 다 그렸고 마무리 확인 중. */
  finishing: string;
  /** 진행 막대의 접근성 이름. */
  progressLabel: string;
  /** 본체를 못 읽었을 때 — 독립 디자인 오류창. */
  loadFailedTitle: string;
  loadFailedMessage: string;
  loadFailedClose: string;
}

const en: SplashStrings = {
  loadFailedClose: 'Close',
  starting: 'Starting Vibisual…',
  loading: 'Loading components…',
  services: 'Starting services…',
  projects: 'Restoring projects ({done}/{total})…',
  sessions: 'Preparing sessions…',
  connecting: 'Connecting agents…',
  workspace: 'Preparing your workspace…',
  finishing: 'Almost ready…',
  progressLabel: 'Startup progress',
  loadFailedTitle: 'Vibisual could not start',
  loadFailedMessage: 'Part of the app failed to load. Reinstall Vibisual, and if the problem continues, check the diagnostic log.',
};

const ko: SplashStrings = {
  loadFailedClose: '닫기',
  starting: 'Vibisual을 시작하는 중…',
  loading: '구성 요소를 불러오는 중…',
  services: '서비스를 시작하는 중…',
  projects: '프로젝트를 복원하는 중 ({done}/{total})…',
  sessions: '세션을 준비하는 중…',
  connecting: '에이전트 연결을 준비하는 중…',
  workspace: '작업 화면을 준비하는 중…',
  finishing: '곧 준비됩니다…',
  progressLabel: '시작 진행 상황',
  loadFailedTitle: 'Vibisual을 시작할 수 없습니다',
  loadFailedMessage: '앱의 일부를 불러오지 못했습니다. Vibisual을 다시 설치해 주세요. 문제가 계속되면 진단 로그를 확인해 주세요.',
};

const ja: SplashStrings = {
  loadFailedClose: '閉じる',
  starting: 'Vibisual を起動しています…',
  loading: 'コンポーネントを読み込んでいます…',
  services: 'サービスを開始しています…',
  projects: 'プロジェクトを復元しています ({done}/{total})…',
  sessions: 'セッションを準備しています…',
  connecting: 'エージェントの接続を準備しています…',
  workspace: 'ワークスペースを準備しています…',
  finishing: 'まもなく準備が整います…',
  progressLabel: '起動の進行状況',
  loadFailedTitle: 'Vibisual を起動できませんでした',
  loadFailedMessage: 'アプリの一部を読み込めませんでした。Vibisual を再インストールしてください。問題が続く場合は、診断ログを確認してください。',
};

const zhCN: SplashStrings = {
  loadFailedClose: '关闭',
  starting: '正在启动 Vibisual…',
  loading: '正在加载组件…',
  services: '正在启动服务…',
  projects: '正在恢复项目（{done}/{total}）…',
  sessions: '正在准备会话…',
  connecting: '正在准备智能体连接…',
  workspace: '正在准备工作区…',
  finishing: '即将就绪…',
  progressLabel: '启动进度',
  loadFailedTitle: 'Vibisual 无法启动',
  loadFailedMessage: '应用的部分内容加载失败。请重新安装 Vibisual。如果问题仍然存在，请检查诊断日志。',
};

const es: SplashStrings = {
  loadFailedClose: 'Cerrar',
  starting: 'Iniciando Vibisual…',
  loading: 'Cargando componentes…',
  services: 'Iniciando servicios…',
  projects: 'Restaurando proyectos ({done}/{total})…',
  sessions: 'Preparando sesiones…',
  connecting: 'Preparando la conexión de los agentes…',
  workspace: 'Preparando el espacio de trabajo…',
  finishing: 'Casi listo…',
  progressLabel: 'Progreso del inicio',
  loadFailedTitle: 'No se ha podido iniciar Vibisual',
  loadFailedMessage: 'No se ha podido cargar parte de la aplicación. Vuelve a instalar Vibisual y, si el problema persiste, consulta el registro de diagnóstico.',
};

const es419: SplashStrings = {
  loadFailedClose: 'Cerrar',
  starting: 'Iniciando Vibisual…',
  loading: 'Cargando componentes…',
  services: 'Iniciando servicios…',
  projects: 'Restaurando proyectos ({done}/{total})…',
  sessions: 'Preparando sesiones…',
  connecting: 'Preparando la conexión de los agentes…',
  workspace: 'Preparando el espacio de trabajo…',
  finishing: 'Casi listo…',
  progressLabel: 'Progreso del inicio',
  loadFailedTitle: 'No se pudo iniciar Vibisual',
  loadFailedMessage: 'No se pudo cargar parte de la aplicación. Vuelve a instalar Vibisual y, si el problema continúa, consulta el registro de diagnóstico.',
};

const fr: SplashStrings = {
  loadFailedClose: 'Fermer',
  starting: 'Démarrage de Vibisual…',
  loading: 'Chargement des composants…',
  services: 'Démarrage des services…',
  projects: 'Restauration des projets ({done}/{total})…',
  sessions: 'Préparation des sessions…',
  connecting: 'Préparation de la connexion des agents…',
  workspace: 'Préparation de l’espace de travail…',
  finishing: 'Presque prêt…',
  progressLabel: 'Progression du démarrage',
  loadFailedTitle: 'Vibisual n’a pas pu démarrer',
  loadFailedMessage: 'Une partie de l’application n’a pas pu être chargée. Réinstallez Vibisual et, si le problème persiste, consultez le journal de diagnostic.',
};

const de: SplashStrings = {
  loadFailedClose: 'Schließen',
  starting: 'Vibisual wird gestartet…',
  loading: 'Komponenten werden geladen…',
  services: 'Dienste werden gestartet…',
  projects: 'Projekte werden wiederhergestellt ({done}/{total})…',
  sessions: 'Sitzungen werden vorbereitet…',
  connecting: 'Agentenverbindung wird vorbereitet…',
  workspace: 'Arbeitsbereich wird vorbereitet…',
  finishing: 'Gleich geschafft…',
  progressLabel: 'Startfortschritt',
  loadFailedTitle: 'Vibisual konnte nicht gestartet werden',
  loadFailedMessage: 'Ein Teil der App konnte nicht geladen werden. Installieren Sie Vibisual neu. Wenn das Problem weiterhin besteht, prüfen Sie das Diagnoseprotokoll.',
};

const hi: SplashStrings = {
  loadFailedClose: 'बंद करें',
  starting: 'Vibisual शुरू हो रहा है…',
  loading: 'घटक लोड हो रहे हैं…',
  services: 'सेवाएँ शुरू हो रही हैं…',
  projects: 'प्रोजेक्ट बहाल किए जा रहे हैं ({done}/{total})…',
  sessions: 'सत्र तैयार किए जा रहे हैं…',
  connecting: 'एजेंट कनेक्शन तैयार किया जा रहा है…',
  workspace: 'कार्यक्षेत्र तैयार किया जा रहा है…',
  finishing: 'लगभग तैयार…',
  progressLabel: 'शुरुआत की प्रगति',
  loadFailedTitle: 'Vibisual शुरू नहीं हो सका',
  loadFailedMessage: 'ऐप का कुछ हिस्सा लोड नहीं हो सका। Vibisual को फिर से इंस्टॉल करें। समस्या बनी रहे तो निदान लॉग देखें।',
};

const id: SplashStrings = {
  loadFailedClose: 'Tutup',
  starting: 'Memulai Vibisual…',
  loading: 'Memuat komponen…',
  services: 'Memulai layanan…',
  projects: 'Memulihkan proyek ({done}/{total})…',
  sessions: 'Menyiapkan sesi…',
  connecting: 'Menyiapkan koneksi agen…',
  workspace: 'Menyiapkan ruang kerja…',
  finishing: 'Hampir siap…',
  progressLabel: 'Kemajuan memulai',
  loadFailedTitle: 'Vibisual tidak dapat dimulai',
  loadFailedMessage: 'Sebagian aplikasi gagal dimuat. Instal ulang Vibisual. Jika masalah berlanjut, periksa log diagnostik.',
};

const it: SplashStrings = {
  loadFailedClose: 'Chiudi',
  starting: 'Avvio di Vibisual…',
  loading: 'Caricamento dei componenti…',
  services: 'Avvio dei servizi…',
  projects: 'Ripristino dei progetti ({done}/{total})…',
  sessions: 'Preparazione delle sessioni…',
  connecting: 'Preparazione della connessione degli agenti…',
  workspace: 'Preparazione dell’area di lavoro…',
  finishing: 'Quasi pronto…',
  progressLabel: 'Avanzamento dell’avvio',
  loadFailedTitle: 'Impossibile avviare Vibisual',
  loadFailedMessage: 'Non è stato possibile caricare una parte dell’app. Reinstalla Vibisual e, se il problema persiste, controlla il registro diagnostico.',
};

const ptBR: SplashStrings = {
  loadFailedClose: 'Fechar',
  starting: 'Iniciando o Vibisual…',
  loading: 'Carregando componentes…',
  services: 'Iniciando serviços…',
  projects: 'Restaurando projetos ({done}/{total})…',
  sessions: 'Preparando sessões…',
  connecting: 'Preparando a conexão dos agentes…',
  workspace: 'Preparando o espaço de trabalho…',
  finishing: 'Quase pronto…',
  progressLabel: 'Progresso da inicialização',
  loadFailedTitle: 'Não foi possível iniciar o Vibisual',
  loadFailedMessage: 'Não foi possível carregar parte do aplicativo. Reinstale o Vibisual e, se o problema continuar, verifique o log de diagnóstico.',
};

const TABLE: Record<SplashLocale, SplashStrings> = {
  en, ko, ja, 'zh-CN': zhCN, es, 'es-419': es419, fr, de, hi, id, it, 'pt-BR': ptBR,
};

export function isSplashLocale(value: unknown): value is SplashLocale {
  return typeof value === 'string' && (SPLASH_LOCALES as readonly string[]).includes(value);
}

/** 그 언어의 문구 한 벌. 모르는 값이면 `en` — 침묵보다 영어가 낫다(`mainStrings` 와 같은 바닥). */
export function splashStrings(locale: string | null | undefined): SplashStrings {
  return isSplashLocale(locale) ? TABLE[locale] : TABLE.en;
}

/** `{이름}` 자리표시자를 채운다. 값이 없는 자리는 그대로 둔다(빠진 키가 화면에서 보이게 — `strings.ts` `fmt` 와 같다). */
export function fillSplash(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = vars[key];
    return v === undefined ? whole : String(v);
  });
}
