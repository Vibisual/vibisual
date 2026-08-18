/**
 * graceful-degradation — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.gracefulDegradation` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "A guardrail has to fail safe — when judgement fails, the answer is block, not pass. Here the fork is what happens when an approval prompt goes unanswered.",
    "heading": "Graceful Degradation",
    "level": {
      "noGate": "No gate to fail",
      "failSafe": "Fails safe",
      "failOpen": "Fails open"
    },
    "check": {
      "policy": "On no answer",
      "mode": "Permission mode"
    },
    "open": "allow (fail-open)",
    "safe": "block (fail-safe)",
    "note": "Fail-open is a legitimate choice when work must not stall — but it should be a choice, not a default nobody noticed.",
    "noteOpen": "If you step away, unanswered prompts turn into approvals. Switch to auto-block for work where that would matter."
  },
  "ko": {
    "desc": "가드레일은 fail-safe 여야 합니다 — 판정에 실패하면 통과가 아니라 차단입니다. 여기서 갈림길은 승인 팝업에 응답이 없을 때의 정책입니다.",
    "heading": "우아한 성능 저하",
    "level": {
      "noGate": "실패할 관문 없음",
      "failSafe": "안전 쪽으로 실패",
      "failOpen": "열림 쪽으로 실패"
    },
    "check": {
      "policy": "무응답일 때",
      "mode": "퍼미션 모드"
    },
    "open": "허용 (fail-open)",
    "safe": "차단 (fail-safe)",
    "note": "작업이 멈추면 안 되는 곳에서 fail-open 은 정당한 선택입니다 — 다만 아무도 모르는 기본값이 아니라 선택이어야 합니다.",
    "noteOpen": "자리를 비우면 응답 없는 승인이 곧 허용이 됩니다. 그게 곤란한 작업이라면 자동 차단으로 바꾸십시오."
  },
  "ja": {
    "check": {
      "mode": "パーミッションモード",
      "policy": "無応答のとき"
    },
    "heading": "段階的な機能低下",
    "level": {
      "noGate": "倒れる関門がない",
      "failSafe": "安全側に倒れる",
      "failOpen": "開く側に倒れる"
    },
    "open": "許可（fail-open）",
    "safe": "遮断（fail-safe）",
    "desc": "ガードレールは fail-safe でなければなりません — 判定に失敗したら通過ではなく遮断です。ここでの分かれ道は、承認ダイアログに応答がなかったときの方針です。",
    "note": "作業を止められない場面では fail-open も正当な選択です — ただし誰も気づかなかった既定値ではなく、選択であるべきです。",
    "noteOpen": "席を外すと、応答のない承認がそのまま許可になります。それが困る作業なら自動遮断へ切り替えてください。"
  },
  "zh-CN": {
    "check": {
      "mode": "权限模式",
      "policy": "未回应时"
    },
    "heading": "优雅降级",
    "level": {
      "noGate": "无关口可失效",
      "failSafe": "失效即阻断",
      "failOpen": "失效即放行"
    },
    "open": "放行（fail-open）",
    "safe": "阻断（fail-safe）",
    "desc": "护栏必须是 fail-safe 的 — 判定失败时的答案是阻断而不是放行。这里的分岔点是：审批提示无人回应时会怎样。",
    "note": "在不能让工作停摆的场合，fail-open 也是正当选择 — 但它应该是一个选择，而不是没人注意到的默认值。",
    "noteOpen": "一旦你离开，无人回应的提示就变成了放行。若这会造成问题，请切换为自动阻断。"
  },
  "es": {
    "check": {
      "mode": "Modo de permisos",
      "policy": "Si no hay respuesta"
    },
    "heading": "Degradación controlada",
    "level": {
      "noGate": "No hay puerta que falle",
      "failSafe": "Falla cerrando",
      "failOpen": "Falla abriendo"
    },
    "open": "permitir (fail-open)",
    "safe": "bloquear (fail-safe)",
    "desc": "Una barrera debe fallar del lado seguro — si el juicio falla, la respuesta es bloquear, no dejar pasar. Aquí la bifurcación es qué ocurre cuando una solicitud de aprobación queda sin respuesta.",
    "note": "Fallar abriendo es una elección legítima cuando el trabajo no puede detenerse — pero debería ser una elección, no un valor por defecto que nadie notó.",
    "noteOpen": "Si te alejas, las solicitudes sin respuesta se vuelven aprobaciones. Cambia a bloqueo automático para los trabajos en que eso importe."
  },
  "es-419": {
    "check": {
      "mode": "Modo de permisos",
      "policy": "Si no hay respuesta"
    },
    "heading": "Degradación controlada",
    "level": {
      "noGate": "No hay puerta que falle",
      "failSafe": "Falla cerrando",
      "failOpen": "Falla abriendo"
    },
    "open": "permitir (fail-open)",
    "safe": "bloquear (fail-safe)",
    "desc": "Una barrera debe fallar del lado seguro — si el juicio falla, la respuesta es bloquear, no dejar pasar. Aquí la bifurcación es qué ocurre cuando una solicitud de aprobación queda sin respuesta.",
    "note": "Fallar abriendo es una elección legítima cuando el trabajo no puede detenerse — pero debería ser una elección, no un valor por defecto que nadie notó.",
    "noteOpen": "Si te alejas, las solicitudes sin respuesta se vuelven aprobaciones. Cambia a bloqueo automático para los trabajos en que eso importe."
  },
  "fr": {
    "check": {
      "mode": "Mode de permission",
      "policy": "Sans réponse"
    },
    "heading": "Dégradation maîtrisée",
    "level": {
      "noGate": "Aucune porte à faire échouer",
      "failSafe": "Échoue en sécurité",
      "failOpen": "Échoue en ouvrant"
    },
    "open": "autoriser (fail-open)",
    "safe": "bloquer (fail-safe)",
    "desc": "Un garde-fou doit échouer du côté sûr — si le jugement échoue, la réponse est bloquer, pas laisser passer. Ici la bifurcation est ce qui se produit quand une demande d’approbation reste sans réponse.",
    "note": "Le fail-open est un choix légitime quand le travail ne doit pas s’arrêter — mais il doit être un choix, pas un défaut que personne n’a remarqué.",
    "noteOpen": "Si vous vous absentez, les demandes sans réponse deviennent des approbations. Passez au blocage automatique pour les travaux où cela compte."
  },
  "de": {
    "check": {
      "mode": "Berechtigungsmodus",
      "policy": "Ohne Antwort"
    },
    "heading": "Kontrollierter Funktionsabbau",
    "level": {
      "noGate": "Kein Gate zum Ausfallen",
      "failSafe": "Fällt sicher aus",
      "failOpen": "Fällt offen aus"
    },
    "open": "erlauben (fail-open)",
    "safe": "blockieren (fail-safe)",
    "desc": "Eine Leitplanke muss sicher ausfallen — scheitert die Beurteilung, lautet die Antwort blockieren, nicht durchlassen. Die Weggabelung ist hier, was bei unbeantworteter Freigabeabfrage geschieht.",
    "note": "Fail-open ist eine legitime Wahl, wenn die Arbeit nicht stocken darf — es sollte aber eine Wahl sein und kein Standard, den niemand bemerkt hat.",
    "noteOpen": "Wenn Sie weggehen, werden unbeantwortete Abfragen zu Freigaben. Für Arbeiten, bei denen das zählt, auf automatisches Blockieren umstellen."
  },
  "hi": {
    "check": {
      "mode": "अनुमति मोड",
      "policy": "उत्तर न मिलने पर"
    },
    "heading": "नियंत्रित अवनति",
    "level": {
      "noGate": "विफल होने को द्वार नहीं",
      "failSafe": "सुरक्षित रूप से विफल",
      "failOpen": "खुलने की ओर विफल"
    },
    "open": "अनुमति (fail-open)",
    "safe": "अवरोध (fail-safe)",
    "desc": "रक्षक को सुरक्षित दिशा में गिरना चाहिए — निर्णय विफल हो तो उत्तर है रोको, जाने दो नहीं। यहाँ मोड़ यह है कि अनुमति-माँग अनुत्तरित रह जाए तो क्या होता है।",
    "note": "खुला-गिरना उन जगहों पर वैध चुनाव है जहाँ काम रुकना नहीं चाहिए — पर वह चुनाव होना चाहिए, ऐसा डिफ़ॉल्ट नहीं जिसका किसी को पता ही न हो।",
    "noteOpen": "आप हट जाएँ तो अनुत्तरित माँगें अपने-आप मंज़ूरी बन जाती हैं। जिस काम में यह मायने रखता है, वहाँ स्वतः-रोक पर जाइए।"
  },
  "id": {
    "check": {
      "mode": "Mode izin",
      "policy": "Bila tanpa jawaban"
    },
    "heading": "Penurunan bertahap",
    "level": {
      "noGate": "Tak ada gerbang untuk gagal",
      "failSafe": "Gagal jadi aman",
      "failOpen": "Gagal jadi terbuka"
    },
    "open": "izinkan (fail-open)",
    "safe": "blokir (fail-safe)",
    "desc": "Pagar pengaman harus gagal ke sisi aman — kalau penilaian gagal, jawabannya blokir, bukan lolos. Percabangannya di sini adalah apa yang terjadi ketika permintaan persetujuan tak dijawab.",
    "note": "Gagal-terbuka adalah pilihan yang sah ketika pekerjaan tak boleh berhenti — tetapi itu harus berupa pilihan, bukan nilai bawaan yang tak seorang pun sadari.",
    "noteOpen": "Kalau Anda pergi, permintaan tanpa jawaban berubah menjadi persetujuan. Beralihlah ke blokir otomatis untuk pekerjaan yang mementingkan hal itu."
  },
  "it": {
    "check": {
      "mode": "Modalità permessi",
      "policy": "Senza risposta"
    },
    "heading": "Degrado controllato",
    "level": {
      "noGate": "Nessun varco da far fallire",
      "failSafe": "Fallisce in sicurezza",
      "failOpen": "Fallisce aprendo"
    },
    "open": "consenti (fail-open)",
    "safe": "blocca (fail-safe)",
    "desc": "Un guardrail deve fallire dal lato sicuro — se il giudizio fallisce, la risposta è bloccare, non lasciar passare. Qui il bivio è che cosa succede quando una richiesta di approvazione resta senza risposta.",
    "note": "Fallire aprendo è una scelta legittima quando il lavoro non può fermarsi — ma dev’essere una scelta, non un valore predefinito che nessuno ha notato.",
    "noteOpen": "Se ti allontani, le richieste senza risposta diventano approvazioni. Passa al blocco automatico per i lavori in cui questo pesa."
  },
  "pt-BR": {
    "check": {
      "mode": "Modo de permissão",
      "policy": "Sem resposta"
    },
    "heading": "Degradação controlada",
    "level": {
      "noGate": "Sem portão para falhar",
      "failSafe": "Falha com segurança",
      "failOpen": "Falha abrindo"
    },
    "open": "permitir (fail-open)",
    "safe": "bloquear (fail-safe)",
    "desc": "Uma barreira precisa falhar para o lado seguro — se o julgamento falha, a resposta é bloquear, não deixar passar. Aqui a bifurcação é o que acontece quando um pedido de aprovação fica sem resposta.",
    "note": "Falhar abrindo é escolha legítima quando o trabalho não pode parar — mas deve ser uma escolha, não um padrão que ninguém notou.",
    "noteOpen": "Se você se afastar, pedidos sem resposta viram aprovações. Mude para bloqueio automático nos trabalhos em que isso pesa."
  }
} as const;
