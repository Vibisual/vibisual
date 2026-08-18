/**
 * scope-creep — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.scopeCreep` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Watches the to-do list for growth and for quiet shrinkage. In AI collaboration the shrinking direction matters just as much — the user believes it was all done and finds out late.",
    "heading": "Scope",
    "level": {
      "unknown": "No plan to compare",
      "stable": "Stable",
      "grew": "Grew",
      "shrank": "Shrank"
    },
    "check": {
      "first": "First recorded",
      "peak": "Peak",
      "last": "Latest"
    },
    "note": "Scope is the instructing side’s decision, not the model’s discretion.",
    "noteGrew": "The list grew well past where it started. Worth checking whether that growth was agreed.",
    "noteShrank": "The list shrank from its peak. Confirm those items were finished rather than dropped."
  },
  "ko": {
    "desc": "할일 목록이 늘었는지, 조용히 줄었는지 봅니다. AI 협업에서는 줄어드는 방향도 똑같이 문제입니다 — 사용자는 전부 됐다고 믿고 넘어가므로 발견이 늦습니다.",
    "heading": "범위",
    "level": {
      "unknown": "비교할 계획 없음",
      "stable": "유지됨",
      "grew": "늘어남",
      "shrank": "줄어듦"
    },
    "check": {
      "first": "처음 기록",
      "peak": "최대",
      "last": "마지막"
    },
    "note": "범위 조정은 지시하는 쪽의 결정권이지 모델의 재량이 아닙니다.",
    "noteGrew": "시작보다 목록이 많이 늘었습니다. 그 확장이 합의된 것인지 확인해 볼 만합니다.",
    "noteShrank": "최대치보다 목록이 줄었습니다. 그 항목들이 끝난 것인지, 빠진 것인지 확인하십시오."
  },
  "ja": {
    "heading": "範囲",
    "check": {
      "first": "最初の記録",
      "peak": "最大",
      "last": "最新"
    },
    "level": {
      "unknown": "比較する計画がない",
      "grew": "増えた",
      "stable": "安定",
      "shrank": "減った"
    },
    "desc": "やることリストが増えたか、静かに減ったかを見ます。AI との協働では減る方向も同じくらい問題です — 利用者は全部できたと信じて進むため、発見が遅れます。",
    "note": "範囲の調整は指示する側の決定権であって、モデルの裁量ではありません。",
    "noteGrew": "始まりより項目がかなり増えています。その拡大が合意されたものか確認する価値があります。",
    "noteShrank": "最大時よりリストが減っています。その項目が終わったのか、落ちたのかを確認してください。"
  },
  "zh-CN": {
    "heading": "范围",
    "check": {
      "first": "首次记录",
      "peak": "峰值",
      "last": "最新"
    },
    "level": {
      "unknown": "无计划可比",
      "grew": "有增长",
      "stable": "稳定",
      "shrank": "有缩减"
    },
    "desc": "观察待办清单是变多了还是悄悄变少了。在与 AI 协作中，缩小的方向同样是问题 — 用户以为全都做完了，因此发现得很晚。",
    "note": "范围调整是下达指令一方的决定权，而不是模型的自由裁量。",
    "noteGrew": "清单比最初增加了不少。值得确认这种扩张是否经过同意。",
    "noteShrank": "清单从峰值缩减了。请确认那些条目是完成了，还是被丢掉了。"
  },
  "es": {
    "heading": "Alcance",
    "check": {
      "first": "Primer registro",
      "peak": "Máximo",
      "last": "Último"
    },
    "level": {
      "unknown": "Sin plan que comparar",
      "grew": "Creció",
      "stable": "Estable",
      "shrank": "Se redujo"
    },
    "desc": "Vigila la lista de tareas, tanto su crecimiento como su reducción silenciosa. En la colaboración con IA la dirección menguante importa igual — se cree que todo estaba hecho y se descubre tarde.",
    "note": "El alcance es decisión de quien da las instrucciones, no discreción del modelo.",
    "noteGrew": "La lista ha crecido bastante más allá de donde empezó. Conviene comprobar si ese crecimiento se acordó.",
    "noteShrank": "La lista ha encogido respecto a su máximo. Confirma que esos puntos se terminaron y no se abandonaron."
  },
  "es-419": {
    "heading": "Alcance",
    "check": {
      "first": "Primer registro",
      "peak": "Máximo",
      "last": "Último"
    },
    "level": {
      "unknown": "Sin plan que comparar",
      "grew": "Creció",
      "stable": "Estable",
      "shrank": "Se redujo"
    },
    "desc": "Vigila la lista de tareas, tanto su crecimiento como su reducción silenciosa. En la colaboración con IA la dirección menguante importa igual — se cree que todo estaba hecho y se descubre tarde.",
    "note": "El alcance es decisión de quien da las instrucciones, no discreción del modelo.",
    "noteGrew": "La lista ha crecido bastante más allá de donde empezó. Conviene comprobar si ese crecimiento se acordó.",
    "noteShrank": "La lista ha encogido respecto a su máximo. Confirma que esos puntos se terminaron y no se abandonaron."
  },
  "fr": {
    "heading": "Portée",
    "check": {
      "first": "Premier enregistrement",
      "peak": "Pic",
      "last": "Dernier"
    },
    "level": {
      "unknown": "Aucun plan à comparer",
      "grew": "A augmenté",
      "stable": "Stable",
      "shrank": "A diminué"
    },
    "desc": "Surveille la liste de tâches, sa croissance comme son rétrécissement silencieux. En collaboration avec une IA, le sens décroissant compte tout autant — on croit que tout est fait et on s’en aperçoit tard.",
    "note": "Le périmètre relève de la décision de celui qui donne les instructions, pas de la latitude du modèle.",
    "noteGrew": "La liste a nettement dépassé son point de départ. Il vaut la peine de vérifier si cette croissance a été convenue.",
    "noteShrank": "La liste a rétréci par rapport à son maximum. Confirmez que ces éléments ont été terminés et non abandonnés."
  },
  "de": {
    "heading": "Umfang",
    "check": {
      "first": "Erste Erfassung",
      "peak": "Höchstwert",
      "last": "Zuletzt"
    },
    "level": {
      "unknown": "Kein Plan zum Vergleich",
      "grew": "Gewachsen",
      "stable": "Stabil",
      "shrank": "Geschrumpft"
    },
    "desc": "Beobachtet die Aufgabenliste auf Wachstum und auf stilles Schrumpfen. In der Zusammenarbeit mit KI zählt die Schrumpfrichtung genauso — man glaubt, alles sei erledigt, und merkt es spät.",
    "note": "Der Umfang ist die Entscheidung der anweisenden Seite, nicht das Ermessen des Modells.",
    "noteGrew": "Die Liste ist weit über den Ausgangspunkt hinaus gewachsen. Es lohnt zu prüfen, ob dieses Wachstum vereinbart war.",
    "noteShrank": "Die Liste ist vom Höchststand geschrumpft. Prüfen Sie, ob diese Punkte erledigt wurden oder weggefallen sind."
  },
  "hi": {
    "heading": "दायरा",
    "check": {
      "first": "पहला रिकॉर्ड",
      "peak": "शिखर",
      "last": "नवीनतम"
    },
    "level": {
      "unknown": "तुलना को योजना नहीं",
      "grew": "बढ़ा",
      "stable": "स्थिर",
      "shrank": "घटा"
    },
    "desc": "काम की सूची पर नज़र रखता है — उसका बढ़ना भी और चुपचाप सिकुड़ना भी। AI के साथ काम में सिकुड़ने की दिशा उतनी ही अहम है — लोग मान लेते हैं कि सब हो गया और बाद में पता चलता है।",
    "note": "दायरा निर्देश देने वाले का निर्णय है, मॉडल की सूझ नहीं।",
    "noteGrew": "सूची शुरुआती बिंदु से कहीं आगे बढ़ गई है। यह देखने लायक है कि वह बढ़त तय हुई थी या नहीं।",
    "noteShrank": "सूची अपने शिखर से घट गई है। पक्का कीजिए कि वे मदें पूरी हुईं, छोड़ी नहीं गईं।"
  },
  "id": {
    "heading": "Cakupan",
    "check": {
      "first": "Catatan pertama",
      "peak": "Puncak",
      "last": "Terakhir"
    },
    "level": {
      "unknown": "Tak ada rencana pembanding",
      "grew": "Bertambah",
      "stable": "Stabil",
      "shrank": "Menyusut"
    },
    "desc": "Mengawasi daftar tugas, baik pertumbuhannya maupun penyusutannya yang senyap. Dalam kolaborasi dengan AI arah menyusut sama pentingnya — orang percaya semuanya sudah selesai dan baru sadar belakangan.",
    "note": "Cakupan adalah keputusan pihak yang memberi instruksi, bukan kebijaksanaan model.",
    "noteGrew": "Daftarnya tumbuh jauh melewati titik awal. Layak diperiksa apakah pertumbuhan itu memang disepakati.",
    "noteShrank": "Daftarnya menyusut dari puncaknya. Pastikan butir-butir itu selesai, bukan ditinggalkan."
  },
  "it": {
    "heading": "Ambito",
    "check": {
      "first": "Prima registrazione",
      "peak": "Picco",
      "last": "Ultimo"
    },
    "level": {
      "unknown": "Nessun piano da confrontare",
      "grew": "Cresciuto",
      "stable": "Stabile",
      "shrank": "Ridotto"
    },
    "desc": "Sorveglia l’elenco delle attività, sia la crescita sia il restringimento silenzioso. Nella collaborazione con l’IA la direzione che restringe conta allo stesso modo — si crede che sia tutto fatto e ci si accorge tardi.",
    "note": "L’ambito è decisione di chi impartisce le istruzioni, non discrezionalità del modello.",
    "noteGrew": "L’elenco è cresciuto ben oltre il punto di partenza. Vale la pena verificare se quella crescita era concordata.",
    "noteShrank": "L’elenco si è ridotto rispetto al massimo. Conferma che quelle voci siano state completate e non abbandonate."
  },
  "pt-BR": {
    "heading": "Escopo",
    "check": {
      "first": "Primeiro registro",
      "peak": "Pico",
      "last": "Mais recente"
    },
    "level": {
      "unknown": "Sem plano para comparar",
      "grew": "Cresceu",
      "stable": "Estável",
      "shrank": "Encolheu"
    },
    "desc": "Observa a lista de tarefas, tanto o crescimento quanto o encolhimento silencioso. Na colaboração com IA a direção que encolhe importa igual — acredita-se que tudo foi feito e a descoberta vem tarde.",
    "note": "O escopo é decisão de quem dá as instruções, não critério do modelo.",
    "noteGrew": "A lista cresceu bem além de onde começou. Vale conferir se esse crescimento foi combinado.",
    "noteShrank": "A lista encolheu em relação ao pico. Confirme se esses itens foram concluídos e não abandonados."
  }
} as const;
