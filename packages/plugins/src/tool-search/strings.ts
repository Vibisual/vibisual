/**
 * tool-search — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.toolSearch` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Rather than loading every tool definition, search and load only the one needed. Calling a tool a hundred times piles a hundred intermediate results into the window; running it as code returns only the final one.",
    "heading": "Tool Search",
    "level": {
      "lean": "Lean",
      "most": "Most loaded",
      "all": "Everything loaded"
    },
    "check": {
      "loaded": "Loaded",
      "cost": "Schema tokens"
    },
    "note": "The evolution of “use fewer tools” is “let it search for tools”. The bigger the catalogue, the larger the gain."
  },
  "ko": {
    "desc": "도구 정의를 전부 싣지 않고 필요할 때 검색해 그것만 로드하는 방식입니다. 도구를 100번 부르면 중간 결과 100개가 창에 쌓이지만, 코드로 돌리면 최종 결과만 돌아옵니다.",
    "heading": "도구 검색",
    "level": {
      "lean": "적게 실림",
      "most": "대부분 실림",
      "all": "전부 실림"
    },
    "check": {
      "loaded": "실린 도구",
      "cost": "스키마 토큰"
    },
    "note": "\"도구를 줄여라\"의 진화형이 \"도구를 검색하게 하라\"입니다. 카탈로그가 커질수록 이득이 커집니다."
  },
  "ja": {
    "level": {
      "lean": "絞られている",
      "all": "すべて読み込み",
      "most": "ほぼ全部読み込み"
    },
    "check": {
      "loaded": "読み込み済み",
      "cost": "スキーマトークン"
    },
    "heading": "ツール検索",
    "desc": "ツール定義を全部載せる代わりに、必要なときに検索してそれだけ読み込む方式です。ツールを 100 回呼べば途中結果 100 個がウィンドウに積まれますが、コードで回せば最終結果だけが返ります。",
    "note": "「ツールを減らせ」の進化形が「ツールを検索させろ」です。カタログが大きいほど得が大きくなります。"
  },
  "zh-CN": {
    "level": {
      "lean": "精简",
      "all": "全部载入",
      "most": "载入大部分"
    },
    "check": {
      "loaded": "已载入",
      "cost": "模式令牌"
    },
    "heading": "工具检索",
    "desc": "与其载入全部工具定义，不如在需要时检索并只加载那一个。调用工具一百次会把一百个中间结果堆进窗口；用代码跑则只返回最终结果。",
    "note": "「少给工具」的进化形态是「让它去检索工具」。目录越大，收益越大。"
  },
  "es": {
    "level": {
      "lean": "Ajustado",
      "all": "Todo cargado",
      "most": "Casi todas cargadas"
    },
    "check": {
      "loaded": "Cargado",
      "cost": "Tokens de esquema"
    },
    "heading": "Búsqueda de herramientas",
    "desc": "En vez de cargar cada definición de herramienta, buscar y cargar solo la necesaria. Llamar cien veces a una herramienta amontona cien resultados intermedios en la ventana; ejecutarla como código devuelve solo el final.",
    "note": "La evolución de «dar menos herramientas» es «dejar que las busque». Cuanto mayor el catálogo, mayor la ganancia."
  },
  "es-419": {
    "level": {
      "lean": "Ajustado",
      "all": "Todo cargado",
      "most": "Casi todas cargadas"
    },
    "check": {
      "loaded": "Cargado",
      "cost": "Tokens de esquema"
    },
    "heading": "Búsqueda de herramientas",
    "desc": "En vez de cargar cada definición de herramienta, buscar y cargar solo la necesaria. Llamar cien veces a una herramienta amontona cien resultados intermedios en la ventana; ejecutarla como código devuelve solo el final.",
    "note": "La evolución de «dar menos herramientas» es «dejar que las busque». Cuanto mayor el catálogo, mayor la ganancia."
  },
  "fr": {
    "level": {
      "lean": "Restreint",
      "all": "Tout chargé",
      "most": "Presque tout chargé"
    },
    "check": {
      "loaded": "Chargé",
      "cost": "Jetons de schéma"
    },
    "heading": "Recherche d’outils",
    "desc": "Plutôt que charger chaque définition d’outil, chercher et ne charger que celle qu’il faut. Appeler un outil cent fois empile cent résultats intermédiaires dans la fenêtre ; l’exécuter comme du code ne renvoie que le résultat final.",
    "note": "L’évolution de « donner moins d’outils » est « laisser chercher les outils ». Plus le catalogue est grand, plus le gain l’est."
  },
  "de": {
    "level": {
      "lean": "Schlank",
      "all": "Alles geladen",
      "most": "Fast alles geladen"
    },
    "check": {
      "loaded": "Geladen",
      "cost": "Schema-Tokens"
    },
    "heading": "Werkzeugsuche",
    "desc": "Statt jede Werkzeugdefinition zu laden, suchen und nur die benötigte laden. Ein Werkzeug hundertmal aufzurufen häuft hundert Zwischenergebnisse im Fenster; als Code ausgeführt kommt nur das Endergebnis zurück.",
    "note": "Die Weiterentwicklung von „weniger Werkzeuge geben“ ist „nach Werkzeugen suchen lassen“. Je größer der Katalog, desto größer der Gewinn."
  },
  "hi": {
    "level": {
      "lean": "सीमित",
      "all": "सब लोड",
      "most": "लगभग सब लोड"
    },
    "check": {
      "loaded": "लोड किया",
      "cost": "स्कीमा टोकन"
    },
    "heading": "टूल खोज",
    "desc": "हर टूल-परिभाषा लादने के बजाय खोजिए और सिर्फ़ ज़रूरी लादिए। एक टूल को सौ बार बुलाना खिड़की में सौ बीच के नतीजे जमा करता है; उसे कोड की तरह चलाना केवल अंतिम नतीजा लौटाता है।",
    "note": "«टूल घटाओ» का अगला कदम है «उसे टूल खोजने दो»। सूची जितनी बड़ी, फ़ायदा उतना ज़्यादा।"
  },
  "id": {
    "level": {
      "lean": "Ramping",
      "all": "Semua dimuat",
      "most": "Hampir semua dimuat"
    },
    "check": {
      "loaded": "Dimuat",
      "cost": "Token skema"
    },
    "heading": "Pencarian alat",
    "desc": "Alih-alih memuat setiap definisi alat, cari lalu muat hanya yang diperlukan. Memanggil satu alat seratus kali menumpuk seratus hasil antara di jendela; menjalankannya sebagai kode hanya mengembalikan hasil akhir.",
    "note": "Kelanjutan dari «kurangi alatnya» adalah «biarkan ia mencari alat». Makin besar katalognya, makin besar keuntungannya."
  },
  "it": {
    "level": {
      "lean": "Ristretto",
      "all": "Tutto caricato",
      "most": "Quasi tutto caricato"
    },
    "check": {
      "loaded": "Caricato",
      "cost": "Token dello schema"
    },
    "heading": "Ricerca strumenti",
    "desc": "Invece di caricare ogni definizione di strumento, cercare e caricare solo quella necessaria. Chiamare uno strumento cento volte accumula cento risultati intermedi nella finestra; eseguirlo come codice restituisce solo quello finale.",
    "note": "L’evoluzione di «dare meno strumenti» è «lasciare che li cerchi». Più grande è il catalogo, maggiore il guadagno."
  },
  "pt-BR": {
    "level": {
      "lean": "Enxuto",
      "all": "Tudo carregado",
      "most": "Quase tudo carregado"
    },
    "check": {
      "loaded": "Carregado",
      "cost": "Tokens de esquema"
    },
    "heading": "Busca de ferramentas",
    "desc": "Em vez de carregar toda definição de ferramenta, buscar e carregar só a necessária. Chamar uma ferramenta cem vezes empilha cem resultados intermediários na janela; rodá-la como código devolve apenas o final.",
    "note": "A evolução de «dar menos ferramentas» é «deixar buscar ferramentas». Quanto maior o catálogo, maior o ganho."
  }
} as const;
