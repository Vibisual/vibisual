/**
 * eval — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.eval` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Agents are non-deterministic, so a single run is not evidence — the same input has to be looked at as a distribution. This counts how often an instruction was actually repeated.",
    "heading": "Eval",
    "level": {
      "none": "No instructions yet",
      "single": "Single runs only",
      "repeated": "Repeated runs"
    },
    "check": {
      "unique": "Distinct instructions",
      "repeated": "Repeated"
    },
    "note": "Whatever can be checked deterministically — format, schema, required fields, forbidden words — is cheaper and more accurate in code than through a judge model."
  },
  "ko": {
    "desc": "에이전트는 비결정적이라 한 번 돌려 본 결과는 증거가 되지 못합니다 — 같은 입력을 여러 번 돌린 분포로 봐야 합니다. 여기서는 같은 지시가 실제로 몇 번 반복됐는지 셉니다.",
    "heading": "평가",
    "level": {
      "none": "아직 지시 없음",
      "single": "한 번씩만",
      "repeated": "반복 실행 있음"
    },
    "check": {
      "unique": "서로 다른 지시",
      "repeated": "반복된 것"
    },
    "note": "형식·스키마·필수 필드·금지어처럼 결정적으로 검사할 수 있는 것은 심판 모델보다 코드로 검사하는 편이 싸고 정확합니다."
  },
  "ja": {
    "check": {
      "repeated": "繰り返し",
      "unique": "異なる指示"
    },
    "heading": "評価",
    "level": {
      "none": "まだ指示なし",
      "single": "一回ずつのみ",
      "repeated": "繰り返し実行あり"
    },
    "desc": "エージェントは非決定的なので、一度回した結果は証拠になりません — 同じ入力を何度も回した分布で見る必要があります。ここでは同じ指示が実際に何度繰り返されたかを数えます。",
    "note": "形式・スキーマ・必須項目・禁止語のように決定的に検査できるものは、審判モデルよりコードで検査する方が安く正確です。"
  },
  "zh-CN": {
    "check": {
      "repeated": "重复",
      "unique": "不同指令"
    },
    "heading": "评估",
    "level": {
      "none": "尚无指令",
      "single": "仅单次运行",
      "repeated": "有重复运行"
    },
    "desc": "智能体是非确定性的，跑一次的结果不构成证据 — 需要把同一输入的多次运行当作分布来看。这里统计同一条指令实际被重复了多少次。",
    "note": "格式、模式、必填字段、禁用词这类能确定性检查的东西，用代码检查比用裁判模型更便宜也更准确。"
  },
  "es": {
    "check": {
      "repeated": "Repetido",
      "unique": "Instrucciones distintas"
    },
    "heading": "Evaluación",
    "level": {
      "none": "Sin instrucciones aún",
      "single": "Solo ejecuciones únicas",
      "repeated": "Ejecuciones repetidas"
    },
    "desc": "Los agentes no son deterministas, así que una sola ejecución no es prueba — la misma entrada hay que verla como distribución. Aquí se cuenta cuántas veces se repitió realmente una instrucción.",
    "note": "Lo que se puede comprobar de forma determinista — formato, esquema, campos obligatorios, palabras prohibidas — sale más barato y exacto en código que con un modelo juez."
  },
  "es-419": {
    "check": {
      "repeated": "Repetido",
      "unique": "Instrucciones distintas"
    },
    "heading": "Evaluación",
    "level": {
      "none": "Sin instrucciones aún",
      "single": "Solo ejecuciones únicas",
      "repeated": "Ejecuciones repetidas"
    },
    "desc": "Los agentes no son deterministas, así que una sola ejecución no es prueba — la misma entrada hay que verla como distribución. Aquí se cuenta cuántas veces se repitió realmente una instrucción.",
    "note": "Lo que se puede comprobar de forma determinista — formato, esquema, campos obligatorios, palabras prohibidas — sale más barato y exacto en código que con un modelo juez."
  },
  "fr": {
    "check": {
      "repeated": "Répété",
      "unique": "Instructions distinctes"
    },
    "heading": "Évaluation",
    "level": {
      "none": "Pas encore d’instructions",
      "single": "Exécutions uniques",
      "repeated": "Exécutions répétées"
    },
    "desc": "Les agents ne sont pas déterministes : un seul passage ne fait pas preuve — la même entrée doit être vue comme une distribution. On compte ici combien de fois une instruction a réellement été répétée.",
    "note": "Tout ce qui se vérifie de façon déterministe — format, schéma, champs requis, mots interdits — coûte moins cher et est plus juste en code qu’avec un modèle juge."
  },
  "de": {
    "check": {
      "repeated": "Wiederholt",
      "unique": "Verschiedene Anweisungen"
    },
    "heading": "Bewertung",
    "level": {
      "none": "Noch keine Anweisungen",
      "single": "Nur Einzelläufe",
      "repeated": "Wiederholte Läufe"
    },
    "desc": "Agenten sind nicht deterministisch, ein einzelner Lauf ist also kein Beleg — dieselbe Eingabe muss als Verteilung betrachtet werden. Hier wird gezählt, wie oft eine Anweisung tatsächlich wiederholt wurde.",
    "note": "Was deterministisch prüfbar ist — Format, Schema, Pflichtfelder, verbotene Wörter — ist im Code günstiger und genauer als über ein Richtermodell."
  },
  "hi": {
    "check": {
      "repeated": "दोहराया",
      "unique": "भिन्न निर्देश"
    },
    "heading": "मूल्यांकन",
    "level": {
      "none": "अभी कोई निर्देश नहीं",
      "single": "केवल एकल रन",
      "repeated": "दोहराए गए रन"
    },
    "desc": "एजेंट अनिश्चयात्मक हैं, इसलिए एक बार चलाना प्रमाण नहीं — एक ही इनपुट को वितरण की तरह देखना चाहिए। यहाँ गिना जाता है कि कोई निर्देश सचमुच कितनी बार दोहराया गया।",
    "note": "जो कुछ भी निश्चयात्मक रूप से जाँचा जा सकता है — प्रारूप, स्कीमा, अनिवार्य खाने, वर्जित शब्द — वह मॉडल-न्यायाधीश की जगह कोड से सस्ता और सटीक निकलता है।"
  },
  "id": {
    "check": {
      "repeated": "Berulang",
      "unique": "Instruksi berbeda"
    },
    "heading": "Evaluasi",
    "level": {
      "none": "Belum ada instruksi",
      "single": "Hanya sekali jalan",
      "repeated": "Eksekusi berulang"
    },
    "desc": "Agen bersifat non-deterministik, jadi satu kali jalan bukanlah bukti — masukan yang sama harus dilihat sebagai sebaran. Di sini dihitung berapa kali sebuah instruksi benar-benar diulang.",
    "note": "Apa pun yang bisa diperiksa secara deterministik — format, skema, bidang wajib, kata terlarang — lebih murah dan lebih tepat lewat kode daripada lewat model juri."
  },
  "it": {
    "check": {
      "repeated": "Ripetuto",
      "unique": "Istruzioni distinte"
    },
    "heading": "Valutazione",
    "level": {
      "none": "Ancora nessuna istruzione",
      "single": "Solo esecuzioni singole",
      "repeated": "Esecuzioni ripetute"
    },
    "desc": "Gli agenti non sono deterministici, quindi una singola esecuzione non fa prova — lo stesso input va guardato come distribuzione. Qui si conta quante volte un’istruzione è stata davvero ripetuta.",
    "note": "Ciò che si può verificare in modo deterministico — formato, schema, campi obbligatori, parole vietate — costa meno ed è più esatto nel codice che con un modello giudice."
  },
  "pt-BR": {
    "check": {
      "repeated": "Repetido",
      "unique": "Instruções distintas"
    },
    "heading": "Avaliação",
    "level": {
      "none": "Ainda sem instruções",
      "single": "Apenas execuções únicas",
      "repeated": "Execuções repetidas"
    },
    "desc": "Agentes não são determinísticos, então uma única execução não é prova — a mesma entrada precisa ser vista como distribuição. Aqui se conta quantas vezes uma instrução foi de fato repetida.",
    "note": "O que dá para checar de forma determinística — formato, esquema, campos obrigatórios, palavras proibidas — sai mais barato e exato em código do que com um modelo juiz."
  }
} as const;
