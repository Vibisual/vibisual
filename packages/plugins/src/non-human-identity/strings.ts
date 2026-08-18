/**
 * non-human-identity — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.nonHumanIdentity` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Asks the practical question: can you cut off this one agent right now? If the answer is “I would have to stop everything”, there is no identity design.",
    "heading": "Non-Human Identity",
    "level": {
      "owned": "Ours to stop",
      "external": "Owned by Claude Code"
    },
    "check": {
      "id": "Identity",
      "owner": "Owner",
      "sessions": "Sessions"
    },
    "ours": "Vibisual (custom agent)",
    "claudeCode": "Claude Code (hook session)",
    "noteOwned": "We created this agent, so it carries its own settings and can be stopped on its own.",
    "noteExternal": "This session was registered through hooks and belongs to Claude Code — we have no handle that stops it alone."
  },
  "ko": {
    "desc": "실무 질문 하나를 던집니다 — 지금 이 에이전트 **하나만** 끊을 수 있습니까? 답이 \"전부 멈춰야 한다\"면 신원 설계가 없는 것입니다.",
    "heading": "비인간 신원",
    "level": {
      "owned": "우리가 끊을 수 있음",
      "external": "Claude Code 소유"
    },
    "check": {
      "id": "신원",
      "owner": "소유",
      "sessions": "세션 수"
    },
    "ours": "Vibisual (커스텀 에이전트)",
    "claudeCode": "Claude Code (훅 세션)",
    "noteOwned": "우리가 만든 에이전트라 자기 설정을 갖고 있고, 이 하나만 따로 멈출 수 있습니다.",
    "noteExternal": "훅으로 등록된 외부 세션이라 Claude Code 본체 소유입니다 — 이것만 끊을 손잡이가 우리에게 없습니다."
  },
  "ja": {
    "check": {
      "owner": "所有",
      "sessions": "セッション数",
      "id": "識別子"
    },
    "ours": "Vibisual（カスタムエージェント）",
    "claudeCode": "Claude Code（フックセッション）",
    "heading": "非人間の識別子",
    "level": {
      "owned": "こちらで止められる",
      "external": "Claude Code の所有"
    },
    "desc": "実務的な問いを一つ投げます — いま**このエージェント一つだけ**を止められますか。答えが「全部止めるしかない」なら、識別子の設計がないということです。",
    "noteOwned": "私たちが作ったエージェントなので自分の設定を持ち、これ一つだけを止められます。",
    "noteExternal": "フック経由で登録された外部セッションで、所有は Claude Code 側です — これだけを止める取っ手が私たちにはありません。"
  },
  "zh-CN": {
    "check": {
      "owner": "归属",
      "sessions": "会话数",
      "id": "身份"
    },
    "ours": "Vibisual（自定义智能体）",
    "claudeCode": "Claude Code（钩子会话）",
    "heading": "非人类身份",
    "level": {
      "owned": "我方可停止",
      "external": "归属 Claude Code"
    },
    "desc": "提出一个实务问题 — 现在能否**只切断这一个智能体**？如果答案是「只能全部停掉」，那就说明没有身份设计。",
    "noteOwned": "这是我们创建的智能体，带有自己的设置，可以单独停止。",
    "noteExternal": "该会话通过钩子注册，归属 Claude Code — 我们没有单独停止它的把手。"
  },
  "es": {
    "check": {
      "owner": "Propietario",
      "sessions": "Sesiones",
      "id": "Identidad"
    },
    "ours": "Vibisual (agente propio)",
    "claudeCode": "Claude Code (sesión por hook)",
    "heading": "Identidad no humana",
    "level": {
      "owned": "Podemos detenerlo",
      "external": "Pertenece a Claude Code"
    },
    "desc": "Plantea la pregunta práctica: ¿puedes cortar **solo este agente** ahora mismo? Si la respuesta es «tendría que parar todo», no hay diseño de identidad.",
    "noteOwned": "Nosotros creamos este agente, así que lleva sus propios ajustes y puede detenerse por separado.",
    "noteExternal": "Esta sesión se registró mediante hooks y pertenece a Claude Code — no tenemos ningún asidero para detenerla sola."
  },
  "es-419": {
    "check": {
      "owner": "Propietario",
      "sessions": "Sesiones",
      "id": "Identidad"
    },
    "ours": "Vibisual (agente propio)",
    "claudeCode": "Claude Code (sesión por hook)",
    "heading": "Identidad no humana",
    "level": {
      "owned": "Podemos detenerlo",
      "external": "Pertenece a Claude Code"
    },
    "desc": "Plantea la pregunta práctica: ¿puedes cortar **solo este agente** ahora mismo? Si la respuesta es «tendría que parar todo», no hay diseño de identidad.",
    "noteOwned": "Nosotros creamos este agente, así que lleva sus propios ajustes y puede detenerse por separado.",
    "noteExternal": "Esta sesión se registró mediante hooks y pertenece a Claude Code — no tenemos ningún asidero para detenerla sola."
  },
  "fr": {
    "check": {
      "owner": "Propriétaire",
      "sessions": "Sessions",
      "id": "Identité"
    },
    "ours": "Vibisual (agent personnalisé)",
    "claudeCode": "Claude Code (session par hook)",
    "heading": "Identité non humaine",
    "level": {
      "owned": "Nous pouvons l’arrêter",
      "external": "Appartient à Claude Code"
    },
    "desc": "Pose la question pratique : pouvez-vous couper **cet agent-là seulement**, maintenant ? Si la réponse est « il faudrait tout arrêter », il n’y a pas de conception d’identité.",
    "noteOwned": "Nous avons créé cet agent : il porte ses propres réglages et peut être arrêté seul.",
    "noteExternal": "Cette session a été enregistrée via des hooks et appartient à Claude Code — nous n’avons aucune poignée pour l’arrêter seule."
  },
  "de": {
    "check": {
      "owner": "Eigentümer",
      "sessions": "Sitzungen",
      "id": "Identität"
    },
    "ours": "Vibisual (eigener Agent)",
    "claudeCode": "Claude Code (Hook-Sitzung)",
    "heading": "Nicht-menschliche Identität",
    "level": {
      "owned": "Von uns stoppbar",
      "external": "Gehört Claude Code"
    },
    "desc": "Stellt die praktische Frage: Können Sie genau **diesen einen Agenten** jetzt abschalten? Lautet die Antwort „ich müsste alles stoppen“, gibt es kein Identitätsdesign.",
    "noteOwned": "Wir haben diesen Agenten erstellt, er trägt seine eigenen Einstellungen und lässt sich einzeln stoppen.",
    "noteExternal": "Diese Sitzung wurde über Hooks registriert und gehört Claude Code — wir haben keinen Griff, der sie allein stoppt."
  },
  "hi": {
    "check": {
      "owner": "स्वामी",
      "sessions": "सत्र",
      "id": "पहचान"
    },
    "ours": "Vibisual (कस्टम एजेंट)",
    "claudeCode": "Claude Code (हुक सत्र)",
    "heading": "गैर-मानव पहचान",
    "level": {
      "owned": "हम रोक सकते हैं",
      "external": "Claude Code का स्वामित्व"
    },
    "desc": "एक व्यावहारिक सवाल पूछता है: क्या आप अभी **सिर्फ़ इसी एजेंट** को रोक सकते हैं? यदि उत्तर «सब कुछ रोकना पड़ेगा» है, तो पहचान का कोई डिज़ाइन नहीं है।",
    "noteOwned": "यह एजेंट हमने बनाया है, इसलिए इसके पास अपनी सेटिंग है और इसे अकेले रोका जा सकता है।",
    "noteExternal": "यह सत्र hook से दर्ज हुआ है और Claude Code का है — इसे अकेले रोकने की पकड़ हमारे पास नहीं है।"
  },
  "id": {
    "check": {
      "owner": "Pemilik",
      "sessions": "Sesi",
      "id": "Identitas"
    },
    "ours": "Vibisual (agen kustom)",
    "claudeCode": "Claude Code (sesi hook)",
    "heading": "Identitas non-manusia",
    "level": {
      "owned": "Bisa kami hentikan",
      "external": "Milik Claude Code"
    },
    "desc": "Mengajukan pertanyaan praktis: bisakah Anda memutus **agen ini saja** sekarang? Kalau jawabannya «harus menghentikan semuanya», berarti tidak ada rancangan identitas.",
    "noteOwned": "Kami yang membuat agen ini, jadi ia membawa pengaturannya sendiri dan bisa dihentikan sendiri.",
    "noteExternal": "Sesi ini terdaftar lewat hook dan milik Claude Code — kami tidak punya pegangan untuk menghentikannya sendirian."
  },
  "it": {
    "check": {
      "owner": "Proprietario",
      "sessions": "Sessioni",
      "id": "Identità"
    },
    "ours": "Vibisual (agente personalizzato)",
    "claudeCode": "Claude Code (sessione hook)",
    "heading": "Identità non umana",
    "level": {
      "owned": "Possiamo fermarlo",
      "external": "Di proprietà di Claude Code"
    },
    "desc": "Pone la domanda pratica: puoi staccare **solo questo agente** adesso? Se la risposta è «dovrei fermare tutto», non c’è progettazione dell’identità.",
    "noteOwned": "Abbiamo creato noi questo agente: porta le proprie impostazioni e può essere fermato da solo.",
    "noteExternal": "Questa sessione è stata registrata tramite hook e appartiene a Claude Code — non abbiamo alcuna maniglia per fermarla da sola."
  },
  "pt-BR": {
    "check": {
      "owner": "Dono",
      "sessions": "Sessões",
      "id": "Identidade"
    },
    "ours": "Vibisual (agente personalizado)",
    "claudeCode": "Claude Code (sessão por hook)",
    "heading": "Identidade não humana",
    "level": {
      "owned": "Podemos parar",
      "external": "Pertence ao Claude Code"
    },
    "desc": "Faz a pergunta prática: dá para cortar **apenas este agente** agora? Se a resposta for «eu teria que parar tudo», não existe desenho de identidade.",
    "noteOwned": "Nós criamos este agente, então ele carrega seus próprios ajustes e pode ser parado sozinho.",
    "noteExternal": "Esta sessão foi registrada por hooks e pertence ao Claude Code — não temos nenhuma alça que a pare sozinha."
  }
} as const;
