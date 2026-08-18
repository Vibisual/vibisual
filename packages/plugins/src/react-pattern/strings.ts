/**
 * react-pattern — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.reactPattern` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Reason and act alternating is the default shape, not one option among many. This card watches for the signal that it is no longer enough — a long run with nothing written down.",
    "heading": "ReAct",
    "level": {
      "idle": "Not started",
      "healthy": "Healthy",
      "drifting": "May be drifting"
    },
    "check": {
      "turns": "Turns",
      "plan": "Plan recorded"
    },
    "yes": "yes",
    "no": "no",
    "note": "The signals that ReAct alone is not enough: circling the same tool, losing the goal, moving on without verifying.",
    "noteDrifting": "A long run with no plan recorded. This is where a written plan or a verifier step usually pays for itself."
  },
  "ko": {
    "desc": "생각과 행동을 번갈아 하는 것은 선택지가 아니라 기본형입니다. 이 카드는 그것만으로 부족해지는 신호 — 아무것도 적어 두지 않은 채 길어지는 진행 — 를 봅니다.",
    "heading": "ReAct",
    "level": {
      "idle": "시작 전",
      "healthy": "정상",
      "drifting": "지엽으로 빠질 수 있음"
    },
    "check": {
      "turns": "턴 수",
      "plan": "계획 기록"
    },
    "yes": "있음",
    "no": "없음",
    "note": "ReAct 만으로 부족한 신호: 같은 도구를 맴돌거나, 목표를 잊거나, 검증 없이 다음으로 넘어갈 때.",
    "noteDrifting": "계획 없이 길어졌습니다. 이 구간에서 적어 둔 계획이나 검증자 단계가 대개 값을 합니다."
  },
  "ja": {
    "check": {
      "turns": "ターン数",
      "plan": "計画の記録"
    },
    "yes": "はい",
    "no": "いいえ",
    "heading": "ReAct",
    "level": {
      "healthy": "健全",
      "drifting": "逸れている可能性",
      "idle": "未開始"
    },
    "desc": "思考と行動を交互に回すのは選択肢の一つではなく基本形です。このカードは、それだけでは足りなくなる兆候 — 何も書き留めないまま長引く進行 — を見ます。",
    "note": "ReAct だけでは足りない兆候：同じツールの周りを回る、目標を見失う、検証せず次へ進む。",
    "noteDrifting": "計画のないまま長引いています。この区間では、書き出した計画や検証者の一手が大抵は元を取ります。"
  },
  "zh-CN": {
    "check": {
      "turns": "轮次",
      "plan": "已记录计划"
    },
    "yes": "是",
    "no": "否",
    "heading": "ReAct",
    "level": {
      "healthy": "健康",
      "drifting": "可能已偏离",
      "idle": "未开始"
    },
    "desc": "思考与行动交替是默认形态，而不是众多选项之一。这张卡片盯的是「它已经不够用」的信号 — 什么都没写下却越拖越长。",
    "note": "仅靠 ReAct 不够的信号：围着同一个工具打转、丢失目标、不验证就进入下一步。",
    "noteDrifting": "没有计划却已经拖得很长。在这个区间，写下的计划或一个验证环节通常都能回本。"
  },
  "es": {
    "check": {
      "turns": "Turnos",
      "plan": "Plan registrado"
    },
    "yes": "sí",
    "no": "no",
    "heading": "ReAct",
    "level": {
      "healthy": "Sano",
      "drifting": "Puede estar desviándose",
      "idle": "Sin empezar"
    },
    "desc": "Alternar razonar y actuar es la forma por defecto, no una opción entre varias. Esta tarjeta vigila la señal de que ya no basta — una tanda larga sin nada anotado.",
    "note": "Señales de que ReAct por sí solo no basta: dar vueltas con la misma herramienta, perder el objetivo, seguir adelante sin verificar.",
    "noteDrifting": "Una tanda larga sin plan registrado. Aquí es donde un plan escrito o un paso de verificación suelen amortizarse."
  },
  "es-419": {
    "check": {
      "turns": "Turnos",
      "plan": "Plan registrado"
    },
    "yes": "sí",
    "no": "no",
    "heading": "ReAct",
    "level": {
      "healthy": "Sano",
      "drifting": "Puede estar desviándose",
      "idle": "Sin empezar"
    },
    "desc": "Alternar razonar y actuar es la forma por defecto, no una opción entre varias. Esta tarjeta vigila la señal de que ya no basta — una tanda larga sin nada anotado.",
    "note": "Señales de que ReAct por sí solo no basta: dar vueltas con la misma herramienta, perder el objetivo, seguir adelante sin verificar.",
    "noteDrifting": "Una tanda larga sin plan registrado. Aquí es donde un plan escrito o un paso de verificación suelen amortizarse."
  },
  "fr": {
    "check": {
      "turns": "Tours",
      "plan": "Plan enregistré"
    },
    "yes": "oui",
    "no": "non",
    "heading": "ReAct",
    "level": {
      "healthy": "Sain",
      "drifting": "Peut dériver",
      "idle": "Pas démarré"
    },
    "desc": "Alterner raisonnement et action est la forme par défaut, pas une option parmi d’autres. Cette carte guette le signal que cela ne suffit plus — une longue série sans rien de consigné.",
    "note": "Les signaux que ReAct seul ne suffit pas : tourner autour du même outil, perdre l’objectif, passer à la suite sans vérifier.",
    "noteDrifting": "Une longue série sans plan enregistré. C’est là qu’un plan écrit ou une étape de vérification s’amortit généralement."
  },
  "de": {
    "check": {
      "turns": "Züge",
      "plan": "Plan erfasst"
    },
    "yes": "ja",
    "no": "nein",
    "heading": "ReAct",
    "level": {
      "healthy": "Gesund",
      "drifting": "Könnte abdriften",
      "idle": "Nicht gestartet"
    },
    "desc": "Denken und Handeln im Wechsel ist die Grundform, nicht eine Option unter vielen. Diese Karte achtet auf das Signal, dass es nicht mehr reicht — ein langer Lauf, in dem nichts festgehalten wurde.",
    "note": "Signale, dass ReAct allein nicht genügt: um dasselbe Werkzeug kreisen, das Ziel verlieren, ohne Prüfung weitergehen.",
    "noteDrifting": "Ein langer Lauf ohne erfassten Plan. Genau hier zahlt sich ein aufgeschriebener Plan oder ein Prüfschritt meist aus."
  },
  "hi": {
    "check": {
      "turns": "टर्न",
      "plan": "योजना दर्ज"
    },
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "ReAct",
    "level": {
      "healthy": "स्वस्थ",
      "drifting": "भटक सकता है",
      "idle": "शुरू नहीं हुआ"
    },
    "desc": "सोचना और करना बारी-बारी चलाना इसका मूल रूप है, कई विकल्पों में से एक नहीं। यह कार्ड उस संकेत पर नज़र रखता है कि अब इतना काफ़ी नहीं — बिना एक भी दर्ज पड़ाव के लंबी शृंखला।",
    "note": "संकेत कि अकेला ReAct कम पड़ रहा है: वही टूल बार-बार घूमना, लक्ष्य खो देना, बिना जाँचे आगे बढ़ते रहना।",
    "noteDrifting": "बिना दर्ज योजना के लंबी शृंखला। यहीं आकर लिखी हुई योजना या एक जाँच-चरण आम तौर पर अपनी कीमत वसूल कर लेता है।"
  },
  "id": {
    "check": {
      "turns": "Giliran",
      "plan": "Rencana tercatat"
    },
    "yes": "ya",
    "no": "tidak",
    "heading": "ReAct",
    "level": {
      "healthy": "Sehat",
      "drifting": "Mungkin melenceng",
      "idle": "Belum dimulai"
    },
    "desc": "Bergantian menalar dan bertindak adalah bentuk bawaannya, bukan salah satu pilihan. Kartu ini mengawasi tanda bahwa itu tidak lagi cukup — rangkaian panjang tanpa satu pun catatan.",
    "note": "Tanda bahwa ReAct saja tidak cukup: berputar di alat yang sama, kehilangan tujuan, melanjutkan tanpa memverifikasi.",
    "noteDrifting": "Rangkaian panjang tanpa rencana tercatat. Di titik inilah rencana tertulis atau satu langkah verifikasi biasanya terbayar."
  },
  "it": {
    "check": {
      "turns": "Turni",
      "plan": "Piano registrato"
    },
    "yes": "sì",
    "no": "no",
    "heading": "ReAct",
    "level": {
      "healthy": "Sano",
      "drifting": "Potrebbe deviare",
      "idle": "Non avviato"
    },
    "desc": "Alternare ragionamento e azione è la forma predefinita, non un’opzione tra tante. Questa scheda sorveglia il segnale che non basta più — una serie lunga senza nulla di annotato.",
    "note": "Segnali che ReAct da solo non basta: girare attorno allo stesso strumento, perdere l’obiettivo, andare avanti senza verificare.",
    "noteDrifting": "Serie lunga senza piano registrato. È qui che un piano scritto o un passo di verifica di solito si ripaga."
  },
  "pt-BR": {
    "check": {
      "turns": "Turnos",
      "plan": "Plano registrado"
    },
    "yes": "sim",
    "no": "não",
    "heading": "ReAct",
    "level": {
      "healthy": "Saudável",
      "drifting": "Pode estar desviando",
      "idle": "Não iniciado"
    },
    "desc": "Alternar raciocínio e ação é a forma padrão, não uma opção entre várias. Este cartão observa o sinal de que já não basta — uma sequência longa sem nada anotado.",
    "note": "Sinais de que ReAct sozinho não basta: girar em torno da mesma ferramenta, perder o objetivo, seguir adiante sem verificar.",
    "noteDrifting": "Sequência longa sem plano registrado. É aqui que um plano escrito ou uma etapa de verificação normalmente se paga."
  }
} as const;
