/**
 * reranking — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.reranking` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "First-pass retrieval casts wide; reranking lifts what is actually relevant. Vibisual injects only the top few cards, so that cap is the reranking result.",
    "heading": "Reranking",
    "level": {
      "none": "No injections",
      "tight": "Within the cap",
      "loose": "Above the cap"
    },
    "check": {
      "perEvent": "Cards per injection",
      "topK": "Cap"
    },
    "note": "A tight cap is what keeps retrieval from turning into another source of context rot."
  },
  "ko": {
    "desc": "1차 검색은 넓게 건지고 재순위화가 실제로 관련 있는 것을 위로 올립니다. Vibisual 은 상위 몇 장만 주입하므로 그 상한이 곧 재순위 결과입니다.",
    "heading": "재순위화",
    "level": {
      "none": "주입 없음",
      "tight": "상한 안",
      "loose": "상한을 넘김"
    },
    "check": {
      "perEvent": "주입당 카드",
      "topK": "상한"
    },
    "note": "상한을 좁게 두는 것이 검색이 또 다른 컨텍스트 부패원이 되는 것을 막습니다."
  },
  "ja": {
    "level": {
      "none": "注入なし",
      "loose": "上限超過",
      "tight": "上限内"
    },
    "heading": "再ランキング",
    "check": {
      "perEvent": "注入当たりカード",
      "topK": "上限"
    },
    "desc": "一次検索は広く掬い、再ランキングが実際に関係するものを上へ上げます。Vibisual は上位数枚だけを注入するので、その上限が再ランキングの結果です。",
    "note": "上限を狭く保つことが、検索がもう一つのコンテキスト劣化源になるのを防ぎます。"
  },
  "zh-CN": {
    "level": {
      "none": "无注入",
      "loose": "超出上限",
      "tight": "上限内"
    },
    "heading": "重排序",
    "check": {
      "perEvent": "每次注入卡片",
      "topK": "上限"
    },
    "desc": "一次检索广撒网，重排序把真正相关的提上来。Vibisual 只注入排名靠前的几张卡片，那个上限就是重排序的结果。",
    "note": "把上限收窄，才能避免检索本身变成另一个上下文腐化源。"
  },
  "es": {
    "level": {
      "none": "Sin inyecciones",
      "loose": "Por encima del tope",
      "tight": "Dentro del tope"
    },
    "heading": "Reordenación",
    "check": {
      "perEvent": "Tarjetas por inyección",
      "topK": "Tope"
    },
    "desc": "La primera pasada barre ancho; el reordenamiento sube lo realmente relevante. Vibisual inyecta solo las primeras tarjetas, así que ese tope es el resultado del reordenamiento.",
    "note": "Un tope ajustado es lo que evita que la búsqueda se convierta ella misma en otra fuente de deterioro del contexto."
  },
  "es-419": {
    "level": {
      "none": "Sin inyecciones",
      "loose": "Por encima del tope",
      "tight": "Dentro del tope"
    },
    "heading": "Reordenación",
    "check": {
      "perEvent": "Tarjetas por inyección",
      "topK": "Tope"
    },
    "desc": "La primera pasada barre ancho; el reordenamiento sube lo realmente relevante. Vibisual inyecta solo las primeras tarjetas, así que ese tope es el resultado del reordenamiento.",
    "note": "Un tope ajustado es lo que evita que la búsqueda se convierta ella misma en otra fuente de deterioro del contexto."
  },
  "fr": {
    "level": {
      "none": "Aucune injection",
      "loose": "Au-dessus du plafond",
      "tight": "Sous le plafond"
    },
    "heading": "Reclassement",
    "check": {
      "perEvent": "Cartes par injection",
      "topK": "Plafond"
    },
    "desc": "La première passe ratisse large ; le reclassement remonte ce qui est réellement pertinent. Vibisual n’injecte que les quelques premières cartes : ce plafond est le résultat du reclassement.",
    "note": "Un plafond serré empêche la recherche de devenir elle-même une nouvelle source de dégradation du contexte."
  },
  "de": {
    "level": {
      "none": "Keine Injektionen",
      "loose": "Über der Grenze",
      "tight": "Innerhalb der Grenze"
    },
    "heading": "Neu-Rangfolge",
    "check": {
      "perEvent": "Karten pro Injektion",
      "topK": "Obergrenze"
    },
    "desc": "Der erste Suchdurchgang wirft weit aus; die Neu-Rangfolge hebt das tatsächlich Passende nach oben. Vibisual speist nur die obersten Karten ein, diese Obergrenze ist also das Ergebnis der Neu-Rangfolge.",
    "note": "Eine enge Obergrenze verhindert, dass die Suche selbst zu einer weiteren Quelle des Kontextverfalls wird."
  },
  "hi": {
    "level": {
      "none": "कोई इंजेक्शन नहीं",
      "loose": "सीमा से ऊपर",
      "tight": "सीमा के भीतर"
    },
    "heading": "पुनः क्रमांकन",
    "check": {
      "perEvent": "प्रति इंजेक्शन कार्ड",
      "topK": "सीमा"
    },
    "desc": "पहले चरण की खोज चौड़ा जाल डालती है; पुनःक्रमण सचमुच प्रासंगिक को ऊपर उठाता है। Vibisual केवल कुछ शीर्ष कार्ड डालता है, इसलिए वही सीमा उसका पुनःक्रमण-परिणाम है।",
    "note": "यही कड़ी सीमा खोज को संदर्भ-क्षय का एक और स्रोत बनने से रोकती है।"
  },
  "id": {
    "level": {
      "none": "Tanpa injeksi",
      "loose": "Di atas batas",
      "tight": "Dalam batas"
    },
    "heading": "Pemeringkatan ulang",
    "check": {
      "perEvent": "Kartu per injeksi",
      "topK": "Batas"
    },
    "desc": "Pencarian tahap pertama menjaring luas; pemeringkatan ulang mengangkat yang benar-benar relevan. Vibisual hanya menyuntikkan beberapa kartu teratas, jadi batas itulah hasil pemeringkatan ulangnya.",
    "note": "Batas yang ketat itulah yang mencegah pencarian berubah menjadi sumber pembusukan konteks yang lain."
  },
  "it": {
    "level": {
      "none": "Nessuna iniezione",
      "loose": "Sopra il tetto",
      "tight": "Entro il tetto"
    },
    "heading": "Riordinamento",
    "check": {
      "perEvent": "Schede per iniezione",
      "topK": "Tetto"
    },
    "desc": "Il primo passaggio pesca largo; il riordinamento porta in alto ciò che è davvero pertinente. Vibisual inietta solo le prime schede, quindi quel tetto è il risultato del riordinamento.",
    "note": "Un tetto stretto è ciò che impedisce alla ricerca di diventare essa stessa un’altra fonte di degrado del contesto."
  },
  "pt-BR": {
    "level": {
      "none": "Sem injeções",
      "loose": "Acima do teto",
      "tight": "Dentro do teto"
    },
    "heading": "Reordenação",
    "check": {
      "perEvent": "Cartões por injeção",
      "topK": "Teto"
    },
    "desc": "A primeira passagem varre largo; o reordenamento sobe o que de fato é relevante. O Vibisual injeta só os primeiros cartões, então esse teto é o resultado do reordenamento.",
    "note": "Um teto apertado é o que evita que a busca vire ela mesma outra fonte de deterioração de contexto."
  }
} as const;
