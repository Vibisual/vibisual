/**
 * event-driven — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.eventDriven` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Vibisual itself runs on hook events, so this card shows how much signal actually flowed through this agent and where it came from.",
    "heading": "Event-Driven",
    "level": {
      "silent": "No events",
      "flowing": "Events flowing"
    },
    "check": {
      "total": "Total events",
      "queued": "From the queue",
      "direct": "Direct"
    },
    "note": "Loose coupling and independent failure are the point — but they also mean nothing tells you an event was dropped."
  },
  "ko": {
    "desc": "Vibisual 자체가 훅 이벤트로 도는 시스템이라, 이 카드는 이 에이전트에서 실제로 흐른 신호의 양과 출처를 보여줍니다.",
    "heading": "이벤트 기반",
    "level": {
      "silent": "이벤트 없음",
      "flowing": "흐르는 중"
    },
    "check": {
      "total": "전체 이벤트",
      "queued": "대기열에서",
      "direct": "직접 입력"
    },
    "note": "느슨한 결합과 독립적 장애가 장점이지만, 그만큼 이벤트가 유실돼도 아무도 알려주지 않습니다."
  },
  "ja": {
    "heading": "イベント駆動",
    "check": {
      "total": "イベント総数",
      "queued": "待ち行列から",
      "direct": "直接入力"
    },
    "level": {
      "silent": "イベントなし",
      "flowing": "イベントが流れている"
    },
    "desc": "Vibisual 自体がフックイベントで動く仕組みなので、このカードはこのエージェントで実際に流れた信号の量と出所を示します。",
    "note": "疎結合と独立した障害が利点ですが、その分イベントが失われても誰も教えてくれません。"
  },
  "zh-CN": {
    "heading": "事件驱动",
    "check": {
      "total": "事件总数",
      "queued": "来自队列",
      "direct": "直接输入"
    },
    "level": {
      "silent": "无事件",
      "flowing": "事件在流动"
    },
    "desc": "Vibisual 本身就靠钩子事件运转，所以这张卡片显示这个智能体上实际流过多少信号、来自哪里。",
    "note": "松耦合与独立故障是优点，但这也意味着事件被丢掉时没人会告诉你。"
  },
  "es": {
    "heading": "Basado en eventos",
    "check": {
      "total": "Eventos en total",
      "queued": "Desde la cola",
      "direct": "Directas"
    },
    "level": {
      "silent": "Sin eventos",
      "flowing": "Eventos fluyendo"
    },
    "desc": "Vibisual mismo funciona con eventos de hook, así que esta tarjeta muestra cuánta señal pasó realmente por este agente y de dónde vino.",
    "note": "El acoplamiento débil y el fallo independiente son la gracia — pero también significan que nada te avisa cuando un evento se perdió."
  },
  "es-419": {
    "heading": "Basado en eventos",
    "check": {
      "total": "Eventos en total",
      "queued": "Desde la cola",
      "direct": "Directas"
    },
    "level": {
      "silent": "Sin eventos",
      "flowing": "Eventos fluyendo"
    },
    "desc": "Vibisual mismo funciona con eventos de hook, así que esta tarjeta muestra cuánta señal pasó realmente por este agente y de dónde vino.",
    "note": "El acoplamiento débil y el fallo independiente son la gracia — pero también significan que nada te avisa cuando un evento se perdió."
  },
  "fr": {
    "heading": "Piloté par événements",
    "check": {
      "total": "Total d’événements",
      "queued": "Depuis la file",
      "direct": "Directes"
    },
    "level": {
      "silent": "Aucun événement",
      "flowing": "Événements en flux"
    },
    "desc": "Vibisual lui-même tourne sur des événements de hook ; cette carte montre donc combien de signal a réellement traversé cet agent et d’où il venait.",
    "note": "Couplage lâche et pannes indépendantes sont le but — mais cela signifie aussi que rien ne vous prévient qu’un événement a été perdu."
  },
  "de": {
    "heading": "Ereignisgesteuert",
    "check": {
      "total": "Ereignisse gesamt",
      "queued": "Aus der Warteschlange",
      "direct": "Direkt"
    },
    "level": {
      "silent": "Keine Ereignisse",
      "flowing": "Ereignisse fließen"
    },
    "desc": "Vibisual selbst läuft auf Hook-Ereignissen, deshalb zeigt diese Karte, wie viel Signal tatsächlich durch diesen Agenten floss und woher es kam.",
    "note": "Lose Kopplung und unabhängiges Scheitern sind der Sinn — sie bedeuten aber auch, dass niemand meldet, wenn ein Ereignis verloren ging."
  },
  "hi": {
    "heading": "इवेंट-चालित",
    "check": {
      "total": "कुल घटनाएँ",
      "queued": "कतार से",
      "direct": "सीधे"
    },
    "level": {
      "silent": "कोई घटना नहीं",
      "flowing": "घटनाएँ बह रहीं"
    },
    "desc": "Vibisual ख़ुद hook घटनाओं पर चलता है, इसलिए यह कार्ड दिखाता है कि इस एजेंट से सचमुच कितने संकेत गुज़रे और कहाँ से आए।",
    "note": "ढीला जुड़ाव और स्वतंत्र विफलता ही उद्देश्य है — पर इसका अर्थ यह भी है कि कोई घटना गुम हो जाए तो बताने वाला कोई नहीं।"
  },
  "id": {
    "heading": "Berbasis peristiwa",
    "check": {
      "total": "Total peristiwa",
      "queued": "Dari antrean",
      "direct": "Langsung"
    },
    "level": {
      "silent": "Tanpa peristiwa",
      "flowing": "Peristiwa mengalir"
    },
    "desc": "Vibisual sendiri berjalan di atas peristiwa hook, jadi kartu ini menunjukkan berapa banyak sinyal yang benar-benar melewati agen ini dan dari mana asalnya.",
    "note": "Keterkaitan longgar dan kegagalan yang mandiri memang tujuannya — tetapi itu juga berarti tak ada yang memberi tahu ketika sebuah peristiwa hilang."
  },
  "it": {
    "heading": "Guidato dagli eventi",
    "check": {
      "total": "Eventi totali",
      "queued": "Dalla coda",
      "direct": "Dirette"
    },
    "level": {
      "silent": "Nessun evento",
      "flowing": "Eventi in flusso"
    },
    "desc": "Vibisual stesso gira su eventi di hook, quindi questa scheda mostra quanto segnale è realmente passato per questo agente e da dove veniva.",
    "note": "Accoppiamento lasco e guasti indipendenti sono il punto — ma significano anche che nulla ti avvisa quando un evento è andato perso."
  },
  "pt-BR": {
    "heading": "Orientado a eventos",
    "check": {
      "total": "Total de eventos",
      "queued": "Da fila",
      "direct": "Diretas"
    },
    "level": {
      "silent": "Sem eventos",
      "flowing": "Eventos fluindo"
    },
    "desc": "O próprio Vibisual roda sobre eventos de hook, então este cartão mostra quanto sinal realmente passou por este agente e de onde veio.",
    "note": "Acoplamento frouxo e falhas independentes são o ponto — mas também significam que nada avisa quando um evento se perdeu."
  }
} as const;
