/**
 * golden-set — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.goldenSet` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Representativeness matters more than size, and real past failures have to be in there. A set built only from successes always scores full marks.",
    "heading": "Golden Set",
    "level": {
      "empty": "Nothing accrued",
      "partial": "Cards only",
      "accruing": "Accruing"
    },
    "check": {
      "lessons": "Lessons recorded",
      "cards": "Memory cards"
    },
    "note": "Adding a failure to the set the moment it is found is the cheapest quality infrastructure there is — one incident becomes one permanent regression test."
  },
  "ko": {
    "desc": "크기보다 대표성이 중요하고, 실제로 실패했던 사례가 들어 있어야 합니다. 잘 되는 경우만 모은 기준 데이터는 항상 만점을 줍니다.",
    "heading": "골든 셋",
    "level": {
      "empty": "적립된 것 없음",
      "partial": "카드만 있음",
      "accruing": "적립 중"
    },
    "check": {
      "lessons": "기록된 교훈",
      "cards": "기억 카드"
    },
    "note": "실패를 발견한 즉시 적립하는 습관이 가장 값싼 품질 인프라입니다 — 사고 하나가 영구적인 회귀 테스트 하나가 됩니다."
  },
  "ja": {
    "level": {
      "empty": "蓄積なし",
      "accruing": "蓄積中",
      "partial": "カードのみ"
    },
    "check": {
      "lessons": "記録された教訓",
      "cards": "記憶カード"
    },
    "heading": "ゴールデンセット",
    "desc": "大きさより代表性が重要で、実際に失敗した事例が入っている必要があります。うまくいった場合だけ集めた基準データは、いつでも満点を返します。",
    "note": "失敗を見つけた瞬間に積み立てる習慣が、最も安上がりな品質基盤です — 事故一つが恒久的な回帰テスト一つになります。"
  },
  "zh-CN": {
    "level": {
      "empty": "尚无积累",
      "accruing": "正在积累",
      "partial": "仅有卡片"
    },
    "check": {
      "lessons": "已记录的教训",
      "cards": "记忆卡片"
    },
    "heading": "黄金集",
    "desc": "代表性比数量更重要，而且必须包含真正失败过的案例。只收集成功案例的基准集，永远只会给满分。",
    "note": "发现失败就立刻加进集合，是成本最低的质量基础设施 — 一次事故变成一条永久的回归测试。"
  },
  "es": {
    "level": {
      "empty": "Nada acumulado",
      "accruing": "Acumulando",
      "partial": "Solo tarjetas"
    },
    "check": {
      "lessons": "Lecciones registradas",
      "cards": "Tarjetas de memoria"
    },
    "heading": "Conjunto de referencia",
    "desc": "La representatividad importa más que el tamaño, y tiene que incluir fallos reales del pasado. Un conjunto hecho solo con aciertos siempre da la nota máxima.",
    "note": "Añadir un fallo al conjunto en cuanto se encuentra es la infraestructura de calidad más barata que existe — un incidente se convierte en una prueba de regresión permanente."
  },
  "es-419": {
    "level": {
      "empty": "Nada acumulado",
      "accruing": "Acumulando",
      "partial": "Solo tarjetas"
    },
    "check": {
      "lessons": "Lecciones registradas",
      "cards": "Tarjetas de memoria"
    },
    "heading": "Conjunto de referencia",
    "desc": "La representatividad importa más que el tamaño, y tiene que incluir fallos reales del pasado. Un conjunto hecho solo con aciertos siempre da la nota máxima.",
    "note": "Añadir un fallo al conjunto en cuanto se encuentra es la infraestructura de calidad más barata que existe — un incidente se convierte en una prueba de regresión permanente."
  },
  "fr": {
    "level": {
      "empty": "Rien d’accumulé",
      "accruing": "En accumulation",
      "partial": "Cartes seulement"
    },
    "check": {
      "lessons": "Leçons consignées",
      "cards": "Cartes mémoire"
    },
    "heading": "Jeu de référence",
    "desc": "La représentativité compte plus que la taille, et de vrais échecs passés doivent y figurer. Un jeu bâti uniquement sur des réussites donne toujours la note maximale.",
    "note": "Ajouter un échec au jeu dès qu’il est trouvé est l’infrastructure qualité la moins chère qui soit — un incident devient un test de régression permanent."
  },
  "de": {
    "level": {
      "empty": "Nichts angesammelt",
      "accruing": "Sammelt sich",
      "partial": "Nur Karten"
    },
    "check": {
      "lessons": "Erfasste Lehren",
      "cards": "Gedächtniskarten"
    },
    "heading": "Golden Set",
    "desc": "Repräsentativität zählt mehr als Größe, und echte frühere Fehlschläge müssen enthalten sein. Ein nur aus Erfolgen gebautes Set vergibt immer die volle Punktzahl.",
    "note": "Einen Fehlschlag sofort ins Set aufzunehmen ist die billigste Qualitätsinfrastruktur überhaupt — ein Vorfall wird zu einem dauerhaften Regressionstest."
  },
  "hi": {
    "level": {
      "empty": "कुछ जमा नहीं",
      "accruing": "जमा हो रहा",
      "partial": "केवल कार्ड"
    },
    "check": {
      "lessons": "दर्ज सबक",
      "cards": "स्मृति कार्ड"
    },
    "heading": "गोल्डन सेट",
    "desc": "प्रतिनिधित्व आकार से ज़्यादा मायने रखता है, और पिछली असली विफलताएँ उसमें होनी चाहिए। केवल सफलताओं से बना संग्रह हमेशा पूरे अंक देता है।",
    "note": "विफलता मिलते ही उसे संग्रह में जोड़ना सबसे सस्ता गुणवत्ता-ढाँचा है — एक घटना स्थायी प्रतिगमन-टेस्ट बन जाती है।"
  },
  "id": {
    "level": {
      "empty": "Belum terkumpul",
      "accruing": "Terkumpul",
      "partial": "Hanya kartu"
    },
    "check": {
      "lessons": "Pelajaran tercatat",
      "cards": "Kartu memori"
    },
    "heading": "Golden set",
    "desc": "Keterwakilan lebih penting daripada ukuran, dan kegagalan nyata di masa lalu harus ada di dalamnya. Kumpulan yang dibangun hanya dari keberhasilan selalu memberi nilai penuh.",
    "note": "Menambahkan kegagalan ke kumpulan begitu ditemukan adalah infrastruktur mutu termurah yang ada — satu insiden menjadi satu tes regresi permanen."
  },
  "it": {
    "level": {
      "empty": "Nulla accumulato",
      "accruing": "In accumulo",
      "partial": "Solo schede"
    },
    "check": {
      "lessons": "Lezioni registrate",
      "cards": "Schede di memoria"
    },
    "heading": "Golden set",
    "desc": "La rappresentatività conta più della dimensione, e devono esserci fallimenti reali del passato. Un insieme costruito solo su successi dà sempre il massimo.",
    "note": "Aggiungere un fallimento all’insieme appena lo si trova è l’infrastruttura di qualità più economica che esista — un incidente diventa un test di regressione permanente."
  },
  "pt-BR": {
    "level": {
      "empty": "Nada acumulado",
      "accruing": "Acumulando",
      "partial": "Apenas cartões"
    },
    "check": {
      "lessons": "Lições registradas",
      "cards": "Cartões de memória"
    },
    "heading": "Conjunto de referência",
    "desc": "Representatividade importa mais que tamanho, e falhas reais do passado precisam estar ali. Um conjunto feito só de acertos sempre dá nota máxima.",
    "note": "Acrescentar uma falha ao conjunto assim que ela aparece é a infraestrutura de qualidade mais barata que existe — um incidente vira um teste de regressão permanente."
  }
} as const;
