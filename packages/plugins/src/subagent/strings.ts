/**
 * subagent — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.subagent` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows whether context isolation is actually happening. The point of a subagent is not speed but keeping exploration notes and verbose tool output out of the main thread.",
    "heading": "Subagent Isolation",
    "level": {
      "single": "Single thread",
      "isolated": "Isolated sessions",
      "delegating": "Delegating now"
    },
    "check": {
      "sessions": "Sessions",
      "running": "Running tasks",
      "kinds": "Types"
    },
    "note": "Isolation buys a clean context but creates a new bottleneck — handoff quality. The main thread should see results, not the search."
  },
  "ko": {
    "desc": "컨텍스트 격리가 실제로 일어나는지 보여줍니다. 서브에이전트의 요점은 속도가 아니라, 탐색 메모와 장황한 도구 출력을 본 스레드에서 떼어 놓는 것입니다.",
    "heading": "서브에이전트 격리",
    "level": {
      "single": "단일 스레드",
      "isolated": "세션 분리됨",
      "delegating": "지금 위임 중"
    },
    "check": {
      "sessions": "세션 수",
      "running": "도는 작업",
      "kinds": "유형"
    },
    "note": "격리는 깨끗한 컨텍스트를 주는 대신 인계 품질이라는 새 병목을 만듭니다 — 본 스레드는 탐색이 아니라 결과만 봐야 합니다."
  },
  "ja": {
    "check": {
      "sessions": "セッション数",
      "running": "実行中タスク",
      "kinds": "種類"
    },
    "heading": "サブエージェント隔離",
    "level": {
      "isolated": "隔離されたセッション",
      "delegating": "委譲中",
      "single": "単一スレッド"
    },
    "desc": "コンテキストの隔離が実際に起きているかを示します。サブエージェントの要点は速度ではなく、探索メモや冗長なツール出力を本スレッドから切り離すことです。",
    "note": "隔離は綺麗なコンテキストを与える代わりに、引き継ぎ品質という新しいボトルネックを作ります — 本スレッドは探索ではなく結果だけを見るべきです。"
  },
  "zh-CN": {
    "check": {
      "sessions": "会话数",
      "running": "运行中任务",
      "kinds": "类型"
    },
    "heading": "子智能体隔离",
    "level": {
      "isolated": "隔离的会话",
      "delegating": "正在委派",
      "single": "单线程"
    },
    "desc": "显示上下文隔离是否真的发生了。子智能体的要点不是速度，而是把探索笔记和冗长的工具输出挡在主线程之外。",
    "note": "隔离带来干净的上下文，同时制造了新的瓶颈 — 交接质量。主线程应该只看结果，而不是看探索过程。"
  },
  "es": {
    "check": {
      "sessions": "Sesiones",
      "running": "Tareas en curso",
      "kinds": "Tipos"
    },
    "heading": "Aislamiento de subagentes",
    "level": {
      "isolated": "Sesiones aisladas",
      "delegating": "Delegando ahora",
      "single": "Hilo único"
    },
    "desc": "Muestra si el aislamiento de contexto está ocurriendo de verdad. El sentido de un subagente no es la velocidad, sino mantener las notas de exploración y las salidas verbosas fuera del hilo principal.",
    "note": "El aislamiento compra un contexto limpio y crea un cuello nuevo — la calidad del traspaso. El hilo principal debería ver resultados, no la búsqueda."
  },
  "es-419": {
    "check": {
      "sessions": "Sesiones",
      "running": "Tareas en curso",
      "kinds": "Tipos"
    },
    "heading": "Aislamiento de subagentes",
    "level": {
      "isolated": "Sesiones aisladas",
      "delegating": "Delegando ahora",
      "single": "Hilo único"
    },
    "desc": "Muestra si el aislamiento de contexto está ocurriendo de verdad. El sentido de un subagente no es la velocidad, sino mantener las notas de exploración y las salidas verbosas fuera del hilo principal.",
    "note": "El aislamiento compra un contexto limpio y crea un cuello nuevo — la calidad del traspaso. El hilo principal debería ver resultados, no la búsqueda."
  },
  "fr": {
    "check": {
      "sessions": "Sessions",
      "running": "Tâches en cours",
      "kinds": "Types"
    },
    "heading": "Isolation des sous-agents",
    "level": {
      "isolated": "Sessions isolées",
      "delegating": "Délègue actuellement",
      "single": "Fil unique"
    },
    "desc": "Indique si l’isolation du contexte a réellement lieu. L’intérêt d’un sous-agent n’est pas la vitesse mais de tenir les notes d’exploration et les sorties d’outils verbeuses hors du fil principal.",
    "note": "L’isolation achète un contexte propre et crée un nouveau goulot — la qualité de passation. Le fil principal doit voir des résultats, pas la recherche."
  },
  "de": {
    "check": {
      "sessions": "Sitzungen",
      "running": "Laufende Aufgaben",
      "kinds": "Typen"
    },
    "heading": "Subagenten-Isolierung",
    "level": {
      "isolated": "Isolierte Sitzungen",
      "delegating": "Delegiert gerade",
      "single": "Einzelner Strang"
    },
    "desc": "Zeigt, ob Kontext-Isolierung tatsächlich stattfindet. Der Sinn eines Subagenten ist nicht Tempo, sondern Suchnotizen und ausufernde Werkzeugausgaben aus dem Hauptstrang herauszuhalten.",
    "note": "Isolierung erkauft einen sauberen Kontext und schafft einen neuen Engpass — die Übergabequalität. Der Hauptstrang sollte Ergebnisse sehen, nicht die Suche."
  },
  "hi": {
    "check": {
      "sessions": "सत्र",
      "running": "चल रहे कार्य",
      "kinds": "प्रकार"
    },
    "heading": "सबएजेंट पृथक्करण",
    "level": {
      "isolated": "पृथक सत्र",
      "delegating": "अभी सौंप रहा",
      "single": "एकल थ्रेड"
    },
    "desc": "दिखाता है कि संदर्भ का अलगाव सचमुच हो रहा है या नहीं। उप-एजेंट का मर्म गति नहीं, बल्कि खोजबीन के अंबार और बातूनी टूल-आउटपुट को मुख्य धारे से दूर रखना है।",
    "note": "अलगाव साफ़ संदर्भ ख़रीदता है और साथ ही नया अड़चन-बिंदु बनाता है — सौंपने की गुणवत्ता। मुख्य धारे को नतीजा दिखना चाहिए, खोज की प्रक्रिया नहीं।"
  },
  "id": {
    "check": {
      "sessions": "Sesi",
      "running": "Tugas berjalan",
      "kinds": "Tipe"
    },
    "heading": "Isolasi subagen",
    "level": {
      "isolated": "Sesi terisolasi",
      "delegating": "Sedang mendelegasikan",
      "single": "Utas tunggal"
    },
    "desc": "Menunjukkan apakah isolasi konteks benar-benar terjadi. Inti subagen bukan kecepatan, melainkan menjauhkan catatan penjelajahan dan keluaran alat yang bertele-tele dari utas utama.",
    "note": "Isolasi membeli konteks yang bersih sekaligus menciptakan sumbatan baru — kualitas serah terima. Utas utama seharusnya melihat hasil, bukan proses pencarian."
  },
  "it": {
    "check": {
      "sessions": "Sessioni",
      "running": "Attività in corso",
      "kinds": "Tipi"
    },
    "heading": "Isolamento subagenti",
    "level": {
      "isolated": "Sessioni isolate",
      "delegating": "Sta delegando",
      "single": "Thread singolo"
    },
    "desc": "Mostra se l’isolamento del contesto sta davvero avvenendo. Il senso di un subagente non è la velocità, ma tenere note di esplorazione e output verbosi fuori dal filo principale.",
    "note": "L’isolamento compra un contesto pulito e crea un collo di bottiglia nuovo — la qualità del passaggio di consegne. Il filo principale dovrebbe vedere risultati, non la ricerca."
  },
  "pt-BR": {
    "check": {
      "sessions": "Sessões",
      "running": "Tarefas em execução",
      "kinds": "Tipos"
    },
    "heading": "Isolamento de subagentes",
    "level": {
      "isolated": "Sessões isoladas",
      "delegating": "Delegando agora",
      "single": "Fluxo único"
    },
    "desc": "Mostra se o isolamento de contexto está mesmo acontecendo. O ponto de um subagente não é velocidade, e sim manter notas de exploração e saídas verbosas fora da linha principal.",
    "note": "O isolamento compra um contexto limpo e cria um gargalo novo — a qualidade do repasse. A linha principal deveria ver resultados, não a busca."
  }
} as const;
