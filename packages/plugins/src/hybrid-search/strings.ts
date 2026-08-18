/**
 * hybrid-search — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.hybridSearch` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Keyword search is strong on exact names and paths; semantic search is strong when the wording differs. Vibisual searches memory on the keyword axis only, which is a deliberate choice at this scale.",
    "heading": "Hybrid Search",
    "level": {
      "none": "No memory yet",
      "keyword": "Keyword axis"
    },
    "check": {
      "axis": "Search axis",
      "cards": "Cards"
    },
    "keywordOnly": "keyword only",
    "note": "At a few hundred entries the second axis costs more to run than it returns. This card exists to notice when that stops being true."
  },
  "ko": {
    "desc": "키워드 검색은 정확한 이름·경로에 강하고 의미 검색은 표현이 다를 때 강합니다. Vibisual 의 기억 검색은 키워드 축만 쓰며, 이 규모에서는 의도한 선택입니다.",
    "heading": "하이브리드 검색",
    "level": {
      "none": "아직 기억 없음",
      "keyword": "키워드 축"
    },
    "check": {
      "axis": "검색 축",
      "cards": "카드 수"
    },
    "keywordOnly": "키워드만",
    "note": "수백 건 규모에서는 두 번째 축이 돌리는 비용보다 돌려주는 것이 적습니다. 이 카드는 그게 더는 참이 아니게 되는 때를 알아채기 위한 것입니다."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "keyword": "キーワード軸"
    },
    "check": {
      "cards": "カード数",
      "axis": "検索の軸"
    },
    "heading": "ハイブリッド検索",
    "keywordOnly": "キーワードのみ",
    "desc": "キーワード検索は正確な名前やパスに強く、意味検索は言い回しが違うときに強いです。Vibisual の記憶検索はキーワード軸だけを使っており、この規模では意図した選択です。",
    "note": "数百件の規模では二つ目の軸は回す費用の方が上回ります。このカードは、それが真でなくなる時に気づくためのものです。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "keyword": "关键词维度"
    },
    "check": {
      "cards": "卡片数",
      "axis": "检索维度"
    },
    "heading": "混合检索",
    "keywordOnly": "仅关键词",
    "desc": "关键词检索擅长精确的名称与路径，语义检索擅长措辞不同的情况。Vibisual 的记忆检索只用关键词这一维，在当前规模下是有意的选择。",
    "note": "在数百条的规模上，第二个维度运行的成本高于它带来的收益。这张卡片的存在，是为了察觉这句话何时不再成立。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "keyword": "Eje de palabras clave"
    },
    "check": {
      "cards": "Tarjetas",
      "axis": "Eje de búsqueda"
    },
    "heading": "Búsqueda híbrida",
    "keywordOnly": "solo palabras clave",
    "desc": "La búsqueda por palabras clave es fuerte con nombres y rutas exactos; la semántica lo es cuando cambia la redacción. Vibisual busca en la memoria solo por el eje de palabras clave, una elección deliberada a esta escala.",
    "note": "Con unos cientos de entradas, el segundo eje cuesta más de lo que devuelve. Esta tarjeta existe para notar cuándo eso deja de ser cierto."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "keyword": "Eje de palabras clave"
    },
    "check": {
      "cards": "Tarjetas",
      "axis": "Eje de búsqueda"
    },
    "heading": "Búsqueda híbrida",
    "keywordOnly": "solo palabras clave",
    "desc": "La búsqueda por palabras clave es fuerte con nombres y rutas exactos; la semántica lo es cuando cambia la redacción. Vibisual busca en la memoria solo por el eje de palabras clave, una elección deliberada a esta escala.",
    "note": "Con unos cientos de entradas, el segundo eje cuesta más de lo que devuelve. Esta tarjeta existe para notar cuándo eso deja de ser cierto."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "keyword": "Axe par mots-clés"
    },
    "check": {
      "cards": "Cartes",
      "axis": "Axe de recherche"
    },
    "heading": "Recherche hybride",
    "keywordOnly": "mots-clés seulement",
    "desc": "La recherche par mots-clés excelle sur les noms et chemins exacts ; la recherche sémantique excelle quand la formulation diffère. Vibisual n’interroge la mémoire que sur l’axe des mots-clés — un choix délibéré à cette échelle.",
    "note": "À quelques centaines d’entrées, le second axe coûte plus qu’il ne rapporte. Cette carte existe pour repérer quand cela cesse d’être vrai."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "keyword": "Stichwort-Achse"
    },
    "check": {
      "cards": "Karten",
      "axis": "Suchachse"
    },
    "heading": "Hybride Suche",
    "keywordOnly": "nur Stichwörter",
    "desc": "Stichwortsuche ist stark bei exakten Namen und Pfaden; semantische Suche ist stark bei abweichender Formulierung. Vibisual durchsucht das Gedächtnis nur auf der Stichwortachse — in dieser Größenordnung eine bewusste Wahl.",
    "note": "Bei einigen hundert Einträgen kostet die zweite Achse mehr, als sie einbringt. Diese Karte existiert, um zu bemerken, wann das nicht mehr gilt."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "keyword": "कीवर्ड अक्ष"
    },
    "check": {
      "cards": "कार्ड",
      "axis": "खोज अक्ष"
    },
    "heading": "हाइब्रिड खोज",
    "keywordOnly": "केवल कीवर्ड",
    "desc": "कुंजीशब्द-खोज सटीक नामों और पथों पर मज़बूत है; अर्थ-खोज तब जब शब्दों की बनावट अलग हो। Vibisual स्मृति केवल कुंजीशब्द-अक्ष पर खोजता है — इस पैमाने पर यह जान-बूझकर लिया गया चुनाव है।",
    "note": "कुछ सौ प्रविष्टियों पर दूसरा अक्ष चलाना उससे मिलने वाले नतीजे से महँगा पड़ता है। यह कार्ड उस दिन को पहचानने के लिए है जब यह सच न रहे।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "keyword": "Sumbu kata kunci"
    },
    "check": {
      "cards": "Kartu",
      "axis": "Sumbu pencarian"
    },
    "heading": "Pencarian hibrida",
    "keywordOnly": "hanya kata kunci",
    "desc": "Pencarian kata kunci kuat pada nama dan jalur yang persis; pencarian makna kuat ketika susunan katanya berbeda. Vibisual mencari memori hanya pada sumbu kata kunci — pilihan yang disengaja pada skala ini.",
    "note": "Pada beberapa ratus entri, sumbu kedua lebih mahal dijalankan daripada hasil yang diberikannya. Kartu ini ada untuk menyadari kapan hal itu tak lagi benar."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "keyword": "Asse per parole chiave"
    },
    "check": {
      "cards": "Schede",
      "axis": "Asse di ricerca"
    },
    "heading": "Ricerca ibrida",
    "keywordOnly": "solo parole chiave",
    "desc": "La ricerca per parole chiave è forte su nomi e percorsi esatti; quella semantica è forte quando cambia la formulazione. Vibisual cerca in memoria solo sull’asse delle parole chiave — scelta deliberata a questa scala.",
    "note": "Con qualche centinaio di voci il secondo asse costa più di quanto renda. Questa scheda esiste per accorgersi di quando ciò smette di valere."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "keyword": "Eixo por palavras-chave"
    },
    "check": {
      "cards": "Cartões",
      "axis": "Eixo de busca"
    },
    "heading": "Busca híbrida",
    "keywordOnly": "apenas palavras-chave",
    "desc": "A busca por palavra-chave é forte em nomes e caminhos exatos; a semântica é forte quando a redação difere. O Vibisual busca na memória só pelo eixo de palavras-chave — escolha deliberada nesta escala.",
    "note": "Com algumas centenas de entradas, o segundo eixo custa mais do que devolve. Este cartão existe para notar quando isso deixar de valer."
  }
} as const;
