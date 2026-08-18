/**
 * grounding — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.grounding` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Checks whether claims are tied to something verifiable — the ability to read the source, and evidence that actually arrived.",
    "heading": "Grounding",
    "level": {
      "ungrounded": "Nothing to ground on",
      "partial": "Partial",
      "both": "Source and evidence"
    },
    "check": {
      "source": "Can read source",
      "memory": "Evidence cards"
    },
    "yes": "yes",
    "no": "no",
    "note": "Reading the file beats being told about the file. Grounding is what makes a claim checkable rather than plausible."
  },
  "ko": {
    "desc": "주장이 확인 가능한 것에 매여 있는지 봅니다 — 원본을 읽을 수 있는지, 그리고 근거가 실제로 도착했는지.",
    "heading": "그라운딩",
    "level": {
      "ungrounded": "매일 근거 없음",
      "partial": "일부만",
      "both": "원본 + 근거"
    },
    "check": {
      "source": "원본 읽기 가능",
      "memory": "근거 카드"
    },
    "yes": "가능",
    "no": "불가",
    "note": "파일에 대해 전해 듣는 것보다 파일을 읽는 편이 낫습니다. 그라운딩이 주장을 그럴듯한 것에서 확인 가능한 것으로 바꿉니다."
  },
  "ja": {
    "level": {
      "partial": "一部のみ",
      "ungrounded": "根拠にするものがない",
      "both": "原本と根拠"
    },
    "check": {
      "source": "原本を読める",
      "memory": "根拠カード"
    },
    "yes": "はい",
    "no": "いいえ",
    "heading": "根拠づけ",
    "desc": "主張が確認できるものに結び付いているかを見ます — 原本を読めるか、そして根拠が実際に届いたか。",
    "note": "ファイルについて伝え聞くより、ファイルを読む方が確かです。グラウンディングが主張を「もっともらしいもの」から「確認できるもの」に変えます。"
  },
  "zh-CN": {
    "level": {
      "partial": "部分",
      "ungrounded": "无可锚定的依据",
      "both": "源码与证据"
    },
    "check": {
      "source": "可读取源码",
      "memory": "证据卡片"
    },
    "yes": "是",
    "no": "否",
    "heading": "事实锚定",
    "desc": "检查主张是否绑定在可核实的东西上 — 是否能读到原文，以及依据是否真的送达。",
    "note": "读文件比听人转述文件更可靠。锚定把一个主张从「听起来有道理」变成「可以核实」。"
  },
  "es": {
    "level": {
      "partial": "Parcial",
      "ungrounded": "Nada en qué anclarse",
      "both": "Fuente y evidencia"
    },
    "check": {
      "source": "Puede leer la fuente",
      "memory": "Tarjetas de evidencia"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Anclaje en evidencia",
    "desc": "Comprueba si las afirmaciones están atadas a algo verificable — la capacidad de leer la fuente, y evidencia que realmente llegó.",
    "note": "Leer el archivo vale más que oír hablar del archivo. El anclaje convierte una afirmación plausible en una comprobable."
  },
  "es-419": {
    "level": {
      "partial": "Parcial",
      "ungrounded": "Nada en qué anclarse",
      "both": "Fuente y evidencia"
    },
    "check": {
      "source": "Puede leer la fuente",
      "memory": "Tarjetas de evidencia"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Anclaje en evidencia",
    "desc": "Comprueba si las afirmaciones están atadas a algo verificable — la capacidad de leer la fuente, y evidencia que realmente llegó.",
    "note": "Leer el archivo vale más que oír hablar del archivo. El anclaje convierte una afirmación plausible en una comprobable."
  },
  "fr": {
    "level": {
      "partial": "Partiel",
      "ungrounded": "Rien sur quoi s’ancrer",
      "both": "Source et preuves"
    },
    "check": {
      "source": "Peut lire la source",
      "memory": "Cartes de preuve"
    },
    "yes": "oui",
    "no": "non",
    "heading": "Ancrage factuel",
    "desc": "Vérifie que les affirmations sont rattachées à quelque chose de vérifiable — la capacité de lire la source, et des preuves réellement arrivées.",
    "note": "Lire le fichier vaut mieux que s’en faire raconter le contenu. L’ancrage transforme une affirmation plausible en affirmation vérifiable."
  },
  "de": {
    "level": {
      "partial": "Teilweise",
      "ungrounded": "Nichts zum Fundieren",
      "both": "Quelle und Belege"
    },
    "check": {
      "source": "Kann Quelle lesen",
      "memory": "Belegkarten"
    },
    "yes": "ja",
    "no": "nein",
    "heading": "Fundierung",
    "desc": "Prüft, ob Aussagen an etwas Überprüfbares gebunden sind — die Fähigkeit, die Quelle zu lesen, und Belege, die tatsächlich ankamen.",
    "note": "Die Datei zu lesen schlägt es, über die Datei erzählt zu bekommen. Fundierung macht aus einer Aussage etwas Prüfbares statt bloß Plausibles."
  },
  "hi": {
    "level": {
      "partial": "आंशिक",
      "ungrounded": "आधार बनाने को कुछ नहीं",
      "both": "स्रोत और साक्ष्य"
    },
    "check": {
      "source": "स्रोत पढ़ सकता है",
      "memory": "साक्ष्य कार्ड"
    },
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "साक्ष्य आधार",
    "desc": "जाँचता है कि दावे किसी जाँचने योग्य चीज़ से बँधे हैं या नहीं — स्रोत पढ़ पाने की क्षमता, और सचमुच पहुँचा हुआ प्रमाण।",
    "note": "फ़ाइल के बारे में बताया जाना उसे पढ़ लेने से कमतर है। आधार दावे को प्रशंसनीय से जाँचने योग्य में बदल देता है।"
  },
  "id": {
    "level": {
      "partial": "Sebagian",
      "ungrounded": "Tak ada dasar",
      "both": "Sumber dan bukti"
    },
    "check": {
      "source": "Bisa baca sumber",
      "memory": "Kartu bukti"
    },
    "yes": "ya",
    "no": "tidak",
    "heading": "Pendasaran",
    "desc": "Memeriksa apakah klaim terikat pada sesuatu yang bisa diverifikasi — kemampuan membaca sumbernya, dan bukti yang benar-benar sampai.",
    "note": "Membaca berkasnya lebih baik daripada diceritakan tentang berkasnya. Pendasaran mengubah klaim yang terdengar masuk akal menjadi klaim yang bisa diperiksa."
  },
  "it": {
    "level": {
      "partial": "Parziale",
      "ungrounded": "Nulla su cui ancorarsi",
      "both": "Sorgente e prove"
    },
    "check": {
      "source": "Può leggere il sorgente",
      "memory": "Schede di prova"
    },
    "yes": "sì",
    "no": "no",
    "heading": "Ancoraggio ai fatti",
    "desc": "Verifica se le affermazioni sono legate a qualcosa di verificabile — la possibilità di leggere la fonte e prove effettivamente arrivate.",
    "note": "Leggere il file vale più che sentirsi raccontare il file. L’ancoraggio trasforma un’affermazione plausibile in una verificabile."
  },
  "pt-BR": {
    "level": {
      "partial": "Parcial",
      "ungrounded": "Nada em que se ancorar",
      "both": "Fonte e evidências"
    },
    "check": {
      "source": "Pode ler a fonte",
      "memory": "Cartões de evidência"
    },
    "yes": "sim",
    "no": "não",
    "heading": "Ancoragem factual",
    "desc": "Verifica se as afirmações estão presas a algo verificável — a capacidade de ler a fonte e evidências que realmente chegaram.",
    "note": "Ler o arquivo vale mais do que ouvir falar do arquivo. A ancoragem transforma uma afirmação plausível numa verificável."
  }
} as const;
