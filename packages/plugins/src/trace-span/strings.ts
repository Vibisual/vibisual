/**
 * trace-span — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.traceSpan` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "A trace is the whole path of one request and spans are its segments. Model calls, tool runs and judgements all become spans.",
    "heading": "Trace and Span",
    "level": {
      "empty": "No spans",
      "shapeOnly": "Shape only",
      "costed": "With cost"
    },
    "check": {
      "spans": "Spans",
      "sessions": "Sessions",
      "costed": "Sessions with tokens"
    },
    "note": "Carry tokens and cost on the spans and observability doubles as cost analysis."
  },
  "ko": {
    "desc": "한 요청의 전체 경로가 트레이스, 그 안의 구간이 스팬입니다. 모델 호출·도구 실행·판정이 전부 스팬이 됩니다.",
    "heading": "트레이스·스팬",
    "level": {
      "empty": "스팬 없음",
      "shapeOnly": "형태만",
      "costed": "비용까지"
    },
    "check": {
      "spans": "스팬 수",
      "sessions": "세션 수",
      "costed": "토큰이 실린 세션"
    },
    "note": "스팬에 토큰과 비용을 함께 실으면 관측이 곧 원가 분석이 됩니다."
  },
  "ja": {
    "check": {
      "sessions": "セッション数",
      "spans": "スパン数",
      "costed": "トークンのあるセッション"
    },
    "heading": "トレースとスパン",
    "level": {
      "empty": "スパンなし",
      "shapeOnly": "形だけ",
      "costed": "コスト込み"
    },
    "desc": "一つの要求の全経路がトレースで、その中の区間がスパンです。モデル呼び出し・ツール実行・判定がすべてスパンになります。",
    "note": "スパンにトークンと費用を載せれば、観測がそのまま原価分析になります。"
  },
  "zh-CN": {
    "check": {
      "sessions": "会话数",
      "spans": "跨度数",
      "costed": "含令牌的会话"
    },
    "heading": "追踪与跨度",
    "level": {
      "empty": "无跨度",
      "shapeOnly": "仅有结构",
      "costed": "含成本"
    },
    "desc": "一次请求的完整路径是追踪，其中的各个区段是跨度。模型调用、工具执行、判定都会成为跨度。",
    "note": "在跨度上带上令牌与成本，可观测性就顺便成了成本分析。"
  },
  "es": {
    "check": {
      "sessions": "Sesiones",
      "spans": "Tramos",
      "costed": "Sesiones con tokens"
    },
    "heading": "Traza y tramo",
    "level": {
      "empty": "Sin tramos",
      "shapeOnly": "Solo la forma",
      "costed": "Con coste"
    },
    "desc": "Una traza es el camino completo de una petición y los tramos son sus segmentos. Llamadas al modelo, ejecuciones de herramientas y juicios se convierten todos en tramos.",
    "note": "Lleva tokens y coste sobre los tramos y la observabilidad pasa a ser también análisis de coste."
  },
  "es-419": {
    "check": {
      "sessions": "Sesiones",
      "spans": "Tramos",
      "costed": "Sesiones con tokens"
    },
    "heading": "Traza y tramo",
    "level": {
      "empty": "Sin tramos",
      "shapeOnly": "Solo la forma",
      "costed": "Con coste"
    },
    "desc": "Una traza es el camino completo de una petición y los tramos son sus segmentos. Llamadas al modelo, ejecuciones de herramientas y juicios se convierten todos en tramos.",
    "note": "Lleva tokens y coste sobre los tramos y la observabilidad pasa a ser también análisis de coste."
  },
  "fr": {
    "check": {
      "sessions": "Sessions",
      "spans": "Spans",
      "costed": "Sessions avec jetons"
    },
    "heading": "Trace et span",
    "level": {
      "empty": "Aucun span",
      "shapeOnly": "Forme seulement",
      "costed": "Avec coût"
    },
    "desc": "Une trace est le chemin complet d’une requête, les spans en sont les segments. Appels de modèle, exécutions d’outils et jugements deviennent tous des spans.",
    "note": "Portez jetons et coût sur les spans, et l’observabilité devient du même coup une analyse de coût."
  },
  "de": {
    "check": {
      "sessions": "Sitzungen",
      "spans": "Spans",
      "costed": "Sitzungen mit Tokens"
    },
    "heading": "Trace und Span",
    "level": {
      "empty": "Keine Spans",
      "shapeOnly": "Nur die Form",
      "costed": "Mit Kosten"
    },
    "desc": "Ein Trace ist der gesamte Weg einer Anfrage, Spans sind seine Abschnitte. Modellaufrufe, Werkzeugläufe und Bewertungen werden allesamt zu Spans.",
    "note": "Tragen Sie Tokens und Kosten auf den Spans mit, dann ist Observability zugleich Kostenanalyse."
  },
  "hi": {
    "check": {
      "sessions": "सत्र",
      "spans": "स्पैन",
      "costed": "टोकन वाले सत्र"
    },
    "heading": "ट्रेस और स्पैन",
    "level": {
      "empty": "कोई स्पैन नहीं",
      "shapeOnly": "केवल आकार",
      "costed": "लागत सहित"
    },
    "desc": "Trace एक अनुरोध का पूरा रास्ता है और span उसके खंड। मॉडल-कॉल, टूल-निष्पादन और मूल्यांकन — सब span बनते हैं।",
    "note": "Span पर टोकन और लागत साथ रखिए, तो अवलोकनीयता ही लागत-विश्लेषण भी बन जाती है।"
  },
  "id": {
    "check": {
      "sessions": "Sesi",
      "spans": "Span",
      "costed": "Sesi dengan token"
    },
    "heading": "Trace dan span",
    "level": {
      "empty": "Tanpa span",
      "shapeOnly": "Hanya bentuk",
      "costed": "Dengan biaya"
    },
    "desc": "Trace adalah seluruh jalur satu permintaan dan span adalah ruas-ruasnya. Pemanggilan model, eksekusi alat, dan penilaian semuanya menjadi span.",
    "note": "Bawa token dan biaya pada span, maka observabilitas sekaligus menjadi analisis biaya."
  },
  "it": {
    "check": {
      "sessions": "Sessioni",
      "spans": "Span",
      "costed": "Sessioni con token"
    },
    "heading": "Trace e span",
    "level": {
      "empty": "Nessuno span",
      "shapeOnly": "Solo la forma",
      "costed": "Con costo"
    },
    "desc": "Una traccia è l’intero percorso di una richiesta e gli span ne sono i tratti. Chiamate al modello, esecuzioni di strumenti e giudizi diventano tutti span.",
    "note": "Porta token e costo sugli span e l’osservabilità diventa anche analisi dei costi."
  },
  "pt-BR": {
    "check": {
      "sessions": "Sessões",
      "spans": "Spans",
      "costed": "Sessões com tokens"
    },
    "heading": "Trace e span",
    "level": {
      "empty": "Sem spans",
      "shapeOnly": "Apenas a forma",
      "costed": "Com custo"
    },
    "desc": "Um trace é o caminho inteiro de uma requisição e os spans são seus trechos. Chamadas de modelo, execuções de ferramenta e julgamentos viram todos spans.",
    "note": "Leve tokens e custo nos spans e a observabilidade passa a ser também análise de custo."
  }
} as const;
