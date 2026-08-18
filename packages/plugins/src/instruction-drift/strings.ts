/**
 * instruction-drift — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.instructionDrift` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Early instructions lose their grip as a session grows, and compaction dilutes them faster. “I said it once” does not hold.",
    "heading": "Instruction Drift",
    "level": {
      "noRules": "No standing rules",
      "fresh": "Still fresh",
      "rising": "Diluting",
      "high": "Likely diluted"
    },
    "check": {
      "rules": "Standing rules",
      "turns": "Turns",
      "skills": "Skills"
    },
    "yes": "yes",
    "no": "no",
    "note": "Important constraints need re-injecting each turn, or marking as a preserved section through compaction.",
    "noteLong": "This session is long enough that early instructions have likely faded. Re-state the constraints that still matter."
  },
  "ko": {
    "desc": "세션이 길어질수록 초반 지시의 영향력이 옅어지고, 컴팩션이 돌면 더 빨리 희석됩니다. \"한 번 말했으니 계속 지켜지겠지\"는 성립하지 않습니다.",
    "heading": "지시 표류",
    "level": {
      "noRules": "상시 규칙 없음",
      "fresh": "아직 선명함",
      "rising": "희석되는 중",
      "high": "희석됐을 가능성"
    },
    "check": {
      "rules": "상시 규칙",
      "turns": "턴 수",
      "skills": "스킬 수"
    },
    "yes": "있음",
    "no": "없음",
    "note": "중요한 제약은 매 턴 다시 주입하거나, 컴팩션에서 보존 구획으로 지정해 두는 것이 표준 대응입니다.",
    "noteLong": "초반 지시가 희석됐을 만큼 세션이 길어졌습니다. 아직 유효한 제약이라면 다시 한 번 말해 주십시오."
  },
  "ja": {
    "level": {
      "noRules": "常設ルールなし",
      "rising": "薄まりつつある",
      "high": "薄まった可能性",
      "fresh": "まだ鮮明"
    },
    "check": {
      "rules": "常設ルール",
      "turns": "ターン数",
      "skills": "スキル"
    },
    "yes": "はい",
    "no": "いいえ",
    "heading": "指示の希薄化",
    "desc": "セッションが伸びるほど序盤の指示は効きが薄れ、コンパクションが走るとさらに速く薄まります。「一度言ったから守られるはず」は成り立ちません。",
    "note": "重要な制約は毎ターン入れ直すか、コンパクションの保存区画に指定しておくのが標準的な対処です。",
    "noteLong": "序盤の指示が薄まる程度にはセッションが長くなっています。まだ効かせたい制約があるなら、もう一度言ってください。"
  },
  "zh-CN": {
    "level": {
      "noRules": "无常驻规则",
      "rising": "正在稀释",
      "high": "可能已稀释",
      "fresh": "仍然清晰"
    },
    "check": {
      "rules": "常驻规则",
      "turns": "轮次",
      "skills": "技能"
    },
    "yes": "是",
    "no": "否",
    "heading": "指令漂移",
    "desc": "会话越长，早期指令的约束力越弱，压缩一旦发生还会稀释得更快。「说过一次就会一直遵守」并不成立。",
    "note": "重要约束需要每轮重新注入，或者在压缩时指定为保留区块，这是标准做法。",
    "noteLong": "会话已经长到早期指令很可能被稀释了。如果还有仍需生效的约束，请再说一次。"
  },
  "es": {
    "level": {
      "noRules": "Sin reglas permanentes",
      "rising": "Diluyéndose",
      "high": "Probablemente diluido",
      "fresh": "Aún fresco"
    },
    "check": {
      "rules": "Reglas permanentes",
      "turns": "Turnos",
      "skills": "Habilidades"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Deriva de instrucciones",
    "desc": "Las instrucciones iniciales pierden agarre a medida que crece la sesión, y la compactación las diluye más rápido. «Ya lo dije una vez» no se sostiene.",
    "note": "Las restricciones importantes deben reinyectarse en cada turno, o marcarse como sección preservada a través de la compactación.",
    "noteLong": "La sesión es lo bastante larga como para que las instrucciones iniciales se hayan desvanecido. Repite las restricciones que sigan importando."
  },
  "es-419": {
    "level": {
      "noRules": "Sin reglas permanentes",
      "rising": "Diluyéndose",
      "high": "Probablemente diluido",
      "fresh": "Aún fresco"
    },
    "check": {
      "rules": "Reglas permanentes",
      "turns": "Turnos",
      "skills": "Habilidades"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Deriva de instrucciones",
    "desc": "Las instrucciones iniciales pierden agarre a medida que crece la sesión, y la compactación las diluye más rápido. «Ya lo dije una vez» no se sostiene.",
    "note": "Las restricciones importantes deben reinyectarse en cada turno, o marcarse como sección preservada a través de la compactación.",
    "noteLong": "La sesión es lo bastante larga como para que las instrucciones iniciales se hayan desvanecido. Repite las restricciones que sigan importando."
  },
  "fr": {
    "level": {
      "noRules": "Aucune règle permanente",
      "rising": "En dilution",
      "high": "Probablement dilué",
      "fresh": "Encore frais"
    },
    "check": {
      "rules": "Règles permanentes",
      "turns": "Tours",
      "skills": "Compétences"
    },
    "yes": "oui",
    "no": "non",
    "heading": "Dérive des instructions",
    "desc": "Les instructions initiales perdent leur prise à mesure que la session s’allonge, et la compaction les dilue plus vite. « Je l’ai dit une fois » ne tient pas.",
    "note": "Les contraintes importantes doivent être réinjectées à chaque tour, ou marquées comme section préservée à travers la compaction.",
    "noteLong": "La session est assez longue pour que les instructions initiales se soient probablement estompées. Redites les contraintes qui comptent encore."
  },
  "de": {
    "level": {
      "noRules": "Keine Dauerregeln",
      "rising": "Verwässert",
      "high": "Vermutlich verwässert",
      "fresh": "Noch frisch"
    },
    "check": {
      "rules": "Dauerregeln",
      "turns": "Züge",
      "skills": "Skills"
    },
    "yes": "ja",
    "no": "nein",
    "heading": "Anweisungsdrift",
    "desc": "Frühe Anweisungen verlieren mit wachsender Sitzung an Griff, und die Kompaktierung verwässert sie schneller. „Ich habe es einmal gesagt“ trägt nicht.",
    "note": "Wichtige Einschränkungen müssen in jedem Zug erneut eingespeist oder als erhaltener Abschnitt durch die Kompaktierung markiert werden.",
    "noteLong": "Die Sitzung ist lang genug, dass frühe Anweisungen wahrscheinlich verblasst sind. Wiederholen Sie die Einschränkungen, die weiter gelten sollen."
  },
  "hi": {
    "level": {
      "noRules": "कोई स्थायी नियम नहीं",
      "rising": "पतला हो रहा",
      "high": "शायद पतला",
      "fresh": "अभी स्पष्ट"
    },
    "check": {
      "rules": "स्थायी नियम",
      "turns": "टर्न",
      "skills": "स्किल"
    },
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "निर्देश बहाव",
    "desc": "सत्र खिंचने पर शुरुआती निर्देश अपनी पकड़ खो देते हैं, और संपीड़न उन्हें और तेज़ी से पतला करता है। «मैंने एक बार कह दिया था» यहाँ नहीं चलता।",
    "note": "अहम बंदिशों को हर बारी दोबारा डालना पड़ता है, या संपीड़न के पार बचाए जाने वाले हिस्से के रूप में चिह्नित करना पड़ता है।",
    "noteLong": "सत्र इतना लंबा हो चुका है कि शुरुआती निर्देश संभवतः धुँधले पड़ गए हैं। जो बंदिशें अब भी लागू हैं, उन्हें फिर से कहिए।"
  },
  "id": {
    "level": {
      "noRules": "Tidak ada aturan tetap",
      "rising": "Mengencer",
      "high": "Mungkin mengencer",
      "fresh": "Masih segar"
    },
    "check": {
      "rules": "Aturan tetap",
      "turns": "Giliran",
      "skills": "Skill"
    },
    "yes": "ya",
    "no": "tidak",
    "heading": "Pergeseran instruksi",
    "desc": "Instruksi awal kehilangan cengkeramannya seiring sesi memanjang, dan pemadatan mengencerkannya lebih cepat. «Saya sudah bilang sekali» tidak berlaku.",
    "note": "Batasan penting perlu disuntikkan ulang setiap giliran, atau ditandai sebagai bagian yang dipertahankan melewati pemadatan.",
    "noteLong": "Sesi sudah cukup panjang sehingga instruksi awal kemungkinan memudar. Sebutkan lagi batasan yang masih berlaku."
  },
  "it": {
    "level": {
      "noRules": "Nessuna regola permanente",
      "rising": "In diluizione",
      "high": "Probabilmente diluito",
      "fresh": "Ancora fresco"
    },
    "check": {
      "rules": "Regole permanenti",
      "turns": "Turni",
      "skills": "Competenze"
    },
    "yes": "sì",
    "no": "no",
    "heading": "Deriva delle istruzioni",
    "desc": "Le istruzioni iniziali perdono presa man mano che la sessione cresce, e la compattazione le diluisce più in fretta. «L’ho detto una volta» non regge.",
    "note": "I vincoli importanti vanno reiniettati a ogni turno, oppure marcati come sezione preservata attraverso la compattazione.",
    "noteLong": "La sessione è abbastanza lunga perché le istruzioni iniziali si siano sbiadite. Ripeti i vincoli che contano ancora."
  },
  "pt-BR": {
    "level": {
      "noRules": "Sem regras permanentes",
      "rising": "Diluindo",
      "high": "Provavelmente diluído",
      "fresh": "Ainda fresco"
    },
    "check": {
      "rules": "Regras permanentes",
      "turns": "Turnos",
      "skills": "Habilidades"
    },
    "yes": "sim",
    "no": "não",
    "heading": "Deriva de instruções",
    "desc": "As instruções iniciais perdem força conforme a sessão cresce, e a compactação as dilui mais rápido. «Eu já disse uma vez» não se sustenta.",
    "note": "Restrições importantes precisam ser reinjetadas a cada turno, ou marcadas como seção preservada através da compactação.",
    "noteLong": "A sessão está longa o bastante para que as instruções iniciais tenham desbotado. Repita as restrições que ainda importam."
  }
} as const;
