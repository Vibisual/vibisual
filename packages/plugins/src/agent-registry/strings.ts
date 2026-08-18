/**
 * agent-registry — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agentRegistry` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Answers the practical question a registry exists for — who created this agent, what authority it holds, and when it last moved. If those cannot be answered, unregistered agents are simply running unseen.",
    "heading": "Agent Registry",
    "level": {
      "unregistered": "Not in our registry",
      "partial": "Partially known",
      "registered": "Registered"
    },
    "check": {
      "owner": "Owner",
      "authority": "Authority",
      "lastSeen": "Last seen",
      "sessions": "Sessions"
    },
    "ours": "Vibisual (custom agent)",
    "external": "Claude Code (hook session)",
    "note": "Design the moment an agent is retired, not only the moment it is created — forced registration, expiring credentials and idle shutdown are operational discipline rather than security technology.",
    "noteExternal": "This session was registered through hooks, so its lifecycle belongs to Claude Code. We can see it but we do not promote or retire it."
  },
  "ko": {
    "desc": "레지스트리가 존재하는 이유인 실무 질문에 답합니다 — 누가 이 에이전트를 만들었고, 무슨 권한을 갖고, 마지막으로 언제 움직였는가. 답할 수 없다면 등록되지 않은 에이전트가 그냥 보이지 않게 돌고 있는 것입니다.",
    "heading": "에이전트 레지스트리",
    "level": {
      "unregistered": "우리 대장에 없음",
      "partial": "일부만 파악됨",
      "registered": "등록됨"
    },
    "check": {
      "owner": "소유",
      "authority": "권한",
      "lastSeen": "마지막 활동",
      "sessions": "세션 수"
    },
    "ours": "Vibisual (커스텀 에이전트)",
    "external": "Claude Code (훅 세션)",
    "note": "에이전트는 만들 때가 아니라 끌 때를 설계해야 합니다 — 등록 강제·자격증명 만료·유휴 자동 정지는 보안 기술이 아니라 운영 규율입니다.",
    "noteExternal": "훅으로 등록된 세션이라 생애주기가 Claude Code 소유입니다. 보이기는 하지만 우리가 승격하거나 폐기하지 않습니다."
  },
  "ja": {
    "check": {
      "owner": "所有",
      "authority": "権限",
      "sessions": "セッション数",
      "lastSeen": "最終確認"
    },
    "ours": "Vibisual（カスタムエージェント）",
    "external": "Claude Code（フックセッション）",
    "heading": "エージェント台帳",
    "level": {
      "unregistered": "台帳にない",
      "partial": "一部だけ把握",
      "registered": "台帳に登録済み"
    },
    "desc": "台帳が存在する理由である実務的な問いに答えます — 誰がこのエージェントを作り、どんな権限を持ち、最後に動いたのはいつか。答えられなければ、登録されていないエージェントがただ見えないまま動いているということです。",
    "note": "エージェントは作るときではなく止めるときを設計すべきです — 登録の強制・資格情報の期限・放置時の自動停止は、セキュリティ技術ではなく運用の規律です。",
    "noteExternal": "フック経由で登録されたセッションなので、生涯管理は Claude Code 側にあります。見えはしますが、私たちが昇格させたり廃棄したりはしません。"
  },
  "zh-CN": {
    "check": {
      "owner": "归属",
      "authority": "权限",
      "sessions": "会话数",
      "lastSeen": "最后出现"
    },
    "ours": "Vibisual（自定义智能体）",
    "external": "Claude Code（钩子会话）",
    "heading": "智能体登记册",
    "level": {
      "unregistered": "不在登记册中",
      "partial": "仅部分掌握",
      "registered": "已登记"
    },
    "desc": "回答登记册之所以存在的那个实务问题 — 谁创建了这个智能体、它拥有什么权限、最后一次活动是什么时候。若答不上来，未登记的智能体就只是在无人看见处运行着。",
    "note": "要设计的是关停智能体的时刻，而不只是创建的时刻 — 强制登记、凭证到期、闲置自动停止，都是运营纪律而非安全技术。",
    "noteExternal": "该会话通过钩子注册，因此生命周期归 Claude Code 管。我们看得到它，但不会去晋升或废弃它。"
  },
  "es": {
    "check": {
      "owner": "Propietario",
      "authority": "Autoridad",
      "sessions": "Sesiones",
      "lastSeen": "Visto por última vez"
    },
    "ours": "Vibisual (agente propio)",
    "external": "Claude Code (sesión por hook)",
    "heading": "Registro de agentes",
    "level": {
      "unregistered": "No está en el registro",
      "partial": "Parcialmente conocido",
      "registered": "Registrado"
    },
    "desc": "Responde a la pregunta práctica por la que existe un registro — quién creó este agente, qué autoridad tiene y cuándo se movió por última vez. Si eso no se puede responder, hay agentes sin registrar corriendo sin que nadie los vea.",
    "note": "Diseña el momento en que un agente se retira, no solo el de su creación — registro obligatorio, credenciales que caducan y apagado por inactividad son disciplina de operación, no técnica de seguridad.",
    "noteExternal": "Esta sesión se registró mediante hooks, así que su ciclo de vida pertenece a Claude Code. La vemos, pero no la promovemos ni la retiramos."
  },
  "es-419": {
    "check": {
      "owner": "Propietario",
      "authority": "Autoridad",
      "sessions": "Sesiones",
      "lastSeen": "Visto por última vez"
    },
    "ours": "Vibisual (agente propio)",
    "external": "Claude Code (sesión por hook)",
    "heading": "Registro de agentes",
    "level": {
      "unregistered": "No está en el registro",
      "partial": "Parcialmente conocido",
      "registered": "Registrado"
    },
    "desc": "Responde a la pregunta práctica por la que existe un registro — quién creó este agente, qué autoridad tiene y cuándo se movió por última vez. Si eso no se puede responder, hay agentes sin registrar corriendo sin que nadie los vea.",
    "note": "Diseña el momento en que un agente se retira, no solo el de su creación — registro obligatorio, credenciales que caducan y apagado por inactividad son disciplina de operación, no técnica de seguridad.",
    "noteExternal": "Esta sesión se registró mediante hooks, así que su ciclo de vida pertenece a Claude Code. La vemos, pero no la promovemos ni la retiramos."
  },
  "fr": {
    "check": {
      "owner": "Propriétaire",
      "authority": "Autorité",
      "sessions": "Sessions",
      "lastSeen": "Vu pour la dernière fois"
    },
    "ours": "Vibisual (agent personnalisé)",
    "external": "Claude Code (session par hook)",
    "heading": "Registre des agents",
    "level": {
      "unregistered": "Absent du registre",
      "partial": "Partiellement connu",
      "registered": "Enregistré"
    },
    "desc": "Répond à la question pratique qui justifie un registre — qui a créé cet agent, quelle autorité il détient et quand il a bougé pour la dernière fois. Sans réponse, des agents non enregistrés tournent simplement sans être vus.",
    "note": "Concevez le moment où l’on retire un agent, pas seulement celui où on le crée — enregistrement obligatoire, identifiants expirants et arrêt en cas d’inactivité relèvent de la discipline d’exploitation, pas de la technique de sécurité.",
    "noteExternal": "Cette session a été enregistrée via des hooks : son cycle de vie appartient donc à Claude Code. Nous la voyons, mais nous ne la promouvons ni ne la retirons."
  },
  "de": {
    "check": {
      "owner": "Eigentümer",
      "authority": "Befugnis",
      "sessions": "Sitzungen",
      "lastSeen": "Zuletzt gesehen"
    },
    "ours": "Vibisual (eigener Agent)",
    "external": "Claude Code (Hook-Sitzung)",
    "heading": "Agenten-Register",
    "level": {
      "unregistered": "Nicht im Register",
      "partial": "Teilweise bekannt",
      "registered": "Registriert"
    },
    "desc": "Beantwortet die praktische Frage, für die ein Register existiert — wer diesen Agenten erstellt hat, welche Befugnis er hält und wann er sich zuletzt bewegt hat. Lässt sich das nicht beantworten, laufen nicht registrierte Agenten schlicht unbemerkt.",
    "note": "Gestalten Sie den Moment, in dem ein Agent abgeschaltet wird, nicht nur den seiner Erstellung — erzwungene Registrierung, ablaufende Zugangsdaten und Abschalten im Leerlauf sind Betriebsdisziplin, keine Sicherheitstechnik.",
    "noteExternal": "Diese Sitzung wurde über Hooks registriert, ihr Lebenszyklus gehört also Claude Code. Wir sehen sie, aber wir stufen sie weder hoch noch außer Dienst."
  },
  "hi": {
    "check": {
      "owner": "स्वामी",
      "authority": "अधिकार",
      "sessions": "सत्र",
      "lastSeen": "अंतिम बार देखा"
    },
    "ours": "Vibisual (कस्टम एजेंट)",
    "external": "Claude Code (हुक सत्र)",
    "heading": "एजेंट रजिस्ट्री",
    "level": {
      "unregistered": "हमारी रजिस्ट्री में नहीं",
      "partial": "आंशिक रूप से ज्ञात",
      "registered": "पंजीकृत"
    },
    "desc": "उस व्यावहारिक सवाल का उत्तर देता है जिसके लिए पंजिका होती है — यह एजेंट किसने बनाया, उसके पास कौन-सा अधिकार है, और वह आख़िरी बार कब चला। उत्तर न मिले तो अपंजीकृत एजेंट बस बिना दिखे चलता रहता है।",
    "note": "एजेंट के बनने के साथ-साथ उसके सेवानिवृत्त होने का भी डिज़ाइन कीजिए — अनिवार्य पंजीकरण, समय-सीमा वाली कुंजियाँ और निष्क्रिय पड़ने पर रोक, ये संचालन का अनुशासन हैं, सुरक्षा की तरकीब नहीं।",
    "noteExternal": "यह सत्र hook से दर्ज हुआ है, इसलिए इसका जीवनचक्र Claude Code का है। हम इसे देखते हैं, पर न चढ़ाते हैं, न सेवानिवृत्त करते हैं।"
  },
  "id": {
    "check": {
      "owner": "Pemilik",
      "authority": "Wewenang",
      "sessions": "Sesi",
      "lastSeen": "Terakhir terlihat"
    },
    "ours": "Vibisual (agen kustom)",
    "external": "Claude Code (sesi hook)",
    "heading": "Registri agen",
    "level": {
      "unregistered": "Tidak ada di registri",
      "partial": "Sebagian diketahui",
      "registered": "Terdaftar"
    },
    "desc": "Menjawab pertanyaan praktis yang menjadi alasan adanya registri — siapa yang membuat agen ini, wewenang apa yang dipegangnya, dan kapan terakhir kali ia bergerak. Bila tak terjawab, agen yang tak terdaftar sekadar berjalan tanpa terlihat.",
    "note": "Rancanglah saat sebuah agen dipensiunkan, bukan hanya saat ia dibuat — pendaftaran wajib, kredensial yang kedaluwarsa, dan penghentian saat menganggur adalah disiplin operasional, bukan teknik keamanan.",
    "noteExternal": "Sesi ini terdaftar lewat hook, jadi daur hidupnya milik Claude Code. Kami melihatnya, tetapi tidak menaikkan maupun memensiunkannya."
  },
  "it": {
    "check": {
      "owner": "Proprietario",
      "authority": "Autorità",
      "sessions": "Sessioni",
      "lastSeen": "Visto l’ultima volta"
    },
    "ours": "Vibisual (agente personalizzato)",
    "external": "Claude Code (sessione hook)",
    "heading": "Registro degli agenti",
    "level": {
      "unregistered": "Non nel registro",
      "partial": "Parzialmente noto",
      "registered": "Registrato"
    },
    "desc": "Risponde alla domanda pratica per cui esiste un registro — chi ha creato questo agente, quale autorità detiene e quando si è mosso l’ultima volta. Se non si può rispondere, agenti non registrati stanno semplicemente girando senza che nessuno li veda.",
    "note": "Progetta il momento in cui un agente viene ritirato, non solo quello della creazione — registrazione obbligatoria, credenziali che scadono e spegnimento per inattività sono disciplina operativa, non tecnica di sicurezza.",
    "noteExternal": "Questa sessione è stata registrata tramite hook, quindi il suo ciclo di vita appartiene a Claude Code. La vediamo, ma non la promuoviamo né la ritiriamo."
  },
  "pt-BR": {
    "check": {
      "owner": "Dono",
      "authority": "Autoridade",
      "sessions": "Sessões",
      "lastSeen": "Visto pela última vez"
    },
    "ours": "Vibisual (agente personalizado)",
    "external": "Claude Code (sessão por hook)",
    "heading": "Registro de agentes",
    "level": {
      "unregistered": "Fora do registro",
      "partial": "Parcialmente conhecido",
      "registered": "Registrado"
    },
    "desc": "Responde à pergunta prática pela qual um registro existe — quem criou este agente, que autoridade ele tem e quando se mexeu pela última vez. Sem resposta, agentes não registrados simplesmente rodam sem ninguém ver.",
    "note": "Projete o momento em que um agente é desligado, não só o de sua criação — registro obrigatório, credenciais que expiram e desligamento por ociosidade são disciplina de operação, não técnica de segurança.",
    "noteExternal": "Esta sessão foi registrada por hooks, então seu ciclo de vida pertence ao Claude Code. Nós a vemos, mas não a promovemos nem a aposentamos."
  }
} as const;
