/**
 * agent-skills — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agentSkills` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Skills give procedural knowledge as files rather than prompt text. Names and descriptions load at start, bodies only when relevant — so dozens of skills barely raise the standing cost.",
    "heading": "Agent Skills",
    "level": {
      "none": "No skills",
      "loaded": "Skills attached"
    },
    "check": {
      "count": "Skills",
      "idleCost": "Standing cost (approx. tokens)"
    },
    "note": "Reusable procedures — deployment steps, review checklists, internal API usage — belong in files under version control, not in a prompt."
  },
  "ko": {
    "desc": "스킬은 절차 지식을 프롬프트가 아니라 파일로 줍니다. 시작 시엔 이름·설명만, 본문은 관련 있을 때만 로드하므로 수십 개를 붙여도 상시 비용이 거의 늘지 않습니다.",
    "heading": "에이전트 스킬",
    "level": {
      "none": "스킬 없음",
      "loaded": "스킬 붙음"
    },
    "check": {
      "count": "스킬 수",
      "idleCost": "상시 비용(토큰 근사)"
    },
    "note": "배포 절차·리뷰 체크리스트·사내 API 사용법 같은 재사용 절차는 프롬프트가 아니라 버전 관리되는 파일에 두는 것이 맞습니다."
  },
  "ja": {
    "level": {
      "loaded": "スキルあり",
      "none": "スキルなし"
    },
    "check": {
      "count": "スキル",
      "idleCost": "常時コスト（概算トークン）"
    },
    "heading": "エージェントスキル",
    "desc": "スキルは手続き的な知識をプロンプト文ではなくファイルで与えます。開始時は名前と説明だけ、本文は関連するときだけ読むので、数十個付けても常時コストはほとんど増えません。",
    "note": "デプロイ手順・レビューのチェックリスト・社内 API の使い方のような再利用可能な手順は、プロンプトではなくバージョン管理されたファイルに置くべきです。"
  },
  "zh-CN": {
    "level": {
      "loaded": "已附加技能",
      "none": "无技能"
    },
    "check": {
      "count": "技能",
      "idleCost": "常驻成本（约合令牌）"
    },
    "heading": "智能体技能",
    "desc": "技能以文件而非提示词文本的形式提供流程性知识。启动时只载入名称与描述，正文只在相关时才读 — 因此挂上数十个技能，常驻成本也几乎不增加。",
    "note": "部署步骤、评审清单、内部 API 用法这类可复用流程，应该放进受版本管理的文件，而不是提示词里。"
  },
  "es": {
    "level": {
      "loaded": "Con habilidades",
      "none": "Sin habilidades"
    },
    "check": {
      "count": "Habilidades",
      "idleCost": "Coste permanente (tokens aprox.)"
    },
    "heading": "Habilidades del agente",
    "desc": "Las habilidades aportan conocimiento de procedimiento como archivos en lugar de texto de prompt. Nombres y descripciones cargan al inicio, el cuerpo solo cuando es relevante — así, decenas de habilidades apenas suben el coste permanente.",
    "note": "Los procedimientos reutilizables — pasos de despliegue, listas de revisión, uso de API internas — pertenecen a archivos versionados, no a un prompt."
  },
  "es-419": {
    "level": {
      "loaded": "Con habilidades",
      "none": "Sin habilidades"
    },
    "check": {
      "count": "Habilidades",
      "idleCost": "Coste permanente (tokens aprox.)"
    },
    "heading": "Habilidades del agente",
    "desc": "Las habilidades aportan conocimiento de procedimiento como archivos en lugar de texto de prompt. Nombres y descripciones cargan al inicio, el cuerpo solo cuando es relevante — así, decenas de habilidades apenas suben el coste permanente.",
    "note": "Los procedimientos reutilizables — pasos de despliegue, listas de revisión, uso de API internas — pertenecen a archivos versionados, no a un prompt."
  },
  "fr": {
    "level": {
      "loaded": "Compétences attachées",
      "none": "Aucune compétence"
    },
    "check": {
      "count": "Compétences",
      "idleCost": "Coût permanent (jetons approx.)"
    },
    "heading": "Compétences d’agent",
    "desc": "Les compétences fournissent un savoir procédural sous forme de fichiers plutôt que de texte de prompt. Noms et descriptions se chargent au démarrage, le corps seulement s’il est pertinent — des dizaines de compétences n’augmentent donc presque pas le coût permanent.",
    "note": "Les procédures réutilisables — étapes de déploiement, listes de revue, usage d’API internes — appartiennent à des fichiers versionnés, pas à un prompt."
  },
  "de": {
    "level": {
      "loaded": "Skills angehängt",
      "none": "Keine Skills"
    },
    "check": {
      "count": "Skills",
      "idleCost": "Dauerkosten (ca. Tokens)"
    },
    "heading": "Agent-Skills",
    "desc": "Skills liefern prozedurales Wissen als Dateien statt als Prompt-Text. Namen und Beschreibungen laden beim Start, Inhalte nur bei Relevanz — dutzende Skills erhöhen die Dauerkosten daher kaum.",
    "note": "Wiederverwendbare Abläufe — Deployment-Schritte, Review-Checklisten, interne API-Nutzung — gehören in versionierte Dateien, nicht in einen Prompt."
  },
  "hi": {
    "level": {
      "loaded": "स्किल संलग्न",
      "none": "कोई स्किल नहीं"
    },
    "check": {
      "count": "स्किल",
      "idleCost": "स्थायी लागत (लगभग टोकन)"
    },
    "heading": "एजेंट स्किल",
    "desc": "Skill प्रक्रियात्मक ज्ञान प्रॉम्प्ट-पाठ के बजाय फ़ाइल के रूप में देते हैं। नाम और विवरण शुरुआत में लदते हैं, सामग्री तभी जब प्रासंगिक हो — इसलिए दर्जनों skill भी स्थिर लागत लगभग नहीं बढ़ाते।",
    "note": "बार-बार दोहराई जाने वाली प्रक्रियाएँ — रिलीज़ के चरण, समीक्षा की सूची, आंतरिक API का उपयोग — प्रॉम्प्ट में नहीं, संस्करण-नियंत्रित फ़ाइल में बैठती हैं।"
  },
  "id": {
    "level": {
      "loaded": "Skill terpasang",
      "none": "Tanpa skill"
    },
    "check": {
      "count": "Skill",
      "idleCost": "Biaya tetap (perkiraan token)"
    },
    "heading": "Skill agen",
    "desc": "Skill memberi pengetahuan prosedural sebagai berkas alih-alih teks prompt. Nama dan deskripsi dimuat saat mulai, isinya hanya bila relevan — sehingga puluhan skill nyaris tak menaikkan biaya tetap.",
    "note": "Prosedur yang dipakai berulang — langkah rilis, daftar periksa tinjauan, cara pakai API internal — tempatnya di berkas yang dikelola versi, bukan di prompt."
  },
  "it": {
    "level": {
      "loaded": "Competenze allegate",
      "none": "Nessuna competenza"
    },
    "check": {
      "count": "Competenze",
      "idleCost": "Costo fisso (token approx.)"
    },
    "heading": "Competenze dell’agente",
    "desc": "Le competenze forniscono conoscenza procedurale come file invece che come testo del prompt. Nomi e descrizioni si caricano all’avvio, il corpo solo quando è pertinente — così decine di competenze non alzano quasi il costo permanente.",
    "note": "Le procedure riutilizzabili — passi di rilascio, liste di revisione, uso di API interne — appartengono a file versionati, non a un prompt."
  },
  "pt-BR": {
    "level": {
      "loaded": "Com habilidades",
      "none": "Sem habilidades"
    },
    "check": {
      "count": "Habilidades",
      "idleCost": "Custo permanente (tokens aprox.)"
    },
    "heading": "Habilidades do agente",
    "desc": "Habilidades fornecem conhecimento de procedimento como arquivos em vez de texto de prompt. Nomes e descrições carregam no início, o corpo só quando é relevante — assim, dezenas de habilidades quase não aumentam o custo permanente.",
    "note": "Procedimentos reutilizáveis — passos de implantação, listas de revisão, uso de APIs internas — pertencem a arquivos versionados, não a um prompt."
  }
} as const;
