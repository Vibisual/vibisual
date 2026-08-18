/**
 * context-window — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.contextWindow` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "The window is a ceiling, not a target. “This model has 200k so 150k is fine” does not follow — measure your own effective window with real work.",
    "heading": "Context Window",
    "level": {
      "unused": "Not measured",
      "shallow": "Shallow",
      "deep": "Deep fill"
    },
    "check": {
      "configured": "Configured",
      "peak": "Peak use",
      "headroom": "Headroom"
    },
    "note": "Do not trust needle-in-a-haystack scores — they measure lexical lookup, not the difficulty of real long-context work."
  },
  "ko": {
    "desc": "창은 상한이지 목표가 아닙니다. \"이 모델은 200k 니까 150k 를 넣어도 된다\"는 추론은 성립하지 않으므로, 실제 작업으로 자기 유효 창을 재야 합니다.",
    "heading": "컨텍스트 창",
    "level": {
      "unused": "측정 전",
      "shallow": "얕게 씀",
      "deep": "깊게 참"
    },
    "check": {
      "configured": "설정된 창",
      "peak": "최대 사용",
      "headroom": "여유"
    },
    "note": "Needle-in-a-Haystack 점수는 믿지 마십시오 — 어휘 일치 검색이라는 좁은 능력만 재고, 실제 장문 작업의 난이도를 과소평가합니다."
  },
  "ja": {
    "heading": "コンテキストウィンドウ",
    "check": {
      "configured": "設定値",
      "peak": "最大使用量",
      "headroom": "余裕"
    },
    "level": {
      "deep": "深く充填",
      "unused": "未計測",
      "shallow": "浅い"
    },
    "desc": "ウィンドウは上限であって目標ではありません。「このモデルは 200k だから 150k 入れてよい」は成り立たないので、実際の作業で自分の有効幅を測る必要があります。",
    "note": "Needle-in-a-Haystack の点数は信じないでください — 語彙一致の検索という狭い能力しか測っておらず、実際の長文作業の難しさを過小評価します。"
  },
  "zh-CN": {
    "heading": "上下文窗口",
    "check": {
      "configured": "已配置",
      "peak": "峰值使用",
      "headroom": "余量"
    },
    "level": {
      "deep": "占用较深",
      "unused": "未测量",
      "shallow": "较浅"
    },
    "desc": "窗口是上限而不是目标。「这个模型有 200k，所以放 150k 没问题」并不成立 — 要用真实任务测出自己的有效窗口。",
    "note": "不要相信大海捞针式的分数 — 它测的是词汇匹配这种狭窄能力，会低估真实长文任务的难度。"
  },
  "es": {
    "heading": "Ventana de contexto",
    "check": {
      "configured": "Configurado",
      "peak": "Uso máximo",
      "headroom": "Margen"
    },
    "level": {
      "deep": "Muy lleno",
      "unused": "Sin medir",
      "shallow": "Superficial"
    },
    "desc": "La ventana es un techo, no un objetivo. «Este modelo tiene 200k, así que 150k está bien» no se sigue — mide tu ventana efectiva con trabajo real.",
    "note": "No te fíes de las puntuaciones tipo aguja en un pajar — miden búsqueda léxica, no la dificultad del trabajo real con contexto largo."
  },
  "es-419": {
    "heading": "Ventana de contexto",
    "check": {
      "configured": "Configurado",
      "peak": "Uso máximo",
      "headroom": "Margen"
    },
    "level": {
      "deep": "Muy lleno",
      "unused": "Sin medir",
      "shallow": "Superficial"
    },
    "desc": "La ventana es un techo, no un objetivo. «Este modelo tiene 200k, así que 150k está bien» no se sigue — mide tu ventana efectiva con trabajo real.",
    "note": "No te fíes de las puntuaciones tipo aguja en un pajar — miden búsqueda léxica, no la dificultad del trabajo real con contexto largo."
  },
  "fr": {
    "heading": "Fenêtre de contexte",
    "check": {
      "configured": "Configuré",
      "peak": "Usage maximal",
      "headroom": "Marge"
    },
    "level": {
      "deep": "Fortement rempli",
      "unused": "Non mesuré",
      "shallow": "Faible"
    },
    "desc": "La fenêtre est un plafond, pas un objectif. « Ce modèle a 200k, donc 150k passent » ne suit pas — mesurez votre fenêtre utile avec du travail réel.",
    "note": "Ne vous fiez pas aux scores type aiguille dans une botte de foin — ils mesurent une recherche lexicale, pas la difficulté d’un vrai travail à long contexte."
  },
  "de": {
    "heading": "Kontextfenster",
    "check": {
      "configured": "Konfiguriert",
      "peak": "Spitzennutzung",
      "headroom": "Spielraum"
    },
    "level": {
      "deep": "Stark gefüllt",
      "unused": "Nicht gemessen",
      "shallow": "Gering gefüllt"
    },
    "desc": "Das Fenster ist eine Obergrenze, kein Ziel. „Dieses Modell hat 200k, also sind 150k in Ordnung“ folgt nicht — messen Sie Ihr wirksames Fenster mit echter Arbeit.",
    "note": "Trauen Sie Needle-in-a-Haystack-Werten nicht — sie messen lexikalisches Nachschlagen, nicht die Schwierigkeit echter Langkontext-Arbeit."
  },
  "hi": {
    "heading": "संदर्भ विंडो",
    "check": {
      "configured": "कॉन्फ़िगर",
      "peak": "शिखर उपयोग",
      "headroom": "बची जगह"
    },
    "level": {
      "deep": "गहरा भरा",
      "unused": "मापा नहीं",
      "shallow": "उथला"
    },
    "desc": "खिड़की ऊपरी सीमा है, लक्ष्य नहीं। «इस मॉडल में 200k है, इसलिए 150k सुरक्षित है» निष्कर्ष नहीं निकलता — अपनी प्रभावी खिड़की असली काम से नापिए।",
    "note": "भूसे में सुई जैसे अंकों पर भरोसा मत कीजिए — वे शब्द-मिलान नापते हैं, असली लंबे-संदर्भ काम की कठिनाई नहीं।"
  },
  "id": {
    "heading": "Jendela konteks",
    "check": {
      "configured": "Dikonfigurasi",
      "peak": "Penggunaan puncak",
      "headroom": "Sisa ruang"
    },
    "level": {
      "deep": "Terisi dalam",
      "unused": "Belum diukur",
      "shallow": "Dangkal"
    },
    "desc": "Jendela adalah batas atas, bukan target. «Model ini punya 200k, jadi 150k aman» tidak mengikuti — ukur jendela efektif Anda dengan pekerjaan nyata.",
    "note": "Jangan percaya skor jenis jarum di tumpukan jerami — itu mengukur pencocokan kata, bukan sulitnya pekerjaan konteks panjang yang nyata."
  },
  "it": {
    "heading": "Finestra di contesto",
    "check": {
      "configured": "Configurato",
      "peak": "Uso di picco",
      "headroom": "Margine"
    },
    "level": {
      "deep": "Molto pieno",
      "unused": "Non misurato",
      "shallow": "Superficiale"
    },
    "desc": "La finestra è un tetto, non un obiettivo. «Questo modello ha 200k, quindi 150k vanno bene» non segue — misura la tua finestra effettiva con lavoro reale.",
    "note": "Non fidarti dei punteggi tipo ago nel pagliaio — misurano una ricerca lessicale, non la difficoltà del lavoro reale a contesto lungo."
  },
  "pt-BR": {
    "heading": "Janela de contexto",
    "check": {
      "configured": "Configurado",
      "peak": "Uso máximo",
      "headroom": "Folga"
    },
    "level": {
      "deep": "Muito preenchido",
      "unused": "Não medido",
      "shallow": "Raso"
    },
    "desc": "A janela é um teto, não uma meta. «Este modelo tem 200k, então 150k está ok» não se sustenta — meça sua janela efetiva com trabalho real.",
    "note": "Não confie em pontuações tipo agulha no palheiro — elas medem busca lexical, não a dificuldade de trabalho real com contexto longo."
  }
} as const;
