/**
 * tool-use — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.toolUse` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows how much of the context window the tool definitions alone take. Past a few dozen tools the definitions cost tens of thousands of tokens and selection accuracy drops with them.",
    "heading": "Tool Use",
    "level": {
      "lean": "Lean",
      "moderate": "Moderate",
      "all": "Everything loaded"
    },
    "check": {
      "count": "Tools",
      "tokens": "Schema tokens",
      "share": "Share of window"
    },
    "note": "Removing tools this agent never uses improves cost and selection accuracy at the same time."
  },
  "ko": {
    "desc": "도구 정의만으로 컨텍스트 창을 얼마나 먹고 있는지 보여줍니다. 도구가 수십 개를 넘어가면 정의만으로 수만 토큰이 되고, 모델의 도구 선택 정확도도 함께 떨어집니다.",
    "heading": "도구 사용",
    "level": {
      "lean": "적게 쥠",
      "moderate": "보통",
      "all": "전부 실림"
    },
    "check": {
      "count": "도구 수",
      "tokens": "스키마 토큰",
      "share": "창에서 차지하는 몫"
    },
    "note": "이 에이전트가 쓰지 않는 도구를 걷어내면 비용과 선택 정확도가 동시에 좋아집니다."
  },
  "ja": {
    "level": {
      "lean": "絞られている",
      "moderate": "中程度",
      "all": "すべて読み込み"
    },
    "check": {
      "count": "ツール",
      "tokens": "スキーマトークン",
      "share": "ウィンドウ占有率"
    },
    "heading": "ツール使用",
    "desc": "ツール定義だけでコンテキストウィンドウをどれだけ食っているかを示します。ツールが数十を超えると定義だけで数万トークンになり、モデルのツール選択精度も一緒に落ちます。",
    "note": "このエージェントが使わないツールを外すだけで、費用と選択精度が同時に良くなります。"
  },
  "zh-CN": {
    "level": {
      "lean": "精简",
      "moderate": "中等",
      "all": "全部载入"
    },
    "check": {
      "count": "工具",
      "tokens": "模式令牌",
      "share": "占窗口比例"
    },
    "heading": "工具使用",
    "desc": "显示仅工具定义就占了多少上下文窗口。工具超过数十个后，光定义就是数万令牌，模型的工具选择准确率也会随之下降。",
    "note": "仅仅移除这个智能体用不到的工具，就能同时改善成本与选择准确率。"
  },
  "es": {
    "level": {
      "lean": "Ajustado",
      "moderate": "Moderado",
      "all": "Todo cargado"
    },
    "check": {
      "count": "Herramientas",
      "tokens": "Tokens de esquema",
      "share": "Parte de la ventana"
    },
    "heading": "Uso de herramientas",
    "desc": "Muestra cuánta ventana de contexto ocupan solo las definiciones de herramientas. Pasadas unas decenas, las definiciones cuestan decenas de miles de tokens y la precisión de selección cae con ellas.",
    "note": "Quitar las herramientas que este agente nunca usa mejora a la vez el coste y la precisión de selección."
  },
  "es-419": {
    "level": {
      "lean": "Ajustado",
      "moderate": "Moderado",
      "all": "Todo cargado"
    },
    "check": {
      "count": "Herramientas",
      "tokens": "Tokens de esquema",
      "share": "Parte de la ventana"
    },
    "heading": "Uso de herramientas",
    "desc": "Muestra cuánta ventana de contexto ocupan solo las definiciones de herramientas. Pasadas unas decenas, las definiciones cuestan decenas de miles de tokens y la precisión de selección cae con ellas.",
    "note": "Quitar las herramientas que este agente nunca usa mejora a la vez el coste y la precisión de selección."
  },
  "fr": {
    "level": {
      "lean": "Restreint",
      "moderate": "Modéré",
      "all": "Tout chargé"
    },
    "check": {
      "count": "Outils",
      "tokens": "Jetons de schéma",
      "share": "Part de la fenêtre"
    },
    "heading": "Usage des outils",
    "desc": "Montre quelle part de la fenêtre de contexte les seules définitions d’outils occupent. Au-delà de quelques dizaines d’outils, les définitions coûtent des dizaines de milliers de jetons et la justesse de sélection baisse avec elles.",
    "note": "Retirer les outils que cet agent n’utilise jamais améliore à la fois le coût et la justesse de sélection."
  },
  "de": {
    "level": {
      "lean": "Schlank",
      "moderate": "Mittel",
      "all": "Alles geladen"
    },
    "check": {
      "count": "Werkzeuge",
      "tokens": "Schema-Tokens",
      "share": "Anteil am Fenster"
    },
    "heading": "Werkzeugnutzung",
    "desc": "Zeigt, wie viel vom Kontextfenster allein die Werkzeugdefinitionen belegen. Jenseits einiger Dutzend Werkzeuge kosten die Definitionen Zehntausende Tokens, und die Auswahlgenauigkeit sinkt mit.",
    "note": "Schon das Entfernen nie genutzter Werkzeuge verbessert Kosten und Auswahlgenauigkeit zugleich."
  },
  "hi": {
    "level": {
      "lean": "सीमित",
      "moderate": "मध्यम",
      "all": "सब लोड"
    },
    "check": {
      "count": "टूल",
      "tokens": "स्कीमा टोकन",
      "share": "विंडो का हिस्सा"
    },
    "heading": "टूल उपयोग",
    "desc": "दिखाता है कि अकेली टूल-परिभाषाएँ संदर्भ-खिड़की का कितना हिस्सा खाती हैं। कुछ दर्जन टूल के बाद परिभाषाएँ दसियों हज़ार टोकन ले लेती हैं और चुनाव की सटीकता भी गिरती है।",
    "note": "जो टूल यह एजेंट कभी नहीं छूता उन्हें हटाने से लागत और चुनाव की सटीकता, दोनों एक साथ सुधरते हैं।"
  },
  "id": {
    "level": {
      "lean": "Ramping",
      "moderate": "Sedang",
      "all": "Semua dimuat"
    },
    "check": {
      "count": "Alat",
      "tokens": "Token skema",
      "share": "Porsi jendela"
    },
    "heading": "Penggunaan alat",
    "desc": "Menunjukkan berapa banyak jendela konteks yang dipakai definisi alat saja. Lewat beberapa puluh alat, definisinya menghabiskan puluhan ribu token dan ketepatan pemilihan ikut turun.",
    "note": "Menghapus alat yang tak pernah dipakai agen ini memperbaiki biaya dan ketepatan pemilihan sekaligus."
  },
  "it": {
    "level": {
      "lean": "Ristretto",
      "moderate": "Moderato",
      "all": "Tutto caricato"
    },
    "check": {
      "count": "Strumenti",
      "tokens": "Token dello schema",
      "share": "Quota della finestra"
    },
    "heading": "Uso degli strumenti",
    "desc": "Mostra quanta finestra di contesto occupano le sole definizioni degli strumenti. Oltre qualche decina, le definizioni costano decine di migliaia di token e la precisione di selezione cala con loro.",
    "note": "Togliere gli strumenti che questo agente non usa mai migliora insieme costo e precisione di selezione."
  },
  "pt-BR": {
    "level": {
      "lean": "Enxuto",
      "moderate": "Moderado",
      "all": "Tudo carregado"
    },
    "check": {
      "count": "Ferramentas",
      "tokens": "Tokens de esquema",
      "share": "Parte da janela"
    },
    "heading": "Uso de ferramentas",
    "desc": "Mostra quanto da janela de contexto só as definições de ferramentas ocupam. Passadas algumas dezenas, as definições custam dezenas de milhares de tokens e a precisão de seleção cai junto.",
    "note": "Remover as ferramentas que este agente nunca usa melhora custo e precisão de seleção ao mesmo tempo."
  }
} as const;
