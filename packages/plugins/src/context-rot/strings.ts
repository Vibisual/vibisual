/**
 * context-rot — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.contextRot` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows how full the context window is. The window size is a ceiling, not a target — quality often drops noticeably near half, and similar-looking distractors hurt more than length alone.",
    "heading": "Context Rot",
    "level": {
      "low": "Room left",
      "half": "Past half",
      "high": "Nearly full",
      "unknown": "Unknown"
    },
    "check": {
      "fill": "Filled",
      "tokens": "Tokens",
      "sessions": "Sessions"
    },
    "noteLow": "Plenty of room. Measure your own effective window with real work rather than trusting the advertised size.",
    "noteHigh": "Write decisions and file paths out to a file before compaction runs — summaries drop the specifics first."
  },
  "ko": {
    "desc": "컨텍스트 창을 얼마나 채웠는지 보여줍니다. 창 크기는 상한이지 목표가 아닙니다 — 절반 근처에서 이미 품질이 눈에 띄게 떨어지는 경우가 많고, 길이보다 비슷한 방해 정보의 혼입이 더 해롭습니다.",
    "heading": "컨텍스트 부패",
    "level": {
      "low": "여유 있음",
      "half": "절반을 넘김",
      "high": "거의 참",
      "unknown": "알 수 없음"
    },
    "check": {
      "fill": "채움 비율",
      "tokens": "토큰",
      "sessions": "세션 수"
    },
    "noteLow": "아직 여유가 있습니다. 광고된 창 크기를 믿기보다 실제 작업으로 자기 유효 창을 재 보십시오.",
    "noteHigh": "컴팩션이 돌기 전에 결정과 파일 경로를 파일로 남기십시오 — 요약은 구체적인 것부터 버립니다."
  },
  "ja": {
    "level": {
      "low": "余裕あり",
      "unknown": "不明",
      "high": "ほぼ満杯",
      "half": "半分超え"
    },
    "check": {
      "sessions": "セッション数",
      "fill": "充填率",
      "tokens": "トークン"
    },
    "heading": "コンテキスト劣化",
    "desc": "コンテキストウィンドウがどれだけ埋まっているかを示します。ウィンドウの大きさは上限であって目標ではありません — 半分あたりで品質が目に見えて落ちることが多く、長さより「似た紛らわしい情報の混入」の方が害になります。",
    "noteLow": "まだ余裕があります。公称のウィンドウ幅を信じるより、実際の作業で自分の有効幅を測ってください。",
    "noteHigh": "コンパクションが走る前に、決定とファイルパスをファイルへ書き出してください — 要約は具体的なものから先に捨てます。"
  },
  "zh-CN": {
    "level": {
      "low": "仍有余量",
      "unknown": "未知",
      "high": "接近占满",
      "half": "过半"
    },
    "check": {
      "sessions": "会话数",
      "fill": "占用",
      "tokens": "令牌"
    },
    "heading": "上下文腐化",
    "desc": "显示上下文窗口被填了多少。窗口大小是上限而非目标 — 常常在过半时质量就明显下降，而且「相似的干扰信息混入」比单纯的长度更有害。",
    "noteLow": "还有余量。与其相信标称的窗口大小，不如用真实任务测出自己的有效窗口。",
    "noteHigh": "在压缩发生前，把决策和文件路径写到文件里 — 摘要最先丢弃的正是具体信息。"
  },
  "es": {
    "level": {
      "low": "Queda espacio",
      "unknown": "Desconocido",
      "high": "Casi lleno",
      "half": "Más de la mitad"
    },
    "check": {
      "sessions": "Sesiones",
      "fill": "Ocupado",
      "tokens": "Tokens"
    },
    "heading": "Deterioro del contexto",
    "desc": "Muestra cuán llena está la ventana de contexto. Su tamaño es un techo, no un objetivo — la calidad suele caer de forma perceptible ya cerca de la mitad, y los distractores parecidos dañan más que la longitud por sí sola.",
    "noteLow": "Queda margen. Mide tu ventana efectiva con trabajo real en lugar de fiarte del tamaño anunciado.",
    "noteHigh": "Escribe decisiones y rutas de archivo a un fichero antes de que corra la compactación — los resúmenes descartan primero lo concreto."
  },
  "es-419": {
    "level": {
      "low": "Queda espacio",
      "unknown": "Desconocido",
      "high": "Casi lleno",
      "half": "Más de la mitad"
    },
    "check": {
      "sessions": "Sesiones",
      "fill": "Ocupado",
      "tokens": "Tokens"
    },
    "heading": "Deterioro del contexto",
    "desc": "Muestra cuán llena está la ventana de contexto. Su tamaño es un techo, no un objetivo — la calidad suele caer de forma perceptible ya cerca de la mitad, y los distractores parecidos dañan más que la longitud por sí sola.",
    "noteLow": "Queda margen. Mide tu ventana efectiva con trabajo real en lugar de fiarte del tamaño anunciado.",
    "noteHigh": "Escribe decisiones y rutas de archivo a un fichero antes de que corra la compactación — los resúmenes descartan primero lo concreto."
  },
  "fr": {
    "level": {
      "low": "Il reste de la marge",
      "unknown": "Inconnu",
      "high": "Presque plein",
      "half": "Au-delà de la moitié"
    },
    "check": {
      "sessions": "Sessions",
      "fill": "Rempli",
      "tokens": "Jetons"
    },
    "heading": "Dégradation du contexte",
    "desc": "Montre à quel point la fenêtre de contexte est remplie. Sa taille est un plafond, pas un objectif — la qualité chute souvent nettement dès la moitié, et des informations parasites qui se ressemblent nuisent plus que la seule longueur.",
    "noteLow": "Il reste de la marge. Mesurez votre fenêtre utile avec du travail réel plutôt que de vous fier à la taille annoncée.",
    "noteHigh": "Écrivez décisions et chemins de fichiers dans un fichier avant que la compaction ne s’exécute — les résumés abandonnent d’abord le concret."
  },
  "de": {
    "level": {
      "low": "Noch Spielraum",
      "unknown": "Unbekannt",
      "high": "Fast voll",
      "half": "Über die Hälfte"
    },
    "check": {
      "sessions": "Sitzungen",
      "fill": "Gefüllt",
      "tokens": "Tokens"
    },
    "heading": "Kontextverfall",
    "desc": "Zeigt, wie voll das Kontextfenster ist. Die Fenstergröße ist eine Obergrenze, kein Ziel — die Qualität fällt oft schon nahe der Hälfte spürbar ab, und ähnlich aussehende Störinformationen schaden mehr als bloße Länge.",
    "noteLow": "Noch reichlich Platz. Messen Sie Ihr eigenes wirksames Fenster mit echter Arbeit, statt der angegebenen Größe zu vertrauen.",
    "noteHigh": "Schreiben Sie Entscheidungen und Dateipfade in eine Datei, bevor die Kompaktierung läuft — Zusammenfassungen verwerfen zuerst das Konkrete."
  },
  "hi": {
    "level": {
      "low": "जगह बची है",
      "unknown": "अज्ञात",
      "high": "लगभग भरा",
      "half": "आधे से अधिक"
    },
    "check": {
      "sessions": "सत्र",
      "fill": "भरा",
      "tokens": "टोकन"
    },
    "heading": "संदर्भ क्षय",
    "desc": "दिखाता है कि संदर्भ-खिड़की कितनी भरी है। यह ऊपरी सीमा है, लक्ष्य नहीं — गुणवत्ता प्रायः आधे के आसपास ही गिरने लगती है, और मिलते-जुलते भटकाव अकेली लंबाई से ज़्यादा नुकसान करते हैं।",
    "noteLow": "अभी जगह बची है। लिखी हुई क्षमता पर भरोसा करने के बजाय असली काम से अपनी प्रभावी खिड़की नापिए।",
    "noteHigh": "संपीड़न चलने से पहले निर्णय और फ़ाइल-पथ किसी फ़ाइल में लिख लें — सारांश सबसे पहले ठोस चीज़ें ही गिराता है।"
  },
  "id": {
    "level": {
      "low": "Masih ada ruang",
      "unknown": "Tidak diketahui",
      "high": "Hampir penuh",
      "half": "Lewat separuh"
    },
    "check": {
      "sessions": "Sesi",
      "fill": "Terisi",
      "tokens": "Token"
    },
    "heading": "Pembusukan konteks",
    "desc": "Menunjukkan seberapa penuh jendela konteks. Ukurannya adalah batas atas, bukan target — kualitas sering turun terasa sudah di sekitar setengah, dan pengalih perhatian yang mirip lebih merusak daripada panjang semata.",
    "noteLow": "Masih ada ruang. Ukurlah jendela efektif Anda dengan pekerjaan nyata alih-alih memercayai ukuran yang tertulis.",
    "noteHigh": "Tulis keputusan dan jalur berkas ke sebuah berkas sebelum pemadatan berjalan — ringkasan membuang yang konkret lebih dulu."
  },
  "it": {
    "level": {
      "low": "C’è ancora spazio",
      "unknown": "Sconosciuto",
      "high": "Quasi pieno",
      "half": "Oltre metà"
    },
    "check": {
      "sessions": "Sessioni",
      "fill": "Riempito",
      "tokens": "Token"
    },
    "heading": "Degrado del contesto",
    "desc": "Mostra quanto è piena la finestra di contesto. La dimensione è un tetto, non un obiettivo — la qualità cala spesso in modo percepibile già intorno alla metà, e i distrattori simili danneggiano più della sola lunghezza.",
    "noteLow": "C’è ancora margine. Misura la tua finestra effettiva con lavoro reale invece di fidarti della dimensione dichiarata.",
    "noteHigh": "Scrivi decisioni e percorsi di file su un file prima che parta la compattazione — i riassunti scartano per primo il concreto."
  },
  "pt-BR": {
    "level": {
      "low": "Ainda há espaço",
      "unknown": "Desconhecido",
      "high": "Quase cheio",
      "half": "Passou da metade"
    },
    "check": {
      "sessions": "Sessões",
      "fill": "Preenchido",
      "tokens": "Tokens"
    },
    "heading": "Deterioração do contexto",
    "desc": "Mostra o quanto a janela de contexto está cheia. O tamanho é um teto, não uma meta — a qualidade costuma cair de forma perceptível já perto da metade, e distratores parecidos prejudicam mais do que o comprimento sozinho.",
    "noteLow": "Ainda há folga. Meça sua janela efetiva com trabalho real em vez de confiar no tamanho anunciado.",
    "noteHigh": "Escreva decisões e caminhos de arquivo num arquivo antes de a compactação rodar — resumos descartam primeiro o que é concreto."
  }
} as const;
