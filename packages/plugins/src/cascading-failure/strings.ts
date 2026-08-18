/**
 * cascading-failure — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.cascadingFailure` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "A wrong output becomes the next input and gets refined into something more confident at each step. Where a human team would ask “is this right?”, an agent takes it as a premise.",
    "heading": "Cascading Failure",
    "level": {
      "single": "No chain",
      "chained": "Chained",
      "unchecked": "Long and ungated"
    },
    "check": {
      "chain": "Chain length",
      "gated": "Gated handoffs"
    },
    "note": "Pass uncertainty across each boundary and keep a “could not confirm” field in the handoff. Self-feeding — an agent consuming its own signal — is the extreme form of this."
  },
  "ko": {
    "desc": "잘못된 출력이 다음 입력이 되고, 단계를 지날수록 더 확신에 찬 형태로 정제됩니다. 사람이라면 \"이거 이상한데?\"라고 물을 지점에서 에이전트는 그것을 전제로 삼습니다.",
    "heading": "연쇄 실패",
    "level": {
      "single": "사슬 없음",
      "chained": "사슬 있음",
      "unchecked": "길고 검문 없음"
    },
    "check": {
      "chain": "사슬 길이",
      "gated": "검문 있는 인계"
    },
    "note": "경계마다 불확실성을 함께 넘기고, 인계에 \"확인하지 못한 것\" 칸을 두십시오. 자기 신호를 자기 입력으로 되먹는 자기 증식이 이 계열의 극단입니다."
  },
  "ja": {
    "heading": "連鎖障害",
    "check": {
      "chain": "連鎖の長さ",
      "gated": "検問のある引き継ぎ"
    },
    "level": {
      "single": "連鎖なし",
      "chained": "連鎖あり",
      "unchecked": "長く検問なし"
    },
    "desc": "誤った出力が次の入力になり、段階を経るごとにより自信のある形へ整えられていきます。人の集団なら「これ変では」と問う地点で、エージェントはそれを前提にして進みます。",
    "note": "境界ごとに不確かさを一緒に渡し、引き継ぎに「確認できなかったこと」の欄を置いてください。自分の信号を自分の入力に戻す自己増殖が、この系統の極端な形です。"
  },
  "zh-CN": {
    "heading": "级联失败",
    "check": {
      "chain": "链路长度",
      "gated": "带关卡的交接"
    },
    "level": {
      "single": "无链路",
      "chained": "存在链路",
      "unchecked": "长且无关卡"
    },
    "desc": "错误的输出成为下一个输入，并在每一步被打磨得更加自信。人类团队会问「这对吗」的地方，智能体却直接把它当成前提继续。",
    "note": "在每个边界一并传递不确定性，并在交接中保留「未能确认」一栏。把自己的信号当成自己的输入的自增殖，是这一类的极端形态。"
  },
  "es": {
    "heading": "Fallo en cascada",
    "check": {
      "chain": "Longitud de la cadena",
      "gated": "Traspasos con control"
    },
    "level": {
      "single": "Sin cadena",
      "chained": "Encadenado",
      "unchecked": "Largo y sin control"
    },
    "desc": "Una salida errónea pasa a ser la siguiente entrada y se refina en algo más seguro a cada paso. Donde un equipo humano preguntaría «¿esto está bien?», un agente lo toma como premisa.",
    "note": "Pasa la incertidumbre por cada frontera y mantén un campo «no se pudo confirmar» en el traspaso. La autoalimentación — un agente consumiendo su propia señal — es la forma extrema de esto."
  },
  "es-419": {
    "heading": "Fallo en cascada",
    "check": {
      "chain": "Longitud de la cadena",
      "gated": "Traspasos con control"
    },
    "level": {
      "single": "Sin cadena",
      "chained": "Encadenado",
      "unchecked": "Largo y sin control"
    },
    "desc": "Una salida errónea pasa a ser la siguiente entrada y se refina en algo más seguro a cada paso. Donde un equipo humano preguntaría «¿esto está bien?», un agente lo toma como premisa.",
    "note": "Pasa la incertidumbre por cada frontera y mantén un campo «no se pudo confirmar» en el traspaso. La autoalimentación — un agente consumiendo su propia señal — es la forma extrema de esto."
  },
  "fr": {
    "heading": "Défaillance en cascade",
    "check": {
      "chain": "Longueur de chaîne",
      "gated": "Passations contrôlées"
    },
    "level": {
      "single": "Aucune chaîne",
      "chained": "Enchaîné",
      "unchecked": "Long et sans contrôle"
    },
    "desc": "Une sortie fausse devient l’entrée suivante et se raffine à chaque étape en quelque chose de plus assuré. Là où une équipe humaine demanderait « est-ce correct ? », un agent le prend pour prémisse.",
    "note": "Faites circuler l’incertitude à chaque frontière et gardez un champ « n’a pas pu être confirmé » dans la passation. L’auto-alimentation — un agent consommant son propre signal — en est la forme extrême."
  },
  "de": {
    "heading": "Kaskadenausfall",
    "check": {
      "chain": "Kettenlänge",
      "gated": "Kontrollierte Übergaben"
    },
    "level": {
      "single": "Keine Kette",
      "chained": "Verkettet",
      "unchecked": "Lang und ungeprüft"
    },
    "desc": "Eine falsche Ausgabe wird zur nächsten Eingabe und wird bei jedem Schritt zu etwas Selbstsichererem verfeinert. Wo ein menschliches Team fragen würde „stimmt das?“, nimmt ein Agent es als Prämisse.",
    "note": "Reichen Sie Unsicherheit über jede Grenze mit und halten Sie in der Übergabe ein Feld „konnte nicht bestätigt werden“. Selbstzufuhr — ein Agent, der sein eigenes Signal konsumiert — ist die extreme Form davon."
  },
  "hi": {
    "heading": "श्रृंखलाबद्ध विफलता",
    "check": {
      "chain": "श्रृंखला लंबाई",
      "gated": "नियंत्रित हस्तांतरण"
    },
    "level": {
      "single": "कोई श्रृंखला नहीं",
      "chained": "श्रृंखलाबद्ध",
      "unchecked": "लंबा व अनियंत्रित"
    },
    "desc": "ग़लत आउटपुट अगला इनपुट बन जाता है और हर चरण पर और भरोसेमंद रूप में घिस जाता है। जिस जगह मनुष्यों की टीम पूछती «क्या यह सही है?», एजेंट उसे आधार बना लेता है।",
    "note": "हर सीमा पर अनिश्चितता आगे बढ़ाइए और सौंपने में «पक्का नहीं हो सका» का खाना रखिए। ख़ुद को खिलाना — अपने ही संकेत खाता एजेंट — इसका चरम रूप है।"
  },
  "id": {
    "heading": "Kegagalan beruntun",
    "check": {
      "chain": "Panjang rantai",
      "gated": "Serah terima berpagar"
    },
    "level": {
      "single": "Tanpa rantai",
      "chained": "Berantai",
      "unchecked": "Panjang tanpa pagar"
    },
    "desc": "Keluaran yang salah menjadi masukan berikutnya dan di tiap langkah dipoles menjadi sesuatu yang lebih meyakinkan. Di titik tim manusia akan bertanya «ini benar?», agen justru menjadikannya premis.",
    "note": "Teruskan ketidakpastian di tiap batas dan sediakan kolom «tidak bisa dipastikan» dalam serah terima. Memberi makan diri sendiri — agen yang mengonsumsi sinyalnya sendiri — adalah bentuk ekstremnya."
  },
  "it": {
    "heading": "Guasto a cascata",
    "check": {
      "chain": "Lunghezza della catena",
      "gated": "Passaggi controllati"
    },
    "level": {
      "single": "Nessuna catena",
      "chained": "Concatenato",
      "unchecked": "Lungo e senza controlli"
    },
    "desc": "Un output sbagliato diventa l’input successivo e a ogni passo viene raffinato in qualcosa di più sicuro di sé. Dove una squadra umana chiederebbe «è giusto?», un agente lo assume come premessa.",
    "note": "Fai passare l’incertezza a ogni confine e tieni un campo «non è stato possibile confermare» nel passaggio. L’autoalimentazione — un agente che consuma il proprio segnale — ne è la forma estrema."
  },
  "pt-BR": {
    "heading": "Falha em cascata",
    "check": {
      "chain": "Comprimento da cadeia",
      "gated": "Repasses com controle"
    },
    "level": {
      "single": "Sem cadeia",
      "chained": "Encadeado",
      "unchecked": "Longo e sem controle"
    },
    "desc": "Uma saída errada vira a entrada seguinte e é refinada em algo mais convicto a cada passo. Onde um time humano perguntaria «isso está certo?», um agente toma como premissa.",
    "note": "Passe a incerteza por cada fronteira e mantenha um campo «não foi possível confirmar» no repasse. A autoalimentação — um agente consumindo o próprio sinal — é a forma extrema disso."
  }
} as const;
