/**
 * extended-thinking — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.extendedThinking` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Long deliberation before answering helps with planning, debugging and multi-step reasoning — but thinking tokens also occupy the window and get billed.",
    "heading": "Extended Thinking",
    "level": {
      "off": "Off",
      "on": "On",
      "onLoaded": "On, window filling"
    },
    "check": {
      "effort": "Effort",
      "context": "Context in use"
    },
    "note": "Whether to show the thinking to the user is a product decision — it builds trust, but wrong intermediate guesses read like settled conclusions.",
    "noteOn": "Deep thinking is on and the window is filling. In long sessions, clearing old thinking blocks becomes necessary rather than optional."
  },
  "ko": {
    "desc": "답을 내기 전 길게 숙고하는 모드는 계획·디버깅·다단 추론에 효과가 크지만, 사고 토큰도 창을 차지하고 과금됩니다.",
    "heading": "확장 사고",
    "level": {
      "off": "꺼짐",
      "on": "켜짐",
      "onLoaded": "켜짐 · 창이 차는 중"
    },
    "check": {
      "effort": "사고 깊이",
      "context": "사용 중 컨텍스트"
    },
    "note": "사고 내용을 사용자에게 보여줄지는 제품 결정입니다 — 신뢰가 오르지만, 중간의 틀린 추측이 확정된 결론처럼 읽히는 부작용이 있습니다.",
    "noteOn": "깊은 사고가 켜진 채 창이 차고 있습니다. 긴 세션에서는 지난 사고 블록을 걷어내는 것이 선택이 아니라 필수가 됩니다."
  },
  "ja": {
    "check": {
      "effort": "思考の深さ",
      "context": "使用中のコンテキスト"
    },
    "heading": "拡張思考",
    "level": {
      "off": "オフ",
      "on": "オン",
      "onLoaded": "オン・ウィンドウ充填中"
    },
    "desc": "答える前に長く熟考するモードは、計画・デバッグ・多段推論で効果が大きい一方、思考トークンもウィンドウを占め、課金されます。",
    "note": "思考内容を利用者に見せるかは製品判断です — 信頼は上がりますが、途中の誤った推測が確定した結論のように読まれる副作用があります。",
    "noteOn": "深い思考が入ったままウィンドウが埋まりつつあります。長いセッションでは、過去の思考ブロックを片付けることが選択ではなく必須になります。"
  },
  "zh-CN": {
    "check": {
      "effort": "思考强度",
      "context": "使用中的上下文"
    },
    "heading": "扩展思考",
    "level": {
      "off": "关闭",
      "on": "开启",
      "onLoaded": "开启·窗口渐满"
    },
    "desc": "回答前长时间深思，在规划、调试和多步推理上效果显著 — 但思考令牌同样占用窗口并计费。",
    "note": "是否把思考过程展示给用户是产品决策 — 它能提升信任，但中间的错误猜测会被读成已定结论。",
    "noteOn": "深度思考开着，窗口正在被填满。长会话中，清理旧的思考块会从可选变成必须。"
  },
  "es": {
    "check": {
      "effort": "Esfuerzo",
      "context": "Contexto en uso"
    },
    "heading": "Pensamiento extendido",
    "level": {
      "off": "Desactivado",
      "on": "Activado",
      "onLoaded": "Activado, ventana llenándose"
    },
    "desc": "Deliberar largo antes de responder ayuda en planificación, depuración y razonamiento de varios pasos — pero los tokens de razonamiento también ocupan la ventana y se facturan.",
    "note": "Mostrar o no el razonamiento al usuario es una decisión de producto — genera confianza, pero las conjeturas intermedias erróneas se leen como conclusiones firmes.",
    "noteOn": "El razonamiento profundo está activo y la ventana se llena. En sesiones largas, limpiar bloques antiguos de razonamiento pasa de opcional a necesario."
  },
  "es-419": {
    "check": {
      "effort": "Esfuerzo",
      "context": "Contexto en uso"
    },
    "heading": "Pensamiento extendido",
    "level": {
      "off": "Desactivado",
      "on": "Activado",
      "onLoaded": "Activado, ventana llenándose"
    },
    "desc": "Deliberar largo antes de responder ayuda en planificación, depuración y razonamiento de varios pasos — pero los tokens de razonamiento también ocupan la ventana y se facturan.",
    "note": "Mostrar o no el razonamiento al usuario es una decisión de producto — genera confianza, pero las conjeturas intermedias erróneas se leen como conclusiones firmes.",
    "noteOn": "El razonamiento profundo está activo y la ventana se llena. En sesiones largas, limpiar bloques antiguos de razonamiento pasa de opcional a necesario."
  },
  "fr": {
    "check": {
      "effort": "Effort",
      "context": "Contexte utilisé"
    },
    "heading": "Réflexion étendue",
    "level": {
      "off": "Désactivé",
      "on": "Activé",
      "onLoaded": "Activé, fenêtre se remplit"
    },
    "desc": "Délibérer longuement avant de répondre aide pour la planification, le débogage et le raisonnement en plusieurs étapes — mais les jetons de réflexion occupent aussi la fenêtre et sont facturés.",
    "note": "Montrer ou non la réflexion à l’utilisateur est une décision produit — cela inspire confiance, mais les suppositions intermédiaires fausses se lisent comme des conclusions arrêtées.",
    "noteOn": "La réflexion profonde est active et la fenêtre se remplit. Sur les longues sessions, purger les anciens blocs de réflexion devient nécessaire et non optionnel."
  },
  "de": {
    "check": {
      "effort": "Denkaufwand",
      "context": "Genutzter Kontext"
    },
    "heading": "Erweitertes Denken",
    "level": {
      "off": "Aus",
      "on": "An",
      "onLoaded": "An, Fenster füllt sich"
    },
    "desc": "Langes Abwägen vor der Antwort hilft bei Planung, Fehlersuche und mehrstufigem Schließen — aber Denk-Tokens belegen ebenfalls das Fenster und werden abgerechnet.",
    "note": "Ob man das Denken zeigt, ist eine Produktentscheidung — es schafft Vertrauen, doch falsche Zwischenvermutungen lesen sich wie feststehende Schlüsse.",
    "noteOn": "Tiefes Denken ist an und das Fenster füllt sich. In langen Sitzungen wird das Entfernen alter Denkblöcke von der Option zur Notwendigkeit."
  },
  "hi": {
    "check": {
      "effort": "प्रयास",
      "context": "उपयोग में संदर्भ"
    },
    "heading": "विस्तारित चिंतन",
    "level": {
      "off": "बंद",
      "on": "चालू",
      "onLoaded": "चालू · विंडो भर रही"
    },
    "desc": "उत्तर से पहले लंबा तौलना योजना, दोष-खोज और चरणबद्ध तर्क में मदद करता है — पर तर्क-टोकन भी खिड़की खाते हैं और बिल में गिने जाते हैं।",
    "note": "तर्क उपयोगकर्ता को दिखाएँ या नहीं, यह उत्पाद का निर्णय है — इससे भरोसा बढ़ता है, पर बीच के ग़लत अनुमान अंतिम निष्कर्ष जैसे पढ़े जाते हैं।",
    "noteOn": "गहरा तर्क चालू है और खिड़की भरने लगी है। लंबे सत्र में पुराने तर्क-खंड साफ़ करना विकल्प से ज़रूरत बन जाता है।"
  },
  "id": {
    "check": {
      "effort": "Upaya",
      "context": "Konteks terpakai"
    },
    "heading": "Pemikiran diperluas",
    "level": {
      "off": "Mati",
      "on": "Aktif",
      "onLoaded": "Aktif, jendela terisi"
    },
    "desc": "Menimbang lama sebelum menjawab membantu pada perencanaan, penelusuran galat, dan penalaran bertahap — tetapi token penalaran juga memakan jendela dan ditagih.",
    "note": "Menampilkan penalaran kepada pengguna atau tidak adalah keputusan produk — ia menumbuhkan kepercayaan, tetapi tebakan antara yang salah terbaca seperti kesimpulan final.",
    "noteOn": "Penalaran dalam sedang menyala dan jendela mulai penuh. Pada sesi panjang, membersihkan blok penalaran lama berubah dari pilihan menjadi keharusan."
  },
  "it": {
    "check": {
      "effort": "Sforzo",
      "context": "Contesto in uso"
    },
    "heading": "Pensiero esteso",
    "level": {
      "off": "Disattivato",
      "on": "Attivato",
      "onLoaded": "Attivo, finestra in riempimento"
    },
    "desc": "Deliberare a lungo prima di rispondere aiuta in pianificazione, debug e ragionamento a più passi — ma i token di ragionamento occupano anch’essi la finestra e vengono fatturati.",
    "note": "Mostrare o no il ragionamento all’utente è una decisione di prodotto — genera fiducia, ma le congetture intermedie sbagliate si leggono come conclusioni definitive.",
    "noteOn": "Il ragionamento profondo è attivo e la finestra si sta riempiendo. Nelle sessioni lunghe, ripulire i vecchi blocchi di ragionamento passa da facoltativo a necessario."
  },
  "pt-BR": {
    "check": {
      "effort": "Esforço",
      "context": "Contexto em uso"
    },
    "heading": "Pensamento estendido",
    "level": {
      "off": "Desligado",
      "on": "Ligado",
      "onLoaded": "Ligado, janela enchendo"
    },
    "desc": "Deliberar longamente antes de responder ajuda em planejamento, depuração e raciocínio em várias etapas — mas os tokens de raciocínio também ocupam a janela e são cobrados.",
    "note": "Mostrar ou não o raciocínio ao usuário é decisão de produto — gera confiança, mas palpites intermediários errados são lidos como conclusões firmes.",
    "noteOn": "O raciocínio profundo está ligado e a janela está enchendo. Em sessões longas, limpar blocos antigos de raciocínio passa de opcional a necessário."
  }
} as const;
