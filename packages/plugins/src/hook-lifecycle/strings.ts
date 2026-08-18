/**
 * hook-lifecycle — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.hookLifecycle` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Hooks arrive more often than people expect — believing a “session end” hook fires once when it fires every turn is a classic cause of runaway behaviour.",
    "heading": "Hook Lifecycle",
    "level": {
      "quiet": "Quiet",
      "normal": "Normal",
      "busy": "Firing often"
    },
    "check": {
      "events": "Recorded events",
      "rate": "Per minute"
    },
    "note": "Synchronous I/O inside a hook stalls the agent for exactly that long. Queue and coalesce instead."
  },
  "ko": {
    "desc": "훅은 예상보다 자주 옵니다 — \"세션 종료\" 훅이 매 턴 종료마다 온다는 것을 모르면 폭주 사고로 이어집니다.",
    "heading": "훅 생명주기",
    "level": {
      "quiet": "조용함",
      "normal": "보통",
      "busy": "자주 발화"
    },
    "check": {
      "events": "기록된 이벤트",
      "rate": "분당"
    },
    "note": "훅 안에서 동기 I/O 를 하면 에이전트가 그만큼 멈춥니다. 큐잉과 코얼레스가 기본입니다."
  },
  "ja": {
    "level": {
      "normal": "通常",
      "busy": "発火が多い",
      "quiet": "静か"
    },
    "heading": "フックのライフサイクル",
    "check": {
      "events": "記録イベント",
      "rate": "毎分"
    },
    "desc": "フックは思ったより頻繁に来ます — 「セッション終了」フックが毎ターン来ることを知らないと、暴走事故につながります。",
    "note": "フックの中で同期 I/O をすると、その分だけエージェントが止まります。キューイングとまとめ処理が基本です。"
  },
  "zh-CN": {
    "level": {
      "normal": "正常",
      "busy": "触发频繁",
      "quiet": "安静"
    },
    "heading": "钩子生命周期",
    "check": {
      "events": "已记录事件",
      "rate": "每分钟"
    },
    "desc": "钩子来的比人们以为的更频繁 — 以为「会话结束」钩子只触发一次，实际上每轮都触发，这是失控事故的经典原因。",
    "note": "在钩子里做同步 I/O，智能体就会停滞同样长的时间。应该改为排队与合并处理。"
  },
  "es": {
    "level": {
      "normal": "Normal",
      "busy": "Se dispara a menudo",
      "quiet": "Tranquilo"
    },
    "heading": "Ciclo de vida de hooks",
    "check": {
      "events": "Eventos registrados",
      "rate": "Por minuto"
    },
    "desc": "Los hooks llegan más a menudo de lo que se cree — pensar que un hook de «fin de sesión» se dispara una vez cuando lo hace en cada turno es causa clásica de comportamiento desbocado.",
    "note": "Una E/S síncrona dentro de un hook detiene al agente exactamente ese tiempo. Mejor encolar y agrupar."
  },
  "es-419": {
    "level": {
      "normal": "Normal",
      "busy": "Se dispara a menudo",
      "quiet": "Tranquilo"
    },
    "heading": "Ciclo de vida de hooks",
    "check": {
      "events": "Eventos registrados",
      "rate": "Por minuto"
    },
    "desc": "Los hooks llegan más a menudo de lo que se cree — pensar que un hook de «fin de sesión» se dispara una vez cuando lo hace en cada turno es causa clásica de comportamiento desbocado.",
    "note": "Una E/S síncrona dentro de un hook detiene al agente exactamente ese tiempo. Mejor encolar y agrupar."
  },
  "fr": {
    "level": {
      "normal": "Normal",
      "busy": "Se déclenche souvent",
      "quiet": "Calme"
    },
    "heading": "Cycle de vie des hooks",
    "check": {
      "events": "Événements enregistrés",
      "rate": "Par minute"
    },
    "desc": "Les hooks arrivent plus souvent qu’on ne le croit — penser qu’un hook « fin de session » se déclenche une fois alors qu’il se déclenche à chaque tour est une cause classique d’emballement.",
    "note": "Une E/S synchrone dans un hook fige l’agent exactement d’autant. Mettez plutôt en file d’attente et regroupez."
  },
  "de": {
    "level": {
      "normal": "Normal",
      "busy": "Feuert oft",
      "quiet": "Ruhig"
    },
    "heading": "Hook-Lebenszyklus",
    "check": {
      "events": "Erfasste Ereignisse",
      "rate": "Pro Minute"
    },
    "desc": "Hooks kommen häufiger als erwartet — zu glauben, ein „Sitzungsende“-Hook feuere einmal, während er in jedem Zug feuert, ist ein Klassiker unter den Ursachen für außer Kontrolle geratenes Verhalten.",
    "note": "Synchrones I/O in einem Hook hält den Agenten genau so lange an. Stattdessen einreihen und zusammenfassen."
  },
  "hi": {
    "level": {
      "normal": "सामान्य",
      "busy": "बार-बार चल रहा",
      "quiet": "शांत"
    },
    "heading": "हुक जीवनचक्र",
    "check": {
      "events": "दर्ज घटनाएँ",
      "rate": "प्रति मिनट"
    },
    "desc": "Hook लोगों की धारणा से कहीं ज़्यादा बार आते हैं — «सत्र का अंत» वाला hook एक बार चलता है ऐसा मान लेना, जबकि वह हर बारी चलता है, बेकाबू व्यवहार का जाना-पहचाना कारण है।",
    "note": "Hook के भीतर तुल्यकालिक I/O एजेंट को ठीक उतनी देर रोके रखता है। बेहतर है कतार में डालिए और एक साथ कीजिए।"
  },
  "id": {
    "level": {
      "normal": "Normal",
      "busy": "Sering terpicu",
      "quiet": "Sepi"
    },
    "heading": "Siklus hidup hook",
    "check": {
      "events": "Peristiwa tercatat",
      "rate": "Per menit"
    },
    "desc": "Hook datang lebih sering daripada dugaan orang — mengira hook «akhir sesi» menyala sekali padahal menyala tiap giliran adalah penyebab klasik perilaku lepas kendali.",
    "note": "I/O sinkron di dalam hook menahan agen persis selama itu. Lebih baik antrekan dan gabungkan."
  },
  "it": {
    "level": {
      "normal": "Normale",
      "busy": "Scatta spesso",
      "quiet": "Tranquillo"
    },
    "heading": "Ciclo di vita degli hook",
    "check": {
      "events": "Eventi registrati",
      "rate": "Al minuto"
    },
    "desc": "Gli hook arrivano più spesso di quanto si pensi — credere che un hook di «fine sessione» scatti una volta mentre scatta a ogni turno è una causa classica di comportamenti fuori controllo.",
    "note": "Un I/O sincrono dentro un hook blocca l’agente esattamente per quel tempo. Meglio accodare e raggruppare."
  },
  "pt-BR": {
    "level": {
      "normal": "Normal",
      "busy": "Dispara com frequência",
      "quiet": "Quieto"
    },
    "heading": "Ciclo de vida dos hooks",
    "check": {
      "events": "Eventos registrados",
      "rate": "Por minuto"
    },
    "desc": "Hooks chegam com mais frequência do que se imagina — achar que um hook de «fim de sessão» dispara uma vez quando dispara a cada turno é causa clássica de comportamento descontrolado.",
    "note": "E/S síncrona dentro de um hook trava o agente exatamente por esse tempo. Melhor enfileirar e agrupar."
  }
} as const;
