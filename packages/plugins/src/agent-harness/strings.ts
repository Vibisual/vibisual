/**
 * agent-harness — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agentHarness` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Gathers everything wrapped around the model — tools, permission, isolation, skills, rules. The same model produces very different results depending on this layer, which is where the competition moved.",
    "heading": "Agent Harness",
    "level": {
      "bare": "Bare",
      "basic": "Basic",
      "rich": "Well equipped"
    },
    "check": {
      "model": "Model",
      "tools": "Tools",
      "permission": "Permission",
      "skills": "Skills",
      "isolation": "Isolation"
    },
    "note": "Benchmark numbers carry scaffold inflation — the same model scores differently under a different harness, so compare harnesses, not just models."
  },
  "ko": {
    "desc": "모델을 감싸고 있는 것 전부를 한 장으로 모읍니다 — 도구·권한·격리·스킬·규칙. 같은 모델이라도 이 층에 따라 결과가 크게 갈리고, 경쟁 축이 그쪽으로 옮겨갔습니다.",
    "heading": "에이전트 하네스",
    "level": {
      "bare": "거의 없음",
      "basic": "기본",
      "rich": "잘 갖춰짐"
    },
    "check": {
      "model": "모델",
      "tools": "도구",
      "permission": "권한",
      "skills": "스킬",
      "isolation": "격리"
    },
    "note": "벤치마크 점수에는 스캐폴드 인플레이션이 끼어 있습니다 — 같은 모델도 하네스를 바꾸면 점수가 달라지므로, 모델만이 아니라 하네스를 비교해야 합니다."
  },
  "ja": {
    "check": {
      "model": "モデル",
      "tools": "ツール",
      "skills": "スキル",
      "isolation": "隔離",
      "permission": "権限"
    },
    "heading": "エージェントハーネス",
    "level": {
      "bare": "ほぼ素",
      "basic": "基本",
      "rich": "よく整っている"
    },
    "desc": "モデルを取り巻くもの一式（ツール・権限・隔離・スキル・ルール）を一枚にまとめます。同じモデルでもこの層次第で結果が大きく変わり、競争の軸はそちらへ移りました。",
    "note": "ベンチマークの数値にはスキャフォールド由来の水増しが混じります — 同じモデルでもハーネスを変えれば点が動くので、モデルだけでなくハーネスを比べる必要があります。"
  },
  "zh-CN": {
    "check": {
      "model": "模型",
      "tools": "工具",
      "skills": "技能",
      "isolation": "隔离",
      "permission": "权限"
    },
    "heading": "智能体框架",
    "level": {
      "bare": "几乎裸奔",
      "basic": "基本",
      "rich": "装备齐全"
    },
    "desc": "把包裹模型的一切（工具、权限、隔离、技能、规则）汇总成一张卡片。同样的模型在这一层的差别下结果大不相同，竞争的轴心也已经移到这里。",
    "note": "基准分数里掺着脚手架带来的虚高 — 同一个模型换个框架分数就会变，所以要比较的不只是模型，还有框架。"
  },
  "es": {
    "check": {
      "model": "Modelo",
      "tools": "Herramientas",
      "skills": "Habilidades",
      "isolation": "Aislamiento",
      "permission": "Permiso"
    },
    "heading": "Arnés del agente",
    "level": {
      "bare": "Casi vacío",
      "basic": "Básico",
      "rich": "Bien equipado"
    },
    "desc": "Reúne todo lo que envuelve al modelo — herramientas, permisos, aislamiento, habilidades, reglas. El mismo modelo da resultados muy distintos según esta capa, y ahí es donde se movió la competencia.",
    "note": "Las cifras de benchmark llevan inflación de andamiaje — el mismo modelo puntúa distinto bajo otro arnés, así que compara arneses, no solo modelos."
  },
  "es-419": {
    "check": {
      "model": "Modelo",
      "tools": "Herramientas",
      "skills": "Habilidades",
      "isolation": "Aislamiento",
      "permission": "Permiso"
    },
    "heading": "Arnés del agente",
    "level": {
      "bare": "Casi vacío",
      "basic": "Básico",
      "rich": "Bien equipado"
    },
    "desc": "Reúne todo lo que envuelve al modelo — herramientas, permisos, aislamiento, habilidades, reglas. El mismo modelo da resultados muy distintos según esta capa, y ahí es donde se movió la competencia.",
    "note": "Las cifras de benchmark llevan inflación de andamiaje — el mismo modelo puntúa distinto bajo otro arnés, así que compara arneses, no solo modelos."
  },
  "fr": {
    "check": {
      "model": "Modèle",
      "tools": "Outils",
      "skills": "Compétences",
      "isolation": "Isolation",
      "permission": "Permission"
    },
    "heading": "Harnais d’agent",
    "level": {
      "bare": "Presque nu",
      "basic": "Basique",
      "rich": "Bien équipé"
    },
    "desc": "Rassemble tout ce qui entoure le modèle — outils, permission, isolation, compétences, règles. Le même modèle donne des résultats très différents selon cette couche, et c’est là que la concurrence s’est déplacée.",
    "note": "Les scores de benchmark charrient une inflation liée au scaffold — le même modèle obtient d’autres chiffres sous un autre harnais, donc comparez les harnais, pas seulement les modèles."
  },
  "de": {
    "check": {
      "model": "Modell",
      "tools": "Werkzeuge",
      "skills": "Skills",
      "isolation": "Isolierung",
      "permission": "Berechtigung"
    },
    "heading": "Agent-Harness",
    "level": {
      "bare": "Kaum ausgestattet",
      "basic": "Basis",
      "rich": "Gut ausgestattet"
    },
    "desc": "Sammelt alles, was das Modell umgibt — Werkzeuge, Berechtigung, Isolierung, Skills, Regeln. Dasselbe Modell liefert je nach dieser Schicht sehr unterschiedliche Ergebnisse; dorthin hat sich der Wettbewerb verlagert.",
    "note": "Benchmark-Zahlen tragen eine Scaffold-Inflation in sich — dasselbe Modell schneidet unter einer anderen Harness anders ab. Vergleichen Sie also nicht nur Modelle, sondern Harnesses."
  },
  "hi": {
    "check": {
      "model": "मॉडल",
      "tools": "टूल",
      "skills": "स्किल",
      "isolation": "पृथक्करण",
      "permission": "अनुमति"
    },
    "heading": "एजेंट हार्नेस",
    "level": {
      "bare": "लगभग खाली",
      "basic": "बुनियादी",
      "rich": "अच्छी तरह सुसज्जित"
    },
    "desc": "वह सब जोड़ता है जो मॉडल को लपेटता है — टूल, अनुमतियाँ, अलगाव, skill, नियम। एक ही मॉडल इस परत के हिसाब से बहुत अलग नतीजे देता है, और मुकाबला वहीं खिसक गया है।",
    "note": "बेंचमार्क के आँकड़ों में मचान की मुद्रास्फीति घुली रहती है — एक ही मॉडल दूसरे harness के नीचे अलग अंक देता है, इसलिए मॉडल नहीं, harness की तुलना कीजिए।"
  },
  "id": {
    "check": {
      "model": "Model",
      "tools": "Alat",
      "skills": "Skill",
      "isolation": "Isolasi",
      "permission": "Izin"
    },
    "heading": "Harness agen",
    "level": {
      "bare": "Nyaris kosong",
      "basic": "Dasar",
      "rich": "Lengkap"
    },
    "desc": "Mengumpulkan semua yang membungkus model — alat, izin, isolasi, skill, aturan. Model yang sama memberi hasil sangat berbeda tergantung lapisan ini, dan ke sanalah persaingan berpindah.",
    "note": "Angka benchmark membawa inflasi dari perancah — model yang sama memberi skor berbeda di bawah harness lain, jadi bandingkan harness, bukan cuma model."
  },
  "it": {
    "check": {
      "model": "Modello",
      "tools": "Strumenti",
      "skills": "Competenze",
      "isolation": "Isolamento",
      "permission": "Permesso"
    },
    "heading": "Harness dell’agente",
    "level": {
      "bare": "Quasi nudo",
      "basic": "Base",
      "rich": "Ben equipaggiato"
    },
    "desc": "Raccoglie tutto ciò che avvolge il modello — strumenti, permessi, isolamento, competenze, regole. Lo stesso modello dà risultati molto diversi a seconda di questo strato, ed è lì che si è spostata la concorrenza.",
    "note": "I numeri dei benchmark portano un’inflazione da impalcatura — lo stesso modello ottiene punteggi diversi sotto un altro harness, quindi confronta gli harness, non solo i modelli."
  },
  "pt-BR": {
    "check": {
      "model": "Modelo",
      "tools": "Ferramentas",
      "skills": "Habilidades",
      "isolation": "Isolamento",
      "permission": "Permissão"
    },
    "heading": "Arreio do agente",
    "level": {
      "bare": "Quase vazio",
      "basic": "Básico",
      "rich": "Bem equipado"
    },
    "desc": "Reúne tudo o que envolve o modelo — ferramentas, permissão, isolamento, habilidades, regras. O mesmo modelo entrega resultados bem diferentes conforme essa camada, e foi para lá que a concorrência se moveu.",
    "note": "Números de benchmark carregam inflação de andaime — o mesmo modelo pontua diferente sob outro arreio, então compare arreios, não só modelos."
  }
} as const;
