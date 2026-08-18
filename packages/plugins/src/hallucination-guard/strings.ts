/**
 * hallucination-guard — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.hallucinationGuard` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "In agents the usual form is inventing an API, file or function that does not exist. Typecheck, lint and tests catch invented APIs immediately — far more reliably than asking the model to double-check.",
    "heading": "Hallucination Guard",
    "level": {
      "blind": "Cannot verify",
      "readOnly": "Can read only",
      "verifiable": "Can execute"
    },
    "check": {
      "execute": "Can run checks",
      "read": "Can read source"
    },
    "note": "Stale documents produce confidently wrong answers that retrieval cannot fix — search will faithfully fetch the wrong thing.",
    "yes": "yes",
    "no": "no"
  },
  "ko": {
    "desc": "에이전트에서는 존재하지 않는 API·파일·함수를 지어내는 형태가 가장 흔합니다. 타입체크·린트·테스트가 지어낸 API 를 즉시 잡아내며, 모델에게 확인하게 하는 것보다 훨씬 확실합니다.",
    "heading": "환각 방어",
    "level": {
      "blind": "검증 수단 없음",
      "readOnly": "읽기만 가능",
      "verifiable": "실행으로 검증 가능"
    },
    "check": {
      "execute": "검사 실행 가능",
      "read": "원본 읽기 가능"
    },
    "note": "낡은 문서에서 오는 확신에 찬 오답은 검색으로 못 막습니다 — 검색이 틀린 것을 성실하게 찾아다 주기 때문입니다.",
    "yes": "가능",
    "no": "불가"
  },
  "ja": {
    "check": {
      "read": "原本を読める",
      "execute": "検査を実行できる"
    },
    "yes": "はい",
    "no": "いいえ",
    "heading": "ハルシネーション対策",
    "level": {
      "blind": "検証できない",
      "readOnly": "読み取りのみ",
      "verifiable": "実行できる"
    },
    "desc": "エージェントでは、存在しない API・ファイル・関数を作り出す形が最も多く見られます。型チェック・リント・テストが作り話の API を即座に捕まえ、モデルに確認させるよりはるかに確実です。",
    "note": "古い文書から来る自信のある誤答は検索では防げません — 検索は間違ったものを忠実に探してくるからです。"
  },
  "zh-CN": {
    "check": {
      "read": "可读取源码",
      "execute": "可运行检查"
    },
    "yes": "是",
    "no": "否",
    "heading": "幻觉防护",
    "level": {
      "blind": "无法验证",
      "readOnly": "仅可读取",
      "verifiable": "可执行"
    },
    "desc": "在智能体上最常见的形态是编造并不存在的 API、文件或函数。类型检查、lint 和测试能立刻抓住编造的 API，比让模型自己复核可靠得多。",
    "note": "来自过时文档的、自信的错误答案，靠检索是挡不住的 — 检索会忠实地把错的东西找回来。"
  },
  "es": {
    "check": {
      "read": "Puede leer la fuente",
      "execute": "Puede ejecutar comprobaciones"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Defensa ante alucinaciones",
    "level": {
      "blind": "No puede verificar",
      "readOnly": "Solo puede leer",
      "verifiable": "Puede ejecutar"
    },
    "desc": "En agentes la forma habitual es inventar una API, archivo o función que no existe. Comprobación de tipos, lint y pruebas atrapan de inmediato las API inventadas — mucho más fiable que pedirle al modelo que lo revise.",
    "note": "Los documentos caducados producen errores dichos con seguridad que la búsqueda no arregla — la búsqueda traerá fielmente lo equivocado."
  },
  "es-419": {
    "check": {
      "read": "Puede leer la fuente",
      "execute": "Puede ejecutar comprobaciones"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Defensa ante alucinaciones",
    "level": {
      "blind": "No puede verificar",
      "readOnly": "Solo puede leer",
      "verifiable": "Puede ejecutar"
    },
    "desc": "En agentes la forma habitual es inventar una API, archivo o función que no existe. Comprobación de tipos, lint y pruebas atrapan de inmediato las API inventadas — mucho más fiable que pedirle al modelo que lo revise.",
    "note": "Los documentos caducados producen errores dichos con seguridad que la búsqueda no arregla — la búsqueda traerá fielmente lo equivocado."
  },
  "fr": {
    "check": {
      "read": "Peut lire la source",
      "execute": "Peut exécuter des vérifications"
    },
    "yes": "oui",
    "no": "non",
    "heading": "Garde anti-hallucination",
    "level": {
      "blind": "Ne peut pas vérifier",
      "readOnly": "Peut seulement lire",
      "verifiable": "Peut exécuter"
    },
    "desc": "Chez les agents, la forme habituelle est d’inventer une API, un fichier ou une fonction qui n’existe pas. Typage, lint et tests attrapent immédiatement les API inventées — bien plus sûrement que de demander au modèle de revérifier.",
    "note": "Des documents périmés produisent des erreurs affirmées que la recherche ne corrige pas — elle ira chercher fidèlement la mauvaise chose."
  },
  "de": {
    "check": {
      "read": "Kann Quelle lesen",
      "execute": "Kann Prüfungen ausführen"
    },
    "yes": "ja",
    "no": "nein",
    "heading": "Halluzinationsschutz",
    "level": {
      "blind": "Kann nicht prüfen",
      "readOnly": "Kann nur lesen",
      "verifiable": "Kann ausführen"
    },
    "desc": "Bei Agenten ist die übliche Form, eine API, Datei oder Funktion zu erfinden, die es nicht gibt. Typecheck, Lint und Tests fangen erfundene APIs sofort ab — weit verlässlicher, als das Modell selbst nachprüfen zu lassen.",
    "note": "Veraltete Dokumente erzeugen selbstsichere Falschaussagen, die sich nicht durch Suche beheben lassen — die Suche holt das Falsche gewissenhaft herbei."
  },
  "hi": {
    "check": {
      "read": "स्रोत पढ़ सकता है",
      "execute": "जाँच चला सकता है"
    },
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "हैलुसिनेशन रक्षा",
    "level": {
      "blind": "सत्यापन नहीं कर सकता",
      "readOnly": "केवल पढ़ सकता है",
      "verifiable": "निष्पादन संभव"
    },
    "desc": "एजेंट में इसका आम रूप है न मौजूद API, फ़ाइल या फ़ंक्शन गढ़ लेना। टाइप-जाँच, lint और टेस्ट गढ़े हुए API तुरंत पकड़ लेते हैं — मॉडल से दोबारा जाँचने को कहने से कहीं भरोसेमंद।",
    "note": "बासी दस्तावेज़ आत्मविश्वास से भरी ग़लती पैदा करते हैं जिसे खोज ठीक नहीं कर सकती — खोज ईमानदारी से वही ग़लत चीज़ ले आएगी।"
  },
  "id": {
    "check": {
      "read": "Bisa baca sumber",
      "execute": "Bisa menjalankan pemeriksaan"
    },
    "yes": "ya",
    "no": "tidak",
    "heading": "Penjaga halusinasi",
    "level": {
      "blind": "Tidak bisa memverifikasi",
      "readOnly": "Hanya bisa membaca",
      "verifiable": "Bisa mengeksekusi"
    },
    "desc": "Pada agen, bentuk yang lazim adalah mengarang API, berkas, atau fungsi yang tidak ada. Pemeriksaan tipe, lint, dan tes langsung menangkap API karangan — jauh lebih andal daripada meminta model memeriksa ulang.",
    "note": "Dokumen usang menghasilkan kesalahan yang diucapkan dengan yakin dan tak bisa diperbaiki oleh pencarian — pencarian akan setia mengambil yang keliru."
  },
  "it": {
    "check": {
      "read": "Può leggere il sorgente",
      "execute": "Può eseguire verifiche"
    },
    "yes": "sì",
    "no": "no",
    "heading": "Difesa dalle allucinazioni",
    "level": {
      "blind": "Non può verificare",
      "readOnly": "Può solo leggere",
      "verifiable": "Può eseguire"
    },
    "desc": "Negli agenti la forma consueta è inventare un’API, un file o una funzione che non esiste. Controllo dei tipi, lint e test colgono subito le API inventate — molto più affidabile che chiedere al modello di ricontrollare.",
    "note": "I documenti scaduti producono errori detti con sicurezza che la ricerca non corregge — la ricerca andrà a prendere fedelmente la cosa sbagliata."
  },
  "pt-BR": {
    "check": {
      "read": "Pode ler a fonte",
      "execute": "Pode executar verificações"
    },
    "yes": "sim",
    "no": "não",
    "heading": "Proteção contra alucinação",
    "level": {
      "blind": "Não pode verificar",
      "readOnly": "Só pode ler",
      "verifiable": "Pode executar"
    },
    "desc": "Em agentes a forma usual é inventar uma API, arquivo ou função que não existe. Checagem de tipos, lint e testes pegam APIs inventadas na hora — bem mais confiável do que pedir ao modelo que confira.",
    "note": "Documentos vencidos produzem erros ditos com convicção que a busca não corrige — a busca vai trazer fielmente a coisa errada."
  }
} as const;
