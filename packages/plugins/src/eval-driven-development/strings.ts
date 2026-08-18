/**
 * eval-driven-development — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.evalDrivenDevelopment` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Build the evaluation first and fix towards its score. The decisive step was joining evaluation and guardrails — the offline judge gets promoted into the runtime gate.",
    "heading": "Eval-Driven Development",
    "level": {
      "none": "No reviews",
      "partial": "Some without points",
      "defined": "Points defined"
    },
    "check": {
      "reviews": "Review requests",
      "withPoints": "With check points"
    },
    "note": "Changing a prompt with no evaluation behind it is the unlicensed driving of this field."
  },
  "ko": {
    "desc": "평가를 먼저 만들고 그 점수를 올리는 방향으로 고칩니다. 결정적 진전은 평가와 가드레일이 이어진 것 — 오프라인 판정기를 그대로 런타임 관문으로 승격시킵니다.",
    "heading": "평가 주도 개발",
    "level": {
      "none": "검수 없음",
      "partial": "일부는 포인트 없음",
      "defined": "확인 포인트 정의됨"
    },
    "check": {
      "reviews": "검수 요청",
      "withPoints": "확인 포인트 있음"
    },
    "note": "평가 없이 프롬프트를 고치는 것이 이 분야의 무면허 운전입니다."
  },
  "ja": {
    "check": {
      "reviews": "検収リクエスト",
      "withPoints": "確認ポイントあり"
    },
    "heading": "評価駆動開発",
    "level": {
      "none": "検収なし",
      "partial": "確認ポイントなしが一部",
      "defined": "確認ポイント定義済み"
    },
    "desc": "評価を先に作り、その点数を上げる方向で直します。決定的な前進は評価とガードレールがつながったことで、オフラインの判定器をそのまま実行時の関門へ昇格させます。",
    "note": "評価なしにプロンプトを直すのが、この分野の無免許運転です。"
  },
  "zh-CN": {
    "check": {
      "reviews": "检查请求",
      "withPoints": "含检查要点"
    },
    "heading": "评估驱动开发",
    "level": {
      "none": "无检查",
      "partial": "部分缺检查要点",
      "defined": "已定义检查要点"
    },
    "desc": "先做评估，再朝着提高分数的方向修改。决定性的一步是评估与护栏被接到了一起 — 离线的判定器直接升格为运行时的关口。",
    "note": "没有评估就改提示词，是这个领域的无照驾驶。"
  },
  "es": {
    "check": {
      "reviews": "Solicitudes de revisión",
      "withPoints": "Con puntos de verificación"
    },
    "heading": "Desarrollo guiado por evaluación",
    "level": {
      "none": "Sin revisiones",
      "partial": "Algunas sin puntos",
      "defined": "Puntos definidos"
    },
    "desc": "Construir primero la evaluación y corregir hacia su puntuación. El paso decisivo fue unir evaluación y barreras — el juez fuera de línea se asciende a barrera en tiempo de ejecución.",
    "note": "Cambiar un prompt sin evaluación detrás es la conducción sin licencia de este campo."
  },
  "es-419": {
    "check": {
      "reviews": "Solicitudes de revisión",
      "withPoints": "Con puntos de verificación"
    },
    "heading": "Desarrollo guiado por evaluación",
    "level": {
      "none": "Sin revisiones",
      "partial": "Algunas sin puntos",
      "defined": "Puntos definidos"
    },
    "desc": "Construir primero la evaluación y corregir hacia su puntuación. El paso decisivo fue unir evaluación y barreras — el juez fuera de línea se asciende a barrera en tiempo de ejecución.",
    "note": "Cambiar un prompt sin evaluación detrás es la conducción sin licencia de este campo."
  },
  "fr": {
    "check": {
      "reviews": "Demandes de revue",
      "withPoints": "Avec points de contrôle"
    },
    "heading": "Développement piloté par l’évaluation",
    "level": {
      "none": "Aucune revue",
      "partial": "Certaines sans points",
      "defined": "Points définis"
    },
    "desc": "Construire d’abord l’évaluation puis corriger vers son score. L’étape décisive a été de relier évaluation et garde-fous — le juge hors ligne est promu en barrière d’exécution.",
    "note": "Changer un prompt sans évaluation derrière, c’est la conduite sans permis de ce domaine."
  },
  "de": {
    "check": {
      "reviews": "Prüfanfragen",
      "withPoints": "Mit Prüfpunkten"
    },
    "heading": "Evaluationsgetriebene Entwicklung",
    "level": {
      "none": "Keine Prüfungen",
      "partial": "Einige ohne Punkte",
      "defined": "Punkte definiert"
    },
    "desc": "Erst die Bewertung bauen und dann auf deren Punktzahl hin verbessern. Der entscheidende Schritt war die Verbindung von Bewertung und Leitplanken — der Offline-Richter wird zum Laufzeit-Gate befördert.",
    "note": "Einen Prompt ohne Bewertung dahinter zu ändern ist das Fahren ohne Führerschein dieses Fachs."
  },
  "hi": {
    "check": {
      "reviews": "समीक्षा अनुरोध",
      "withPoints": "जाँच बिंदु सहित"
    },
    "heading": "मूल्यांकन-चालित विकास",
    "level": {
      "none": "कोई समीक्षा नहीं",
      "partial": "कुछ बिना बिंदु",
      "defined": "बिंदु परिभाषित"
    },
    "desc": "पहले मूल्यांकन खड़ा कीजिए और फिर अंकों की दिशा में सुधारिए। निर्णायक कदम मूल्यांकन और रक्षक को जोड़ना है — ऑफ़लाइन न्यायाधीश को चलते समय का द्वार बना देना।",
    "note": "पीछे मूल्यांकन के बिना प्रॉम्प्ट बदलना इस क्षेत्र में बिना लाइसेंस गाड़ी चलाना है।"
  },
  "id": {
    "check": {
      "reviews": "Permintaan tinjauan",
      "withPoints": "Dengan titik periksa"
    },
    "heading": "Pengembangan berbasis evaluasi",
    "level": {
      "none": "Tanpa tinjauan",
      "partial": "Sebagian tanpa titik",
      "defined": "Titik ditentukan"
    },
    "desc": "Bangun evaluasinya lebih dulu lalu perbaiki ke arah skornya. Langkah menentukannya adalah menyatukan evaluasi dan pagar pengaman — juri luring dinaikkan menjadi gerbang saat berjalan.",
    "note": "Mengubah prompt tanpa evaluasi di belakangnya adalah menyetir tanpa SIM di bidang ini."
  },
  "it": {
    "check": {
      "reviews": "Richieste di revisione",
      "withPoints": "Con punti di verifica"
    },
    "heading": "Sviluppo guidato dalla valutazione",
    "level": {
      "none": "Nessuna revisione",
      "partial": "Alcune senza punti",
      "defined": "Punti definiti"
    },
    "desc": "Costruire prima la valutazione e correggere verso il suo punteggio. Il passo decisivo è stato unire valutazione e guardrail — il giudice offline viene promosso a barriera in esecuzione.",
    "note": "Cambiare un prompt senza valutazione alle spalle è la guida senza patente di questo campo."
  },
  "pt-BR": {
    "check": {
      "reviews": "Pedidos de revisão",
      "withPoints": "Com pontos de verificação"
    },
    "heading": "Desenvolvimento guiado por avaliação",
    "level": {
      "none": "Sem revisões",
      "partial": "Algumas sem pontos",
      "defined": "Pontos definidos"
    },
    "desc": "Construir a avaliação primeiro e corrigir na direção da sua nota. O passo decisivo foi unir avaliação e barreiras — o juiz offline é promovido a barreira em tempo de execução.",
    "note": "Mudar um prompt sem avaliação por trás é a direção sem habilitação desta área."
  }
} as const;
