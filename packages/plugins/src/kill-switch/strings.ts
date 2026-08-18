/**
 * kill-switch — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.killSwitch` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Adds a single control that stops everything running. It cancels scheduled loops first and then stops live sessions — killing only the current run leaves the scheduler to start the next one.",
    "label": "Stop all",
    "confirm": "Press again",
    "title": "Stop every running session and cancel scheduled loops ({{count}} agents)",
    "check": {}
  },
  "ko": {
    "desc": "돌고 있는 것을 전부 멈추는 단일 수단을 헤더에 답니다. 예약된 루프를 먼저 끊고 그다음 살아 있는 세션을 멈춥니다 — 현재 실행만 죽이면 스케줄러가 다음 회차를 다시 띄웁니다.",
    "label": "전부 정지",
    "confirm": "한 번 더",
    "title": "돌고 있는 세션을 전부 멈추고 예약된 루프를 끊습니다 (에이전트 {{count}}개)",
    "check": {}
  },
  "ja": {
    "label": "すべて停止",
    "confirm": "もう一度",
    "title": "実行中のセッションをすべて止め、予約されたループを切ります（エージェント {{count}} 個）",
    "desc": "動いているものを全部止める単一の操作をヘッダーに置きます。予約されたループを先に切ってから、生きているセッションを止めます — 現在の実行だけを殺すと、スケジューラが次の周回をまた立ち上げます。"
  },
  "zh-CN": {
    "label": "全部停止",
    "confirm": "再按一次",
    "title": "停止所有运行中的会话并取消已排期的循环（{{count}} 个智能体）",
    "desc": "在标题栏放一个能停下所有运行内容的单一控件。它先取消已排期的循环，再停止存活的会话 — 只杀掉当前运行，调度器还会把下一轮拉起来。"
  },
  "es": {
    "label": "Detener todo",
    "confirm": "Pulsa otra vez",
    "title": "Detiene todas las sesiones en curso y cancela los bucles programados ({{count}} agentes)",
    "desc": "Añade un único control que detiene todo lo que está corriendo. Cancela primero los bucles programados y luego para las sesiones vivas — matar solo la ejecución actual deja que el planificador lance la siguiente."
  },
  "es-419": {
    "label": "Detener todo",
    "confirm": "Pulsa otra vez",
    "title": "Detiene todas las sesiones en curso y cancela los bucles programados ({{count}} agentes)",
    "desc": "Añade un único control que detiene todo lo que está corriendo. Cancela primero los bucles programados y luego para las sesiones vivas — matar solo la ejecución actual deja que el planificador lance la siguiente."
  },
  "fr": {
    "label": "Tout arrêter",
    "confirm": "Appuyez encore",
    "title": "Arrête toutes les sessions en cours et annule les boucles planifiées ({{count}} agents)",
    "desc": "Ajoute une commande unique qui arrête tout ce qui tourne. Elle annule d’abord les boucles planifiées puis arrête les sessions actives — ne tuer que l’exécution en cours laisse l’ordonnanceur lancer la suivante."
  },
  "de": {
    "label": "Alles stoppen",
    "confirm": "Nochmal drücken",
    "title": "Stoppt alle laufenden Sitzungen und bricht geplante Schleifen ab ({{count}} Agenten)",
    "desc": "Fügt ein einzelnes Bedienelement hinzu, das alles Laufende stoppt. Es bricht zuerst geplante Schleifen ab und stoppt dann aktive Sitzungen — nur den aktuellen Lauf zu beenden überlässt es dem Scheduler, den nächsten zu starten."
  },
  "hi": {
    "label": "सब रोकें",
    "confirm": "फिर दबाएँ",
    "title": "सभी चल रहे सत्र रोकता है और निर्धारित लूप रद्द करता है ({{count}} एजेंट)",
    "desc": "एक ऐसा नियंत्रण जोड़ता है जो चल रही हर चीज़ रोक दे। यह पहले निर्धारित लूप रद्द करता है और फिर जीवित सत्र रोकता है — केवल मौजूदा निष्पादन मारने पर अनुसूचक अगला शुरू कर देता है।"
  },
  "id": {
    "label": "Hentikan semua",
    "confirm": "Tekan lagi",
    "title": "Menghentikan semua sesi berjalan dan membatalkan loop terjadwal ({{count}} agen)",
    "desc": "Menambahkan satu kendali yang menghentikan semua yang sedang berjalan. Ia membatalkan loop terjadwal lebih dulu lalu menghentikan sesi yang hidup — mematikan hanya eksekusi saat ini membiarkan penjadwal memulai yang berikutnya."
  },
  "it": {
    "label": "Ferma tutto",
    "confirm": "Premi di nuovo",
    "title": "Ferma tutte le sessioni in corso e annulla i cicli programmati ({{count}} agenti)",
    "desc": "Aggiunge un unico comando che ferma tutto ciò che sta girando. Annulla prima i cicli programmati e poi ferma le sessioni vive — uccidere solo l’esecuzione corrente lascia che lo scheduler avvii la successiva."
  },
  "pt-BR": {
    "label": "Parar tudo",
    "confirm": "Pressione de novo",
    "title": "Para todas as sessões em execução e cancela os laços agendados ({{count}} agentes)",
    "desc": "Acrescenta um único controle que para tudo o que está rodando. Ele cancela primeiro os laços agendados e depois para as sessões vivas — matar só a execução atual deixa o agendador iniciar a próxima."
  }
} as const;
