/**
 * vector-db — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.vectorDb` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Scale decides storage. A few hundred entries belong in files with text search; hundreds of thousands justify a vector store. Choosing infrastructure before measuring scale is the common over-design.",
    "heading": "Vector DB",
    "level": {
      "none": "No memory yet",
      "fits": "Files still fit",
      "outgrown": "Outgrowing files"
    },
    "check": {
      "cards": "Cards stored",
      "storage": "Storage",
      "limit": "File-scale limit"
    },
    "files": "markdown files",
    "note": "Vibisual keeps memory in files on purpose. This card exists to notice the day that choice stops paying off."
  },
  "ko": {
    "desc": "규모가 저장 방식을 정합니다. 수백 건이면 파일 + 텍스트 검색, 수십만 건이면 벡터 DB 입니다. 규모를 재기 전에 인프라부터 고르는 것이 가장 흔한 과잉 설계입니다.",
    "heading": "벡터 DB",
    "level": {
      "none": "아직 기억 없음",
      "fits": "파일로 충분",
      "outgrown": "파일 규모를 넘어섬"
    },
    "check": {
      "cards": "저장 장수",
      "storage": "저장 방식",
      "limit": "파일 규모 한계"
    },
    "files": "마크다운 파일",
    "note": "Vibisual 은 의도적으로 기억을 파일에 둡니다. 이 카드는 그 선택이 더는 유리하지 않게 되는 날을 알아채기 위한 것입니다."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "fits": "ファイルで足りる",
      "outgrown": "ファイル運用の限界"
    },
    "check": {
      "cards": "保存カード数",
      "storage": "保存方式",
      "limit": "ファイル運用の限界"
    },
    "heading": "ベクトル DB",
    "files": "マークダウンファイル",
    "desc": "規模が保存方式を決めます。数百件ならテキスト検索付きのファイル、数十万件ならベクトル保存が妥当です。規模を測る前にインフラを選ぶのが最もありがちな過剰設計です。",
    "note": "Vibisual は意図的に記憶をファイルに置いています。このカードは、その選択が割に合わなくなる日に気づくためのものです。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "fits": "文件仍够用",
      "outgrown": "超出文件规模"
    },
    "check": {
      "cards": "已存卡片",
      "storage": "存储方式",
      "limit": "文件规模上限"
    },
    "heading": "向量数据库",
    "files": "Markdown 文件",
    "desc": "规模决定存储方式。数百条适合文件加文本检索，数十万条才值得上向量存储。在测量规模之前就先选基础设施，是最常见的过度设计。",
    "note": "Vibisual 有意把记忆放在文件里。这张卡片的存在，是为了在这个选择不再划算的那天能察觉到。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "fits": "Los archivos bastan",
      "outgrown": "Superando los archivos"
    },
    "check": {
      "cards": "Tarjetas guardadas",
      "storage": "Almacenamiento",
      "limit": "Límite para archivos"
    },
    "heading": "Base vectorial",
    "files": "archivos markdown",
    "desc": "La escala decide el almacenamiento. Unos cientos de entradas van en archivos con búsqueda de texto; cientos de miles justifican un almacén vectorial. Elegir infraestructura antes de medir es el sobrediseño habitual.",
    "note": "Vibisual guarda la memoria en archivos a propósito. Esta tarjeta existe para notar el día en que esa elección deje de compensar."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "fits": "Los archivos bastan",
      "outgrown": "Superando los archivos"
    },
    "check": {
      "cards": "Tarjetas guardadas",
      "storage": "Almacenamiento",
      "limit": "Límite para archivos"
    },
    "heading": "Base vectorial",
    "files": "archivos markdown",
    "desc": "La escala decide el almacenamiento. Unos cientos de entradas van en archivos con búsqueda de texto; cientos de miles justifican un almacén vectorial. Elegir infraestructura antes de medir es el sobrediseño habitual.",
    "note": "Vibisual guarda la memoria en archivos a propósito. Esta tarjeta existe para notar el día en que esa elección deje de compensar."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "fits": "Les fichiers suffisent",
      "outgrown": "Dépasse les fichiers"
    },
    "check": {
      "cards": "Cartes stockées",
      "storage": "Stockage",
      "limit": "Limite pour fichiers"
    },
    "heading": "Base vectorielle",
    "files": "fichiers markdown",
    "desc": "L’échelle décide du stockage. Quelques centaines d’entrées vont dans des fichiers avec recherche texte ; des centaines de milliers justifient un magasin vectoriel. Choisir l’infrastructure avant de mesurer est la sur-conception classique.",
    "note": "Vibisual garde sa mémoire dans des fichiers, délibérément. Cette carte existe pour remarquer le jour où ce choix cesse d’être rentable."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "fits": "Dateien reichen noch",
      "outgrown": "Dateien werden zu klein"
    },
    "check": {
      "cards": "Gespeicherte Karten",
      "storage": "Speicherung",
      "limit": "Grenze für Dateien"
    },
    "heading": "Vektor-DB",
    "files": "Markdown-Dateien",
    "desc": "Die Größenordnung bestimmt die Speicherung. Einige hundert Einträge gehören in Dateien mit Textsuche; Hunderttausende rechtfertigen einen Vektorspeicher. Die Infrastruktur vor der Messung zu wählen ist die übliche Überkonstruktion.",
    "note": "Vibisual hält das Gedächtnis bewusst in Dateien. Diese Karte existiert, um den Tag zu bemerken, an dem sich diese Wahl nicht mehr auszahlt."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "fits": "फ़ाइलें पर्याप्त",
      "outgrown": "फ़ाइल पैमाना पार"
    },
    "check": {
      "cards": "संग्रहित कार्ड",
      "storage": "भंडारण",
      "limit": "फ़ाइल पैमाना सीमा"
    },
    "heading": "वेक्टर DB",
    "files": "मार्कडाउन फ़ाइलें",
    "desc": "पैमाना भंडार तय करता है। कुछ सौ प्रविष्टियाँ पाठ-खोज वाली फ़ाइल में बैठती हैं; कुछ लाख ही वेक्टर-भंडार को उचित ठहराती हैं। नापने से पहले ढाँचा चुनना आम अति-डिज़ाइन है।",
    "note": "Vibisual जान-बूझकर स्मृति फ़ाइलों में रखता है। यह कार्ड उस दिन को पहचानने के लिए है जब वह चुनाव फ़ायदेमंद न रहे।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "fits": "Berkas masih cukup",
      "outgrown": "Melampaui skala berkas"
    },
    "check": {
      "cards": "Kartu tersimpan",
      "storage": "Penyimpanan",
      "limit": "Batas skala berkas"
    },
    "heading": "Basis data vektor",
    "files": "berkas markdown",
    "desc": "Skala menentukan penyimpanan. Beberapa ratus entri masuk berkas dengan pencarian teks; ratusan ribu baru membenarkan penyimpanan vektor. Memilih infrastruktur sebelum mengukur adalah perancangan berlebih yang lazim.",
    "note": "Vibisual sengaja menyimpan memori dalam berkas. Kartu ini ada untuk menyadari hari ketika pilihan itu berhenti menguntungkan."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "fits": "I file bastano ancora",
      "outgrown": "Oltre la scala dei file"
    },
    "check": {
      "cards": "Schede memorizzate",
      "storage": "Archiviazione",
      "limit": "Limite per i file"
    },
    "heading": "DB vettoriale",
    "files": "file markdown",
    "desc": "La scala decide l’archiviazione. Qualche centinaio di voci sta nei file con ricerca testuale; centinaia di migliaia giustificano un archivio vettoriale. Scegliere l’infrastruttura prima di misurare è l’eccesso di progettazione tipico.",
    "note": "Vibisual tiene la memoria nei file di proposito. Questa scheda esiste per accorgersi del giorno in cui quella scelta smette di convenire."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "fits": "Arquivos ainda bastam",
      "outgrown": "Ultrapassando arquivos"
    },
    "check": {
      "cards": "Cartões armazenados",
      "storage": "Armazenamento",
      "limit": "Limite para arquivos"
    },
    "heading": "Banco vetorial",
    "files": "arquivos markdown",
    "desc": "A escala decide o armazenamento. Algumas centenas de entradas ficam em arquivos com busca textual; centenas de milhares justificam um banco vetorial. Escolher a infraestrutura antes de medir é o superdimensionamento habitual.",
    "note": "O Vibisual mantém a memória em arquivos de propósito. Este cartão existe para notar o dia em que essa escolha deixar de compensar."
  }
} as const;
