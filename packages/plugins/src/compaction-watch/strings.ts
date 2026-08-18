/**
 * compaction-watch — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.compactionWatch` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Folding past turns into a summary is the standard device for long work. Knowing where the loss happens is the skill — summaries drop concrete identifiers first.",
    "heading": "Compaction Watch",
    "level": {
      "unknown": "Unknown",
      "far": "Room left",
      "near": "Compaction near"
    },
    "check": {
      "fill": "Window filled",
      "sessions": "Sessions"
    },
    "note": "File paths, function names, error codes and the reasons behind decisions are exactly what a summary discards, and exactly what you need later.",
    "noteNear": "The window is filling. Write the decisions and paths out to a file before automatic compaction runs."
  },
  "ko": {
    "desc": "지난 턴을 요약으로 접어 넣는 것은 긴 작업의 표준 장치입니다. 실력은 손실이 어디서 나는지 아는 데 있습니다 — 요약은 구체적 식별자부터 버립니다.",
    "heading": "컴팩션 감시",
    "level": {
      "unknown": "알 수 없음",
      "far": "여유 있음",
      "near": "컴팩션 임박"
    },
    "check": {
      "fill": "창 채움",
      "sessions": "세션 수"
    },
    "note": "파일 경로·함수명·에러 코드·결정의 이유가 요약이 먼저 버리는 것이자, 나중에 정확히 필요한 것들입니다.",
    "noteNear": "창이 차고 있습니다. 자동 압축이 돌기 전에 결정과 경로를 파일로 내보내십시오."
  },
  "ja": {
    "level": {
      "unknown": "不明",
      "far": "余裕あり",
      "near": "圧縮が近い"
    },
    "check": {
      "fill": "ウィンドウ充填率",
      "sessions": "セッション数"
    },
    "heading": "コンパクション監視",
    "desc": "過去のターンを要約へ畳み込むのは長い作業の標準装備です。実力は損失がどこで出るかを知っていることにあります — 要約は具体的な識別子から先に捨てます。",
    "note": "ファイルパス・関数名・エラーコード・決定の理由が、要約が真っ先に捨てるものであり、後になって正確に必要になるものです。",
    "noteNear": "ウィンドウが埋まりつつあります。自動の圧縮が走る前に、決定とパスをファイルへ書き出してください。"
  },
  "zh-CN": {
    "level": {
      "unknown": "未知",
      "far": "仍有余量",
      "near": "压缩临近"
    },
    "check": {
      "fill": "窗口占用",
      "sessions": "会话数"
    },
    "heading": "压缩监视",
    "desc": "把过去的轮次折叠成摘要，是长任务的标准装置。功力体现在知道损失出在哪里 — 摘要最先丢弃的是具体标识符。",
    "note": "文件路径、函数名、错误码、决策背后的理由，正是摘要最先丢掉、而你之后恰恰需要的东西。",
    "noteNear": "窗口正在填满。在自动压缩发生前，把决策与路径写到文件里。"
  },
  "es": {
    "level": {
      "unknown": "Desconocido",
      "far": "Queda espacio",
      "near": "Compactación cerca"
    },
    "check": {
      "fill": "Ventana ocupada",
      "sessions": "Sesiones"
    },
    "heading": "Vigilancia de compactación",
    "desc": "Plegar turnos pasados en un resumen es el recurso estándar para trabajos largos. La destreza está en saber dónde se produce la pérdida — los resúmenes descartan primero los identificadores concretos.",
    "note": "Rutas de archivo, nombres de función, códigos de error y las razones tras las decisiones son justo lo que un resumen tira y lo que después necesitas.",
    "noteNear": "La ventana se está llenando. Escribe decisiones y rutas a un archivo antes de que corra la compactación automática."
  },
  "es-419": {
    "level": {
      "unknown": "Desconocido",
      "far": "Queda espacio",
      "near": "Compactación cerca"
    },
    "check": {
      "fill": "Ventana ocupada",
      "sessions": "Sesiones"
    },
    "heading": "Vigilancia de compactación",
    "desc": "Plegar turnos pasados en un resumen es el recurso estándar para trabajos largos. La destreza está en saber dónde se produce la pérdida — los resúmenes descartan primero los identificadores concretos.",
    "note": "Rutas de archivo, nombres de función, códigos de error y las razones tras las decisiones son justo lo que un resumen tira y lo que después necesitas.",
    "noteNear": "La ventana se está llenando. Escribe decisiones y rutas a un archivo antes de que corra la compactación automática."
  },
  "fr": {
    "level": {
      "unknown": "Inconnu",
      "far": "Il reste de la marge",
      "near": "Compaction proche"
    },
    "check": {
      "fill": "Fenêtre remplie",
      "sessions": "Sessions"
    },
    "heading": "Surveillance de la compaction",
    "desc": "Replier les tours passés en résumé est le dispositif standard des travaux longs. Le savoir-faire consiste à savoir où se produit la perte — les résumés abandonnent d’abord les identifiants concrets.",
    "note": "Chemins de fichiers, noms de fonctions, codes d’erreur et raisons des décisions sont exactement ce qu’un résumé jette et ce dont vous aurez besoin ensuite.",
    "noteNear": "La fenêtre se remplit. Écrivez décisions et chemins dans un fichier avant que la compaction automatique ne s’exécute."
  },
  "de": {
    "level": {
      "unknown": "Unbekannt",
      "far": "Noch Spielraum",
      "near": "Kompaktierung nah"
    },
    "check": {
      "fill": "Fenster gefüllt",
      "sessions": "Sitzungen"
    },
    "heading": "Kompaktierungs-Überwachung",
    "desc": "Vergangene Züge in eine Zusammenfassung zu falten ist das Standardmittel für lange Arbeit. Das Können liegt darin zu wissen, wo der Verlust entsteht — Zusammenfassungen verwerfen zuerst konkrete Bezeichner.",
    "note": "Dateipfade, Funktionsnamen, Fehlercodes und die Gründe hinter Entscheidungen sind genau das, was eine Zusammenfassung verwirft und was Sie später brauchen.",
    "noteNear": "Das Fenster füllt sich. Schreiben Sie Entscheidungen und Pfade in eine Datei, bevor die automatische Kompaktierung läuft."
  },
  "hi": {
    "level": {
      "unknown": "अज्ञात",
      "far": "जगह बची है",
      "near": "कॉम्पैक्शन निकट"
    },
    "check": {
      "fill": "विंडो भरी",
      "sessions": "सत्र"
    },
    "heading": "कॉम्पैक्शन निगरानी",
    "desc": "बीती बारियों को सारांश में मोड़ना लंबे काम का मानक औज़ार है। कौशल यह जानने में है कि हानि कहाँ होती है — सारांश सबसे पहले ठोस पहचानकर्ता ही गिराता है।",
    "note": "फ़ाइल-पथ, फ़ंक्शन के नाम, दोष-कोड और निर्णय के पीछे की वजह — सारांश ठीक यही गिराता है और आगे यही आपको चाहिए होते हैं।",
    "noteNear": "खिड़की भरने लगी है। स्वतः संपीड़न चलने से पहले निर्णय और पथ किसी फ़ाइल में लिख लीजिए।"
  },
  "id": {
    "level": {
      "unknown": "Tidak diketahui",
      "far": "Masih ada ruang",
      "near": "Pemadatan mendekat"
    },
    "check": {
      "fill": "Jendela terisi",
      "sessions": "Sesi"
    },
    "heading": "Pemantauan pemadatan",
    "desc": "Melipat giliran-giliran lampau menjadi ringkasan adalah perangkat baku untuk pekerjaan panjang. Kepiawaiannya terletak pada mengetahui di mana kehilangan terjadi — ringkasan membuang pengenal konkret lebih dulu.",
    "note": "Jalur berkas, nama fungsi, kode galat, dan alasan di balik keputusan justru itulah yang dibuang ringkasan dan yang nanti Anda butuhkan.",
    "noteNear": "Jendela mulai penuh. Tulis keputusan dan jalur ke sebuah berkas sebelum pemadatan otomatis berjalan."
  },
  "it": {
    "level": {
      "unknown": "Sconosciuto",
      "far": "C’è ancora spazio",
      "near": "Compattazione vicina"
    },
    "check": {
      "fill": "Finestra riempita",
      "sessions": "Sessioni"
    },
    "heading": "Monitoraggio compattazione",
    "desc": "Ripiegare i turni passati in un riassunto è il dispositivo standard per i lavori lunghi. L’abilità sta nel sapere dove avviene la perdita — i riassunti scartano per primi gli identificatori concreti.",
    "note": "Percorsi di file, nomi di funzione, codici di errore e le ragioni dietro le decisioni sono esattamente ciò che un riassunto butta e ciò che ti servirà dopo.",
    "noteNear": "La finestra si sta riempiendo. Scrivi decisioni e percorsi su un file prima che parta la compattazione automatica."
  },
  "pt-BR": {
    "level": {
      "unknown": "Desconhecido",
      "far": "Ainda há espaço",
      "near": "Compactação próxima"
    },
    "check": {
      "fill": "Janela preenchida",
      "sessions": "Sessões"
    },
    "heading": "Monitoramento de compactação",
    "desc": "Dobrar turnos passados num resumo é o recurso padrão para trabalhos longos. A perícia está em saber onde ocorre a perda — resumos descartam primeiro os identificadores concretos.",
    "note": "Caminhos de arquivo, nomes de função, códigos de erro e as razões por trás das decisões são exatamente o que um resumo joga fora e o que você vai precisar depois.",
    "noteNear": "A janela está enchendo. Escreva decisões e caminhos num arquivo antes de a compactação automática rodar."
  }
} as const;
