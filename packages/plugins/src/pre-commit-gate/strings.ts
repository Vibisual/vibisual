/**
 * pre-commit-gate — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.preCommitGate` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Agents commit easily and often, and blocking before the fact is far cheaper than reviewing after. Secret leakage is the one category where after-the-fact response does not exist — once pushed, it is exposed.",
    "heading": "Pre-commit Gate",
    "level": {
      "cannot": "Cannot commit",
      "gated": "Can commit, gated"
    },
    "check": {
      "canCommit": "Can run git",
      "gate": "Repository gate"
    },
    "yes": "yes",
    "no": "no",
    "repoHook": "commit hook active",
    "note": "A gate the agent can bypass is not a gate. The minimum set is secret scanning, lint and typecheck, and blocked paths."
  },
  "ko": {
    "desc": "에이전트는 커밋을 쉽고 자주 합니다. 사후 리뷰보다 사전 차단이 훨씬 싸고, 비밀 정보 유출은 푸시된 순간 노출이라 사후 대응이 성립하지 않는 유일한 범주입니다.",
    "heading": "커밋 전 관문",
    "level": {
      "cannot": "커밋 불가",
      "gated": "커밋 가능 · 관문 있음"
    },
    "check": {
      "canCommit": "git 실행 가능",
      "gate": "저장소 관문"
    },
    "yes": "가능",
    "no": "불가",
    "repoHook": "커밋 훅 작동 중",
    "note": "에이전트가 우회할 수 있는 관문은 관문이 아닙니다. 최소 구성은 비밀 스캔 · 린트·타입체크 · 금지 경로 차단입니다."
  },
  "ja": {
    "yes": "はい",
    "no": "いいえ",
    "heading": "コミット前の関門",
    "check": {
      "canCommit": "git を実行できる",
      "gate": "リポジトリの関門"
    },
    "level": {
      "cannot": "コミット不可",
      "gated": "コミット可・関門あり"
    },
    "repoHook": "コミットフック稼働中",
    "desc": "エージェントはコミットを気軽に、頻繁にします。事後のレビューより事前の遮断の方がはるかに安く、秘密情報の漏洩は押した瞬間に露出するため事後対応が成り立たない唯一の範疇です。",
    "note": "エージェントが回避できる関門は関門ではありません。最小構成は秘密のスキャン・リントと型チェック・禁止パスの遮断です。"
  },
  "zh-CN": {
    "yes": "是",
    "no": "否",
    "heading": "提交前关口",
    "check": {
      "canCommit": "可运行 git",
      "gate": "仓库关口"
    },
    "level": {
      "cannot": "无法提交",
      "gated": "可提交·有关口"
    },
    "repoHook": "提交钩子已启用",
    "desc": "智能体提交得又轻松又频繁，事前阻断比事后复核便宜得多。而机密泄露是唯一没有事后补救的类别 — 一旦推送就已经暴露。",
    "note": "智能体能绕过的关口不是关口。最小组合是机密扫描、lint 与类型检查、禁止路径拦截。"
  },
  "es": {
    "yes": "sí",
    "no": "no",
    "heading": "Puerta previa al commit",
    "check": {
      "canCommit": "Puede ejecutar git",
      "gate": "Puerta del repositorio"
    },
    "level": {
      "cannot": "No puede commitear",
      "gated": "Puede commitear, con puerta"
    },
    "repoHook": "hook de commit activo",
    "desc": "Los agentes hacen commit con facilidad y frecuencia, y bloquear antes sale mucho más barato que revisar después. La fuga de secretos es la única categoría sin respuesta a posteriori — una vez subido, ya está expuesto.",
    "note": "Una puerta que el agente puede saltarse no es una puerta. El mínimo: escaneo de secretos, lint y tipos, rutas prohibidas."
  },
  "es-419": {
    "yes": "sí",
    "no": "no",
    "heading": "Puerta previa al commit",
    "check": {
      "canCommit": "Puede ejecutar git",
      "gate": "Puerta del repositorio"
    },
    "level": {
      "cannot": "No puede commitear",
      "gated": "Puede commitear, con puerta"
    },
    "repoHook": "hook de commit activo",
    "desc": "Los agentes hacen commit con facilidad y frecuencia, y bloquear antes sale mucho más barato que revisar después. La fuga de secretos es la única categoría sin respuesta a posteriori — una vez subido, ya está expuesto.",
    "note": "Una puerta que el agente puede saltarse no es una puerta. El mínimo: escaneo de secretos, lint y tipos, rutas prohibidas."
  },
  "fr": {
    "yes": "oui",
    "no": "non",
    "heading": "Porte avant commit",
    "check": {
      "canCommit": "Peut exécuter git",
      "gate": "Porte du dépôt"
    },
    "level": {
      "cannot": "Ne peut pas committer",
      "gated": "Peut committer, avec porte"
    },
    "repoHook": "hook de commit actif",
    "desc": "Les agents committent facilement et souvent, et bloquer en amont coûte bien moins que relire après coup. La fuite de secrets est la seule catégorie sans réponse a posteriori — une fois poussé, c’est exposé.",
    "note": "Une barrière que l’agent peut contourner n’est pas une barrière. Le minimum : analyse des secrets, lint et typage, chemins interdits."
  },
  "de": {
    "yes": "ja",
    "no": "nein",
    "heading": "Pre-Commit-Gate",
    "check": {
      "canCommit": "Kann git ausführen",
      "gate": "Repository-Gate"
    },
    "level": {
      "cannot": "Kein Commit möglich",
      "gated": "Commit möglich, mit Gate"
    },
    "repoHook": "Commit-Hook aktiv",
    "desc": "Agenten committen leicht und häufig, und vorher zu blockieren ist weit günstiger als hinterher zu prüfen. Geheimnisabfluss ist die eine Kategorie, in der es keine nachträgliche Reaktion gibt — einmal gepusht, ist es offengelegt.",
    "note": "Ein Gate, das der Agent umgehen kann, ist kein Gate. Die Mindestausstattung sind Secret-Scan, Lint und Typecheck sowie gesperrte Pfade."
  },
  "hi": {
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "कमिट-पूर्व द्वार",
    "check": {
      "canCommit": "git चला सकता है",
      "gate": "रिपॉज़िटरी द्वार"
    },
    "level": {
      "cannot": "कमिट नहीं कर सकता",
      "gated": "कमिट संभव · द्वार सहित"
    },
    "repoHook": "कमिट हुक सक्रिय",
    "desc": "एजेंट आसानी से और बार-बार commit करते हैं, और आगे रोक देना पीछे समीक्षा करने से कहीं सस्ता है। रहस्य का रिसाव अकेली ऐसी श्रेणी है जिसका बाद में इलाज नहीं — push होते ही वह खुला है।",
    "note": "जिस द्वार को एजेंट पार कर सके वह द्वार नहीं है। न्यूनतम व्यवस्था: रहस्य-स्कैन, lint और टाइप, और वर्जित पथ।"
  },
  "id": {
    "yes": "ya",
    "no": "tidak",
    "heading": "Gerbang pra-commit",
    "check": {
      "canCommit": "Bisa menjalankan git",
      "gate": "Gerbang repositori"
    },
    "level": {
      "cannot": "Tidak bisa commit",
      "gated": "Bisa commit, ada gerbang"
    },
    "repoHook": "hook commit aktif",
    "desc": "Agen melakukan commit dengan mudah dan sering, dan memblokir di depan jauh lebih murah daripada meninjau di belakang. Kebocoran rahasia adalah satu-satunya kategori tanpa penanganan susulan — begitu terdorong, ia sudah terbuka.",
    "note": "Gerbang yang bisa dilewati agen bukanlah gerbang. Susunan minimalnya: pemindaian rahasia, lint dan tipe, serta jalur terlarang."
  },
  "it": {
    "yes": "sì",
    "no": "no",
    "heading": "Varco pre-commit",
    "check": {
      "canCommit": "Può eseguire git",
      "gate": "Varco del repository"
    },
    "level": {
      "cannot": "Non può committare",
      "gated": "Può committare, con varco"
    },
    "repoHook": "hook di commit attivo",
    "desc": "Gli agenti fanno commit con facilità e frequenza, e bloccare prima costa molto meno che rivedere dopo. La fuga di segreti è l’unica categoria senza risposta a posteriori — una volta inviato, è esposto.",
    "note": "Un varco che l’agente può aggirare non è un varco. Il minimo: scansione dei segreti, lint e tipi, percorsi vietati."
  },
  "pt-BR": {
    "yes": "sim",
    "no": "não",
    "heading": "Portão pré-commit",
    "check": {
      "canCommit": "Pode executar git",
      "gate": "Portão do repositório"
    },
    "level": {
      "cannot": "Não pode commitar",
      "gated": "Pode commitar, com portão"
    },
    "repoHook": "hook de commit ativo",
    "desc": "Agentes fazem commit com facilidade e frequência, e bloquear antes sai bem mais barato que revisar depois. Vazamento de segredo é a única categoria sem resposta a posteriori — uma vez enviado, está exposto.",
    "note": "Um portão que o agente consegue driblar não é portão. O mínimo: varredura de segredos, lint e tipos, caminhos proibidos."
  }
} as const;
