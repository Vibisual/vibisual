/**
 * chunking — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.chunking` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Split too finely and context breaks; keep chunks too large and unrelated content rides along. In Vibisual one memory card is one chunk, so card size is the quality knob.",
    "heading": "Chunking",
    "level": {
      "none": "No memory yet",
      "perCard": "One card per chunk"
    },
    "check": {
      "cards": "Cards",
      "unit": "Chunk unit"
    },
    "card": "one memory card",
    "note": "Because topics group the cards, chunk boundaries do not need separate tuning here — writing one idea per card does that job."
  },
  "ko": {
    "desc": "너무 잘게 나누면 맥락이 끊기고 너무 크면 무관한 내용이 딸려 옵니다. Vibisual 에서는 기억 카드 한 장이 곧 한 덩어리라, 카드 크기가 품질 손잡이입니다.",
    "heading": "청킹",
    "level": {
      "none": "아직 기억 없음",
      "perCard": "카드 하나가 한 덩어리"
    },
    "check": {
      "cards": "카드 수",
      "unit": "덩어리 단위"
    },
    "card": "기억 카드 한 장",
    "note": "주제가 카드를 묶어 주므로 경계를 따로 조율할 필요가 없습니다 — 카드 하나에 한 가지만 적는 것이 그 일을 합니다."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "perCard": "カード1枚が1塊"
    },
    "check": {
      "cards": "カード数",
      "unit": "分割の単位"
    },
    "heading": "チャンク分割",
    "card": "記憶カード1枚",
    "desc": "細かく分けすぎれば文脈が切れ、大きすぎれば無関係な内容が一緒に付いてきます。Vibisual では記憶カード 1 枚が 1 塊なので、カードの大きさが品質のつまみです。",
    "note": "主題がカードをまとめてくれるので、ここでは境界を別途調整する必要がありません — カード 1 枚に 1 つのことだけ書くのがその役目を果たします。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "perCard": "一卡即一块"
    },
    "check": {
      "cards": "卡片数",
      "unit": "分块单位"
    },
    "heading": "分块",
    "card": "一张记忆卡片",
    "desc": "切得太碎会断掉上下文，块太大又会把无关内容一起带上。在 Vibisual 中一张记忆卡片就是一个块，所以卡片大小就是质量旋钮。",
    "note": "主题会把卡片归拢，所以这里不需要单独调整块边界 — 一张卡片只写一件事就完成了这项工作。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "perCard": "Una tarjeta por fragmento"
    },
    "check": {
      "cards": "Tarjetas",
      "unit": "Unidad de fragmento"
    },
    "heading": "Fragmentación",
    "card": "una tarjeta de memoria",
    "desc": "Partido demasiado fino se rompe el contexto; con bloques demasiado grandes viaja contenido ajeno. En Vibisual una tarjeta de memoria es un bloque, así que el tamaño de la tarjeta es la perilla de calidad.",
    "note": "Como los temas agrupan las tarjetas, aquí las fronteras de bloque no necesitan ajuste aparte — escribir una idea por tarjeta ya hace ese trabajo."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "perCard": "Una tarjeta por fragmento"
    },
    "check": {
      "cards": "Tarjetas",
      "unit": "Unidad de fragmento"
    },
    "heading": "Fragmentación",
    "card": "una tarjeta de memoria",
    "desc": "Partido demasiado fino se rompe el contexto; con bloques demasiado grandes viaja contenido ajeno. En Vibisual una tarjeta de memoria es un bloque, así que el tamaño de la tarjeta es la perilla de calidad.",
    "note": "Como los temas agrupan las tarjetas, aquí las fronteras de bloque no necesitan ajuste aparte — escribir una idea por tarjeta ya hace ese trabajo."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "perCard": "Une carte par bloc"
    },
    "check": {
      "cards": "Cartes",
      "unit": "Unité de découpage"
    },
    "heading": "Découpage",
    "card": "une carte mémoire",
    "desc": "Trop finement découpé, le contexte se rompt ; des blocs trop grands entraînent du hors-sujet. Dans Vibisual une carte mémoire est un bloc : la taille de la carte est donc le curseur de qualité.",
    "note": "Comme les thèmes regroupent les cartes, les frontières de blocs n’ont pas besoin d’un réglage à part — écrire une idée par carte y suffit."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "perCard": "Eine Karte pro Chunk"
    },
    "check": {
      "cards": "Karten",
      "unit": "Chunk-Einheit"
    },
    "heading": "Chunking",
    "card": "eine Gedächtniskarte",
    "desc": "Zu fein geteilt bricht der Zusammenhang; zu große Blöcke schleppen Unbeteiligtes mit. In Vibisual ist eine Gedächtniskarte ein Block, die Kartengröße ist also der Qualitätsregler.",
    "note": "Weil Themen die Karten gruppieren, müssen Blockgrenzen hier nicht eigens abgestimmt werden — eine Idee pro Karte zu schreiben erledigt das."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "perCard": "एक कार्ड प्रति चंक"
    },
    "check": {
      "cards": "कार्ड",
      "unit": "चंक इकाई"
    },
    "heading": "चंकिंग",
    "card": "एक स्मृति कार्ड",
    "desc": "बहुत बारीक काटा जाए तो संदर्भ टूट जाता है; बहुत बड़ा खंड असंबद्ध चीज़ें साथ ले आता है। Vibisual में एक स्मृति-कार्ड ही एक खंड है, इसलिए कार्ड का आकार ही गुणवत्ता की घुंडी है।",
    "note": "चूँकि विषय ही कार्डों को समूह में बाँधता है, यहाँ खंड की सीमा अलग से सेट करने की ज़रूरत नहीं — प्रति कार्ड एक विचार लिखना वही काम कर देता है।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "perCard": "Satu kartu per potongan"
    },
    "check": {
      "cards": "Kartu",
      "unit": "Satuan potongan"
    },
    "heading": "Pemotongan",
    "card": "satu kartu memori",
    "desc": "Dipotong terlalu halus, konteksnya putus; blok terlalu besar membawa serta hal yang tak berkaitan. Di Vibisual satu kartu memori adalah satu potongan, jadi ukuran kartu itulah tombol mutunya.",
    "note": "Karena topik mengelompokkan kartu, batas potongan di sini tak perlu disetel terpisah — menulis satu gagasan per kartu sudah melakukan tugas itu."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "perCard": "Una scheda per blocco"
    },
    "check": {
      "cards": "Schede",
      "unit": "Unità di suddivisione"
    },
    "heading": "Suddivisione",
    "card": "una scheda di memoria",
    "desc": "Diviso troppo finemente il contesto si spezza; con blocchi troppo grandi arriva contenuto estraneo. In Vibisual una scheda di memoria è un blocco, quindi la dimensione della scheda è la manopola della qualità.",
    "note": "Poiché i temi raggruppano le schede, qui i confini dei blocchi non richiedono una regolazione a parte — scrivere un’idea per scheda fa già quel lavoro."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "perCard": "Um cartão por fragmento"
    },
    "check": {
      "cards": "Cartões",
      "unit": "Unidade de fragmento"
    },
    "heading": "Fragmentação",
    "card": "um cartão de memória",
    "desc": "Dividido fino demais o contexto se rompe; com blocos grandes demais vem conteúdo alheio junto. No Vibisual um cartão de memória é um bloco, então o tamanho do cartão é o botão de qualidade.",
    "note": "Como os temas agrupam os cartões, aqui as fronteiras de bloco não precisam de ajuste à parte — escrever uma ideia por cartão já faz esse trabalho."
  }
} as const;
