/**
 * rag — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.rag` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows what evidence was actually pulled in for this agent. In Vibisual that channel is Project Brain, so the card counts the cards that arrived rather than guessing at retrieval quality.",
    "heading": "RAG",
    "level": {
      "none": "No evidence pulled",
      "grounded": "Evidence pulled"
    },
    "check": {
      "cards": "Cards pulled",
      "events": "Retrievals",
      "recent": "Most recent"
    },
    "note": "Retrieval cannot fix a confidently wrong source — it will faithfully fetch the wrong thing."
  },
  "ko": {
    "desc": "이 에이전트에 실제로 어떤 근거가 들어왔는지 보여줍니다. Vibisual 에서 그 통로는 Project Brain 이므로, 검색 품질을 추측하는 대신 도착한 카드를 셉니다.",
    "heading": "검색 증강",
    "level": {
      "none": "끌어온 근거 없음",
      "grounded": "근거 들어옴"
    },
    "check": {
      "cards": "끌어온 카드",
      "events": "검색 횟수",
      "recent": "가장 최근"
    },
    "note": "확신에 찬 틀린 출처는 검색으로 못 고칩니다 — 검색이 틀린 것을 성실하게 찾아다 주기 때문입니다."
  },
  "ja": {
    "check": {
      "recent": "最新",
      "cards": "取り込んだカード",
      "events": "検索回数"
    },
    "heading": "RAG",
    "level": {
      "none": "根拠の取得なし",
      "grounded": "根拠を取得"
    },
    "desc": "このエージェントに実際どんな根拠が入ってきたかを示します。Vibisual ではその経路が Project Brain なので、検索品質を推測する代わりに到着したカードを数えます。",
    "note": "自信のある誤った出所は検索では直せません — 検索は間違ったものを忠実に探してくるからです。"
  },
  "zh-CN": {
    "check": {
      "recent": "最近一次",
      "cards": "拉取的卡片",
      "events": "检索次数"
    },
    "heading": "RAG",
    "level": {
      "none": "未拉取证据",
      "grounded": "已拉取证据"
    },
    "desc": "显示这个智能体实际拉进来了哪些依据。在 Vibisual 中这条通路是 Project Brain，所以卡片统计的是到达的卡片数，而不是去猜检索质量。",
    "note": "自信却错误的来源，靠检索修不好 — 检索只会忠实地把错的东西找回来。"
  },
  "es": {
    "check": {
      "recent": "Más reciente",
      "cards": "Tarjetas traídas",
      "events": "Recuperaciones"
    },
    "heading": "RAG",
    "level": {
      "none": "Sin evidencia traída",
      "grounded": "Evidencia traída"
    },
    "desc": "Muestra qué evidencia se trajo realmente para este agente. En Vibisual ese canal es Project Brain, así que la tarjeta cuenta las tarjetas que llegaron en vez de adivinar la calidad de la búsqueda.",
    "note": "Una fuente equivocada pero segura de sí no se arregla con búsqueda — la búsqueda traerá fielmente lo equivocado."
  },
  "es-419": {
    "check": {
      "recent": "Más reciente",
      "cards": "Tarjetas traídas",
      "events": "Recuperaciones"
    },
    "heading": "RAG",
    "level": {
      "none": "Sin evidencia traída",
      "grounded": "Evidencia traída"
    },
    "desc": "Muestra qué evidencia se trajo realmente para este agente. En Vibisual ese canal es Project Brain, así que la tarjeta cuenta las tarjetas que llegaron en vez de adivinar la calidad de la búsqueda.",
    "note": "Una fuente equivocada pero segura de sí no se arregla con búsqueda — la búsqueda traerá fielmente lo equivocado."
  },
  "fr": {
    "check": {
      "recent": "Le plus récent",
      "cards": "Cartes récupérées",
      "events": "Récupérations"
    },
    "heading": "RAG",
    "level": {
      "none": "Aucune preuve récupérée",
      "grounded": "Preuves récupérées"
    },
    "desc": "Montre quelles preuves ont réellement été apportées à cet agent. Dans Vibisual ce canal est Project Brain, la carte compte donc les cartes arrivées plutôt que de deviner la qualité de la recherche.",
    "note": "Une source fausse mais assurée ne se corrige pas par la recherche — celle-ci ira chercher fidèlement la mauvaise chose."
  },
  "de": {
    "check": {
      "recent": "Zuletzt",
      "cards": "Abgerufene Karten",
      "events": "Abrufe"
    },
    "heading": "RAG",
    "level": {
      "none": "Keine Belege abgerufen",
      "grounded": "Belege abgerufen"
    },
    "desc": "Zeigt, welche Belege tatsächlich für diesen Agenten herangezogen wurden. In Vibisual ist dieser Kanal das Project Brain, deshalb zählt die Karte die angekommenen Karten, statt die Suchqualität zu erraten.",
    "note": "Eine selbstsicher falsche Quelle lässt sich nicht durch Suche beheben — die Suche holt das Falsche gewissenhaft herbei."
  },
  "hi": {
    "check": {
      "recent": "सबसे हाल का",
      "cards": "लाए गए कार्ड",
      "events": "पुनर्प्राप्तियाँ"
    },
    "heading": "RAG",
    "level": {
      "none": "कोई साक्ष्य नहीं लाया",
      "grounded": "साक्ष्य लाया"
    },
    "desc": "दिखाता है कि इस एजेंट के लिए सचमुच कौन-सा प्रमाण खींचा गया। Vibisual में वह रास्ता Project Brain है, इसलिए यह कार्ड खोज की गुणवत्ता का अनुमान लगाने के बजाय आए हुए कार्ड गिनता है।",
    "note": "आत्मविश्वास से भरा ग़लत स्रोत खोज से ठीक नहीं होता — खोज ईमानदारी से वही ग़लत चीज़ ले आएगी।"
  },
  "id": {
    "check": {
      "recent": "Terbaru",
      "cards": "Kartu ditarik",
      "events": "Pengambilan"
    },
    "heading": "RAG",
    "level": {
      "none": "Tidak menarik bukti",
      "grounded": "Bukti ditarik"
    },
    "desc": "Menunjukkan bukti apa yang benar-benar ditarik untuk agen ini. Di Vibisual salurannya adalah Project Brain, jadi kartu ini menghitung kartu yang datang alih-alih menebak mutu pencarian.",
    "note": "Sumber yang salah tapi yakin tak bisa diperbaiki dengan pencarian — pencarian akan setia mengambil yang keliru."
  },
  "it": {
    "check": {
      "recent": "Più recente",
      "cards": "Schede recuperate",
      "events": "Recuperi"
    },
    "heading": "RAG",
    "level": {
      "none": "Nessuna prova recuperata",
      "grounded": "Prove recuperate"
    },
    "desc": "Mostra quali prove sono state effettivamente portate a questo agente. In Vibisual quel canale è Project Brain, quindi la scheda conta le schede arrivate invece di indovinare la qualità della ricerca.",
    "note": "Una fonte sbagliata ma sicura di sé non si corregge con la ricerca — la ricerca andrà a prendere fedelmente la cosa sbagliata."
  },
  "pt-BR": {
    "check": {
      "recent": "Mais recente",
      "cards": "Cartões trazidos",
      "events": "Recuperações"
    },
    "heading": "RAG",
    "level": {
      "none": "Nenhuma evidência trazida",
      "grounded": "Evidências trazidas"
    },
    "desc": "Mostra quais evidências foram de fato trazidas para este agente. No Vibisual esse canal é o Project Brain, então o cartão conta os cartões que chegaram em vez de adivinhar a qualidade da busca.",
    "note": "Uma fonte errada e confiante não se conserta com busca — a busca vai trazer fielmente a coisa errada."
  }
} as const;
