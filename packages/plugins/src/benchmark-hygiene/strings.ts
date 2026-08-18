/**
 * benchmark-hygiene — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.benchmarkHygiene` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Public scores cluster at the top, test data leaks into training, and the same model scores differently under a different harness. Only a set built from your own domain is a trustworthy signal.",
    "heading": "Benchmark Hygiene",
    "level": {
      "none": "No own criteria",
      "own": "Own criteria accruing"
    },
    "check": {
      "own": "Own criteria"
    },
    "note": "Lessons and check points recorded here are exactly the material an in-house evaluation set is built from."
  },
  "ko": {
    "desc": "공개 점수는 상단에 몰리고, 문제·정답이 학습 데이터에 새며, 같은 모델도 하네스를 바꾸면 점수가 달라집니다. 믿을 수 있는 신호는 자기 도메인으로 만든 자체 셋뿐입니다.",
    "heading": "벤치마크 위생",
    "level": {
      "none": "자체 기준 없음",
      "own": "자체 기준 적립 중"
    },
    "check": {
      "own": "자체 기준"
    },
    "note": "여기 적립되는 교훈과 확인 포인트가 곧 자체 평가 셋을 만드는 재료입니다."
  },
  "ja": {
    "heading": "ベンチマークの衛生",
    "check": {
      "own": "自前の基準"
    },
    "level": {
      "none": "自前の基準なし",
      "own": "自前の基準が積もる"
    },
    "desc": "公開の点数は上位に固まり、問題と答えが学習データに漏れ、同じモデルでもハーネスを変えれば点が動きます。信頼できる合図は自分の領域で作った自前のセットだけです。",
    "note": "ここに積み上がる教訓と確認ポイントが、そのまま自前の評価セットを作る材料になります。"
  },
  "zh-CN": {
    "heading": "基准测试卫生",
    "check": {
      "own": "自有标准"
    },
    "level": {
      "none": "无自有标准",
      "own": "自有标准在积累"
    },
    "desc": "公开分数扎堆在高位，题目与答案渗入训练数据，而且同一模型换个框架分数就会变。唯一可信的信号，是用自己领域构建的评估集。",
    "note": "这里积累的教训与检查要点，正是构建内部评估集的原料。"
  },
  "es": {
    "heading": "Higiene de benchmarks",
    "check": {
      "own": "Criterios propios"
    },
    "level": {
      "none": "Sin criterios propios",
      "own": "Criterios propios acumulándose"
    },
    "desc": "Las puntuaciones públicas se agolpan arriba, los datos de prueba se filtran al entrenamiento, y el mismo modelo puntúa distinto bajo otro arnés. Solo un conjunto construido con tu propio dominio es señal fiable.",
    "note": "Las lecciones y puntos de verificación registrados aquí son justo el material del que se construye un conjunto de evaluación propio."
  },
  "es-419": {
    "heading": "Higiene de benchmarks",
    "check": {
      "own": "Criterios propios"
    },
    "level": {
      "none": "Sin criterios propios",
      "own": "Criterios propios acumulándose"
    },
    "desc": "Las puntuaciones públicas se agolpan arriba, los datos de prueba se filtran al entrenamiento, y el mismo modelo puntúa distinto bajo otro arnés. Solo un conjunto construido con tu propio dominio es señal fiable.",
    "note": "Las lecciones y puntos de verificación registrados aquí son justo el material del que se construye un conjunto de evaluación propio."
  },
  "fr": {
    "heading": "Hygiène des benchmarks",
    "check": {
      "own": "Critères propres"
    },
    "level": {
      "none": "Aucun critère propre",
      "own": "Critères propres en accumulation"
    },
    "desc": "Les scores publics se tassent en haut, les données de test fuient dans l’entraînement, et le même modèle obtient d’autres chiffres sous un autre harnais. Seul un jeu bâti sur votre propre domaine est un signal fiable.",
    "note": "Les leçons et points de contrôle consignés ici sont précisément la matière d’un jeu d’évaluation maison."
  },
  "de": {
    "heading": "Benchmark-Hygiene",
    "check": {
      "own": "Eigene Kriterien"
    },
    "level": {
      "none": "Keine eigenen Kriterien",
      "own": "Eigene Kriterien wachsen"
    },
    "desc": "Öffentliche Werte drängen sich oben, Testdaten sickern ins Training, und dasselbe Modell schneidet unter einer anderen Harness anders ab. Nur ein aus der eigenen Domäne gebautes Set ist ein vertrauenswürdiges Signal.",
    "note": "Die hier festgehaltenen Lehren und Prüfpunkte sind genau das Material, aus dem ein hauseigenes Bewertungsset entsteht."
  },
  "hi": {
    "heading": "बेंचमार्क स्वच्छता",
    "check": {
      "own": "अपने मानदंड"
    },
    "level": {
      "none": "अपने मानदंड नहीं",
      "own": "अपने मानदंड जमा हो रहे"
    },
    "desc": "सार्वजनिक अंक ऊपर की ओर जमा होते हैं, परीक्षण-डेटा प्रशिक्षण में रिसता है, और वही मॉडल दूसरे harness के नीचे अलग अंक देता है। भरोसेमंद संकेत केवल वही संग्रह है जो आपके अपने क्षेत्र से बना हो।",
    "note": "यहाँ दर्ज सबक और जाँच-बिंदु ठीक वही सामग्री हैं जिनसे आंतरिक मूल्यांकन-संग्रह बनता है।"
  },
  "id": {
    "heading": "Higiene benchmark",
    "check": {
      "own": "Kriteria sendiri"
    },
    "level": {
      "none": "Tanpa kriteria sendiri",
      "own": "Kriteria sendiri menumpuk"
    },
    "desc": "Skor publik menumpuk di atas, data uji merembes ke pelatihan, dan model yang sama memberi skor berbeda di bawah harness lain. Hanya kumpulan yang dibangun dari ranah Anda sendiri yang merupakan sinyal tepercaya.",
    "note": "Pelajaran dan titik periksa yang tercatat di sini persis merupakan bahan untuk membangun kumpulan evaluasi internal."
  },
  "it": {
    "heading": "Igiene dei benchmark",
    "check": {
      "own": "Criteri propri"
    },
    "level": {
      "none": "Nessun criterio proprio",
      "own": "Criteri propri in accumulo"
    },
    "desc": "I punteggi pubblici si addensano in alto, i dati di test filtrano nell’addestramento, e lo stesso modello ottiene punteggi diversi sotto un altro harness. Solo un insieme costruito sul proprio dominio è un segnale affidabile.",
    "note": "Le lezioni e i punti di verifica registrati qui sono esattamente il materiale con cui si costruisce un insieme di valutazione interno."
  },
  "pt-BR": {
    "heading": "Higiene de benchmarks",
    "check": {
      "own": "Critérios próprios"
    },
    "level": {
      "none": "Sem critérios próprios",
      "own": "Critérios próprios acumulando"
    },
    "desc": "Pontuações públicas se aglomeram no topo, dados de teste vazam para o treino, e o mesmo modelo pontua diferente sob outro arreio. Só um conjunto construído com o seu domínio é sinal confiável.",
    "note": "As lições e pontos de verificação registrados aqui são justamente o material de que se faz um conjunto de avaliação próprio."
  }
} as const;
