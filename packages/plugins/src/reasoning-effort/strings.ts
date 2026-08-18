/**
 * reasoning-effort — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.reasoningEffort` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows thinking effort next to the size of the work. More thinking is not always better — there is a measured range where extra deliberation lowers accuracy on simple, factual tasks.",
    "heading": "Reasoning Effort",
    "level": {
      "normal": "Normal",
      "deep": "Deep thinking",
      "overthinking": "Possibly overthinking"
    },
    "check": {
      "effort": "Effort",
      "turns": "Turns so far",
      "model": "Model"
    },
    "noteMeasure": "Raise effort and measure, rather than leaving the maximum on — turning it up costs tokens on every turn.",
    "noteOverthinking": "Maximum thinking on a very short task. This is the range where cost rises and accuracy can fall."
  },
  "ko": {
    "desc": "사고 깊이를 작업 크기와 함께 보여줍니다. 더 오래 생각한다고 늘 좋아지지는 않습니다 — 단순·조회형 작업에서는 숙고가 오히려 정확도를 떨어뜨리는 구간이 실측됐습니다.",
    "heading": "사고 깊이",
    "level": {
      "normal": "보통",
      "deep": "깊게 사고",
      "overthinking": "과잉 사고 가능성"
    },
    "check": {
      "effort": "사고 깊이",
      "turns": "지금까지 턴",
      "model": "모델"
    },
    "noteMeasure": "기본값으로 최대를 켜 두지 말고 올려 보고 측정하십시오 — 사고 깊이는 매 턴 토큰을 씁니다.",
    "noteOverthinking": "아주 짧은 작업에 최대 사고가 켜져 있습니다. 비용은 늘고 정확도는 떨어질 수 있는 구간입니다."
  },
  "ja": {
    "level": {
      "normal": "通常",
      "deep": "深く思考",
      "overthinking": "過剰思考の可能性"
    },
    "check": {
      "effort": "思考の深さ",
      "turns": "これまでのターン",
      "model": "モデル"
    },
    "heading": "思考の深さ",
    "desc": "思考の深さを作業の大きさと並べて示します。長く考えれば必ず良くなるわけではありません — 単純・照会型の作業では、熟考がかえって正確さを下げる区間が実測されています。",
    "noteMeasure": "既定で最大にしておくのではなく、上げてから測ってください — 思考の深さは毎ターン トークンを消費します。",
    "noteOverthinking": "ごく短い作業に最大の思考が入っています。費用は増え、正確さは下がりうる区間です。"
  },
  "zh-CN": {
    "level": {
      "normal": "正常",
      "deep": "深度思考",
      "overthinking": "可能过度思考"
    },
    "check": {
      "effort": "思考强度",
      "turns": "目前轮次",
      "model": "模型"
    },
    "heading": "思考强度",
    "desc": "把思考强度与任务规模并排显示。想得更久不一定更好 — 在简单的查询型任务上，实测存在「深思反而降低准确率」的区间。",
    "noteMeasure": "不要默认开到最大，而要调高后再测量 — 思考强度每一轮都在消耗令牌。",
    "noteOverthinking": "很短的任务上开着最大思考。这正是成本上升而准确率可能下降的区间。"
  },
  "es": {
    "level": {
      "normal": "Normal",
      "deep": "Pensamiento profundo",
      "overthinking": "Posible exceso de razonamiento"
    },
    "check": {
      "effort": "Esfuerzo",
      "turns": "Turnos hasta ahora",
      "model": "Modelo"
    },
    "heading": "Esfuerzo de razonamiento",
    "desc": "Muestra el esfuerzo de razonamiento junto al tamaño del trabajo. Pensar más no siempre es mejor — hay un rango medido en el que deliberar de más baja la precisión en tareas simples y factuales.",
    "noteMeasure": "Sube el esfuerzo y mide, en lugar de dejar el máximo activado — subirlo cuesta tokens en cada turno.",
    "noteOverthinking": "Máximo razonamiento en una tarea muy corta. Este es justo el rango donde el coste sube y la precisión puede caer."
  },
  "es-419": {
    "level": {
      "normal": "Normal",
      "deep": "Pensamiento profundo",
      "overthinking": "Posible exceso de razonamiento"
    },
    "check": {
      "effort": "Esfuerzo",
      "turns": "Turnos hasta ahora",
      "model": "Modelo"
    },
    "heading": "Esfuerzo de razonamiento",
    "desc": "Muestra el esfuerzo de razonamiento junto al tamaño del trabajo. Pensar más no siempre es mejor — hay un rango medido en el que deliberar de más baja la precisión en tareas simples y factuales.",
    "noteMeasure": "Sube el esfuerzo y mide, en lugar de dejar el máximo activado — subirlo cuesta tokens en cada turno.",
    "noteOverthinking": "Máximo razonamiento en una tarea muy corta. Este es justo el rango donde el coste sube y la precisión puede caer."
  },
  "fr": {
    "level": {
      "normal": "Normal",
      "deep": "Réflexion profonde",
      "overthinking": "Possible sur-réflexion"
    },
    "check": {
      "effort": "Effort",
      "turns": "Tours jusqu’ici",
      "model": "Modèle"
    },
    "heading": "Effort de raisonnement",
    "desc": "Affiche l’effort de raisonnement à côté de l’ampleur du travail. Réfléchir plus n’est pas toujours mieux — il existe une plage mesurée où la délibération supplémentaire abaisse la justesse sur des tâches simples et factuelles.",
    "noteMeasure": "Augmentez puis mesurez, plutôt que de laisser le maximum activé — monter le curseur coûte des jetons à chaque tour.",
    "noteOverthinking": "Réflexion maximale sur une tâche très courte. C’est précisément la plage où le coût monte et où la justesse peut baisser."
  },
  "de": {
    "level": {
      "normal": "Normal",
      "deep": "Tiefes Denken",
      "overthinking": "Möglicherweise Überdenken"
    },
    "check": {
      "effort": "Denkaufwand",
      "turns": "Züge bisher",
      "model": "Modell"
    },
    "heading": "Denkaufwand",
    "desc": "Zeigt den Denkaufwand neben dem Umfang der Arbeit. Mehr Nachdenken ist nicht immer besser — es gibt einen gemessenen Bereich, in dem zusätzliches Grübeln die Genauigkeit bei einfachen Abfragen senkt.",
    "noteMeasure": "Erhöhen und messen, statt das Maximum dauerhaft anzulassen — ein höherer Aufwand kostet in jedem Zug Tokens.",
    "noteOverthinking": "Maximales Nachdenken bei einer sehr kurzen Aufgabe. Genau hier steigen die Kosten, während die Genauigkeit fallen kann."
  },
  "hi": {
    "level": {
      "normal": "सामान्य",
      "deep": "गहन चिंतन",
      "overthinking": "शायद अति-चिंतन"
    },
    "check": {
      "effort": "प्रयास",
      "turns": "अब तक टर्न",
      "model": "मॉडल"
    },
    "heading": "तर्क प्रयास",
    "desc": "तर्क-प्रयास को काम के आकार के बग़ल में दिखाता है। ज़्यादा देर सोचना हमेशा बेहतर नहीं — एक नापी हुई सीमा है जहाँ अति-विचार सरल तथ्यात्मक कामों में सटीकता घटा देता है।",
    "noteMeasure": "अधिकतम को जलता छोड़ने के बजाय प्रयास बढ़ाइए और नापिए — बढ़ाने पर हर बारी में टोकन लगते हैं।",
    "noteOverthinking": "बहुत छोटे काम पर अधिकतम तर्क। यही वह सीमा है जहाँ लागत चढ़ती है और सटीकता गिर सकती है।"
  },
  "id": {
    "level": {
      "normal": "Normal",
      "deep": "Berpikir dalam",
      "overthinking": "Mungkin berpikir berlebihan"
    },
    "check": {
      "effort": "Upaya",
      "turns": "Giliran sejauh ini",
      "model": "Model"
    },
    "heading": "Upaya penalaran",
    "desc": "Menampilkan upaya penalaran di sebelah besarnya pekerjaan. Berpikir lebih lama tidak selalu lebih baik — ada rentang terukur di mana pertimbangan berlebih justru menurunkan ketepatan pada tugas sederhana dan faktual.",
    "noteMeasure": "Naikkan upaya lalu ukur, alih-alih membiarkan maksimum menyala — menaikkannya memakan token di setiap giliran.",
    "noteOverthinking": "Penalaran maksimum pada tugas yang sangat pendek. Inilah rentang di mana biaya naik dan ketepatan bisa turun."
  },
  "it": {
    "level": {
      "normal": "Normale",
      "deep": "Pensiero profondo",
      "overthinking": "Possibile eccesso di ragionamento"
    },
    "check": {
      "effort": "Sforzo",
      "turns": "Turni finora",
      "model": "Modello"
    },
    "heading": "Sforzo di ragionamento",
    "desc": "Mostra lo sforzo di ragionamento accanto alla dimensione del lavoro. Pensare di più non è sempre meglio — esiste un intervallo misurato in cui deliberare oltre abbassa la precisione su compiti semplici e fattuali.",
    "noteMeasure": "Alza lo sforzo e misura, invece di lasciare il massimo acceso — alzarlo costa token a ogni turno.",
    "noteOverthinking": "Ragionamento massimo su un’attività molto breve. È proprio l’intervallo in cui il costo sale e la precisione può scendere."
  },
  "pt-BR": {
    "level": {
      "normal": "Normal",
      "deep": "Pensamento profundo",
      "overthinking": "Possível excesso de raciocínio"
    },
    "check": {
      "effort": "Esforço",
      "turns": "Turnos até agora",
      "model": "Modelo"
    },
    "heading": "Esforço de raciocínio",
    "desc": "Mostra o esforço de raciocínio ao lado do tamanho do trabalho. Pensar mais nem sempre é melhor — existe uma faixa medida em que deliberar demais reduz a precisão em tarefas simples e factuais.",
    "noteMeasure": "Aumente o esforço e meça, em vez de deixar o máximo ligado — subir custa tokens em todo turno.",
    "noteOverthinking": "Raciocínio máximo numa tarefa muito curta. É justamente a faixa em que o custo sobe e a precisão pode cair."
  }
} as const;
