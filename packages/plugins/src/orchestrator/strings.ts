/**
 * orchestrator — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.orchestrator` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows whether this agent acts as a supervisor or does the work itself. Gathering agents without a supervisor is a known anti-pattern — scale grows and reliability drops.",
    "heading": "Orchestrator",
    "level": {
      "worker": "Does the work",
      "mixed": "Mixed",
      "supervisor": "Supervises"
    },
    "check": {
      "delegated": "Delegated sessions",
      "turns": "Own turns",
      "running": "Running now"
    },
    "note": "The recommended shape is a supervisor that judges while the actual tool execution lives below it."
  },
  "ko": {
    "desc": "이 에이전트가 감독자 구실을 하는지, 직접 일하는지 보여줍니다. 감독자 없이 에이전트만 모아 두면 규모만 커지고 신뢰도는 떨어집니다.",
    "heading": "오케스트레이터",
    "level": {
      "worker": "직접 일함",
      "mixed": "섞여 있음",
      "supervisor": "감독함"
    },
    "check": {
      "delegated": "위임한 세션",
      "turns": "자기 턴",
      "running": "지금 도는 것"
    },
    "note": "권장 형태는 감독자가 판단만 하고 실제 도구 실행은 하위에 두는 구조입니다."
  },
  "ja": {
    "level": {
      "mixed": "混在",
      "worker": "自分で作業",
      "supervisor": "監督する"
    },
    "check": {
      "running": "実行中",
      "delegated": "委譲セッション",
      "turns": "自身のターン"
    },
    "heading": "オーケストレーター",
    "desc": "このエージェントが監督役を務めているか、自分で作業しているかを示します。監督なしにエージェントだけ集めると、規模だけ大きくなって信頼度は下がります。",
    "note": "推奨される形は、監督役が判断だけを行い、実際のツール実行は下位に置く構造です。"
  },
  "zh-CN": {
    "level": {
      "mixed": "混合",
      "worker": "亲自干活",
      "supervisor": "进行监督"
    },
    "check": {
      "running": "正在运行",
      "delegated": "委派会话",
      "turns": "自身轮次"
    },
    "heading": "编排者",
    "desc": "显示这个智能体是在做监督还是自己干活。没有监督者却把智能体堆在一起，规模变大而可靠性下降。",
    "note": "推荐的形态是：监督者只做判断，实际的工具执行放在下层。"
  },
  "es": {
    "level": {
      "mixed": "Mixto",
      "worker": "Hace el trabajo",
      "supervisor": "Supervisa"
    },
    "check": {
      "running": "En ejecución",
      "delegated": "Sesiones delegadas",
      "turns": "Turnos propios"
    },
    "heading": "Orquestador",
    "desc": "Muestra si este agente actúa como supervisor o hace el trabajo él mismo. Juntar agentes sin supervisor es un antipatrón conocido — crece la escala y baja la fiabilidad.",
    "note": "La forma recomendada es un supervisor que juzga, mientras la ejecución real de herramientas vive por debajo."
  },
  "es-419": {
    "level": {
      "mixed": "Mixto",
      "worker": "Hace el trabajo",
      "supervisor": "Supervisa"
    },
    "check": {
      "running": "En ejecución",
      "delegated": "Sesiones delegadas",
      "turns": "Turnos propios"
    },
    "heading": "Orquestador",
    "desc": "Muestra si este agente actúa como supervisor o hace el trabajo él mismo. Juntar agentes sin supervisor es un antipatrón conocido — crece la escala y baja la fiabilidad.",
    "note": "La forma recomendada es un supervisor que juzga, mientras la ejecución real de herramientas vive por debajo."
  },
  "fr": {
    "level": {
      "mixed": "Mixte",
      "worker": "Fait le travail",
      "supervisor": "Supervise"
    },
    "check": {
      "running": "En cours",
      "delegated": "Sessions déléguées",
      "turns": "Tours propres"
    },
    "heading": "Orchestrateur",
    "desc": "Indique si cet agent joue le rôle de superviseur ou fait le travail lui-même. Rassembler des agents sans superviseur est un anti-modèle connu — l’échelle grandit, la fiabilité baisse.",
    "note": "La forme recommandée est un superviseur qui juge, l’exécution réelle des outils se situant en dessous."
  },
  "de": {
    "level": {
      "mixed": "Gemischt",
      "worker": "Erledigt selbst",
      "supervisor": "Beaufsichtigt"
    },
    "check": {
      "running": "Läuft gerade",
      "delegated": "Delegierte Sitzungen",
      "turns": "Eigene Züge"
    },
    "heading": "Orchestrator",
    "desc": "Zeigt, ob dieser Agent als Aufseher handelt oder die Arbeit selbst erledigt. Agenten ohne Aufseher zu versammeln ist ein bekanntes Anti-Muster — der Umfang wächst, die Verlässlichkeit sinkt.",
    "note": "Die empfohlene Form ist ein Aufseher, der nur urteilt, während die eigentliche Werkzeugausführung darunter liegt."
  },
  "hi": {
    "level": {
      "mixed": "मिश्रित",
      "worker": "खुद काम करता",
      "supervisor": "पर्यवेक्षण करता"
    },
    "check": {
      "running": "अभी चल रहा",
      "delegated": "सौंपे सत्र",
      "turns": "स्वयं के टर्न"
    },
    "heading": "ऑर्केस्ट्रेटर",
    "desc": "दिखाता है कि यह एजेंट पर्यवेक्षक की भूमिका में है या ख़ुद काम कर रहा है। बिना पर्यवेक्षक के एजेंट जमा करना जाना-पहचाना दोष है — पैमाना बढ़ता है और भरोसा घटता है।",
    "note": "सुझाया गया रूप है — निर्णय करता पर्यवेक्षक ऊपर, और असली टूल-निष्पादन उसके नीचे।"
  },
  "id": {
    "level": {
      "mixed": "Campuran",
      "worker": "Mengerjakan sendiri",
      "supervisor": "Mengawasi"
    },
    "check": {
      "running": "Sedang berjalan",
      "delegated": "Sesi didelegasikan",
      "turns": "Giliran sendiri"
    },
    "heading": "Orkestrator",
    "desc": "Menunjukkan apakah agen ini berperan sebagai pengawas atau mengerjakan sendiri. Mengumpulkan agen tanpa pengawas adalah antipola yang dikenal — skalanya membesar dan keandalannya turun.",
    "note": "Bentuk yang dianjurkan adalah pengawas yang menilai, sementara eksekusi alat yang sebenarnya berada di bawahnya."
  },
  "it": {
    "level": {
      "mixed": "Misto",
      "worker": "Fa il lavoro",
      "supervisor": "Supervisiona"
    },
    "check": {
      "running": "In esecuzione",
      "delegated": "Sessioni delegate",
      "turns": "Turni propri"
    },
    "heading": "Orchestratore",
    "desc": "Mostra se questo agente fa da supervisore o svolge il lavoro da sé. Radunare agenti senza un supervisore è un anti-pattern noto — la scala cresce e l’affidabilità cala.",
    "note": "La forma consigliata è un supervisore che giudica, mentre l’esecuzione vera degli strumenti sta sotto."
  },
  "pt-BR": {
    "level": {
      "mixed": "Misto",
      "worker": "Faz o trabalho",
      "supervisor": "Supervisiona"
    },
    "check": {
      "running": "Em execução",
      "delegated": "Sessões delegadas",
      "turns": "Turnos próprios"
    },
    "heading": "Orquestrador",
    "desc": "Mostra se este agente age como supervisor ou faz o trabalho ele mesmo. Juntar agentes sem supervisor é um antipadrão conhecido — a escala cresce e a confiabilidade cai.",
    "note": "A forma recomendada é um supervisor que julga, enquanto a execução real das ferramentas fica abaixo."
  }
} as const;
