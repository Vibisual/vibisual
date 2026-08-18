/**
 * guardrails — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.guardrails` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows whether anything actually stops a tool call. A guardrail placed right before the tool call catches damage at the last moment; placed only in front of the model, it catches too late.",
    "heading": "Guardrails",
    "level": {
      "blocked": "Nothing executes",
      "gated": "Gated at tool call",
      "none": "No gate"
    },
    "check": {
      "mode": "Permission mode",
      "denied": "Blocked tools",
      "timeout": "If you do not answer",
      "tools": "Tools in effect"
    },
    "timeout": {
      "allow": "auto-allow",
      "deny": "auto-block"
    },
    "notePlacement": "The approval prompt sits right before the tool call — the position that catches damage latest and cheapest.",
    "noteNone": "No approval prompt appears, so nothing intercepts a tool call before it runs."
  },
  "ko": {
    "desc": "도구 호출을 실제로 가로막는 지점이 있는지 보여줍니다. 가드레일은 모델 앞이 아니라 **도구 호출 직전**에 있어야 실제 피해 직전에 잡습니다.",
    "heading": "가드레일",
    "level": {
      "blocked": "실행 자체가 없음",
      "gated": "도구 호출 직전에서 가로막힘",
      "none": "관문 없음"
    },
    "check": {
      "mode": "퍼미션 모드",
      "denied": "차단한 도구",
      "timeout": "무응답일 때",
      "tools": "실효 도구 수"
    },
    "timeout": {
      "allow": "자동 허용",
      "deny": "자동 차단"
    },
    "notePlacement": "승인 팝업이 도구 호출 직전에 서 있습니다 — 피해 직전에, 가장 싸게 잡는 자리입니다.",
    "noteNone": "승인 팝업이 뜨지 않아, 도구가 실행되기 전에 가로막는 것이 없습니다."
  },
  "ja": {
    "check": {
      "mode": "パーミッションモード",
      "timeout": "無応答のとき",
      "denied": "禁止ツール",
      "tools": "実効ツール"
    },
    "timeout": {
      "allow": "自動許可",
      "deny": "自動ブロック"
    },
    "heading": "ガードレール",
    "level": {
      "gated": "ツール呼び出し直前で遮断",
      "none": "関門なし",
      "blocked": "実行が起きない"
    },
    "desc": "ツール呼び出しを実際に止めるものがあるかを示します。ガードレールはモデルの手前ではなく**ツール呼び出しの直前**に置いてこそ、被害の直前で捕まえられます。",
    "notePlacement": "承認ダイアログがツール呼び出しの直前に立っています — 被害の直前で、最も安く捕まえられる位置です。",
    "noteNone": "承認ダイアログが出ないため、ツールが実行される前に遮るものがありません。"
  },
  "zh-CN": {
    "check": {
      "mode": "权限模式",
      "timeout": "若你未回应",
      "denied": "禁用工具",
      "tools": "生效工具"
    },
    "timeout": {
      "allow": "自动允许",
      "deny": "自动阻止"
    },
    "heading": "护栏",
    "level": {
      "gated": "在工具调用前拦截",
      "none": "无关口",
      "blocked": "不会执行"
    },
    "desc": "显示是否真的有东西能拦住一次工具调用。护栏要放在**工具调用之前**才能在损害发生前抓住；只放在模型前面就太晚了。",
    "notePlacement": "审批提示就在工具调用之前 — 这是最迟也最省成本的拦截位置。",
    "noteNone": "不会弹出审批提示，因此工具执行前没有任何东西拦截。"
  },
  "es": {
    "check": {
      "mode": "Modo de permisos",
      "timeout": "Si no respondes",
      "denied": "Herramientas bloqueadas",
      "tools": "Herramientas efectivas"
    },
    "timeout": {
      "allow": "permitir automáticamente",
      "deny": "bloquear automáticamente"
    },
    "heading": "Barreras",
    "level": {
      "gated": "Bloqueado antes de la herramienta",
      "none": "Sin puerta",
      "blocked": "No se ejecuta nada"
    },
    "desc": "Muestra si algo detiene realmente una llamada a herramienta. Una barrera puesta **justo antes de la llamada** ataja el daño en el último momento; puesta solo delante del modelo, llega tarde.",
    "notePlacement": "La solicitud de aprobación está justo antes de la llamada a la herramienta — la posición que ataja más tarde y más barato.",
    "noteNone": "No aparece ninguna solicitud de aprobación, así que nada intercepta una llamada antes de que se ejecute."
  },
  "es-419": {
    "check": {
      "mode": "Modo de permisos",
      "timeout": "Si no respondes",
      "denied": "Herramientas bloqueadas",
      "tools": "Herramientas efectivas"
    },
    "timeout": {
      "allow": "permitir automáticamente",
      "deny": "bloquear automáticamente"
    },
    "heading": "Barreras",
    "level": {
      "gated": "Bloqueado antes de la herramienta",
      "none": "Sin puerta",
      "blocked": "No se ejecuta nada"
    },
    "desc": "Muestra si algo detiene realmente una llamada a herramienta. Una barrera puesta **justo antes de la llamada** ataja el daño en el último momento; puesta solo delante del modelo, llega tarde.",
    "notePlacement": "La solicitud de aprobación está justo antes de la llamada a la herramienta — la posición que ataja más tarde y más barato.",
    "noteNone": "No aparece ninguna solicitud de aprobación, así que nada intercepta una llamada antes de que se ejecute."
  },
  "fr": {
    "check": {
      "mode": "Mode de permission",
      "timeout": "Si vous ne répondez pas",
      "denied": "Outils bloqués",
      "tools": "Outils effectifs"
    },
    "timeout": {
      "allow": "autorisation auto",
      "deny": "blocage auto"
    },
    "heading": "Garde-fous",
    "level": {
      "gated": "Bloqué avant l’appel d’outil",
      "none": "Aucune porte",
      "blocked": "Rien ne s’exécute"
    },
    "desc": "Indique si quelque chose arrête réellement un appel d’outil. Un garde-fou placé **juste avant l’appel** intercepte au dernier moment ; placé seulement devant le modèle, il intervient trop tard.",
    "notePlacement": "La demande d’approbation se trouve juste avant l’appel d’outil — la position qui intercepte le plus tard et au moindre coût.",
    "noteNone": "Aucune demande d’approbation n’apparaît, donc rien n’intercepte un appel d’outil avant son exécution."
  },
  "de": {
    "check": {
      "mode": "Berechtigungsmodus",
      "timeout": "Wenn Sie nicht antworten",
      "denied": "Gesperrte Werkzeuge",
      "tools": "Wirksame Werkzeuge"
    },
    "timeout": {
      "allow": "automatisch erlauben",
      "deny": "automatisch blockieren"
    },
    "heading": "Leitplanken",
    "level": {
      "gated": "Vor Werkzeugaufruf gestoppt",
      "none": "Kein Gate",
      "blocked": "Nichts wird ausgeführt"
    },
    "desc": "Zeigt, ob überhaupt etwas einen Werkzeugaufruf stoppt. Eine Leitplanke direkt **vor dem Werkzeugaufruf** greift im letzten Moment; nur vor dem Modell platziert greift sie zu spät.",
    "notePlacement": "Die Freigabeabfrage sitzt unmittelbar vor dem Werkzeugaufruf — die Stelle, die den Schaden am spätesten und am günstigsten abfängt.",
    "noteNone": "Es erscheint keine Freigabeabfrage, also fängt nichts einen Werkzeugaufruf ab, bevor er läuft."
  },
  "hi": {
    "check": {
      "mode": "अनुमति मोड",
      "timeout": "यदि आप उत्तर न दें",
      "denied": "अवरुद्ध टूल",
      "tools": "प्रभावी टूल"
    },
    "timeout": {
      "allow": "स्वतः अनुमति",
      "deny": "स्वतः अवरोध"
    },
    "heading": "गार्डरेल",
    "level": {
      "gated": "टूल कॉल से पहले रोका",
      "none": "कोई द्वार नहीं",
      "blocked": "कुछ निष्पादित नहीं"
    },
    "desc": "दिखाता है कि टूल-कॉल को वास्तव में कोई रोक रहा है या नहीं। **कॉल से ठीक पहले** लगा रक्षक आखिरी क्षण में नुकसान थाम लेता है; केवल मॉडल के आगे लगा हो तो वह बहुत देर से आता है।",
    "notePlacement": "अनुमति की माँग टूल-कॉल से ठीक पहले बैठती है — वही जगह जो सबसे देर तक और सबसे सस्ते में रोकती है।",
    "noteNone": "कोई अनुमति-माँग सामने नहीं आई, यानी चलने से पहले टूल-कॉल को बीच में कुछ भी नहीं रोक रहा।"
  },
  "id": {
    "check": {
      "mode": "Mode izin",
      "timeout": "Jika Anda tidak menjawab",
      "denied": "Alat diblokir",
      "tools": "Alat efektif"
    },
    "timeout": {
      "allow": "izinkan otomatis",
      "deny": "blokir otomatis"
    },
    "heading": "Pagar pengaman",
    "level": {
      "gated": "Dicegat sebelum panggilan alat",
      "none": "Tanpa gerbang",
      "blocked": "Tidak ada yang dijalankan"
    },
    "desc": "Menunjukkan apakah ada sesuatu yang benar-benar menghentikan pemanggilan alat. Pagar pengaman yang dipasang **tepat sebelum pemanggilan** menahan kerusakan pada detik terakhir; jika hanya di depan model, ia datang terlambat.",
    "notePlacement": "Permintaan persetujuan berada tepat sebelum pemanggilan alat — posisi yang menahan paling akhir sekaligus paling murah.",
    "noteNone": "Tidak ada permintaan persetujuan yang muncul, jadi tidak ada yang mencegat pemanggilan alat sebelum dijalankan."
  },
  "it": {
    "check": {
      "mode": "Modalità permessi",
      "timeout": "Se non rispondi",
      "denied": "Strumenti bloccati",
      "tools": "Strumenti effettivi"
    },
    "timeout": {
      "allow": "consenti automatico",
      "deny": "blocca automatico"
    },
    "heading": "Guardrail",
    "level": {
      "gated": "Bloccato prima della chiamata",
      "none": "Nessun varco",
      "blocked": "Non esegue nulla"
    },
    "desc": "Mostra se qualcosa ferma davvero una chiamata a uno strumento. Un guardrail posto **subito prima della chiamata** intercetta all’ultimo momento; messo solo davanti al modello, arriva troppo tardi.",
    "notePlacement": "La richiesta di approvazione sta subito prima della chiamata — la posizione che intercetta più tardi e a minor costo.",
    "noteNone": "Non compare alcuna richiesta di approvazione, quindi nulla intercetta una chiamata prima che venga eseguita."
  },
  "pt-BR": {
    "check": {
      "mode": "Modo de permissão",
      "timeout": "Se você não responder",
      "denied": "Ferramentas bloqueadas",
      "tools": "Ferramentas efetivas"
    },
    "timeout": {
      "allow": "permitir automaticamente",
      "deny": "bloquear automaticamente"
    },
    "heading": "Barreiras",
    "level": {
      "gated": "Barrado antes da chamada",
      "none": "Sem portão",
      "blocked": "Nada é executado"
    },
    "desc": "Mostra se algo realmente impede uma chamada de ferramenta. Uma barreira colocada **logo antes da chamada** intercepta no último instante; posta só na frente do modelo, chega tarde demais.",
    "notePlacement": "O pedido de aprovação fica logo antes da chamada de ferramenta — a posição que intercepta mais tarde e mais barato.",
    "noteNone": "Nenhum pedido de aprovação aparece, então nada intercepta uma chamada antes de ela rodar."
  }
} as const;
