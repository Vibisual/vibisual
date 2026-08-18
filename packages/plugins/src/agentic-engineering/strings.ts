/**
 * agentic-engineering — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agenticEngineering` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "The difference between “coding with AI” and “operating agents” sits here. Programming through agents became the expert default — but with more supervision and review attached.",
    "heading": "Agentic Engineering",
    "level": {
      "raw": "No supervision",
      "partial": "Partial",
      "engineered": "Supervised and verified"
    },
    "check": {
      "pillars": "Signals present",
      "reviews": "Reviews",
      "critique": "Critique edges"
    },
    "note": "Rule documents, evaluation sets, loss-prevention infrastructure and commit gates are all spending done in advance — a fraction of what a later rescue costs."
  },
  "ko": {
    "desc": "\"AI 로 코딩한다\"와 \"에이전트를 운용한다\"의 차이가 여기 있습니다. 에이전트를 통한 프로그래밍이 전문가의 기본이 됐지만, 더 많은 감독과 검토를 곁들여서라는 단서가 붙습니다.",
    "heading": "에이전틱 엔지니어링",
    "level": {
      "raw": "감독 없음",
      "partial": "일부만",
      "engineered": "감독·검증 있음"
    },
    "check": {
      "pillars": "갖춰진 신호",
      "reviews": "검수",
      "critique": "비평 엣지"
    },
    "note": "규칙 문서·평가 셋·손실 방지 인프라·커밋 관문은 전부 사전 지출이며, 사후 구조 비용의 몇 십 분의 일입니다."
  },
  "ja": {
    "level": {
      "partial": "一部のみ",
      "raw": "監督なし",
      "engineered": "監督と検証あり"
    },
    "check": {
      "pillars": "揃った要素",
      "reviews": "検収",
      "critique": "批評エッジ"
    },
    "heading": "エージェント運用工学",
    "desc": "「AI でコーディングする」と「エージェントを運用する」の違いがここにあります。エージェント経由のプログラミングが専門家の既定になりましたが、より多くの監督とレビューを添えて、という但し書きが付きます。",
    "note": "ルール文書・評価セット・損失防止の基盤・コミット関門はすべて前払いであり、後から立て直す費用の何十分の一です。"
  },
  "zh-CN": {
    "level": {
      "partial": "部分",
      "raw": "无监督",
      "engineered": "有监督且已验证"
    },
    "check": {
      "pillars": "具备的信号",
      "reviews": "检查",
      "critique": "批评连线"
    },
    "heading": "智能体工程",
    "desc": "「用 AI 写代码」和「运营智能体」的差别就在这里。通过智能体编程成了专家的默认方式 — 但附带一个前提：要加上更多的监督与复核。",
    "note": "规则文档、评估集、防丢失基础设施、提交关口，全都是预先支出，只是事后救火成本的几十分之一。"
  },
  "es": {
    "level": {
      "partial": "Parcial",
      "raw": "Sin supervisión",
      "engineered": "Supervisado y verificado"
    },
    "check": {
      "pillars": "Señales presentes",
      "reviews": "Revisiones",
      "critique": "Conexiones de crítica"
    },
    "heading": "Ingeniería agéntica",
    "desc": "La diferencia entre «programar con IA» y «operar agentes» está aquí. Programar mediante agentes pasó a ser el modo por defecto de los expertos — pero con más supervisión y revisión.",
    "note": "Documentos de reglas, conjuntos de evaluación, prevención de pérdidas y barreras de commit son todo gasto por adelantado — una fracción de lo que cuesta un rescate posterior."
  },
  "es-419": {
    "level": {
      "partial": "Parcial",
      "raw": "Sin supervisión",
      "engineered": "Supervisado y verificado"
    },
    "check": {
      "pillars": "Señales presentes",
      "reviews": "Revisiones",
      "critique": "Conexiones de crítica"
    },
    "heading": "Ingeniería agéntica",
    "desc": "La diferencia entre «programar con IA» y «operar agentes» está aquí. Programar mediante agentes pasó a ser el modo por defecto de los expertos — pero con más supervisión y revisión.",
    "note": "Documentos de reglas, conjuntos de evaluación, prevención de pérdidas y barreras de commit son todo gasto por adelantado — una fracción de lo que cuesta un rescate posterior."
  },
  "fr": {
    "level": {
      "partial": "Partiel",
      "raw": "Aucune supervision",
      "engineered": "Supervisé et vérifié"
    },
    "check": {
      "pillars": "Signaux présents",
      "reviews": "Revues",
      "critique": "Liens de critique"
    },
    "heading": "Ingénierie agentique",
    "desc": "La différence entre « coder avec l’IA » et « exploiter des agents » se situe ici. Programmer via des agents est devenu le défaut des experts — mais avec davantage de supervision et de relecture.",
    "note": "Documents de règles, jeux d’évaluation, prévention des pertes et barrières de commit sont autant de dépenses anticipées — une fraction de ce que coûte un sauvetage ultérieur."
  },
  "de": {
    "level": {
      "partial": "Teilweise",
      "raw": "Keine Aufsicht",
      "engineered": "Beaufsichtigt und geprüft"
    },
    "check": {
      "pillars": "Vorhandene Signale",
      "reviews": "Prüfungen",
      "critique": "Kritik-Kanten"
    },
    "heading": "Agentische Entwicklung",
    "desc": "Hier liegt der Unterschied zwischen „mit KI programmieren“ und „Agenten betreiben“. Programmieren über Agenten wurde zum Standard von Fachleuten — allerdings mit mehr Aufsicht und Nachprüfung.",
    "note": "Regeldokumente, Bewertungssets, Verlustschutz und Commit-Gates sind alles Vorabausgaben — ein Bruchteil dessen, was eine spätere Sanierung kostet."
  },
  "hi": {
    "level": {
      "partial": "आंशिक",
      "raw": "कोई पर्यवेक्षण नहीं",
      "engineered": "पर्यवेक्षित व सत्यापित"
    },
    "check": {
      "pillars": "मौजूद संकेत",
      "reviews": "समीक्षाएँ",
      "critique": "समीक्षा एज"
    },
    "heading": "एजेंटिक इंजीनियरिंग",
    "desc": "«AI से कोड बनाना» और «एजेंट चलाना» का फ़र्क़ यहीं है। एजेंट के ज़रिए प्रोग्रामिंग विशेषज्ञों का मानक तरीक़ा बन रहा है — पर ज़्यादा निगरानी और समीक्षा के साथ।",
    "note": "नियम-दस्तावेज़, मूल्यांकन-संग्रह, हानि-रोकथाम और commit-द्वार — ये सब पहले किया गया ख़र्च हैं, बाद के बचाव-कार्य की लागत का एक अंश।"
  },
  "id": {
    "level": {
      "partial": "Sebagian",
      "raw": "Tanpa pengawasan",
      "engineered": "Diawasi dan diverifikasi"
    },
    "check": {
      "pillars": "Sinyal ada",
      "reviews": "Tinjauan",
      "critique": "Edge kritik"
    },
    "heading": "Rekayasa agentik",
    "desc": "Perbedaan antara «membuat kode dengan AI» dan «mengoperasikan agen» ada di sini. Memprogram lewat agen menjadi cara baku para ahli — tetapi dengan lebih banyak pengawasan dan tinjauan.",
    "note": "Dokumen aturan, kumpulan evaluasi, pencegahan kehilangan, dan gerbang commit semuanya adalah belanja di muka — sepersekian dari ongkos penyelamatan di kemudian hari."
  },
  "it": {
    "level": {
      "partial": "Parziale",
      "raw": "Nessuna supervisione",
      "engineered": "Supervisionato e verificato"
    },
    "check": {
      "pillars": "Segnali presenti",
      "reviews": "Revisioni",
      "critique": "Collegamenti di critica"
    },
    "heading": "Ingegneria agentica",
    "desc": "La differenza tra «programmare con l’IA» e «far funzionare agenti» sta qui. Programmare tramite agenti è diventato lo standard degli esperti — ma con più supervisione e revisione.",
    "note": "Documenti di regole, insiemi di valutazione, prevenzione delle perdite e varchi di commit sono tutte spese anticipate — una frazione di quanto costa un recupero successivo."
  },
  "pt-BR": {
    "level": {
      "partial": "Parcial",
      "raw": "Sem supervisão",
      "engineered": "Supervisionado e verificado"
    },
    "check": {
      "pillars": "Sinais presentes",
      "reviews": "Revisões",
      "critique": "Conexões de crítica"
    },
    "heading": "Engenharia agêntica",
    "desc": "A diferença entre «programar com IA» e «operar agentes» está aqui. Programar por meio de agentes virou o padrão dos especialistas — mas com mais supervisão e revisão.",
    "note": "Documentos de regras, conjuntos de avaliação, prevenção de perdas e portões de commit são todos gasto antecipado — uma fração do que custa um resgate depois."
  }
} as const;
