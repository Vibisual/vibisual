/**
 * context-editing — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.contextEditing` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Instead of summarising, strip only old tool calls, results and thinking blocks by rule. It is the safest, least lossy form of compression — a finished tool result rarely needs to be seen again.",
    "heading": "Context Editing",
    "level": {
      "fresh": "Nothing to trim",
      "ok": "Fine for now",
      "due": "Worth trimming"
    },
    "check": {
      "turns": "Turns",
      "fill": "Window filled"
    },
    "note": "Try this before compaction — it is cheaper and less risky, and server-side implementations no longer break the prompt cache prefix."
  },
  "ko": {
    "desc": "요약하는 대신 오래된 도구 호출·결과·사고 블록만 규칙으로 걷어냅니다. 가장 안전하고 손실이 적은 압축이며, 처리가 끝난 도구 결과의 원문을 다시 볼 이유는 대개 없습니다.",
    "heading": "컨텍스트 편집",
    "level": {
      "fresh": "걷어낼 것 없음",
      "ok": "아직 괜찮음",
      "due": "걷어낼 때"
    },
    "check": {
      "turns": "턴 수",
      "fill": "창 채움"
    },
    "note": "컴팩션보다 먼저 시도해 보십시오 — 더 싸고 덜 위험하며, 서버 사이드 구현은 프롬프트 캐시 프리픽스도 깨지 않습니다."
  },
  "ja": {
    "check": {
      "turns": "ターン数",
      "fill": "ウィンドウ充填率"
    },
    "heading": "コンテキスト編集",
    "level": {
      "ok": "今は問題ない",
      "fresh": "削るものがない",
      "due": "削る価値あり"
    },
    "desc": "要約する代わりに、古いツール呼び出し・結果・思考ブロックだけを規則で取り除きます。最も安全で損失の少ない圧縮であり、処理の終わったツール結果の原文を再び見る理由は大抵ありません。",
    "note": "コンパクションより先に試してください — 安く危険も少なく、サーバー側の実装ならプロンプトキャッシュの前置きも壊しません。"
  },
  "zh-CN": {
    "check": {
      "turns": "轮次",
      "fill": "窗口占用"
    },
    "heading": "上下文编辑",
    "level": {
      "ok": "暂时没问题",
      "fresh": "无可精简",
      "due": "值得精简"
    },
    "desc": "不做摘要，而是按规则只剥离旧的工具调用、结果和思考块。这是最安全、损失最小的压缩形式 — 已经处理完的工具结果原文，通常没有再看的理由。",
    "note": "先试这个再考虑压缩 — 更便宜也更少风险，而且服务端实现不会破坏提示词缓存前缀。"
  },
  "es": {
    "check": {
      "turns": "Turnos",
      "fill": "Ventana ocupada"
    },
    "heading": "Edición de contexto",
    "level": {
      "ok": "Bien por ahora",
      "fresh": "Nada que recortar",
      "due": "Conviene recortar"
    },
    "desc": "En vez de resumir, retirar por regla solo llamadas, resultados y bloques de razonamiento antiguos. Es la forma de compresión más segura y con menos pérdida — el texto de un resultado ya procesado rara vez hace falta volver a verlo.",
    "note": "Prueba esto antes de la compactación — es más barato y menos arriesgado, y las implementaciones del lado servidor ya no rompen el prefijo de caché del prompt."
  },
  "es-419": {
    "check": {
      "turns": "Turnos",
      "fill": "Ventana ocupada"
    },
    "heading": "Edición de contexto",
    "level": {
      "ok": "Bien por ahora",
      "fresh": "Nada que recortar",
      "due": "Conviene recortar"
    },
    "desc": "En vez de resumir, retirar por regla solo llamadas, resultados y bloques de razonamiento antiguos. Es la forma de compresión más segura y con menos pérdida — el texto de un resultado ya procesado rara vez hace falta volver a verlo.",
    "note": "Prueba esto antes de la compactación — es más barato y menos arriesgado, y las implementaciones del lado servidor ya no rompen el prefijo de caché del prompt."
  },
  "fr": {
    "check": {
      "turns": "Tours",
      "fill": "Fenêtre remplie"
    },
    "heading": "Édition du contexte",
    "level": {
      "ok": "Correct pour l’instant",
      "fresh": "Rien à élaguer",
      "due": "Mérite d’être élagué"
    },
    "desc": "Au lieu de résumer, retirer par règle uniquement les anciens appels d’outils, résultats et blocs de réflexion. C’est la forme de compression la plus sûre et la moins destructrice — le texte d’un résultat d’outil déjà traité n’a que rarement besoin d’être revu.",
    "note": "Essayez cela avant la compaction — c’est moins cher et moins risqué, et les implémentations côté serveur ne cassent plus le préfixe de cache du prompt."
  },
  "de": {
    "check": {
      "turns": "Züge",
      "fill": "Fenster gefüllt"
    },
    "heading": "Kontextbearbeitung",
    "level": {
      "ok": "Vorerst in Ordnung",
      "fresh": "Nichts zu kürzen",
      "due": "Kürzen lohnt sich"
    },
    "desc": "Statt zusammenzufassen nur alte Werkzeugaufrufe, Ergebnisse und Denkblöcke nach Regeln entfernen. Es ist die sicherste, verlustärmste Form der Verdichtung — den Originaltext eines erledigten Werkzeugergebnisses muss man selten wiedersehen.",
    "note": "Probieren Sie das vor der Kompaktierung — es ist günstiger und weniger riskant, und serverseitige Umsetzungen brechen den Prompt-Cache-Präfix nicht mehr."
  },
  "hi": {
    "check": {
      "turns": "टर्न",
      "fill": "विंडो भरी"
    },
    "heading": "संदर्भ संपादन",
    "level": {
      "ok": "फ़िलहाल ठीक",
      "fresh": "छाँटने को कुछ नहीं",
      "due": "छाँटना उचित"
    },
    "desc": "सारांश बनाने के बजाय नियम से केवल पुरानी टूल-कॉल, नतीजे और तर्क-खंड गिराइए। यह संपीड़न का सबसे सुरक्षित और सबसे कम हानि वाला रूप है — पूरे हो चुके टूल-नतीजों का पाठ शायद ही दोबारा देखना पड़ता है।",
    "note": "संपीड़न से पहले यह आज़माइए — यह सस्ता और कम जोखिम भरा है, और सर्वर-पक्ष में लागू होने पर अब prompt cache का उपसर्ग भी नहीं तोड़ता।"
  },
  "id": {
    "check": {
      "turns": "Giliran",
      "fill": "Jendela terisi"
    },
    "heading": "Penyuntingan konteks",
    "level": {
      "ok": "Untuk sekarang cukup",
      "fresh": "Tak ada yang dipangkas",
      "due": "Layak dipangkas"
    },
    "desc": "Alih-alih meringkas, buang berdasarkan aturan hanya pemanggilan alat, hasil, dan blok penalaran yang lama. Ini bentuk pemampatan paling aman dan paling sedikit kehilangan — teks hasil alat yang sudah selesai jarang perlu dilihat lagi.",
    "note": "Coba ini sebelum pemadatan — lebih murah dan lebih kecil risikonya, dan implementasi di sisi server tidak lagi merusak awalan cache prompt."
  },
  "it": {
    "check": {
      "turns": "Turni",
      "fill": "Finestra riempita"
    },
    "heading": "Modifica del contesto",
    "level": {
      "ok": "Per ora va bene",
      "fresh": "Nulla da sfoltire",
      "due": "Vale sfoltire"
    },
    "desc": "Invece di riassumere, rimuovere per regola solo vecchie chiamate, risultati e blocchi di ragionamento. È la forma di compressione più sicura e meno lesiva — il testo di un risultato già elaborato raramente va rivisto.",
    "note": "Prova questo prima della compattazione — costa meno ed è meno rischioso, e le implementazioni lato server non rompono più il prefisso della cache del prompt."
  },
  "pt-BR": {
    "check": {
      "turns": "Turnos",
      "fill": "Janela preenchida"
    },
    "heading": "Edição de contexto",
    "level": {
      "ok": "Bom por enquanto",
      "fresh": "Nada a aparar",
      "due": "Vale aparar"
    },
    "desc": "Em vez de resumir, remover por regra apenas chamadas, resultados e blocos de raciocínio antigos. É a forma de compressão mais segura e com menos perda — o texto de um resultado já processado raramente precisa ser revisto.",
    "note": "Experimente isto antes da compactação — é mais barato e menos arriscado, e implementações no servidor já não quebram o prefixo de cache do prompt."
  }
} as const;
