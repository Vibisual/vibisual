/**
 * test-time-compute — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.testTimeCompute` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Buying thinking time instead of a bigger model pays off over a wide range. In practice it means quality, latency and cost became a dial you can turn per task.",
    "heading": "Test-Time Compute",
    "level": {
      "baseline": "Baseline",
      "unmeasured": "Raised, unmeasured",
      "invested": "Raised and used"
    },
    "check": {
      "effort": "Effort",
      "turns": "Turns",
      "model": "Model"
    },
    "note": "Turning the dial up on easy work is pure waste. Match the amount of thinking to the difficulty of the task."
  },
  "ko": {
    "desc": "모델을 키우는 대신 생각할 시간을 사는 쪽이 비용 대비 효과가 좋은 구간이 넓습니다. 실무적으로는 품질·지연·비용을 작업마다 다이얼로 돌릴 수 있게 됐다는 뜻입니다.",
    "heading": "추론 시점 연산",
    "level": {
      "baseline": "기본값",
      "unmeasured": "올렸으나 미측정",
      "invested": "올려서 실제로 씀"
    },
    "check": {
      "effort": "사고 깊이",
      "turns": "턴 수",
      "model": "모델"
    },
    "note": "쉬운 작업에 다이얼을 올리는 것은 순수한 낭비입니다. 사고량은 작업 난이도에 맞추십시오."
  },
  "ja": {
    "check": {
      "effort": "思考の深さ",
      "turns": "ターン数",
      "model": "モデル"
    },
    "heading": "推論時の計算",
    "level": {
      "baseline": "既定値",
      "unmeasured": "上げたが未計測",
      "invested": "上げて実際に使った"
    },
    "desc": "モデルを大きくする代わりに考える時間を買う方が、費用対効果の良い区間が広いことが分かっています。実務的には、品質・遅延・費用を作業ごとにダイヤルで回せるようになったということです。",
    "note": "易しい作業でダイヤルを上げるのは純粋なむだです。思考量は作業の難しさに合わせてください。"
  },
  "zh-CN": {
    "check": {
      "effort": "思考强度",
      "turns": "轮次",
      "model": "模型"
    },
    "heading": "推理时算力",
    "level": {
      "baseline": "基准",
      "unmeasured": "已提升但未测量",
      "invested": "已提升且用上"
    },
    "desc": "与其把模型做大，不如买思考时间，其性价比更优的区间相当宽。实务上这意味着质量、延迟和成本变成了可以按任务旋转的旋钮。",
    "note": "在容易的任务上把旋钮调高纯属浪费。思考量应与任务难度匹配。"
  },
  "es": {
    "check": {
      "effort": "Esfuerzo",
      "turns": "Turnos",
      "model": "Modelo"
    },
    "heading": "Cómputo en inferencia",
    "level": {
      "baseline": "Base",
      "unmeasured": "Subido, sin medir",
      "invested": "Subido y aprovechado"
    },
    "desc": "Comprar tiempo de razonamiento en lugar de un modelo mayor compensa en un rango amplio. En la práctica significa que calidad, latencia y coste pasaron a ser un dial que giras por tarea.",
    "note": "Subir el dial en trabajo fácil es puro desperdicio. Ajusta la cantidad de razonamiento a la dificultad."
  },
  "es-419": {
    "check": {
      "effort": "Esfuerzo",
      "turns": "Turnos",
      "model": "Modelo"
    },
    "heading": "Cómputo en inferencia",
    "level": {
      "baseline": "Base",
      "unmeasured": "Subido, sin medir",
      "invested": "Subido y aprovechado"
    },
    "desc": "Comprar tiempo de razonamiento en lugar de un modelo mayor compensa en un rango amplio. En la práctica significa que calidad, latencia y coste pasaron a ser un dial que giras por tarea.",
    "note": "Subir el dial en trabajo fácil es puro desperdicio. Ajusta la cantidad de razonamiento a la dificultad."
  },
  "fr": {
    "check": {
      "effort": "Effort",
      "turns": "Tours",
      "model": "Modèle"
    },
    "heading": "Calcul à l’inférence",
    "level": {
      "baseline": "Référence",
      "unmeasured": "Augmenté, non mesuré",
      "invested": "Augmenté et utilisé"
    },
    "desc": "Acheter du temps de réflexion plutôt qu’un modèle plus gros est rentable sur une large plage. En pratique, qualité, latence et coût sont devenus un cadran que l’on tourne par tâche.",
    "note": "Monter le cadran sur un travail facile est du pur gaspillage. Ajustez la quantité de réflexion à la difficulté."
  },
  "de": {
    "check": {
      "effort": "Denkaufwand",
      "turns": "Züge",
      "model": "Modell"
    },
    "heading": "Rechenaufwand zur Laufzeit",
    "level": {
      "baseline": "Grundwert",
      "unmeasured": "Erhöht, ungemessen",
      "invested": "Erhöht und genutzt"
    },
    "desc": "Denkzeit zu kaufen statt eines größeren Modells zahlt sich über einen breiten Bereich aus. Praktisch heißt das: Qualität, Latenz und Kosten wurden zu einem Regler, den man pro Aufgabe dreht.",
    "note": "Den Regler bei leichter Arbeit aufzudrehen ist reine Verschwendung. Passen Sie die Denkmenge an die Schwierigkeit an."
  },
  "hi": {
    "check": {
      "effort": "प्रयास",
      "turns": "टर्न",
      "model": "मॉडल"
    },
    "heading": "अनुमान-समय गणना",
    "level": {
      "baseline": "आधार",
      "unmeasured": "बढ़ाया, मापा नहीं",
      "invested": "बढ़ाया और उपयोग किया"
    },
    "desc": "बड़े मॉडल के बजाय सोचने का समय ख़रीदना एक चौड़ी सीमा तक फ़ायदा देता है। व्यवहार में गुणवत्ता, विलंब और लागत ऐसे घुंडी बन जाते हैं जिन्हें आप हर काम पर अलग सेट करते हैं।",
    "note": "आसान काम पर घुंडी चढ़ाना शुद्ध बर्बादी है। तर्क की मात्रा को कठिनाई से मिलाइए।"
  },
  "id": {
    "check": {
      "effort": "Upaya",
      "turns": "Giliran",
      "model": "Model"
    },
    "heading": "Komputasi saat inferensi",
    "level": {
      "baseline": "Dasar",
      "unmeasured": "Dinaikkan, belum diukur",
      "invested": "Dinaikkan dan dipakai"
    },
    "desc": "Membeli waktu berpikir alih-alih model yang lebih besar menguntungkan pada rentang yang lebar. Secara praktis, kualitas, latensi, dan biaya menjadi tombol putar yang Anda atur per tugas.",
    "note": "Menaikkan tombol pada pekerjaan mudah adalah pemborosan murni. Sesuaikan banyaknya penalaran dengan tingkat kesulitan."
  },
  "it": {
    "check": {
      "effort": "Sforzo",
      "turns": "Turni",
      "model": "Modello"
    },
    "heading": "Calcolo in inferenza",
    "level": {
      "baseline": "Base",
      "unmeasured": "Alzato, non misurato",
      "invested": "Alzato e usato"
    },
    "desc": "Comprare tempo di ragionamento invece di un modello più grande conviene su un intervallo ampio. In pratica significa che qualità, latenza e costo sono diventati una manopola da girare per singolo compito.",
    "note": "Alzare la manopola su lavoro facile è puro spreco. Adegua la quantità di ragionamento alla difficoltà."
  },
  "pt-BR": {
    "check": {
      "effort": "Esforço",
      "turns": "Turnos",
      "model": "Modelo"
    },
    "heading": "Computação na inferência",
    "level": {
      "baseline": "Base",
      "unmeasured": "Elevado, não medido",
      "invested": "Elevado e usado"
    },
    "desc": "Comprar tempo de raciocínio em vez de um modelo maior compensa numa faixa ampla. Na prática, qualidade, latência e custo viraram um dial que você gira por tarefa.",
    "note": "Girar o dial em trabalho fácil é puro desperdício. Ajuste a quantidade de raciocínio à dificuldade."
  }
} as const;
