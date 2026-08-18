/**
 * semantic-memory — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.semanticMemory` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Counts how many facts are actually settled. What matters is not how many cards were stored but how many slots hold a single current truth; slots whose value split are waiting on a human.",
    "heading": "Semantic Memory",
    "level": {
      "none": "No memory yet",
      "settled": "Settled",
      "contested": "Contested slots"
    },
    "check": {
      "cards": "Stored cards",
      "current": "Current truths",
      "contested": "Contested"
    },
    "note": "Scale decides storage: a few hundred entries belong in files, hundreds of thousands in a vector store. Choosing infrastructure before measuring scale is the common over-design."
  },
  "ko": {
    "desc": "사실이 몇 개나 확정돼 있는지 셉니다. 중요한 것은 저장된 장수가 아니라 **현재 진실이 하나로 확정된 슬롯 수**이고, 값이 갈린 슬롯은 사람의 판단을 기다리는 몫입니다.",
    "heading": "의미 기억",
    "level": {
      "none": "아직 기억 없음",
      "settled": "확정됨",
      "contested": "값이 갈린 슬롯 있음"
    },
    "check": {
      "cards": "저장 장수",
      "current": "현재 진실",
      "contested": "값이 갈림"
    },
    "note": "규모가 저장 방식을 정합니다 — 수백 건이면 파일, 수십만 건이면 벡터 DB. 규모를 재기 전에 인프라부터 고르는 것이 가장 흔한 과잉 설계입니다."
  },
  "ja": {
    "level": {
      "none": "まだ記憶なし",
      "contested": "値が割れた枠",
      "settled": "確定済み"
    },
    "check": {
      "cards": "保存カード数",
      "current": "現在の真実",
      "contested": "値が割れている"
    },
    "heading": "意味記憶",
    "desc": "事実がいくつ確定しているかを数えます。重要なのは保存した枚数ではなく、**現在の真実が一つに定まった枠**の数で、値が割れた枠は人の判断待ちです。",
    "note": "規模が保存方式を決めます — 数百件ならファイル、数十万件ならベクトル DB。規模を測る前にインフラを選ぶのが最もありがちな過剰設計です。"
  },
  "zh-CN": {
    "level": {
      "none": "尚无记忆",
      "contested": "存在分歧的槽",
      "settled": "已确定"
    },
    "check": {
      "cards": "已存卡片",
      "current": "当前事实",
      "contested": "存在分歧"
    },
    "heading": "语义记忆",
    "desc": "统计究竟有多少事实已经确定。重要的不是存了多少张卡片，而是**当前真相唯一确定的槽位**有多少；值出现分歧的槽位在等人判断。",
    "note": "规模决定存储方式 — 数百条用文件，数十万条用向量数据库。在测量规模之前就先选基础设施，是最常见的过度设计。"
  },
  "es": {
    "level": {
      "none": "Sin memoria aún",
      "contested": "Ranuras en disputa",
      "settled": "Asentado"
    },
    "check": {
      "cards": "Tarjetas guardadas",
      "current": "Verdades actuales",
      "contested": "En disputa"
    },
    "heading": "Memoria semántica",
    "desc": "Cuenta cuántos hechos están realmente asentados. Lo que importa no es cuántas tarjetas se guardaron, sino cuántas ranuras sostienen **una única verdad actual**; las ranuras cuyo valor se dividió esperan a una persona.",
    "note": "La escala decide el almacenamiento: unos cientos de entradas van en archivos, cientos de miles en un almacén vectorial. Elegir la infraestructura antes de medir la escala es el sobrediseño habitual."
  },
  "es-419": {
    "level": {
      "none": "Sin memoria aún",
      "contested": "Ranuras en disputa",
      "settled": "Asentado"
    },
    "check": {
      "cards": "Tarjetas guardadas",
      "current": "Verdades actuales",
      "contested": "En disputa"
    },
    "heading": "Memoria semántica",
    "desc": "Cuenta cuántos hechos están realmente asentados. Lo que importa no es cuántas tarjetas se guardaron, sino cuántas ranuras sostienen **una única verdad actual**; las ranuras cuyo valor se dividió esperan a una persona.",
    "note": "La escala decide el almacenamiento: unos cientos de entradas van en archivos, cientos de miles en un almacén vectorial. Elegir la infraestructura antes de medir la escala es el sobrediseño habitual."
  },
  "fr": {
    "level": {
      "none": "Pas encore de mémoire",
      "contested": "Emplacements contestés",
      "settled": "Stabilisé"
    },
    "check": {
      "cards": "Cartes stockées",
      "current": "Vérités actuelles",
      "contested": "Contesté"
    },
    "heading": "Mémoire sémantique",
    "desc": "Compte combien de faits sont réellement établis. Ce qui compte n’est pas le nombre de cartes stockées mais le nombre d’emplacements portant **une seule vérité actuelle** ; ceux dont la valeur s’est scindée attendent un humain.",
    "note": "L’échelle décide du stockage : quelques centaines d’entrées vont dans des fichiers, des centaines de milliers dans un magasin vectoriel. Choisir l’infrastructure avant de mesurer l’échelle est la sur-conception classique."
  },
  "de": {
    "level": {
      "none": "Noch kein Gedächtnis",
      "contested": "Strittige Slots",
      "settled": "Gefestigt"
    },
    "check": {
      "cards": "Gespeicherte Karten",
      "current": "Aktuelle Wahrheiten",
      "contested": "Strittig"
    },
    "heading": "Semantisches Gedächtnis",
    "desc": "Zählt, wie viele Fakten tatsächlich feststehen. Entscheidend ist nicht, wie viele Karten gespeichert wurden, sondern wie viele Slots **eine einzige aktuelle Wahrheit** halten; Slots mit geteiltem Wert warten auf einen Menschen.",
    "note": "Die Größenordnung bestimmt die Speicherung: einige hundert Einträge gehören in Dateien, Hunderttausende in einen Vektorspeicher. Die Infrastruktur vor der Messung zu wählen ist die übliche Überkonstruktion."
  },
  "hi": {
    "level": {
      "none": "अभी कोई स्मृति नहीं",
      "contested": "विवादित स्लॉट",
      "settled": "तय"
    },
    "check": {
      "cards": "संग्रहित कार्ड",
      "current": "वर्तमान सत्य",
      "contested": "विवादित"
    },
    "heading": "अर्थ स्मृति",
    "desc": "गिनता है कि सचमुच कितने तथ्य जमे। अहम यह नहीं कि कितने कार्ड सहेजे गए, बल्कि यह कि कितने खाने **एक ताज़ा सच** थामे हैं; जिनका मान बँट गया, वे मनुष्य की प्रतीक्षा में हैं।",
    "note": "पैमाना ही भंडार तय करता है: कुछ सौ प्रविष्टियाँ फ़ाइल में, कुछ लाख वेक्टर-भंडार में। पैमाना नापे बिना ढाँचा चुन लेना आम अति-डिज़ाइन है।"
  },
  "id": {
    "level": {
      "none": "Belum ada memori",
      "contested": "Slot berbeda",
      "settled": "Mapan"
    },
    "check": {
      "cards": "Kartu tersimpan",
      "current": "Kebenaran saat ini",
      "contested": "Berbeda"
    },
    "heading": "Memori semantik",
    "desc": "Menghitung berapa fakta yang benar-benar mengendap. Yang penting bukan berapa kartu tersimpan, melainkan berapa slot yang memegang **satu kebenaran terkini**; slot yang nilainya terbelah menunggu manusia.",
    "note": "Skala menentukan penyimpanan: beberapa ratus entri masuk berkas, ratusan ribu masuk penyimpanan vektor. Memilih infrastruktur sebelum mengukur skala adalah perancangan berlebih yang lazim."
  },
  "it": {
    "level": {
      "none": "Nessuna memoria",
      "contested": "Slot contesi",
      "settled": "Consolidato"
    },
    "check": {
      "cards": "Schede memorizzate",
      "current": "Verità attuali",
      "contested": "Conteso"
    },
    "heading": "Memoria semantica",
    "desc": "Conta quanti fatti sono davvero assestati. Ciò che conta non è quante schede sono state salvate, ma quanti slot reggono **una sola verità attuale**; quelli il cui valore si è diviso aspettano una persona.",
    "note": "La scala decide l’archiviazione: qualche centinaio di voci sta nei file, centinaia di migliaia in un archivio vettoriale. Scegliere l’infrastruttura prima di misurare è l’eccesso di progettazione tipico."
  },
  "pt-BR": {
    "level": {
      "none": "Sem memória ainda",
      "contested": "Espaços contestados",
      "settled": "Assentado"
    },
    "check": {
      "cards": "Cartões armazenados",
      "current": "Verdades atuais",
      "contested": "Contestado"
    },
    "heading": "Memória semântica",
    "desc": "Conta quantos fatos estão de fato assentados. O que importa não é quantos cartões foram guardados, e sim quantos espaços sustentam **uma única verdade atual**; espaços cujo valor se dividiu esperam por uma pessoa.",
    "note": "A escala decide o armazenamento: algumas centenas de entradas ficam em arquivos, centenas de milhares em um banco vetorial. Escolher a infraestrutura antes de medir é o superdimensionamento habitual."
  }
} as const;
