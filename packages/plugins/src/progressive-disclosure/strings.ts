/**
 * progressive-disclosure — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.progressiveDisclosure` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Rather than loading everything up front, hand over an index and let the body be fetched when it matters. This card watches whether the same bundle keeps getting re-injected instead.",
    "heading": "Progressive Disclosure",
    "level": {
      "none": "No injections",
      "lean": "Lean",
      "repeating": "Repeating"
    },
    "check": {
      "events": "Injection events",
      "repeats": "Repeated",
      "cards": "Cards total"
    },
    "note": "Pasting whole documents is manufacturing context rot on purpose. “If the task is X, read file Y” is the same idea done cheaply."
  },
  "ko": {
    "desc": "전부 미리 넣는 대신 목차를 주고 필요할 때 본문을 읽게 하는 방식입니다. 이 카드는 같은 묶음이 계속 재주입되고 있지는 않은지 봅니다.",
    "heading": "점진적 공개",
    "level": {
      "none": "주입 없음",
      "lean": "가벼움",
      "repeating": "반복 주입"
    },
    "check": {
      "events": "주입 이벤트",
      "repeats": "반복 횟수",
      "cards": "카드 총수"
    },
    "note": "문서를 통째로 붙여넣는 것은 컨텍스트 부패를 스스로 만드는 짓입니다. \"어떤 작업이면 어느 파일을 읽어라\" 색인이 같은 일을 훨씬 싸게 합니다."
  },
  "ja": {
    "level": {
      "none": "注入なし",
      "lean": "絞られている",
      "repeating": "繰り返している"
    },
    "check": {
      "events": "注入イベント",
      "repeats": "繰り返し",
      "cards": "カード総数"
    },
    "heading": "段階的開示",
    "desc": "最初から全部を載せるのではなく、目次を渡して必要になったとき本文を読ませる方式です。このカードは、同じ束が繰り返し再注入されていないかを見ます。",
    "note": "文書を丸ごと貼り付けるのは、コンテキストの劣化を自分で作る行為です。「この作業ならこのファイルを読め」という索引が、同じことをずっと安く実現します。"
  },
  "zh-CN": {
    "level": {
      "none": "无注入",
      "lean": "精简",
      "repeating": "重复中"
    },
    "check": {
      "events": "注入事件",
      "repeats": "重复",
      "cards": "卡片总数"
    },
    "heading": "渐进式披露",
    "desc": "与其一开始就全部载入，不如先给出目录，等真正需要时再取正文。这张卡片盯的是同一批内容是否被反复重新注入。",
    "note": "把整份文档粘贴进去，等于自己制造上下文腐化。「如果是这类任务就读那个文件」这样的索引，用低得多的代价做同一件事。"
  },
  "es": {
    "level": {
      "none": "Sin inyecciones",
      "lean": "Ajustado",
      "repeating": "Repitiéndose"
    },
    "check": {
      "events": "Eventos de inyección",
      "repeats": "Repetido",
      "cards": "Tarjetas en total"
    },
    "heading": "Divulgación progresiva",
    "desc": "En vez de cargarlo todo por adelantado, se entrega un índice y se deja traer el contenido cuando importa. Esta tarjeta vigila si, en su lugar, el mismo paquete se reinyecta una y otra vez.",
    "note": "Pegar documentos enteros es fabricar deterioro de contexto a propósito. «Si la tarea es X, lee el archivo Y» hace lo mismo por una fracción del coste."
  },
  "es-419": {
    "level": {
      "none": "Sin inyecciones",
      "lean": "Ajustado",
      "repeating": "Repitiéndose"
    },
    "check": {
      "events": "Eventos de inyección",
      "repeats": "Repetido",
      "cards": "Tarjetas en total"
    },
    "heading": "Divulgación progresiva",
    "desc": "En vez de cargarlo todo por adelantado, se entrega un índice y se deja traer el contenido cuando importa. Esta tarjeta vigila si, en su lugar, el mismo paquete se reinyecta una y otra vez.",
    "note": "Pegar documentos enteros es fabricar deterioro de contexto a propósito. «Si la tarea es X, lee el archivo Y» hace lo mismo por una fracción del coste."
  },
  "fr": {
    "level": {
      "none": "Aucune injection",
      "lean": "Restreint",
      "repeating": "Se répète"
    },
    "check": {
      "events": "Événements d’injection",
      "repeats": "Répété",
      "cards": "Total de cartes"
    },
    "heading": "Divulgation progressive",
    "desc": "Plutôt que tout charger d’emblée, on remet un index et on laisse chercher le contenu quand il compte. Cette carte surveille si, à la place, le même paquet est réinjecté sans cesse.",
    "note": "Coller des documents entiers, c’est fabriquer sciemment de la dégradation de contexte. « Si la tâche est X, lis le fichier Y » fait la même chose pour une fraction du coût."
  },
  "de": {
    "level": {
      "none": "Keine Injektionen",
      "lean": "Schlank",
      "repeating": "Wiederholt sich"
    },
    "check": {
      "events": "Injektionsereignisse",
      "repeats": "Wiederholt",
      "cards": "Karten gesamt"
    },
    "heading": "Schrittweise Offenlegung",
    "desc": "Statt alles vorab zu laden, reicht man ein Verzeichnis und lässt den Inhalt holen, wenn er zählt. Diese Karte achtet darauf, ob stattdessen dasselbe Bündel immer wieder neu eingespeist wird.",
    "note": "Ganze Dokumente einzufügen erzeugt Kontextverfall mit Ansage. „Wenn die Aufgabe X ist, lies Datei Y“ leistet dasselbe zu einem Bruchteil der Kosten."
  },
  "hi": {
    "level": {
      "none": "कोई इंजेक्शन नहीं",
      "lean": "सीमित",
      "repeating": "दोहरा रहा"
    },
    "check": {
      "events": "इंजेक्शन घटनाएँ",
      "repeats": "दोहराया",
      "cards": "कुल कार्ड"
    },
    "heading": "क्रमिक प्रकटीकरण",
    "desc": "सब कुछ पहले से लाद देने के बजाय एक सूची सौंपिए और सामग्री तभी मँगवाइए जब सचमुच ज़रूरत हो। यह कार्ड देखता है कि कहीं वही पैकेट बार-बार तो नहीं डाला जा रहा।",
    "note": "पूरा दस्तावेज़ चिपकाना जान-बूझकर संदर्भ-क्षय बनाना है। «अगर काम X है तो फ़ाइल Y पढ़ो» वही काम कहीं कम लागत में करता है।"
  },
  "id": {
    "level": {
      "none": "Tanpa injeksi",
      "lean": "Ramping",
      "repeating": "Berulang"
    },
    "check": {
      "events": "Peristiwa injeksi",
      "repeats": "Berulang",
      "cards": "Total kartu"
    },
    "heading": "Pengungkapan bertahap",
    "desc": "Alih-alih memuat semuanya di muka, serahkan sebuah indeks dan biarkan isinya diambil saat benar-benar diperlukan. Kartu ini mengawasi apakah justru paket yang sama disuntikkan berulang kali.",
    "note": "Menempelkan dokumen utuh berarti sengaja menciptakan pembusukan konteks. «Kalau tugasnya X, baca berkas Y» melakukan hal yang sama dengan biaya jauh lebih kecil."
  },
  "it": {
    "level": {
      "none": "Nessuna iniezione",
      "lean": "Ristretto",
      "repeating": "Si ripete"
    },
    "check": {
      "events": "Eventi di iniezione",
      "repeats": "Ripetuto",
      "cards": "Schede totali"
    },
    "heading": "Divulgazione progressiva",
    "desc": "Invece di caricare tutto in anticipo, si consegna un indice e si lascia recuperare il contenuto quando serve. Questa scheda osserva se, al suo posto, lo stesso pacchetto viene reiniettato di continuo.",
    "note": "Incollare interi documenti significa fabbricare degrado del contesto di proposito. «Se il compito è X, leggi il file Y» fa la stessa cosa a una frazione del costo."
  },
  "pt-BR": {
    "level": {
      "none": "Sem injeções",
      "lean": "Enxuto",
      "repeating": "Repetindo"
    },
    "check": {
      "events": "Eventos de injeção",
      "repeats": "Repetido",
      "cards": "Total de cartões"
    },
    "heading": "Divulgação progressiva",
    "desc": "Em vez de carregar tudo de antemão, entrega-se um índice e deixa-se buscar o conteúdo quando importa. Este cartão observa se, no lugar disso, o mesmo pacote é reinjetado repetidamente.",
    "note": "Colar documentos inteiros é fabricar deterioração de contexto de propósito. «Se a tarefa for X, leia o arquivo Y» faz o mesmo por uma fração do custo."
  }
} as const;
