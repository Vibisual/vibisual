/**
 * mcp-server — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.mcpServer` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows whether Vibisual itself is exposed as a tool that outside clients can attach to. It is not — that exposure sits in the out-of-scope list, and this card exists so the decision stays visible.",
    "heading": "MCP Server",
    "level": {
      "notExposed": "Not exposed"
    },
    "check": {
      "exposed": "Exposed outward",
      "scope": "Scope",
      "client": "Attaching side"
    },
    "no": "no",
    "outOfScope": "out of scope",
    "clientCard": "see MCP Inventory",
    "note": "The side where we attach to outside servers is a different question and a different card. This one only reports our own exposure, and never turns it on."
  },
  "ko": {
    "desc": "Vibisual 자체가 외부 클라이언트가 물 수 있는 도구로 노출돼 있는지 보여줍니다. 열려 있지 않습니다 — 그 노출은 범위 밖 목록에 있고, 이 카드는 그 결정이 계속 보이게 하려고 있습니다.",
    "heading": "MCP 서버",
    "level": {
      "notExposed": "노출 안 됨"
    },
    "check": {
      "exposed": "외부 노출",
      "scope": "범위",
      "client": "무는 쪽"
    },
    "no": "아니오",
    "outOfScope": "범위 밖",
    "clientCard": "MCP 인벤토리 참조",
    "note": "우리가 외부 서버를 무는 쪽은 다른 질문이고 다른 카드입니다. 이 카드는 우리 노출 상태만 알리며, 노출을 켜지 않습니다."
  },
  "ja": {
    "check": {
      "scope": "範囲",
      "exposed": "外部への公開",
      "client": "接続する側"
    },
    "no": "いいえ",
    "heading": "MCP サーバー",
    "level": {
      "notExposed": "公開されていない"
    },
    "outOfScope": "範囲外",
    "clientCard": "MCP インベントリ参照",
    "desc": "Vibisual 自体が外部のクライアントから接続できる道具として公開されているかを示します。公開されていません — その公開は範囲外の一覧にあり、このカードはその判断が見え続けるためにあります。",
    "note": "私たちが外部サーバーに接続する側は別の問いであり、別のカードです。これは自分の公開状態だけを知らせ、公開を有効にすることはありません。"
  },
  "zh-CN": {
    "check": {
      "scope": "范围",
      "exposed": "对外暴露",
      "client": "连接侧"
    },
    "no": "否",
    "heading": "MCP 服务端",
    "level": {
      "notExposed": "未对外暴露"
    },
    "outOfScope": "范围之外",
    "clientCard": "见 MCP 清单",
    "desc": "显示 Vibisual 自身是否作为可被外部客户端接入的工具对外暴露。并没有 — 那种暴露属于范围之外的清单，这张卡片的存在是为了让这个决定持续可见。",
    "note": "我们去接入外部服务端是另一个问题，也是另一张卡片。这一张只报告我们自身的暴露状态，并且从不开启它。"
  },
  "es": {
    "check": {
      "scope": "Alcance",
      "exposed": "Expuesto al exterior",
      "client": "Lado que se conecta"
    },
    "no": "no",
    "heading": "Servidor MCP",
    "level": {
      "notExposed": "No expuesto"
    },
    "outOfScope": "fuera de alcance",
    "clientCard": "ver Inventario MCP",
    "desc": "Muestra si Vibisual mismo está expuesto como herramienta a la que clientes externos puedan engancharse. No lo está — esa exposición está en la lista de fuera de alcance, y esta tarjeta existe para que la decisión siga visible.",
    "note": "El lado en que nosotros nos enganchamos a servidores externos es otra pregunta y otra tarjeta. Esta solo informa de nuestra propia exposición, y nunca la activa."
  },
  "es-419": {
    "check": {
      "scope": "Alcance",
      "exposed": "Expuesto al exterior",
      "client": "Lado que se conecta"
    },
    "no": "no",
    "heading": "Servidor MCP",
    "level": {
      "notExposed": "No expuesto"
    },
    "outOfScope": "fuera de alcance",
    "clientCard": "ver Inventario MCP",
    "desc": "Muestra si Vibisual mismo está expuesto como herramienta a la que clientes externos puedan engancharse. No lo está — esa exposición está en la lista de fuera de alcance, y esta tarjeta existe para que la decisión siga visible.",
    "note": "El lado en que nosotros nos enganchamos a servidores externos es otra pregunta y otra tarjeta. Esta solo informa de nuestra propia exposición, y nunca la activa."
  },
  "fr": {
    "check": {
      "scope": "Portée",
      "exposed": "Exposé vers l’extérieur",
      "client": "Côté qui se connecte"
    },
    "no": "non",
    "heading": "Serveur MCP",
    "level": {
      "notExposed": "Non exposé"
    },
    "outOfScope": "hors périmètre",
    "clientCard": "voir l’inventaire MCP",
    "desc": "Indique si Vibisual lui-même est exposé comme un outil auquel des clients extérieurs peuvent se rattacher. Il ne l’est pas — cette exposition figure hors périmètre, et cette carte existe pour que la décision reste visible.",
    "note": "Le côté où nous nous rattachons à des serveurs extérieurs est une autre question et une autre carte. Celle-ci ne rapporte que notre propre exposition et ne l’active jamais."
  },
  "de": {
    "check": {
      "scope": "Umfang",
      "exposed": "Nach außen offen",
      "client": "Anbindende Seite"
    },
    "no": "nein",
    "heading": "MCP-Server",
    "level": {
      "notExposed": "Nicht offengelegt"
    },
    "outOfScope": "außerhalb des Umfangs",
    "clientCard": "siehe MCP-Inventar",
    "desc": "Zeigt, ob Vibisual selbst als Werkzeug offengelegt ist, an das sich externe Clients anhängen können. Ist es nicht — diese Offenlegung steht auf der Liste außerhalb des Umfangs, und diese Karte existiert, damit die Entscheidung sichtbar bleibt.",
    "note": "Die Seite, auf der wir uns an externe Server anhängen, ist eine andere Frage und eine andere Karte. Diese meldet nur unsere eigene Offenlegung und schaltet sie nie ein."
  },
  "hi": {
    "check": {
      "scope": "दायरा",
      "exposed": "बाहर उजागर",
      "client": "जुड़ने वाला पक्ष"
    },
    "no": "नहीं",
    "heading": "MCP सर्वर",
    "level": {
      "notExposed": "उजागर नहीं"
    },
    "outOfScope": "दायरे से बाहर",
    "clientCard": "MCP सूची देखें",
    "desc": "दिखाता है कि Vibisual ख़ुद ऐसे टूल के रूप में खुला है या नहीं जिससे बाहरी client जुड़ सकें। नहीं — वह उजागर करना दायरे से बाहर की सूची में है, और यह कार्ड इसलिए है कि वह निर्णय दिखता रहे।",
    "note": "हम बाहरी सर्वर से कहाँ जुड़ते हैं, यह दूसरा सवाल और दूसरा कार्ड है। यह वाला सिर्फ़ हमारा अपना उजागर होना बताता है, और उसे कभी चालू नहीं करता।"
  },
  "id": {
    "check": {
      "scope": "Cakupan",
      "exposed": "Terekspos ke luar",
      "client": "Sisi yang menyambung"
    },
    "no": "tidak",
    "heading": "Server MCP",
    "level": {
      "notExposed": "Tidak terekspos"
    },
    "outOfScope": "di luar cakupan",
    "clientCard": "lihat Inventaris MCP",
    "desc": "Menunjukkan apakah Vibisual sendiri terekspos sebagai alat yang bisa disambungi klien luar. Tidak — pemaparan itu ada di daftar di luar cakupan, dan kartu ini ada supaya keputusan tersebut tetap terlihat.",
    "note": "Sisi di mana kami menyambung ke server luar adalah pertanyaan lain dan kartu lain. Yang ini hanya melaporkan pemaparan kami sendiri, dan tak pernah menyalakannya."
  },
  "it": {
    "check": {
      "scope": "Ambito",
      "exposed": "Esposto verso l’esterno",
      "client": "Lato che si collega"
    },
    "no": "no",
    "heading": "Server MCP",
    "level": {
      "notExposed": "Non esposto"
    },
    "outOfScope": "fuori ambito",
    "clientCard": "vedi Inventario MCP",
    "desc": "Mostra se Vibisual stesso è esposto come strumento a cui client esterni possano agganciarsi. Non lo è — quell’esposizione sta nell’elenco fuori ambito, e questa scheda esiste perché la decisione resti visibile.",
    "note": "Il lato in cui siamo noi ad agganciarci a server esterni è un’altra domanda e un’altra scheda. Questa riporta solo la nostra esposizione, e non la attiva mai."
  },
  "pt-BR": {
    "check": {
      "scope": "Escopo",
      "exposed": "Exposto para fora",
      "client": "Lado que se conecta"
    },
    "no": "não",
    "heading": "Servidor MCP",
    "level": {
      "notExposed": "Não exposto"
    },
    "outOfScope": "fora do escopo",
    "clientCard": "ver Inventário MCP",
    "desc": "Mostra se o próprio Vibisual está exposto como ferramenta à qual clientes externos possam se ligar. Não está — essa exposição está na lista fora de escopo, e este cartão existe para que a decisão continue visível.",
    "note": "O lado em que nós nos ligamos a servidores externos é outra pergunta e outro cartão. Este só relata a nossa própria exposição, e nunca a liga."
  }
} as const;
