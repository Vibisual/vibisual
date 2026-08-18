/**
 * scaffold — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.scaffold` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows how much glue is written around the model — rules, skills, turn caps. Gains on long-running agents come from better scaffolding far more than from a smarter model.",
    "heading": "Scaffold",
    "level": {
      "none": "No scaffold",
      "partial": "Partial",
      "full": "Rules and skills"
    },
    "check": {
      "rules": "Rule characters",
      "skills": "Skills",
      "maxTurns": "Turn cap"
    },
    "note": "Papers say “scaffold”, products say “harness”. Same thing, different nuance — one is code structure, the other is operations."
  },
  "ko": {
    "desc": "모델 주변에 짜 놓은 접착제가 얼마나 되는지 보여줍니다 — 규칙·스킬·턴 상한. 장기 실행 에이전트의 향상분은 더 똑똑한 모델보다 더 나은 스캐폴딩에서 나옵니다.",
    "heading": "스캐폴드",
    "level": {
      "none": "스캐폴드 없음",
      "partial": "일부만",
      "full": "규칙 + 스킬"
    },
    "check": {
      "rules": "규칙 글자 수",
      "skills": "스킬",
      "maxTurns": "턴 상한"
    },
    "note": "논문은 스캐폴드, 제품은 하네스라고 부릅니다. 같은 것을 두 이름으로 논의하는 셈이고, 한쪽은 코드 구조 · 다른 쪽은 운영 뉘앙스입니다."
  },
  "ja": {
    "level": {
      "partial": "一部のみ",
      "none": "スキャフォールドなし",
      "full": "ルールとスキル"
    },
    "check": {
      "rules": "ルール文字数",
      "skills": "スキル",
      "maxTurns": "ターン上限"
    },
    "heading": "スキャフォールド",
    "desc": "モデルの周りにどれだけ接着剤（ルール・スキル・ターン上限）が書かれているかを示します。長時間動くエージェントの伸びは、賢いモデルよりも良いスキャフォールディングから来ます。",
    "note": "論文は「スキャフォールド」、製品は「ハーネス」と呼びます。同じものを二つの名前で語っているだけで、片方はコード構造、もう片方は運用のニュアンスです。"
  },
  "zh-CN": {
    "level": {
      "partial": "部分",
      "none": "无脚手架",
      "full": "规则与技能"
    },
    "check": {
      "rules": "规则字数",
      "skills": "技能",
      "maxTurns": "轮次上限"
    },
    "heading": "脚手架",
    "desc": "显示模型周围写了多少粘合层（规则、技能、轮次上限）。长时间运行的智能体，其提升更多来自更好的脚手架，而非更聪明的模型。",
    "note": "论文说「脚手架」，产品说「框架」。同一件事被两个名字讨论，一边偏代码结构，一边偏运维。"
  },
  "es": {
    "level": {
      "partial": "Parcial",
      "none": "Sin andamiaje",
      "full": "Reglas y habilidades"
    },
    "check": {
      "rules": "Caracteres de reglas",
      "skills": "Habilidades",
      "maxTurns": "Límite de turnos"
    },
    "heading": "Andamiaje",
    "desc": "Muestra cuánto pegamento hay escrito alrededor del modelo — reglas, habilidades, topes de turnos. Las mejoras en agentes de larga duración vienen mucho más de un mejor andamiaje que de un modelo más listo.",
    "note": "Los artículos dicen «andamiaje», los productos dicen «arnés». Lo mismo con distinto matiz — estructura de código de un lado, operación del otro."
  },
  "es-419": {
    "level": {
      "partial": "Parcial",
      "none": "Sin andamiaje",
      "full": "Reglas y habilidades"
    },
    "check": {
      "rules": "Caracteres de reglas",
      "skills": "Habilidades",
      "maxTurns": "Límite de turnos"
    },
    "heading": "Andamiaje",
    "desc": "Muestra cuánto pegamento hay escrito alrededor del modelo — reglas, habilidades, topes de turnos. Las mejoras en agentes de larga duración vienen mucho más de un mejor andamiaje que de un modelo más listo.",
    "note": "Los artículos dicen «andamiaje», los productos dicen «arnés». Lo mismo con distinto matiz — estructura de código de un lado, operación del otro."
  },
  "fr": {
    "level": {
      "partial": "Partiel",
      "none": "Aucun échafaudage",
      "full": "Règles et compétences"
    },
    "check": {
      "rules": "Caractères de règles",
      "skills": "Compétences",
      "maxTurns": "Plafond de tours"
    },
    "heading": "Échafaudage",
    "desc": "Montre la quantité de colle écrite autour du modèle — règles, compétences, plafonds de tours. Les gains des agents longue durée viennent bien plus d’un meilleur échafaudage que d’un modèle plus intelligent.",
    "note": "Les articles disent « échafaudage », les produits disent « harnais ». La même chose avec une nuance différente — structure de code d’un côté, exploitation de l’autre."
  },
  "de": {
    "level": {
      "partial": "Teilweise",
      "none": "Kein Gerüst",
      "full": "Regeln und Skills"
    },
    "check": {
      "rules": "Regelzeichen",
      "skills": "Skills",
      "maxTurns": "Zugbegrenzung"
    },
    "heading": "Gerüst",
    "desc": "Zeigt, wie viel Klebstoff um das Modell herum geschrieben ist — Regeln, Skills, Zugbegrenzungen. Die Fortschritte langlaufender Agenten kommen weit mehr aus besserem Scaffolding als aus einem klügeren Modell.",
    "note": "Papers sagen „Scaffold“, Produkte sagen „Harness“. Dasselbe mit anderem Beiklang — einmal Codestruktur, einmal Betrieb."
  },
  "hi": {
    "level": {
      "partial": "आंशिक",
      "none": "कोई स्कैफ़ोल्ड नहीं",
      "full": "नियम व स्किल"
    },
    "check": {
      "rules": "नियम अक्षर",
      "skills": "स्किल",
      "maxTurns": "टर्न सीमा"
    },
    "heading": "स्कैफ़ोल्ड",
    "desc": "दिखाता है कि मॉडल के चारों ओर कितनी जोड़-गाँठ लिखी गई — नियम, skill, बारी की सीमा। लंबे चलने वाले एजेंट में सुधार बेहतर मॉडल से कहीं ज़्यादा बेहतर मचान से आता है।",
    "note": "शोध-पत्र «मचान» कहते हैं, उत्पाद «harness»। एक ही चीज़, अलग रंगत — एक ओर कोड की संरचना, दूसरी ओर संचालन।"
  },
  "id": {
    "level": {
      "partial": "Sebagian",
      "none": "Tanpa perancah",
      "full": "Aturan dan skill"
    },
    "check": {
      "rules": "Karakter aturan",
      "skills": "Skill",
      "maxTurns": "Batas giliran"
    },
    "heading": "Perancah",
    "desc": "Menunjukkan berapa banyak perekat yang ditulis di sekeliling model — aturan, skill, batas giliran. Peningkatan pada agen berjalan lama jauh lebih banyak datang dari perancah yang lebih baik daripada dari model yang lebih pintar.",
    "note": "Makalah menyebut «perancah», produk menyebut «harness». Hal yang sama dengan nuansa berbeda — struktur kode di satu sisi, operasional di sisi lain."
  },
  "it": {
    "level": {
      "partial": "Parziale",
      "none": "Nessuna impalcatura",
      "full": "Regole e competenze"
    },
    "check": {
      "rules": "Caratteri regole",
      "skills": "Competenze",
      "maxTurns": "Limite di turni"
    },
    "heading": "Impalcatura",
    "desc": "Mostra quanta colla è scritta attorno al modello — regole, competenze, tetti di turno. I guadagni sugli agenti a lunga esecuzione vengono molto più da una migliore impalcatura che da un modello più intelligente.",
    "note": "Gli articoli dicono «impalcatura», i prodotti dicono «harness». La stessa cosa con sfumatura diversa — struttura del codice da un lato, esercizio dall’altro."
  },
  "pt-BR": {
    "level": {
      "partial": "Parcial",
      "none": "Sem andaime",
      "full": "Regras e habilidades"
    },
    "check": {
      "rules": "Caracteres das regras",
      "skills": "Habilidades",
      "maxTurns": "Limite de turnos"
    },
    "heading": "Andaime",
    "desc": "Mostra quanta cola foi escrita ao redor do modelo — regras, habilidades, tetos de turno. Os ganhos em agentes de longa duração vêm muito mais de um andaime melhor do que de um modelo mais esperto.",
    "note": "Artigos dizem «andaime», produtos dizem «arreio». A mesma coisa com nuance distinta — estrutura de código de um lado, operação do outro."
  }
} as const;
