/**
 * idempotency — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.idempotency` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Agents paper over failures with retries. A tool that is not idempotent doubles the data on one retry, which is why this is treated as a base requirement rather than a best practice.",
    "heading": "Idempotency",
    "level": {
      "safe": "Retry-safe tools",
      "capped": "Risky but capped",
      "unbounded": "Risky and unbounded"
    },
    "check": {
      "risky": "Retry-unsafe tools",
      "cap": "Turn cap"
    },
    "none": "none",
    "note": "For tools that cannot be undone, an idempotency key in the schema is what makes a retry safe."
  },
  "ko": {
    "desc": "에이전트는 실패를 재시도로 때웁니다. 멱등하지 않은 도구는 재시도 한 번에 데이터가 두 배가 되므로, 모범 사례가 아니라 기본 요건으로 취급됩니다.",
    "heading": "멱등성",
    "level": {
      "safe": "재시도 안전",
      "capped": "위험하나 상한 있음",
      "unbounded": "위험 + 상한 없음"
    },
    "check": {
      "risky": "재시도 위험 도구",
      "cap": "턴 상한"
    },
    "none": "없음",
    "note": "되돌릴 수 없는 도구는 스키마에 멱등 키를 두는 것이 재시도를 안전하게 만드는 방법입니다."
  },
  "ja": {
    "check": {
      "cap": "ターン上限",
      "risky": "再試行が危険なツール"
    },
    "none": "なし",
    "heading": "冪等性",
    "level": {
      "safe": "再試行しても安全",
      "capped": "危険だが上限あり",
      "unbounded": "危険かつ上限なし"
    },
    "desc": "エージェントは失敗を再試行で埋めます。冪等でないツールは再試行一回でデータが二倍になるため、ベストプラクティスではなく基本要件として扱われます。",
    "note": "取り消せないツールには、スキーマに冪等キーを置くことが再試行を安全にする方法です。"
  },
  "zh-CN": {
    "check": {
      "cap": "轮次上限",
      "risky": "重试不安全的工具"
    },
    "none": "无",
    "heading": "幂等性",
    "level": {
      "safe": "重试安全的工具",
      "capped": "有风险但有上限",
      "unbounded": "有风险且无上限"
    },
    "desc": "智能体用重试来抹平失败。非幂等的工具重试一次就会让数据翻倍，所以这被当作基本要求而不是最佳实践。",
    "note": "对无法撤销的工具，在模式里放一个幂等键，才是让重试变安全的办法。"
  },
  "es": {
    "check": {
      "cap": "Límite de turnos",
      "risky": "Herramientas no seguras al reintentar"
    },
    "none": "ninguno",
    "heading": "Idempotencia",
    "level": {
      "safe": "Herramientas seguras al reintentar",
      "capped": "Arriesgado pero con tope",
      "unbounded": "Arriesgado y sin tope"
    },
    "desc": "Los agentes tapan los fallos con reintentos. Una herramienta no idempotente duplica los datos en un solo reintento, y por eso esto se trata como requisito básico y no como buena práctica.",
    "note": "Para herramientas que no se pueden deshacer, una clave de idempotencia en el esquema es lo que hace seguro un reintento."
  },
  "es-419": {
    "check": {
      "cap": "Límite de turnos",
      "risky": "Herramientas no seguras al reintentar"
    },
    "none": "ninguno",
    "heading": "Idempotencia",
    "level": {
      "safe": "Herramientas seguras al reintentar",
      "capped": "Arriesgado pero con tope",
      "unbounded": "Arriesgado y sin tope"
    },
    "desc": "Los agentes tapan los fallos con reintentos. Una herramienta no idempotente duplica los datos en un solo reintento, y por eso esto se trata como requisito básico y no como buena práctica.",
    "note": "Para herramientas que no se pueden deshacer, una clave de idempotencia en el esquema es lo que hace seguro un reintento."
  },
  "fr": {
    "check": {
      "cap": "Plafond de tours",
      "risky": "Outils risqués en cas de réessai"
    },
    "none": "aucun",
    "heading": "Idempotence",
    "level": {
      "safe": "Outils sûrs au réessai",
      "capped": "Risqué mais plafonné",
      "unbounded": "Risqué et sans plafond"
    },
    "desc": "Les agents masquent les échecs par des reprises. Un outil non idempotent double les données à la première reprise, d’où son statut d’exigence de base plutôt que de bonne pratique.",
    "note": "Pour les outils irréversibles, une clé d’idempotence dans le schéma est ce qui rend une reprise sûre."
  },
  "de": {
    "check": {
      "cap": "Zugbegrenzung",
      "risky": "Bei Wiederholung unsichere Werkzeuge"
    },
    "none": "keine",
    "heading": "Idempotenz",
    "level": {
      "safe": "Bei Wiederholung sichere Werkzeuge",
      "capped": "Riskant, aber begrenzt",
      "unbounded": "Riskant und unbegrenzt"
    },
    "desc": "Agenten übertünchen Fehler mit Wiederholungen. Ein nicht idempotentes Werkzeug verdoppelt bei einem Neuversuch die Daten — deshalb gilt das als Grundanforderung und nicht als bewährte Praxis.",
    "note": "Für nicht rückgängig machbare Werkzeuge macht ein Idempotenzschlüssel im Schema einen Neuversuch erst sicher."
  },
  "hi": {
    "check": {
      "cap": "टर्न सीमा",
      "risky": "पुनःप्रयास-असुरक्षित टूल"
    },
    "none": "कोई नहीं",
    "heading": "इडेम्पोटेंसी",
    "level": {
      "safe": "पुनःप्रयास-सुरक्षित टूल",
      "capped": "जोखिमपूर्ण पर सीमित",
      "unbounded": "जोखिमपूर्ण व असीमित"
    },
    "desc": "एजेंट विफलताओं को दोबारा कोशिश से ढाँपते हैं। जो टूल idempotent नहीं, वह एक ही पुनःप्रयास से डेटा दोगुना कर देता है — इसीलिए यह अच्छी आदत नहीं, बुनियादी शर्त मानी जाती है।",
    "note": "जिन टूल को पलटा नहीं जा सकता, उनके लिए स्कीमा के भीतर idempotency-कुंजी ही पुनःप्रयास को सुरक्षित बनाती है।"
  },
  "id": {
    "check": {
      "cap": "Batas giliran",
      "risky": "Alat tak aman untuk diulang"
    },
    "none": "tidak ada",
    "heading": "Idempotensi",
    "level": {
      "safe": "Alat aman diulang",
      "capped": "Berisiko tapi dibatasi",
      "unbounded": "Berisiko dan tanpa batas"
    },
    "desc": "Agen menambal kegagalan dengan mencoba ulang. Alat yang tidak idempoten menggandakan data hanya dengan satu kali ulang, dan karena itu hal ini diperlakukan sebagai syarat dasar, bukan praktik baik.",
    "note": "Untuk alat yang tak bisa dibatalkan, kunci idempotensi di dalam skema itulah yang membuat pengulangan menjadi aman."
  },
  "it": {
    "check": {
      "cap": "Limite di turni",
      "risky": "Strumenti non sicuri al riprova"
    },
    "none": "nessuno",
    "heading": "Idempotenza",
    "level": {
      "safe": "Strumenti sicuri al riprova",
      "capped": "Rischioso ma limitato",
      "unbounded": "Rischioso e senza limiti"
    },
    "desc": "Gli agenti coprono i fallimenti con i tentativi ripetuti. Uno strumento non idempotente raddoppia i dati a un solo riprova, ed è per questo che qui si parla di requisito di base e non di buona pratica.",
    "note": "Per gli strumenti non annullabili, una chiave di idempotenza nello schema è ciò che rende sicura una riprova."
  },
  "pt-BR": {
    "check": {
      "cap": "Limite de turnos",
      "risky": "Ferramentas inseguras em nova tentativa"
    },
    "none": "nenhum",
    "heading": "Idempotência",
    "level": {
      "safe": "Ferramentas seguras em nova tentativa",
      "capped": "Arriscado mas limitado",
      "unbounded": "Arriscado e sem limite"
    },
    "desc": "Agentes encobrem falhas com novas tentativas. Uma ferramenta não idempotente dobra os dados numa única repetição, e por isso isso é tratado como requisito básico e não como boa prática.",
    "note": "Para ferramentas que não dá para desfazer, uma chave de idempotência no esquema é o que torna a repetição segura."
  }
} as const;
