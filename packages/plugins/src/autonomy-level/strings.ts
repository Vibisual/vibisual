/**
 * autonomy-level — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.autonomyLevel` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows which rung this agent sits on — propose only, run after approval, or run on its own and report. Leaving autonomy as all-or-nothing is the most common design failure.",
    "heading": "Autonomy Level",
    "level": {
      "suggest": "Propose only",
      "approve": "Runs after approval",
      "autonomous": "Runs on its own"
    },
    "badge": {
      "autonomous": "Autonomy: executes without asking"
    },
    "row": {
      "mode": "Permission mode",
      "timeout": "If you do not answer",
      "maxTurns": "Turn cap",
      "isolation": "Isolation"
    },
    "timeout": {
      "allow": "auto-allow",
      "deny": "auto-block"
    },
    "timeoutHint": "Stepping away turns approval into automatic consent — the rung effectively moves up.",
    "ladderNote": "Autonomy is something you raise as trust accumulates, not something granted from the start.",
    "isolated": "worktree",
    "notIsolated": "same folder",
    "unlimited": "unlimited",
    "levelDesc": {
      "suggest": "Plan mode — nothing is executed.",
      "approve": "Mutating tools raise an approval prompt.",
      "autonomous": "No approval prompt appears at all."
    }
  },
  "ko": {
    "desc": "이 에이전트가 어느 칸에 있는지 보여줍니다 — 제안만 / 승인 후 실행 / 자율 실행 후 보고. 자율성을 전부 아니면 전무로 두는 것이 가장 흔한 설계 실패입니다.",
    "heading": "자율성 등급",
    "level": {
      "suggest": "제안만",
      "approve": "승인 후 실행",
      "autonomous": "자율 실행"
    },
    "badge": {
      "autonomous": "자율성: 묻지 않고 실행합니다"
    },
    "row": {
      "mode": "퍼미션 모드",
      "timeout": "무응답일 때",
      "maxTurns": "턴 상한",
      "isolation": "격리"
    },
    "timeout": {
      "allow": "자동 허용",
      "deny": "자동 차단"
    },
    "timeoutHint": "자리를 비우면 승인이 자동 동의가 되어 등급이 사실상 한 칸 올라갑니다.",
    "ladderNote": "자율성은 신뢰가 쌓이면 올리는 것이지 처음부터 주는 것이 아닙니다.",
    "isolated": "worktree",
    "notIsolated": "같은 폴더",
    "unlimited": "무제한",
    "levelDesc": {
      "suggest": "계획 모드 — 실행이 일어나지 않습니다.",
      "approve": "가변 도구는 승인 팝업을 띄웁니다.",
      "autonomous": "승인 팝업이 아예 뜨지 않습니다."
    }
  },
  "ja": {
    "desc": "このエージェントがどの段にいるかを示します — 提案のみ / 承認後に実行 / 自律実行して報告。自律性を全か無かで置くのが最も多い設計上の失敗です。",
    "heading": "自律性の段階",
    "level": {
      "suggest": "提案のみ",
      "approve": "承認後に実行",
      "autonomous": "自律実行"
    },
    "badge": {
      "autonomous": "自律性: 尋ねずに実行します"
    },
    "row": {
      "mode": "パーミッションモード",
      "timeout": "無応答のとき",
      "maxTurns": "ターン上限",
      "isolation": "隔離"
    },
    "timeout": {
      "allow": "自動許可",
      "deny": "自動ブロック"
    },
    "timeoutHint": "席を外すと承認が自動同意になり、段階が実質的に一つ上がります。",
    "ladderNote": "自律性は信頼が積み上がってから上げるもので、最初から与えるものではありません。",
    "isolated": "worktree",
    "notIsolated": "同じフォルダ",
    "unlimited": "無制限",
    "levelDesc": {
      "suggest": "プランモード — 実行は行われません。",
      "approve": "可変ツールは承認ダイアログを出します。",
      "autonomous": "承認ダイアログは一切出ません。"
    }
  },
  "zh-CN": {
    "desc": "显示该智能体处于哪一档 — 仅建议 / 批准后执行 / 自主执行并汇报。把自主权设成全有或全无是最常见的设计失误。",
    "heading": "自主等级",
    "level": {
      "suggest": "仅建议",
      "approve": "批准后执行",
      "autonomous": "自主执行"
    },
    "badge": {
      "autonomous": "自主等级：不询问直接执行"
    },
    "row": {
      "mode": "权限模式",
      "timeout": "若你未回应",
      "maxTurns": "轮次上限",
      "isolation": "隔离"
    },
    "timeout": {
      "allow": "自动允许",
      "deny": "自动阻止"
    },
    "timeoutHint": "一旦离开，审批就变成自动同意，等级实际上升一档。",
    "ladderNote": "自主权应在信任积累后再提升，而不是一开始就给足。",
    "isolated": "worktree",
    "notIsolated": "同一目录",
    "unlimited": "不限",
    "levelDesc": {
      "suggest": "计划模式 — 不会执行任何操作。",
      "approve": "可变工具会弹出审批提示。",
      "autonomous": "完全不会弹出审批提示。"
    }
  },
  "es": {
    "desc": "Muestra en qué peldaño está este agente: solo proponer, ejecutar tras aprobación, o ejecutar solo e informar. Dejar la autonomía en todo o nada es el fallo de diseño más común.",
    "heading": "Nivel de autonomía",
    "level": {
      "suggest": "Solo proponer",
      "approve": "Ejecuta tras aprobación",
      "autonomous": "Ejecuta por su cuenta"
    },
    "badge": {
      "autonomous": "Autonomía: ejecuta sin preguntar"
    },
    "row": {
      "mode": "Modo de permisos",
      "timeout": "Si no respondes",
      "maxTurns": "Límite de turnos",
      "isolation": "Aislamiento"
    },
    "timeout": {
      "allow": "permitir automáticamente",
      "deny": "bloquear automáticamente"
    },
    "timeoutHint": "Si te alejas, la aprobación se vuelve consentimiento automático: el peldaño sube de hecho.",
    "ladderNote": "La autonomía se sube cuando se acumula confianza, no se concede desde el principio.",
    "isolated": "worktree",
    "notIsolated": "misma carpeta",
    "unlimited": "sin límite",
    "levelDesc": {
      "suggest": "Modo plan: no se ejecuta nada.",
      "approve": "Las herramientas mutables piden aprobación.",
      "autonomous": "No aparece ninguna solicitud de aprobación."
    }
  },
  "es-419": {
    "desc": "Muestra en qué peldaño está este agente: solo proponer, ejecutar tras aprobación, o ejecutar solo e informar. Dejar la autonomía en todo o nada es el fallo de diseño más común.",
    "heading": "Nivel de autonomía",
    "level": {
      "suggest": "Solo proponer",
      "approve": "Ejecuta tras aprobación",
      "autonomous": "Ejecuta por su cuenta"
    },
    "badge": {
      "autonomous": "Autonomía: ejecuta sin preguntar"
    },
    "row": {
      "mode": "Modo de permisos",
      "timeout": "Si no respondes",
      "maxTurns": "Límite de turnos",
      "isolation": "Aislamiento"
    },
    "timeout": {
      "allow": "permitir automáticamente",
      "deny": "bloquear automáticamente"
    },
    "timeoutHint": "Si te alejas, la aprobación se vuelve consentimiento automático: el peldaño sube de hecho.",
    "ladderNote": "La autonomía se sube cuando se acumula confianza, no se concede desde el principio.",
    "isolated": "worktree",
    "notIsolated": "misma carpeta",
    "unlimited": "sin límite",
    "levelDesc": {
      "suggest": "Modo plan: no se ejecuta nada.",
      "approve": "Las herramientas mutables piden aprobación.",
      "autonomous": "No aparece ninguna solicitud de aprobación."
    }
  },
  "fr": {
    "desc": "Indique à quel échelon se trouve cet agent : proposer seulement, exécuter après approbation, ou exécuter seul et rendre compte. Laisser l’autonomie en tout ou rien est l’échec de conception le plus courant.",
    "heading": "Niveau d’autonomie",
    "level": {
      "suggest": "Proposer seulement",
      "approve": "Exécute après approbation",
      "autonomous": "Exécute seul"
    },
    "badge": {
      "autonomous": "Autonomie : exécute sans demander"
    },
    "row": {
      "mode": "Mode de permission",
      "timeout": "Si vous ne répondez pas",
      "maxTurns": "Plafond de tours",
      "isolation": "Isolation"
    },
    "timeout": {
      "allow": "autorisation auto",
      "deny": "blocage auto"
    },
    "timeoutHint": "Si vous vous absentez, l’approbation devient un consentement automatique — l’échelon monte de fait.",
    "ladderNote": "L’autonomie se relève à mesure que la confiance s’installe ; elle ne se donne pas d’emblée.",
    "isolated": "worktree",
    "notIsolated": "même dossier",
    "unlimited": "illimité",
    "levelDesc": {
      "suggest": "Mode plan — rien n’est exécuté.",
      "approve": "Les outils mutables déclenchent une demande d’approbation.",
      "autonomous": "Aucune demande d’approbation n’apparaît."
    }
  },
  "de": {
    "desc": "Zeigt, auf welcher Stufe dieser Agent steht — nur vorschlagen, nach Freigabe ausführen oder selbstständig ausführen und berichten. Autonomie als Alles-oder-nichts zu belassen ist der häufigste Entwurfsfehler.",
    "heading": "Autonomiestufe",
    "level": {
      "suggest": "Nur vorschlagen",
      "approve": "Führt nach Freigabe aus",
      "autonomous": "Führt selbstständig aus"
    },
    "badge": {
      "autonomous": "Autonomie: führt ohne Rückfrage aus"
    },
    "row": {
      "mode": "Berechtigungsmodus",
      "timeout": "Wenn Sie nicht antworten",
      "maxTurns": "Zugbegrenzung",
      "isolation": "Isolierung"
    },
    "timeout": {
      "allow": "automatisch erlauben",
      "deny": "automatisch blockieren"
    },
    "timeoutHint": "Wenn Sie weggehen, wird die Freigabe zur automatischen Zustimmung — die Stufe steigt faktisch.",
    "ladderNote": "Autonomie erhöht man, wenn Vertrauen gewachsen ist — man gibt sie nicht von Anfang an.",
    "isolated": "Worktree",
    "notIsolated": "gleicher Ordner",
    "unlimited": "unbegrenzt",
    "levelDesc": {
      "suggest": "Planmodus — nichts wird ausgeführt.",
      "approve": "Verändernde Werkzeuge lösen eine Freigabe aus.",
      "autonomous": "Es erscheint überhaupt keine Freigabeabfrage."
    }
  },
  "hi": {
    "desc": "दिखाता है कि यह एजेंट किस पायदान पर है — केवल सुझाव / स्वीकृति के बाद निष्पादन / स्वायत्त निष्पादन और रिपोर्ट। स्वायत्तता को सब-या-कुछ नहीं रखना सबसे आम डिज़ाइन चूक है।",
    "heading": "स्वायत्तता स्तर",
    "level": {
      "suggest": "केवल सुझाव",
      "approve": "स्वीकृति के बाद",
      "autonomous": "स्वायत्त निष्पादन"
    },
    "badge": {
      "autonomous": "स्वायत्तता: बिना पूछे निष्पादन"
    },
    "row": {
      "mode": "अनुमति मोड",
      "timeout": "यदि आप उत्तर न दें",
      "maxTurns": "टर्न सीमा",
      "isolation": "पृथक्करण"
    },
    "timeout": {
      "allow": "स्वतः अनुमति",
      "deny": "स्वतः अवरोध"
    },
    "timeoutHint": "दूर जाने पर स्वीकृति स्वतः सहमति बन जाती है — स्तर वस्तुतः बढ़ जाता है।",
    "ladderNote": "स्वायत्तता भरोसा बनने पर बढ़ाई जाती है, शुरू से दी नहीं जाती।",
    "isolated": "worktree",
    "notIsolated": "वही फ़ोल्डर",
    "unlimited": "असीमित",
    "levelDesc": {
      "suggest": "योजना मोड — कुछ भी निष्पादित नहीं होता।",
      "approve": "परिवर्तनकारी टूल स्वीकृति माँगते हैं।",
      "autonomous": "कोई स्वीकृति संकेत नहीं आता।"
    }
  },
  "id": {
    "desc": "Menunjukkan agen ini ada di anak tangga mana — hanya mengusulkan, menjalankan setelah persetujuan, atau berjalan sendiri lalu melapor. Membiarkan otonomi jadi semua-atau-tidak adalah kegagalan desain paling umum.",
    "heading": "Tingkat otonomi",
    "level": {
      "suggest": "Hanya usul",
      "approve": "Jalan setelah disetujui",
      "autonomous": "Jalan sendiri"
    },
    "badge": {
      "autonomous": "Otonomi: menjalankan tanpa bertanya"
    },
    "row": {
      "mode": "Mode izin",
      "timeout": "Jika Anda tidak menjawab",
      "maxTurns": "Batas giliran",
      "isolation": "Isolasi"
    },
    "timeout": {
      "allow": "izinkan otomatis",
      "deny": "blokir otomatis"
    },
    "timeoutHint": "Bila Anda pergi, persetujuan menjadi izin otomatis — tingkatnya efektif naik.",
    "ladderNote": "Otonomi dinaikkan seiring tumbuhnya kepercayaan, bukan diberikan sejak awal.",
    "isolated": "worktree",
    "notIsolated": "folder sama",
    "unlimited": "tanpa batas",
    "levelDesc": {
      "suggest": "Mode rencana — tidak ada yang dijalankan.",
      "approve": "Alat yang mengubah memunculkan permintaan persetujuan.",
      "autonomous": "Tidak ada permintaan persetujuan sama sekali."
    }
  },
  "it": {
    "desc": "Mostra su quale gradino si trova questo agente — solo proporre, eseguire dopo approvazione, oppure eseguire da solo e riferire. Lasciare l’autonomia tutto-o-niente è l’errore di progettazione più comune.",
    "heading": "Livello di autonomia",
    "level": {
      "suggest": "Solo proporre",
      "approve": "Esegue dopo approvazione",
      "autonomous": "Esegue da solo"
    },
    "badge": {
      "autonomous": "Autonomia: esegue senza chiedere"
    },
    "row": {
      "mode": "Modalità permessi",
      "timeout": "Se non rispondi",
      "maxTurns": "Limite di turni",
      "isolation": "Isolamento"
    },
    "timeout": {
      "allow": "consenti automatico",
      "deny": "blocca automatico"
    },
    "timeoutHint": "Se ti allontani, l’approvazione diventa consenso automatico: il gradino sale di fatto.",
    "ladderNote": "L’autonomia si alza quando la fiducia cresce, non si concede dall’inizio.",
    "isolated": "worktree",
    "notIsolated": "stessa cartella",
    "unlimited": "illimitato",
    "levelDesc": {
      "suggest": "Modalità piano — non viene eseguito nulla.",
      "approve": "Gli strumenti che modificano chiedono approvazione.",
      "autonomous": "Non compare alcuna richiesta di approvazione."
    }
  },
  "pt-BR": {
    "desc": "Mostra em que degrau este agente está — apenas propor, executar após aprovação, ou executar sozinho e relatar. Deixar a autonomia como tudo ou nada é a falha de projeto mais comum.",
    "heading": "Nível de autonomia",
    "level": {
      "suggest": "Apenas propor",
      "approve": "Executa após aprovação",
      "autonomous": "Executa sozinho"
    },
    "badge": {
      "autonomous": "Autonomia: executa sem perguntar"
    },
    "row": {
      "mode": "Modo de permissão",
      "timeout": "Se você não responder",
      "maxTurns": "Limite de turnos",
      "isolation": "Isolamento"
    },
    "timeout": {
      "allow": "permitir automaticamente",
      "deny": "bloquear automaticamente"
    },
    "timeoutHint": "Se você se afastar, a aprovação vira consentimento automático — o degrau sobe na prática.",
    "ladderNote": "Autonomia é algo que se eleva conforme a confiança se acumula, não algo dado desde o início.",
    "isolated": "worktree",
    "notIsolated": "mesma pasta",
    "unlimited": "sem limite",
    "levelDesc": {
      "suggest": "Modo plano — nada é executado.",
      "approve": "Ferramentas que alteram pedem aprovação.",
      "autonomous": "Nenhum pedido de aprovação aparece."
    }
  }
} as const;
