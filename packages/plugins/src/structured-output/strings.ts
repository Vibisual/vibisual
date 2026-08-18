/**
 * structured-output — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.structuredOutput` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows whether this agent reports through a schema rather than prose. Once one agent’s output becomes another’s input, a parse failure is a pipeline stop.",
    "heading": "Structured Output",
    "level": {
      "prose": "Prose only",
      "structured": "Structured"
    },
    "check": {
      "reports": "Work reports",
      "reviews": "Review requests",
      "userActions": "Actions left to you"
    },
    "note": "Handoff packets, scoring results and tool arguments are all better received as schemas than as sentences."
  },
  "ko": {
    "desc": "이 에이전트가 서술이 아니라 스키마로 보고하는지 보여줍니다. 한 에이전트의 출력이 다음 단계의 입력이 되는 순간, 파싱 실패는 곧 파이프라인 중단입니다.",
    "heading": "구조화 출력",
    "level": {
      "prose": "서술만",
      "structured": "구조화됨"
    },
    "check": {
      "reports": "작업 신고",
      "reviews": "검수 요청",
      "userActions": "사용자가 할 일"
    },
    "note": "인계 패킷·채점 결과·도구 인자는 문장보다 스키마로 받는 편이 낫습니다."
  },
  "ja": {
    "level": {
      "structured": "構造化済み",
      "prose": "文章のみ"
    },
    "check": {
      "reports": "作業報告",
      "reviews": "検収リクエスト",
      "userActions": "あなたが行う作業"
    },
    "heading": "構造化出力",
    "desc": "このエージェントが文章ではなくスキーマで報告しているかを示します。あるエージェントの出力が次の入力になる瞬間、解析失敗はそのままパイプラインの停止です。",
    "note": "引き継ぎパケット・採点結果・ツール引数は、文よりスキーマで受け取る方が確実です。"
  },
  "zh-CN": {
    "level": {
      "structured": "已结构化",
      "prose": "仅有叙述"
    },
    "check": {
      "reports": "工作汇报",
      "reviews": "检查请求",
      "userActions": "需你处理的事项"
    },
    "heading": "结构化输出",
    "desc": "显示这个智能体是用结构化模式而不是叙述来汇报。一旦某个智能体的输出成为下一个的输入，解析失败就等于流水线停摆。",
    "note": "交接包、评分结果、工具参数，用结构化模式接收都比用句子更可靠。"
  },
  "es": {
    "level": {
      "structured": "Estructurado",
      "prose": "Solo texto"
    },
    "check": {
      "reports": "Informes de trabajo",
      "reviews": "Solicitudes de revisión",
      "userActions": "Acciones para ti"
    },
    "heading": "Salida estructurada",
    "desc": "Muestra si este agente informa mediante un esquema en lugar de prosa. En cuanto la salida de un agente pasa a ser la entrada de otro, un fallo de análisis detiene la cadena.",
    "note": "Los paquetes de traspaso, los resultados de puntuación y los argumentos de herramientas se reciben mejor como esquemas que como frases."
  },
  "es-419": {
    "level": {
      "structured": "Estructurado",
      "prose": "Solo texto"
    },
    "check": {
      "reports": "Informes de trabajo",
      "reviews": "Solicitudes de revisión",
      "userActions": "Acciones para ti"
    },
    "heading": "Salida estructurada",
    "desc": "Muestra si este agente informa mediante un esquema en lugar de prosa. En cuanto la salida de un agente pasa a ser la entrada de otro, un fallo de análisis detiene la cadena.",
    "note": "Los paquetes de traspaso, los resultados de puntuación y los argumentos de herramientas se reciben mejor como esquemas que como frases."
  },
  "fr": {
    "level": {
      "structured": "Structuré",
      "prose": "Texte seulement"
    },
    "check": {
      "reports": "Rapports de travail",
      "reviews": "Demandes de revue",
      "userActions": "Actions qui vous reviennent"
    },
    "heading": "Sortie structurée",
    "desc": "Indique si cet agent rend compte via un schéma plutôt qu’en prose. Dès que la sortie d’un agent devient l’entrée d’un autre, un échec d’analyse arrête la chaîne.",
    "note": "Paquets de passation, résultats de notation et arguments d’outils se reçoivent mieux en schémas qu’en phrases."
  },
  "de": {
    "level": {
      "structured": "Strukturiert",
      "prose": "Nur Fließtext"
    },
    "check": {
      "reports": "Arbeitsberichte",
      "reviews": "Prüfanfragen",
      "userActions": "Für Sie verbleibend"
    },
    "heading": "Strukturierte Ausgabe",
    "desc": "Zeigt, ob dieser Agent über ein Schema statt über Fließtext berichtet. Sobald die Ausgabe eines Agenten zur Eingabe des nächsten wird, ist ein Parse-Fehler ein Stillstand der Kette.",
    "note": "Übergabepakete, Bewertungsergebnisse und Werkzeugargumente nimmt man besser als Schema entgegen als in Sätzen."
  },
  "hi": {
    "level": {
      "structured": "संरचित",
      "prose": "केवल गद्य"
    },
    "check": {
      "reports": "कार्य रिपोर्ट",
      "reviews": "समीक्षा अनुरोध",
      "userActions": "आपके लिए कार्य"
    },
    "heading": "संरचित आउटपुट",
    "desc": "दिखाता है कि यह एजेंट गद्य के बजाय स्कीमा से रिपोर्ट करता है या नहीं। जैसे ही एक एजेंट का आउटपुट दूसरे का इनपुट बनता है, पार्स की विफलता का अर्थ है पूरी कड़ी रुक जाना।",
    "note": "सौंपने के पैकेट, मूल्यांकन के नतीजे और टूल के तर्क — इन्हें वाक्यों के बजाय स्कीमा के रूप में लेना बेहतर है।"
  },
  "id": {
    "level": {
      "structured": "Terstruktur",
      "prose": "Hanya narasi"
    },
    "check": {
      "reports": "Laporan kerja",
      "reviews": "Permintaan tinjauan",
      "userActions": "Tindakan untuk Anda"
    },
    "heading": "Keluaran terstruktur",
    "desc": "Menunjukkan apakah agen ini melapor lewat skema alih-alih prosa. Begitu keluaran satu agen menjadi masukan agen lain, kegagalan penguraian berarti rantai berhenti.",
    "note": "Paket serah terima, hasil penilaian, dan argumen alat lebih baik diterima sebagai skema daripada sebagai kalimat."
  },
  "it": {
    "level": {
      "structured": "Strutturato",
      "prose": "Solo prosa"
    },
    "check": {
      "reports": "Rapporti di lavoro",
      "reviews": "Richieste di revisione",
      "userActions": "Azioni per te"
    },
    "heading": "Output strutturato",
    "desc": "Mostra se questo agente riferisce tramite uno schema invece che in prosa. Nel momento in cui l’output di un agente diventa l’input di un altro, un errore di parsing ferma la catena.",
    "note": "Pacchetti di consegna, esiti di valutazione e argomenti degli strumenti si ricevono meglio come schemi che come frasi."
  },
  "pt-BR": {
    "level": {
      "structured": "Estruturado",
      "prose": "Apenas texto"
    },
    "check": {
      "reports": "Relatórios de trabalho",
      "reviews": "Pedidos de revisão",
      "userActions": "Ações para você"
    },
    "heading": "Saída estruturada",
    "desc": "Mostra se este agente relata por um esquema em vez de prosa. Quando a saída de um agente vira a entrada de outro, uma falha de parsing é uma parada na cadeia.",
    "note": "Pacotes de repasse, resultados de pontuação e argumentos de ferramentas são melhor recebidos como esquemas do que como frases."
  }
} as const;
