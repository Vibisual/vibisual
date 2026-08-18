/**
 * prompt-caching — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.promptCaching` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Reusing the same prefix on every request cuts cost and latency sharply, but the prefix has to match byte for byte — put a timestamp or a random id up front and the whole cache breaks.",
    "heading": "Prompt Caching",
    "level": {
      "single": "Single session",
      "thin": "No stable prefix",
      "reusable": "Prefix reusable"
    },
    "check": {
      "prefix": "Stable prefix",
      "tools": "Tool definitions",
      "sessions": "Sessions"
    },
    "stable": "standing rules",
    "none": "none",
    "note": "Hit rate lives in the provider response, so this card does not guess at it — it only checks whether the prefix is stable enough for caching to be possible. The rule is: changing things last, unchanging things first."
  },
  "ko": {
    "desc": "매 요청 같은 앞부분을 재사용하면 비용과 지연이 크게 줄지만, 프리픽스가 바이트 단위로 같아야 합니다 — 시각이나 랜덤 ID 를 앞에 두면 캐시가 통째로 깨집니다.",
    "heading": "프롬프트 캐싱",
    "level": {
      "single": "단일 세션",
      "thin": "고정 프리픽스 없음",
      "reusable": "프리픽스 재사용 가능"
    },
    "check": {
      "prefix": "고정 프리픽스",
      "tools": "도구 정의",
      "sessions": "세션 수"
    },
    "stable": "상시 규칙",
    "none": "없음",
    "note": "캐시 적중률은 공급자 응답에만 있어 이 카드는 그것을 지어내지 않습니다 — 캐시가 살 수 있는 구성인지만 봅니다. 규칙은 하나입니다: 변하는 것은 뒤로, 안 변하는 것은 앞으로."
  },
  "ja": {
    "check": {
      "sessions": "セッション数",
      "prefix": "安定した前置き",
      "tools": "ツール定義"
    },
    "none": "なし",
    "heading": "プロンプトキャッシュ",
    "level": {
      "single": "単一セッション",
      "thin": "安定した前置きなし",
      "reusable": "前置きを再利用できる"
    },
    "stable": "常設ルール",
    "desc": "毎回同じ前置きを再利用すれば費用と遅延が大きく減りますが、前置きはバイト単位で一致する必要があります — 時刻や乱数 ID を先頭に置けばキャッシュが丸ごと壊れます。",
    "note": "ヒット率は提供者の応答にしかないので、このカードはそれを推測しません — キャッシュが効きうる構成かどうかだけを見ます。規則は一つ、変わるものは後ろ、変わらないものは前へ。"
  },
  "zh-CN": {
    "check": {
      "sessions": "会话数",
      "prefix": "稳定前缀",
      "tools": "工具定义"
    },
    "none": "无",
    "heading": "提示词缓存",
    "level": {
      "single": "单一会话",
      "thin": "无稳定前缀",
      "reusable": "前缀可复用"
    },
    "stable": "常驻规则",
    "desc": "每次请求复用相同前缀能大幅降低成本与延迟，但前缀必须逐字节一致 — 把时间戳或随机 ID 放在开头，整个缓存就废了。",
    "note": "命中率只存在于提供方的响应里，所以这张卡片不去猜它 — 只看前缀是否稳定到足以让缓存生效。规则只有一条：会变的放后面，不变的放前面。"
  },
  "es": {
    "check": {
      "sessions": "Sesiones",
      "prefix": "Prefijo estable",
      "tools": "Definiciones de herramientas"
    },
    "none": "ninguno",
    "heading": "Caché de prompts",
    "level": {
      "single": "Sesión única",
      "thin": "Sin prefijo estable",
      "reusable": "Prefijo reutilizable"
    },
    "stable": "reglas permanentes",
    "desc": "Reutilizar el mismo prefijo en cada petición baja mucho coste y latencia, pero el prefijo debe coincidir byte a byte — pon una marca de tiempo o un id aleatorio delante y toda la caché se rompe.",
    "note": "La tasa de acierto vive en la respuesta del proveedor, así que esta tarjeta no la adivina — solo comprueba si el prefijo es lo bastante estable para que la caché sea posible. La regla: lo que cambia al final, lo que no cambia al principio."
  },
  "es-419": {
    "check": {
      "sessions": "Sesiones",
      "prefix": "Prefijo estable",
      "tools": "Definiciones de herramientas"
    },
    "none": "ninguno",
    "heading": "Caché de prompts",
    "level": {
      "single": "Sesión única",
      "thin": "Sin prefijo estable",
      "reusable": "Prefijo reutilizable"
    },
    "stable": "reglas permanentes",
    "desc": "Reutilizar el mismo prefijo en cada petición baja mucho coste y latencia, pero el prefijo debe coincidir byte a byte — pon una marca de tiempo o un id aleatorio delante y toda la caché se rompe.",
    "note": "La tasa de acierto vive en la respuesta del proveedor, así que esta tarjeta no la adivina — solo comprueba si el prefijo es lo bastante estable para que la caché sea posible. La regla: lo que cambia al final, lo que no cambia al principio."
  },
  "fr": {
    "check": {
      "sessions": "Sessions",
      "prefix": "Préfixe stable",
      "tools": "Définitions d’outils"
    },
    "none": "aucun",
    "heading": "Cache de prompts",
    "level": {
      "single": "Session unique",
      "thin": "Pas de préfixe stable",
      "reusable": "Préfixe réutilisable"
    },
    "stable": "règles permanentes",
    "desc": "Réutiliser le même préfixe à chaque requête réduit fortement coût et latence, mais le préfixe doit correspondre octet pour octet — placez un horodatage ou un identifiant aléatoire en tête et tout le cache tombe.",
    "note": "Le taux de succès réside dans la réponse du fournisseur : cette carte ne le devine donc pas — elle vérifie seulement si le préfixe est assez stable pour qu’un cache soit possible. La règle : ce qui change à la fin, ce qui ne change pas au début."
  },
  "de": {
    "check": {
      "sessions": "Sitzungen",
      "prefix": "Stabiler Präfix",
      "tools": "Werkzeugdefinitionen"
    },
    "none": "keine",
    "heading": "Prompt-Caching",
    "level": {
      "single": "Einzelne Sitzung",
      "thin": "Kein stabiler Präfix",
      "reusable": "Präfix wiederverwendbar"
    },
    "stable": "Dauerregeln",
    "desc": "Denselben Präfix bei jeder Anfrage wiederzuverwenden senkt Kosten und Latenz deutlich, aber der Präfix muss Byte für Byte übereinstimmen — ein Zeitstempel oder eine Zufalls-ID vorn, und der ganze Cache bricht.",
    "note": "Die Trefferquote steckt in der Antwort des Anbieters, diese Karte rät sie also nicht — sie prüft nur, ob der Präfix stabil genug für Caching ist. Die Regel lautet: Veränderliches nach hinten, Unveränderliches nach vorn."
  },
  "hi": {
    "check": {
      "sessions": "सत्र",
      "prefix": "स्थिर उपसर्ग",
      "tools": "टूल परिभाषाएँ"
    },
    "none": "कोई नहीं",
    "heading": "प्रॉम्प्ट कैशिंग",
    "level": {
      "single": "एकल सत्र",
      "thin": "कोई स्थिर उपसर्ग नहीं",
      "reusable": "उपसर्ग पुनः प्रयोज्य"
    },
    "stable": "स्थायी नियम",
    "desc": "हर अनुरोध पर वही उपसर्ग दोबारा इस्तेमाल करना लागत और विलंब तेज़ी से घटाता है, पर उपसर्ग बाइट-दर-बाइट एक जैसा होना चाहिए — आगे कोई समय-मुहर या यादृच्छिक id रखिए, और पूरा cache ढह जाता है।",
    "note": "सफलता-दर प्रदाता के उत्तर में आती है, इसलिए यह कार्ड अनुमान नहीं लगाता — वह सिर्फ़ देखता है कि उपसर्ग इतना स्थिर है या नहीं कि cache संभव हो। नियम: जो बदलता है पीछे, जो टिकता है आगे।"
  },
  "id": {
    "check": {
      "sessions": "Sesi",
      "prefix": "Prefiks stabil",
      "tools": "Definisi alat"
    },
    "none": "tidak ada",
    "heading": "Caching prompt",
    "level": {
      "single": "Sesi tunggal",
      "thin": "Tanpa prefiks stabil",
      "reusable": "Prefiks bisa dipakai ulang"
    },
    "stable": "aturan tetap",
    "desc": "Memakai ulang awalan yang sama pada tiap permintaan memangkas biaya dan latensi secara tajam, tetapi awalannya harus sama persis bita demi bita — taruh penanda waktu atau id acak di depan, dan seluruh cache pun runtuh.",
    "note": "Tingkat keberhasilan ada di respons penyedia, jadi kartu ini tidak menebaknya — ia hanya memeriksa apakah awalannya cukup stabil agar cache mungkin terjadi. Aturannya: yang berubah di belakang, yang tetap di depan."
  },
  "it": {
    "check": {
      "sessions": "Sessioni",
      "prefix": "Prefisso stabile",
      "tools": "Definizioni degli strumenti"
    },
    "none": "nessuno",
    "heading": "Caching dei prompt",
    "level": {
      "single": "Sessione singola",
      "thin": "Nessun prefisso stabile",
      "reusable": "Prefisso riutilizzabile"
    },
    "stable": "regole permanenti",
    "desc": "Riutilizzare lo stesso prefisso a ogni richiesta abbatte costo e latenza, ma il prefisso deve coincidere byte per byte — metti davanti una marca temporale o un id casuale e l’intera cache salta.",
    "note": "Il tasso di successo vive nella risposta del fornitore, quindi questa scheda non lo indovina — controlla solo se il prefisso è abbastanza stabile perché una cache sia possibile. La regola: ciò che cambia in fondo, ciò che non cambia davanti."
  },
  "pt-BR": {
    "check": {
      "sessions": "Sessões",
      "prefix": "Prefixo estável",
      "tools": "Definições de ferramentas"
    },
    "none": "nenhum",
    "heading": "Cache de prompts",
    "level": {
      "single": "Sessão única",
      "thin": "Sem prefixo estável",
      "reusable": "Prefixo reutilizável"
    },
    "stable": "regras permanentes",
    "desc": "Reaproveitar o mesmo prefixo em cada requisição derruba custo e latência, mas o prefixo precisa bater byte a byte — ponha um carimbo de tempo ou um id aleatório na frente e todo o cache quebra.",
    "note": "A taxa de acerto vive na resposta do provedor, então este cartão não a adivinha — só verifica se o prefixo é estável o bastante para haver cache. A regra: o que muda vai no fim, o que não muda vai no começo."
  }
} as const;
