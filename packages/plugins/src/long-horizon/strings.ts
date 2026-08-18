/**
 * long-horizon — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.longHorizon` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Tracks how long a session has been running — turns, elapsed time, and the last to-do progress. Long tasks usually fail from exhausted context and accumulated error, not from lack of ability.",
    "heading": "Long-Horizon Task",
    "level": {
      "short": "Short",
      "long": "Getting long",
      "verylong": "Very long"
    },
    "badge": "{{turns}} turns over {{elapsed}}",
    "row": {
      "turns": "Turns",
      "elapsed": "Elapsed",
      "todos": "To-do progress"
    },
    "shortNote": "Still short — nothing to watch yet.",
    "longNote": "Write down decisions and file paths before compaction runs — summaries drop the specifics first."
  },
  "ko": {
    "desc": "세션이 얼마나 길어졌는지 추적합니다 — 턴 수, 경과 시간, 마지막 할일 진행률. 긴 작업의 실패는 대개 능력 부족이 아니라 맥락 소진과 누적 오차에서 옵니다.",
    "heading": "장기 지평 작업",
    "level": {
      "short": "짧음",
      "long": "길어지는 중",
      "verylong": "매우 김"
    },
    "badge": "{{elapsed}} 동안 {{turns}}턴",
    "row": {
      "turns": "턴 수",
      "elapsed": "경과",
      "todos": "할일 진행률"
    },
    "shortNote": "아직 짧습니다 — 지켜볼 것이 없습니다.",
    "longNote": "컴팩션이 돌기 전에 결정과 파일 경로를 파일로 남기십시오 — 요약은 구체적인 것부터 버립니다."
  },
  "ja": {
    "desc": "セッションがどれだけ長引いたかを追跡します — ターン数・経過時間・最後のタスク進捗。長い作業の失敗は多くの場合、能力不足ではなく文脈の枯渇と誤差の蓄積から来ます。",
    "heading": "長期作業",
    "level": {
      "short": "短い",
      "long": "長くなってきた",
      "verylong": "非常に長い"
    },
    "badge": "{{elapsed}} で {{turns}} ターン",
    "row": {
      "turns": "ターン数",
      "elapsed": "経過",
      "todos": "タスク進捗"
    },
    "shortNote": "まだ短く、注視すべきことはありません。",
    "longNote": "コンパクションが走る前に決定とファイルパスを書き出してください — 要約は具体的なものから捨てます。"
  },
  "zh-CN": {
    "desc": "追踪会话已经持续多久 — 轮次、耗时以及最近的待办进度。长任务的失败通常源于上下文耗尽和误差累积，而非能力不足。",
    "heading": "长跨度任务",
    "level": {
      "short": "较短",
      "long": "正在变长",
      "verylong": "非常长"
    },
    "badge": "{{elapsed}} 内 {{turns}} 轮",
    "row": {
      "turns": "轮次",
      "elapsed": "耗时",
      "todos": "待办进度"
    },
    "shortNote": "仍然较短 — 暂无需关注。",
    "longNote": "在压缩发生前，把决定与文件路径写下来 — 摘要最先丢弃的就是具体信息。"
  },
  "es": {
    "desc": "Sigue cuánto lleva corriendo la sesión: turnos, tiempo transcurrido y el último progreso de tareas. Las tareas largas suelen fallar por contexto agotado y error acumulado, no por falta de capacidad.",
    "heading": "Tarea de largo alcance",
    "level": {
      "short": "Corta",
      "long": "Alargándose",
      "verylong": "Muy larga"
    },
    "badge": "{{turns}} turnos en {{elapsed}}",
    "row": {
      "turns": "Turnos",
      "elapsed": "Transcurrido",
      "todos": "Progreso de tareas"
    },
    "shortNote": "Aún corta: nada que vigilar.",
    "longNote": "Anota decisiones y rutas de archivo antes de que corra la compactación: los resúmenes descartan primero lo concreto."
  },
  "es-419": {
    "desc": "Sigue cuánto lleva corriendo la sesión: turnos, tiempo transcurrido y el último progreso de tareas. Las tareas largas suelen fallar por contexto agotado y error acumulado, no por falta de capacidad.",
    "heading": "Tarea de largo alcance",
    "level": {
      "short": "Corta",
      "long": "Alargándose",
      "verylong": "Muy larga"
    },
    "badge": "{{turns}} turnos en {{elapsed}}",
    "row": {
      "turns": "Turnos",
      "elapsed": "Transcurrido",
      "todos": "Progreso de tareas"
    },
    "shortNote": "Aún corta: nada que vigilar.",
    "longNote": "Anota decisiones y rutas de archivo antes de que corra la compactación: los resúmenes descartan primero lo concreto."
  },
  "fr": {
    "desc": "Suit la durée de la session — tours, temps écoulé et dernière progression des tâches. Les tâches longues échouent surtout par contexte épuisé et erreurs cumulées, pas par manque de capacité.",
    "heading": "Tâche de long horizon",
    "level": {
      "short": "Courte",
      "long": "S’allonge",
      "verylong": "Très longue"
    },
    "badge": "{{turns}} tours sur {{elapsed}}",
    "row": {
      "turns": "Tours",
      "elapsed": "Écoulé",
      "todos": "Progression des tâches"
    },
    "shortNote": "Encore courte — rien à surveiller.",
    "longNote": "Notez les décisions et chemins de fichiers avant la compaction — les résumés abandonnent d’abord le concret."
  },
  "de": {
    "desc": "Verfolgt, wie lange eine Sitzung schon läuft — Züge, verstrichene Zeit und letzter Aufgabenfortschritt. Lange Aufgaben scheitern meist an erschöpftem Kontext und aufsummierten Fehlern, nicht am Können.",
    "heading": "Langhorizont-Aufgabe",
    "level": {
      "short": "Kurz",
      "long": "Wird lang",
      "verylong": "Sehr lang"
    },
    "badge": "{{turns}} Züge über {{elapsed}}",
    "row": {
      "turns": "Züge",
      "elapsed": "Verstrichen",
      "todos": "Aufgabenfortschritt"
    },
    "shortNote": "Noch kurz — nichts zu beobachten.",
    "longNote": "Halten Sie Entscheidungen und Dateipfade fest, bevor die Kompaktierung läuft — Zusammenfassungen verwerfen zuerst das Konkrete."
  },
  "hi": {
    "desc": "यह ट्रैक करता है कि सत्र कितना लंबा चला — टर्न, बीता समय और अंतिम कार्य प्रगति। लंबे कार्य अक्सर क्षमता की कमी से नहीं, बल्कि संदर्भ की समाप्ति और संचित त्रुटि से विफल होते हैं।",
    "heading": "दीर्घ-अवधि कार्य",
    "level": {
      "short": "छोटा",
      "long": "लंबा हो रहा",
      "verylong": "बहुत लंबा"
    },
    "badge": "{{elapsed}} में {{turns}} टर्न",
    "row": {
      "turns": "टर्न",
      "elapsed": "बीता समय",
      "todos": "कार्य प्रगति"
    },
    "shortNote": "अभी छोटा — देखने को कुछ नहीं।",
    "longNote": "कॉम्पैक्शन चलने से पहले निर्णय और फ़ाइल पथ लिख लें — सारांश पहले ठोस विवरण ही छोड़ते हैं।"
  },
  "id": {
    "desc": "Melacak berapa lama sesi berjalan — giliran, waktu berlalu, dan progres tugas terakhir. Tugas panjang biasanya gagal karena konteks habis dan galat menumpuk, bukan kurang kemampuan.",
    "heading": "Tugas jangka panjang",
    "level": {
      "short": "Pendek",
      "long": "Mulai panjang",
      "verylong": "Sangat panjang"
    },
    "badge": "{{turns}} giliran dalam {{elapsed}}",
    "row": {
      "turns": "Giliran",
      "elapsed": "Berlalu",
      "todos": "Progres tugas"
    },
    "shortNote": "Masih pendek — belum ada yang perlu diawasi.",
    "longNote": "Catat keputusan dan jalur berkas sebelum pemadatan berjalan — ringkasan membuang hal spesifik lebih dulu."
  },
  "it": {
    "desc": "Traccia da quanto dura la sessione — turni, tempo trascorso e ultimo avanzamento delle attività. I lavori lunghi falliscono per contesto esaurito ed errore accumulato, non per mancanza di capacità.",
    "heading": "Attività a lungo orizzonte",
    "level": {
      "short": "Breve",
      "long": "Si sta allungando",
      "verylong": "Molto lunga"
    },
    "badge": "{{turns}} turni in {{elapsed}}",
    "row": {
      "turns": "Turni",
      "elapsed": "Trascorso",
      "todos": "Avanzamento attività"
    },
    "shortNote": "Ancora breve — nulla da osservare.",
    "longNote": "Annota decisioni e percorsi dei file prima che parta la compattazione: i riassunti scartano per primi i dettagli concreti."
  },
  "pt-BR": {
    "desc": "Acompanha há quanto tempo a sessão corre — turnos, tempo decorrido e o último progresso de tarefas. Tarefas longas costumam falhar por contexto esgotado e erro acumulado, não por falta de capacidade.",
    "heading": "Tarefa de longo horizonte",
    "level": {
      "short": "Curta",
      "long": "Ficando longa",
      "verylong": "Muito longa"
    },
    "badge": "{{turns}} turnos em {{elapsed}}",
    "row": {
      "turns": "Turnos",
      "elapsed": "Decorrido",
      "todos": "Progresso de tarefas"
    },
    "shortNote": "Ainda curta — nada a observar.",
    "longNote": "Anote decisões e caminhos de arquivo antes da compactação — resumos descartam primeiro o que é específico."
  }
} as const;
