/**
 * rogue-agent — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.rogueAgent` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows how long an agent has been silent while its sessions are still alive. Most incidents start with “I did not know that was still running”, not with malice.",
    "heading": "Idle & Rogue",
    "level": {
      "active": "Active",
      "idle": "Idle",
      "forgotten": "Possibly forgotten"
    },
    "badge": {
      "idle": "Quiet for {{elapsed}} with sessions still alive",
      "forgotten": "Quiet for {{elapsed}} — probably forgotten"
    },
    "row": {
      "idle": "Quiet for",
      "live": "Live sessions",
      "total": "Sessions total"
    },
    "activeNote": "Recently active — nothing forgotten here.",
    "idleNote": "Design the moment you turn an agent off, not just the moment you create one."
  },
  "ko": {
    "desc": "세션이 아직 살아 있는데 얼마나 오래 조용했는지 보여줍니다. 사고의 대부분은 악의가 아니라 \"그게 아직 돌고 있는 줄 몰랐다\"에서 시작됩니다.",
    "heading": "유휴·통제 이탈",
    "level": {
      "active": "활동 중",
      "idle": "유휴",
      "forgotten": "잊혔을 수 있음"
    },
    "badge": {
      "idle": "세션이 살아 있는 채 {{elapsed}} 동안 조용합니다",
      "forgotten": "{{elapsed}} 동안 조용합니다 — 잊혔을 수 있습니다"
    },
    "row": {
      "idle": "조용한 시간",
      "live": "살아 있는 세션",
      "total": "전체 세션"
    },
    "activeNote": "최근까지 활동했습니다 — 잊힌 것은 없습니다.",
    "idleNote": "에이전트는 만들 때가 아니라 **끌 때**를 설계해야 합니다."
  },
  "ja": {
    "desc": "セッションがまだ生きているのにどれだけ静かだったかを表示します。事故の多くは悪意ではなく「まだ動いているとは知らなかった」から始まります。",
    "heading": "放置・逸脱",
    "level": {
      "active": "稼働中",
      "idle": "待機",
      "forgotten": "忘れられた可能性"
    },
    "badge": {
      "idle": "セッションが生きたまま {{elapsed}} 静かです",
      "forgotten": "{{elapsed}} 静かです — 忘れられている可能性があります"
    },
    "row": {
      "idle": "静かな時間",
      "live": "生きているセッション",
      "total": "セッション総数"
    },
    "activeNote": "最近まで動いていました — 忘れられたものはありません。",
    "idleNote": "エージェントは作るときではなく、**止めるとき**を設計すべきです。"
  },
  "zh-CN": {
    "desc": "显示会话仍存活时，智能体已经沉默了多久。多数事故并非源于恶意，而是“不知道它还在跑”。",
    "heading": "闲置与失控",
    "level": {
      "active": "活跃",
      "idle": "闲置",
      "forgotten": "可能被遗忘"
    },
    "badge": {
      "idle": "会话仍存活，已沉默 {{elapsed}}",
      "forgotten": "已沉默 {{elapsed}} — 可能被遗忘了"
    },
    "row": {
      "idle": "沉默时长",
      "live": "存活会话",
      "total": "会话总数"
    },
    "activeNote": "近期仍在活动 — 没有被遗忘的东西。",
    "idleNote": "要设计的是关闭智能体的时刻，而不只是创建的时刻。"
  },
  "es": {
    "desc": "Muestra cuánto lleva callado un agente mientras sus sesiones siguen vivas. La mayoría de incidentes empiezan con «no sabía que eso seguía corriendo», no con mala intención.",
    "heading": "Inactivo y fuera de control",
    "level": {
      "active": "Activo",
      "idle": "Inactivo",
      "forgotten": "Posiblemente olvidado"
    },
    "badge": {
      "idle": "Callado {{elapsed}} con sesiones aún vivas",
      "forgotten": "Callado {{elapsed}} — probablemente olvidado"
    },
    "row": {
      "idle": "Callado desde",
      "live": "Sesiones vivas",
      "total": "Sesiones en total"
    },
    "activeNote": "Activo recientemente: aquí no hay nada olvidado.",
    "idleNote": "Diseña el momento de apagar un agente, no solo el de crearlo."
  },
  "es-419": {
    "desc": "Muestra cuánto lleva callado un agente mientras sus sesiones siguen vivas. La mayoría de incidentes empiezan con «no sabía que eso seguía corriendo», no con mala intención.",
    "heading": "Inactivo y fuera de control",
    "level": {
      "active": "Activo",
      "idle": "Inactivo",
      "forgotten": "Posiblemente olvidado"
    },
    "badge": {
      "idle": "Callado {{elapsed}} con sesiones aún vivas",
      "forgotten": "Callado {{elapsed}} — probablemente olvidado"
    },
    "row": {
      "idle": "Callado desde",
      "live": "Sesiones vivas",
      "total": "Sesiones en total"
    },
    "activeNote": "Activo recientemente: aquí no hay nada olvidado.",
    "idleNote": "Diseña el momento de apagar un agente, no solo el de crearlo."
  },
  "fr": {
    "desc": "Montre depuis combien de temps un agent est silencieux alors que ses sessions tournent encore. La plupart des incidents commencent par « je ne savais pas que ça tournait encore », pas par malveillance.",
    "heading": "Inactif et hors contrôle",
    "level": {
      "active": "Actif",
      "idle": "Inactif",
      "forgotten": "Peut-être oublié"
    },
    "badge": {
      "idle": "Silencieux depuis {{elapsed}} avec des sessions actives",
      "forgotten": "Silencieux depuis {{elapsed}} — probablement oublié"
    },
    "row": {
      "idle": "Silencieux depuis",
      "live": "Sessions actives",
      "total": "Sessions au total"
    },
    "activeNote": "Actif récemment — rien d’oublié ici.",
    "idleNote": "Concevez le moment où l’on éteint un agent, pas seulement celui où on le crée."
  },
  "de": {
    "desc": "Zeigt, wie lange ein Agent still ist, während seine Sitzungen noch laufen. Die meisten Vorfälle beginnen mit „Ich wusste nicht, dass das noch läuft“, nicht mit Absicht.",
    "heading": "Untätig & außer Kontrolle",
    "level": {
      "active": "Aktiv",
      "idle": "Untätig",
      "forgotten": "Möglicherweise vergessen"
    },
    "badge": {
      "idle": "Seit {{elapsed}} still, Sitzungen laufen noch",
      "forgotten": "Seit {{elapsed}} still — vermutlich vergessen"
    },
    "row": {
      "idle": "Still seit",
      "live": "Aktive Sitzungen",
      "total": "Sitzungen gesamt"
    },
    "activeNote": "Kürzlich aktiv — hier ist nichts vergessen.",
    "idleNote": "Gestalten Sie den Moment des Abschaltens, nicht nur den des Erstellens."
  },
  "hi": {
    "desc": "दिखाता है कि सत्र जीवित रहते हुए एजेंट कितनी देर चुप रहा। अधिकांश घटनाएँ दुर्भावना से नहीं, \"पता ही नहीं था कि यह अब भी चल रहा है\" से शुरू होती हैं।",
    "heading": "निष्क्रिय व नियंत्रण-बाहर",
    "level": {
      "active": "सक्रिय",
      "idle": "निष्क्रिय",
      "forgotten": "शायद भुला दिया गया"
    },
    "badge": {
      "idle": "सत्र जीवित रहते {{elapsed}} से चुप",
      "forgotten": "{{elapsed}} से चुप — शायद भुला दिया गया"
    },
    "row": {
      "idle": "चुप्पी",
      "live": "जीवित सत्र",
      "total": "कुल सत्र"
    },
    "activeNote": "हाल ही में सक्रिय — यहाँ कुछ भुलाया नहीं गया।",
    "idleNote": "एजेंट को बनाने का नहीं, **बंद करने** का क्षण डिज़ाइन करें।"
  },
  "id": {
    "desc": "Menunjukkan berapa lama agen diam sementara sesinya masih hidup. Sebagian besar insiden bermula dari “tidak tahu itu masih berjalan”, bukan niat jahat.",
    "heading": "Idle & lepas kendali",
    "level": {
      "active": "Aktif",
      "idle": "Idle",
      "forgotten": "Mungkin terlupakan"
    },
    "badge": {
      "idle": "Diam {{elapsed}} padahal sesi masih hidup",
      "forgotten": "Diam {{elapsed}} — mungkin terlupakan"
    },
    "row": {
      "idle": "Diam selama",
      "live": "Sesi hidup",
      "total": "Total sesi"
    },
    "activeNote": "Baru aktif — tidak ada yang terlupakan di sini.",
    "idleNote": "Rancang saat mematikan agen, bukan hanya saat membuatnya."
  },
  "it": {
    "desc": "Mostra da quanto un agente è silenzioso mentre le sue sessioni sono ancora vive. La maggior parte degli incidenti nasce da «non sapevo fosse ancora in esecuzione», non da malizia.",
    "heading": "Inattivo e fuori controllo",
    "level": {
      "active": "Attivo",
      "idle": "Inattivo",
      "forgotten": "Forse dimenticato"
    },
    "badge": {
      "idle": "Silenzioso da {{elapsed}} con sessioni ancora vive",
      "forgotten": "Silenzioso da {{elapsed}} — probabilmente dimenticato"
    },
    "row": {
      "idle": "Silenzioso da",
      "live": "Sessioni vive",
      "total": "Sessioni totali"
    },
    "activeNote": "Attivo di recente — qui non c’è nulla di dimenticato.",
    "idleNote": "Progetta il momento in cui spegni un agente, non solo quello in cui lo crei."
  },
  "pt-BR": {
    "desc": "Mostra há quanto tempo um agente está calado enquanto suas sessões seguem vivas. A maioria dos incidentes começa com “eu não sabia que aquilo ainda estava rodando”, não com má intenção.",
    "heading": "Ocioso e fora de controle",
    "level": {
      "active": "Ativo",
      "idle": "Ocioso",
      "forgotten": "Possivelmente esquecido"
    },
    "badge": {
      "idle": "Calado há {{elapsed}} com sessões ainda vivas",
      "forgotten": "Calado há {{elapsed}} — provavelmente esquecido"
    },
    "row": {
      "idle": "Calado há",
      "live": "Sessões vivas",
      "total": "Total de sessões"
    },
    "activeNote": "Ativo recentemente — nada esquecido aqui.",
    "idleNote": "Projete o momento de desligar um agente, não apenas o de criá-lo."
  }
} as const;
