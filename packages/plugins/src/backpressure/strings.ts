/**
 * backpressure — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.backpressure` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "When arrival outpaces processing the queue grows, and left alone the overflow is either silently dropped or brings everything to a stop.",
    "heading": "Backpressure",
    "level": {
      "idle": "Idle",
      "flowing": "Flowing",
      "saturated": "Saturated"
    },
    "check": {
      "running": "Running now",
      "queued": "Queued instructions"
    },
    "note": "Many branches at once is not throughput if they contend for the same context and the same review attention."
  },
  "ko": {
    "desc": "유입이 처리를 앞지르면 큐가 자라고, 방치하면 넘친 것이 조용히 버려지거나 전체가 멈춥니다.",
    "heading": "배압",
    "level": {
      "idle": "유휴",
      "flowing": "흐르는 중",
      "saturated": "포화"
    },
    "check": {
      "running": "지금 도는 것",
      "queued": "대기 중 지시"
    },
    "note": "동시에 여러 갈래를 띄우는 것은, 같은 컨텍스트와 같은 검수 주의를 다툰다면 처리량이 아닙니다."
  },
  "ja": {
    "level": {
      "idle": "待機",
      "flowing": "流れている",
      "saturated": "飽和"
    },
    "check": {
      "running": "実行中",
      "queued": "待機中の指示"
    },
    "heading": "背圧",
    "desc": "流入が処理を追い越すとキューが伸び、放っておけば溢れた分が静かに捨てられるか、全体が止まります。",
    "note": "同時に何本も走らせることは、同じコンテキストと同じ検収の注意を奪い合うなら処理量ではありません。"
  },
  "zh-CN": {
    "level": {
      "idle": "闲置",
      "flowing": "流动中",
      "saturated": "饱和"
    },
    "check": {
      "running": "正在运行",
      "queued": "排队指令"
    },
    "heading": "背压",
    "desc": "当流入超过处理速度，队列就会增长；放任不管，溢出的部分要么被悄悄丢弃，要么让整体停摆。",
    "note": "如果多条分支争夺同一份上下文和同一份检查注意力，同时开很多条并不等于吞吐量。"
  },
  "es": {
    "level": {
      "idle": "Inactivo",
      "flowing": "Fluyendo",
      "saturated": "Saturado"
    },
    "check": {
      "running": "En ejecución",
      "queued": "Instrucciones en cola"
    },
    "heading": "Contrapresión",
    "desc": "Cuando la llegada supera al procesamiento, la cola crece; si se deja sola, el exceso se descarta en silencio o lo detiene todo.",
    "note": "Muchas ramas a la vez no son rendimiento si compiten por el mismo contexto y la misma atención de revisión."
  },
  "es-419": {
    "level": {
      "idle": "Inactivo",
      "flowing": "Fluyendo",
      "saturated": "Saturado"
    },
    "check": {
      "running": "En ejecución",
      "queued": "Instrucciones en cola"
    },
    "heading": "Contrapresión",
    "desc": "Cuando la llegada supera al procesamiento, la cola crece; si se deja sola, el exceso se descarta en silencio o lo detiene todo.",
    "note": "Muchas ramas a la vez no son rendimiento si compiten por el mismo contexto y la misma atención de revisión."
  },
  "fr": {
    "level": {
      "idle": "Inactif",
      "flowing": "En flux",
      "saturated": "Saturé"
    },
    "check": {
      "running": "En cours",
      "queued": "Instructions en file"
    },
    "heading": "Contre-pression",
    "desc": "Quand l’arrivée dépasse le traitement, la file grandit ; laissée à elle-même, la surcharge est soit silencieusement jetée, soit elle arrête tout.",
    "note": "Beaucoup de branches à la fois ne font pas du débit si elles se disputent le même contexte et la même attention de revue."
  },
  "de": {
    "level": {
      "idle": "Untätig",
      "flowing": "Im Fluss",
      "saturated": "Gesättigt"
    },
    "check": {
      "running": "Läuft gerade",
      "queued": "Anweisungen in Warteschlange"
    },
    "heading": "Gegendruck",
    "desc": "Wenn der Zustrom die Verarbeitung überholt, wächst die Warteschlange; bleibt sie sich selbst überlassen, wird der Überlauf entweder still verworfen oder bringt alles zum Stehen.",
    "note": "Viele Zweige gleichzeitig sind kein Durchsatz, wenn sie um denselben Kontext und dieselbe Prüfaufmerksamkeit konkurrieren."
  },
  "hi": {
    "level": {
      "idle": "निष्क्रिय",
      "flowing": "बह रहा",
      "saturated": "संतृप्त"
    },
    "check": {
      "running": "अभी चल रहा",
      "queued": "कतार में निर्देश"
    },
    "heading": "बैकप्रेशर",
    "desc": "जब आने की दर संसाधन की दर से आगे निकल जाए, कतार बढ़ती है; यूँ ही छोड़ दें तो अतिरिक्त या तो चुपचाप गिरता है या सब कुछ रोक देता है।",
    "note": "एक साथ बहुत सी शाखाएँ उत्पादन नहीं हैं, यदि वे उसी संदर्भ और उसी समीक्षा-ध्यान के लिए आपस में लड़ रही हों।"
  },
  "id": {
    "level": {
      "idle": "Idle",
      "flowing": "Mengalir",
      "saturated": "Jenuh"
    },
    "check": {
      "running": "Sedang berjalan",
      "queued": "Instruksi antre"
    },
    "heading": "Tekanan balik",
    "desc": "Ketika laju masuk melampaui laju proses, antrean membesar; dibiarkan begitu, kelebihannya entah dibuang diam-diam atau menghentikan semuanya.",
    "note": "Banyak cabang sekaligus bukanlah keluaran kerja bila mereka memperebutkan konteks yang sama dan perhatian tinjauan yang sama."
  },
  "it": {
    "level": {
      "idle": "Inattivo",
      "flowing": "In flusso",
      "saturated": "Saturo"
    },
    "check": {
      "running": "In esecuzione",
      "queued": "Istruzioni in coda"
    },
    "heading": "Contropressione",
    "desc": "Quando l’arrivo supera l’elaborazione la coda cresce; lasciata a sé, l’eccedenza viene scartata in silenzio oppure blocca tutto.",
    "note": "Molti rami insieme non sono portata se si contendono lo stesso contesto e la stessa attenzione di revisione."
  },
  "pt-BR": {
    "level": {
      "idle": "Ocioso",
      "flowing": "Fluindo",
      "saturated": "Saturado"
    },
    "check": {
      "running": "Em execução",
      "queued": "Instruções na fila"
    },
    "heading": "Contrapressão",
    "desc": "Quando a chegada ultrapassa o processamento, a fila cresce; deixada sozinha, a sobra é descartada em silêncio ou trava tudo.",
    "note": "Muitos ramos ao mesmo tempo não são vazão se disputam o mesmo contexto e a mesma atenção de revisão."
  }
} as const;
