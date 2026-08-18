/**
 * agentic-file-search — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agenticFileSearch` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "In a codebase, walking the filesystem usually beats building an index — indexes go stale, grep always sees the current state.",
    "heading": "Agentic File Search",
    "level": {
      "none": "No search tools",
      "partial": "Partial",
      "full": "Grep and Glob"
    },
    "check": {
      "tools": "Search tools",
      "read": "Can read matches"
    },
    "yes": "yes",
    "no": "no",
    "note": "Letting the agent explore — estimating complexity from file size, purpose from names — is the same idea as progressive disclosure."
  },
  "ko": {
    "desc": "코드베이스에서는 색인을 세우는 것보다 파일시스템을 직접 훑는 편이 대개 낫습니다 — 색인은 낡지만 grep 은 항상 현재 상태를 봅니다.",
    "heading": "파일시스템 검색",
    "level": {
      "none": "검색 도구 없음",
      "partial": "일부만",
      "full": "Grep + Glob"
    },
    "check": {
      "tools": "검색 도구",
      "read": "결과 읽기 가능"
    },
    "yes": "가능",
    "no": "불가",
    "note": "파일 크기로 복잡도를, 이름으로 목적을 추정하며 스스로 탐색하게 두는 것도 점진적 공개와 같은 계열입니다."
  },
  "ja": {
    "level": {
      "partial": "一部のみ",
      "none": "検索ツールなし",
      "full": "Grep と Glob"
    },
    "yes": "はい",
    "no": "いいえ",
    "heading": "ファイル検索（エージェント主導）",
    "check": {
      "tools": "検索ツール",
      "read": "一致箇所を読める"
    },
    "desc": "コードベースでは、索引を立てるよりファイルシステムを直接歩く方が大抵優れています — 索引は古びますが、grep は常に現在の状態を見ます。",
    "note": "ファイルサイズから複雑さを、名前から目的を推し量りながら自分で探索させるのも、段階的開示と同じ系統です。"
  },
  "zh-CN": {
    "level": {
      "partial": "部分",
      "none": "无检索工具",
      "full": "Grep 与 Glob"
    },
    "yes": "是",
    "no": "否",
    "heading": "智能体文件检索",
    "check": {
      "tools": "检索工具",
      "read": "可读取匹配"
    },
    "desc": "在代码库中，直接走文件系统通常胜过建索引 — 索引会过时，而 grep 永远看到当前状态。",
    "note": "让智能体自己探索（从文件大小估复杂度、从名字猜用途）与渐进式披露是同一路数。"
  },
  "es": {
    "level": {
      "partial": "Parcial",
      "none": "Sin herramientas de búsqueda",
      "full": "Grep y Glob"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Búsqueda de archivos por el agente",
    "check": {
      "tools": "Herramientas de búsqueda",
      "read": "Puede leer coincidencias"
    },
    "desc": "En una base de código, recorrer el sistema de archivos suele ganarle a construir un índice — los índices caducan, grep siempre ve el estado actual.",
    "note": "Dejar que el agente explore — estimar complejidad por el tamaño del archivo y propósito por los nombres — es la misma idea que la divulgación progresiva."
  },
  "es-419": {
    "level": {
      "partial": "Parcial",
      "none": "Sin herramientas de búsqueda",
      "full": "Grep y Glob"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Búsqueda de archivos por el agente",
    "check": {
      "tools": "Herramientas de búsqueda",
      "read": "Puede leer coincidencias"
    },
    "desc": "En una base de código, recorrer el sistema de archivos suele ganarle a construir un índice — los índices caducan, grep siempre ve el estado actual.",
    "note": "Dejar que el agente explore — estimar complejidad por el tamaño del archivo y propósito por los nombres — es la misma idea que la divulgación progresiva."
  },
  "fr": {
    "level": {
      "partial": "Partiel",
      "none": "Aucun outil de recherche",
      "full": "Grep et Glob"
    },
    "yes": "oui",
    "no": "non",
    "heading": "Recherche de fichiers par l’agent",
    "check": {
      "tools": "Outils de recherche",
      "read": "Peut lire les correspondances"
    },
    "desc": "Dans une base de code, parcourir le système de fichiers vaut généralement mieux que construire un index — les index vieillissent, grep voit toujours l’état actuel.",
    "note": "Laisser l’agent explorer — estimer la complexité par la taille des fichiers, l’objet par les noms — relève de la même idée que la divulgation progressive."
  },
  "de": {
    "level": {
      "partial": "Teilweise",
      "none": "Keine Suchwerkzeuge",
      "full": "Grep und Glob"
    },
    "yes": "ja",
    "no": "nein",
    "heading": "Agentengesteuerte Dateisuche",
    "check": {
      "tools": "Suchwerkzeuge",
      "read": "Kann Treffer lesen"
    },
    "desc": "In einer Codebasis schlägt das Durchgehen des Dateisystems meist den Aufbau eines Index — Indizes veralten, grep sieht immer den aktuellen Stand.",
    "note": "Den Agenten erkunden zu lassen — Komplexität aus der Dateigröße, Zweck aus Namen zu schätzen — ist dieselbe Idee wie schrittweise Offenlegung."
  },
  "hi": {
    "level": {
      "partial": "आंशिक",
      "none": "कोई खोज टूल नहीं",
      "full": "Grep और Glob"
    },
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "एजेंट फ़ाइल खोज",
    "check": {
      "tools": "खोज टूल",
      "read": "मिलान पढ़ सकता है"
    },
    "desc": "कोडबेस में फ़ाइल-तंत्र टटोलना आम तौर पर सूचकांक बनाने से बेहतर पड़ता है — सूचकांक पुराना पड़ता है, grep हमेशा वर्तमान देखता है।",
    "note": "एजेंट को टोह लेने देना — फ़ाइल के आकार से जटिलता और नाम से उद्देश्य आँकना — क्रमिक उद्घाटन वाला ही विचार है।"
  },
  "id": {
    "level": {
      "partial": "Sebagian",
      "none": "Tanpa alat pencarian",
      "full": "Grep dan Glob"
    },
    "yes": "ya",
    "no": "tidak",
    "heading": "Pencarian berkas oleh agen",
    "check": {
      "tools": "Alat pencarian",
      "read": "Bisa baca hasil"
    },
    "desc": "Di sebuah basis kode, menyusuri sistem berkas biasanya mengalahkan membangun indeks — indeks menua, grep selalu melihat keadaan sekarang.",
    "note": "Membiarkan agen menjelajah — menaksir kerumitan dari ukuran berkas dan tujuan dari namanya — adalah gagasan yang sama dengan pengungkapan bertahap."
  },
  "it": {
    "level": {
      "partial": "Parziale",
      "none": "Nessuno strumento di ricerca",
      "full": "Grep e Glob"
    },
    "yes": "sì",
    "no": "no",
    "heading": "Ricerca file guidata dall’agente",
    "check": {
      "tools": "Strumenti di ricerca",
      "read": "Può leggere le corrispondenze"
    },
    "desc": "In una base di codice, percorrere il filesystem di solito batte costruire un indice — gli indici invecchiano, grep vede sempre lo stato attuale.",
    "note": "Lasciare esplorare l’agente — stimare complessità dalla dimensione dei file e scopo dai nomi — è la stessa idea della divulgazione progressiva."
  },
  "pt-BR": {
    "level": {
      "partial": "Parcial",
      "none": "Sem ferramentas de busca",
      "full": "Grep e Glob"
    },
    "yes": "sim",
    "no": "não",
    "heading": "Busca de arquivos pelo agente",
    "check": {
      "tools": "Ferramentas de busca",
      "read": "Pode ler correspondências"
    },
    "desc": "Numa base de código, percorrer o sistema de arquivos costuma ganhar de construir um índice — índices envelhecem, o grep sempre vê o estado atual.",
    "note": "Deixar o agente explorar — estimar complexidade pelo tamanho do arquivo e propósito pelos nomes — é a mesma ideia da divulgação progressiva."
  }
} as const;
