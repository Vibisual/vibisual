/**
 * token-budget — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.tokenBudget` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Splits the context window into fixed sections first. Without a per-section budget, one section quietly pushes the others out — that is how instructions get truncated on a heavy day.",
    "heading": "Token Budget",
    "level": {
      "ok": "Fixed cost is small",
      "heavy": "Fixed cost is heavy"
    },
    "check": {
      "window": "Window",
      "fixed": "Fixed sections",
      "share": "Share of window",
      "rules": "Agent rules (approx. tokens)"
    },
    "note": "Characters divided by four approximates tokens. Fix the ceilings as constants and state what gets cut when they overflow."
  },
  "ko": {
    "desc": "컨텍스트 창을 고정 구획부터 떼어 보여줍니다. 구획별 상한이 없으면 한 구획이 조용히 나머지를 밀어냅니다 — 검색 결과가 많은 날 지시문이 잘려 나가는 사고가 그렇게 납니다.",
    "heading": "토큰 예산",
    "level": {
      "ok": "고정 비용이 작음",
      "heavy": "고정 비용이 큼"
    },
    "check": {
      "window": "창 크기",
      "fixed": "고정 구획",
      "share": "창에서 차지하는 몫",
      "rules": "에이전트 규칙(토큰 근사)"
    },
    "note": "문자수/4 를 토큰으로 근사합니다. 구획별 상한을 상수로 고정하고, 넘칠 때 무엇을 자를지까지 정해 두는 것이 표준입니다."
  },
  "ja": {
    "check": {
      "share": "ウィンドウ占有率",
      "window": "ウィンドウ",
      "fixed": "固定区画",
      "rules": "エージェントルール（概算トークン）"
    },
    "heading": "トークン予算",
    "level": {
      "ok": "固定費が軽い",
      "heavy": "固定費が重い"
    },
    "desc": "コンテキストウィンドウをまず固定区画から切り分けて示します。区画ごとの上限がないと、一つの区画が静かに他を押し出します — 検索結果が多い日に指示文が切れる事故はそうして起きます。",
    "note": "文字数÷4 をトークンの近似として使います。区画ごとの上限を定数で固定し、溢れたときに何を切るかまで決めておくのが標準です。"
  },
  "zh-CN": {
    "check": {
      "share": "占窗口比例",
      "window": "窗口",
      "fixed": "固定区块",
      "rules": "智能体规则（约合令牌）"
    },
    "heading": "令牌预算",
    "level": {
      "ok": "固定成本较低",
      "heavy": "固定成本偏重"
    },
    "desc": "先把上下文窗口按固定区块切开显示。没有分区上限时，一个区块会悄悄挤掉其他 — 检索结果多的那天指令被截断，就是这么发生的。",
    "note": "用「字符数÷4」近似令牌数。把分区上限固定为常量，并明确超出时先切掉什么，这才是标准做法。"
  },
  "es": {
    "check": {
      "share": "Parte de la ventana",
      "window": "Ventana",
      "fixed": "Secciones fijas",
      "rules": "Reglas del agente (tokens aprox.)"
    },
    "heading": "Presupuesto de tokens",
    "level": {
      "ok": "Coste fijo bajo",
      "heavy": "Coste fijo alto"
    },
    "desc": "Divide primero la ventana de contexto en secciones fijas. Sin presupuesto por sección, una sección empuja calladamente a las demás — así es como las instrucciones acaban truncadas en un día cargado.",
    "note": "Los caracteres divididos entre cuatro aproximan los tokens. Fija los topes como constantes y define qué se recorta al desbordar."
  },
  "es-419": {
    "check": {
      "share": "Parte de la ventana",
      "window": "Ventana",
      "fixed": "Secciones fijas",
      "rules": "Reglas del agente (tokens aprox.)"
    },
    "heading": "Presupuesto de tokens",
    "level": {
      "ok": "Coste fijo bajo",
      "heavy": "Coste fijo alto"
    },
    "desc": "Divide primero la ventana de contexto en secciones fijas. Sin presupuesto por sección, una sección empuja calladamente a las demás — así es como las instrucciones acaban truncadas en un día cargado.",
    "note": "Los caracteres divididos entre cuatro aproximan los tokens. Fija los topes como constantes y define qué se recorta al desbordar."
  },
  "fr": {
    "check": {
      "share": "Part de la fenêtre",
      "window": "Fenêtre",
      "fixed": "Sections fixes",
      "rules": "Règles d’agent (jetons approx.)"
    },
    "heading": "Budget de jetons",
    "level": {
      "ok": "Coût fixe faible",
      "heavy": "Coût fixe élevé"
    },
    "desc": "Découpe d’abord la fenêtre de contexte en sections fixes. Sans budget par section, une section pousse discrètement les autres dehors — c’est ainsi que les instructions se retrouvent tronquées un jour chargé.",
    "note": "Le nombre de caractères divisé par quatre approxime les jetons. Fixez les plafonds comme constantes et précisez ce qui est coupé en cas de dépassement."
  },
  "de": {
    "check": {
      "share": "Anteil am Fenster",
      "window": "Fenster",
      "fixed": "Feste Abschnitte",
      "rules": "Agentregeln (ca. Tokens)"
    },
    "heading": "Token-Budget",
    "level": {
      "ok": "Fixkosten gering",
      "heavy": "Fixkosten hoch"
    },
    "desc": "Teilt das Kontextfenster zuerst in feste Abschnitte auf. Ohne Budget je Abschnitt drängt ein Abschnitt die anderen still hinaus — so werden Anweisungen an einem Tag mit vielen Suchtreffern abgeschnitten.",
    "note": "Zeichen geteilt durch vier nähert Tokens an. Legen Sie die Obergrenzen als Konstanten fest und bestimmen Sie, was bei Überlauf zuerst gekürzt wird."
  },
  "hi": {
    "check": {
      "share": "विंडो का हिस्सा",
      "window": "विंडो",
      "fixed": "निश्चित खंड",
      "rules": "एजेंट नियम (लगभग टोकन)"
    },
    "heading": "टोकन बजट",
    "level": {
      "ok": "निश्चित लागत कम",
      "heavy": "निश्चित लागत भारी"
    },
    "desc": "संदर्भ-खिड़की को पहले ही तय हिस्सों में बाँटता है। हिस्सेवार बजट न हो तो एक हिस्सा चुपचाप दूसरे को बाहर धकेल देता है — व्यस्त दिन में निर्देश इसी तरह कटते हैं।",
    "note": "अक्षरों की संख्या को चार से भाग देने पर टोकन का मोटा अनुमान मिलता है। सीमाओं को स्थिरांक बनाइए और तय कीजिए कि भरने पर क्या छाँटा जाएगा।"
  },
  "id": {
    "check": {
      "share": "Porsi jendela",
      "window": "Jendela",
      "fixed": "Bagian tetap",
      "rules": "Aturan agen (perkiraan token)"
    },
    "heading": "Anggaran token",
    "level": {
      "ok": "Biaya tetap ringan",
      "heavy": "Biaya tetap berat"
    },
    "desc": "Membagi jendela konteks lebih dulu ke bagian-bagian tetap. Tanpa anggaran per bagian, satu bagian diam-diam mendorong yang lain keluar — begitulah instruksi terpotong pada hari yang padat.",
    "note": "Jumlah karakter dibagi empat mendekati jumlah token. Tetapkan batas sebagai konstanta dan tentukan apa yang dipangkas saat meluap."
  },
  "it": {
    "check": {
      "share": "Quota della finestra",
      "window": "Finestra",
      "fixed": "Sezioni fisse",
      "rules": "Regole agente (token approx.)"
    },
    "heading": "Budget di token",
    "level": {
      "ok": "Costo fisso basso",
      "heavy": "Costo fisso alto"
    },
    "desc": "Divide prima la finestra di contesto in sezioni fisse. Senza budget per sezione, una sezione spinge in silenzio fuori le altre — è così che le istruzioni finiscono troncate in una giornata carica.",
    "note": "I caratteri divisi per quattro approssimano i token. Fissa i tetti come costanti e stabilisci che cosa viene tagliato in caso di eccedenza."
  },
  "pt-BR": {
    "check": {
      "share": "Parte da janela",
      "window": "Janela",
      "fixed": "Seções fixas",
      "rules": "Regras do agente (tokens aprox.)"
    },
    "heading": "Orçamento de tokens",
    "level": {
      "ok": "Custo fixo baixo",
      "heavy": "Custo fixo alto"
    },
    "desc": "Primeiro divide a janela de contexto em seções fixas. Sem orçamento por seção, uma seção empurra as outras em silêncio — é assim que instruções acabam truncadas num dia cheio.",
    "note": "Caracteres divididos por quatro aproximam os tokens. Fixe os tetos como constantes e defina o que é cortado quando estourar."
  }
} as const;
