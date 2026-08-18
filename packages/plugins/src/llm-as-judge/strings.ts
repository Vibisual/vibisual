/**
 * llm-as-judge — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.llmAsJudge` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "A strong model scoring output is a practical compromise where no correct string exists. It has known biases — it prefers longer answers, favours its own family, and is swayed by presentation order.",
    "heading": "LLM as Judge",
    "level": {
      "none": "No judging",
      "model": "Model critique",
      "human": "Human review"
    },
    "check": {
      "critique": "Critique edges",
      "human": "Human reviews"
    },
    "note": "Without checking the judge against human scoring, there is no way to know the judge itself is wrong."
  },
  "ko": {
    "desc": "정답 문자열이 없는 자연어 출력에서 강한 모델이 채점하는 것은 현실적 타협안입니다. 다만 알려진 편향이 있습니다 — 긴 답을 선호하고, 자기 계열을 후하게 보며, 제시 순서에 흔들립니다.",
    "heading": "심판 모델",
    "level": {
      "none": "채점 없음",
      "model": "모델 비평",
      "human": "사람 검수"
    },
    "check": {
      "critique": "비평 엣지",
      "human": "사람 검수"
    },
    "note": "심판의 채점을 사람 채점과 대조하지 않으면, 심판 자체가 틀렸는지 알 수 없습니다."
  },
  "ja": {
    "check": {
      "critique": "批評エッジ",
      "human": "人による検収"
    },
    "heading": "審判モデル",
    "level": {
      "none": "採点なし",
      "model": "モデルによる批評",
      "human": "人による検収"
    },
    "desc": "正解の文字列がない自然言語の出力を強いモデルが採点するのは、現実的な妥協案です。ただし既知の偏りがあります — 長い答えを好み、自分の系列を甘く見て、提示順に左右されます。",
    "note": "審判の採点を人の採点と突き合わせなければ、審判自体が間違っているかどうかを知る術がありません。"
  },
  "zh-CN": {
    "check": {
      "critique": "批评连线",
      "human": "人工检查"
    },
    "heading": "模型评审",
    "level": {
      "none": "无评审",
      "model": "模型批评",
      "human": "人工检查"
    },
    "desc": "在没有标准答案字符串的自然语言输出上，让强模型打分是现实的折中。但它有已知偏差 — 偏好更长的回答、对同门模型更宽松、受呈现顺序影响。",
    "note": "不把裁判的打分与人工打分做对照，就无从得知裁判本身是不是错的。"
  },
  "es": {
    "check": {
      "critique": "Conexiones de crítica",
      "human": "Revisiones humanas"
    },
    "heading": "LLM como juez",
    "level": {
      "none": "Sin evaluación",
      "model": "Crítica del modelo",
      "human": "Revisión humana"
    },
    "desc": "Que un modelo potente puntúe la salida es un compromiso práctico donde no existe una cadena correcta. Tiene sesgos conocidos — prefiere respuestas largas, favorece a su propia familia y le afecta el orden de presentación.",
    "note": "Sin contrastar la puntuación del juez con puntuación humana, no hay forma de saber que el propio juez se equivoca."
  },
  "es-419": {
    "check": {
      "critique": "Conexiones de crítica",
      "human": "Revisiones humanas"
    },
    "heading": "LLM como juez",
    "level": {
      "none": "Sin evaluación",
      "model": "Crítica del modelo",
      "human": "Revisión humana"
    },
    "desc": "Que un modelo potente puntúe la salida es un compromiso práctico donde no existe una cadena correcta. Tiene sesgos conocidos — prefiere respuestas largas, favorece a su propia familia y le afecta el orden de presentación.",
    "note": "Sin contrastar la puntuación del juez con puntuación humana, no hay forma de saber que el propio juez se equivoca."
  },
  "fr": {
    "check": {
      "critique": "Liens de critique",
      "human": "Revues humaines"
    },
    "heading": "LLM comme juge",
    "level": {
      "none": "Aucune notation",
      "model": "Critique par modèle",
      "human": "Revue humaine"
    },
    "desc": "Faire noter la sortie par un modèle puissant est un compromis pratique là où aucune chaîne correcte n’existe. Il a des biais connus — il préfère les réponses longues, favorise sa propre famille et se laisse influencer par l’ordre de présentation.",
    "note": "Sans confronter la notation du juge à une notation humaine, rien ne permet de savoir que le juge lui-même se trompe."
  },
  "de": {
    "check": {
      "critique": "Kritik-Kanten",
      "human": "Menschliche Prüfungen"
    },
    "heading": "LLM als Richter",
    "level": {
      "none": "Keine Bewertung",
      "model": "Modell-Kritik",
      "human": "Menschliche Prüfung"
    },
    "desc": "Ein starkes Modell als Bewerter ist ein praktischer Kompromiss, wo es keine korrekte Zeichenfolge gibt. Es hat bekannte Verzerrungen — es bevorzugt längere Antworten, ist gegenüber der eigenen Familie milde und lässt sich von der Reihenfolge beeinflussen.",
    "note": "Ohne Abgleich der Bewertung mit menschlicher Bewertung gibt es keine Möglichkeit zu erkennen, dass der Richter selbst falsch liegt."
  },
  "hi": {
    "check": {
      "critique": "समीक्षा एज",
      "human": "मानव समीक्षा"
    },
    "heading": "निर्णायक LLM",
    "level": {
      "none": "कोई निर्णय नहीं",
      "model": "मॉडल समीक्षा",
      "human": "मानव समीक्षा"
    },
    "desc": "जब सही उत्तरों की शृंखला न हो, तब आउटपुट आँकने के लिए ताक़तवर मॉडल एक व्यावहारिक समझौता है। इसके जाने-पहचाने झुकाव हैं — लंबे उत्तर पसंद, अपने ही परिवार पर नरम, और प्रस्तुति के क्रम से प्रभावित।",
    "note": "न्यायाधीश के आकलन को मनुष्य के आकलन से मिलाए बिना यह जानने का कोई तरीक़ा नहीं कि न्यायाधीश ख़ुद ही ग़लत है।"
  },
  "id": {
    "check": {
      "critique": "Edge kritik",
      "human": "Tinjauan manusia"
    },
    "heading": "LLM sebagai juri",
    "level": {
      "none": "Tanpa penilaian",
      "model": "Kritik model",
      "human": "Tinjauan manusia"
    },
    "desc": "Model kuat yang menilai keluaran adalah kompromi praktis ketika tak ada rangkaian jawaban yang benar. Ia punya bias yang dikenal — menyukai jawaban panjang, lunak pada keluarganya sendiri, dan terpengaruh urutan penyajian.",
    "note": "Tanpa membandingkan penilaian juri dengan penilaian manusia, tak ada cara mengetahui bahwa jurinya sendiri keliru."
  },
  "it": {
    "check": {
      "critique": "Collegamenti di critica",
      "human": "Revisioni umane"
    },
    "heading": "LLM come giudice",
    "level": {
      "none": "Nessuna valutazione",
      "model": "Critica del modello",
      "human": "Revisione umana"
    },
    "desc": "Far valutare l’output da un modello forte è un compromesso pratico dove non esiste una stringa corretta. Ha bias noti — preferisce risposte lunghe, è indulgente con la propria famiglia e risente dell’ordine di presentazione.",
    "note": "Senza confrontare il punteggio del giudice con quello umano, non c’è modo di sapere che il giudice stesso sbaglia."
  },
  "pt-BR": {
    "check": {
      "critique": "Conexões de crítica",
      "human": "Revisões humanas"
    },
    "heading": "LLM como juiz",
    "level": {
      "none": "Sem avaliação",
      "model": "Crítica do modelo",
      "human": "Revisão humana"
    },
    "desc": "Um modelo forte pontuando a saída é um meio-termo prático onde não existe uma cadeia correta. Ele tem vieses conhecidos — prefere respostas longas, favorece a própria família e se deixa levar pela ordem de apresentação.",
    "note": "Sem confrontar a pontuação do juiz com pontuação humana, não há como saber que o próprio juiz está errado."
  }
} as const;
