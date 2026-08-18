/**
 * memory-tool — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.memoryTool` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Separates memory that was pushed in at spawn from memory the agent went and looked up. Notes in files survive compaction, which is what makes this the lightest form of lasting memory.",
    "heading": "Memory Tool",
    "level": {
      "unused": "Not used",
      "pushed": "Pushed in only",
      "active": "Actively searched"
    },
    "check": {
      "spawn": "At spawn",
      "file": "On file access",
      "search": "Searched"
    },
    "note": "Try file-based notes before standing up separate vector infrastructure — the overhead is close to none."
  },
  "ko": {
    "desc": "스폰 때 밀어넣은 기억과, 에이전트가 직접 찾아 쓴 기억을 나눠 봅니다. 파일에 적어 둔 메모는 컴팩션에도 살아남는다는 점이 이 방식의 결정적 성질입니다.",
    "heading": "기억 도구",
    "level": {
      "unused": "쓰지 않음",
      "pushed": "밀어넣기만",
      "active": "능동 검색함"
    },
    "check": {
      "spawn": "스폰 시",
      "file": "파일 접근 시",
      "search": "능동 검색"
    },
    "note": "별도 벡터 인프라를 세우기 전에 파일 메모부터 해 보는 것이 권장 순서입니다 — 오버헤드가 거의 없습니다."
  },
  "ja": {
    "level": {
      "pushed": "押し込みのみ",
      "active": "能動的に検索",
      "unused": "未使用"
    },
    "heading": "記憶ツール",
    "check": {
      "spawn": "起動時",
      "file": "ファイル参照時",
      "search": "検索による取得"
    },
    "desc": "起動時に押し込まれた記憶と、エージェントが自分で探しに行った記憶を分けます。ファイルに書いたメモはコンパクションでも生き残る、というのがこの方式の決定的な性質です。",
    "note": "別途ベクトル基盤を立てる前に、ファイルのメモから試すのが推奨される順序です — 追加コストがほとんどありません。"
  },
  "zh-CN": {
    "level": {
      "pushed": "仅推送",
      "active": "主动检索",
      "unused": "未使用"
    },
    "heading": "记忆工具",
    "check": {
      "spawn": "启动时",
      "file": "访问文件时",
      "search": "主动检索"
    },
    "desc": "把启动时推送进来的记忆，与智能体自己去查找的记忆区分开。写在文件里的笔记能在压缩后存活，这正是该方式的决定性性质。",
    "note": "在搭建独立的向量基础设施之前，先试试基于文件的笔记 — 额外开销几乎为零。"
  },
  "es": {
    "level": {
      "pushed": "Solo empujado",
      "active": "Búsqueda activa",
      "unused": "Sin usar"
    },
    "heading": "Herramienta de memoria",
    "check": {
      "spawn": "Al iniciar",
      "file": "Al acceder a archivos",
      "search": "Buscadas"
    },
    "desc": "Separa la memoria empujada al arrancar de la que el agente fue a buscar. Las notas en archivos sobreviven a la compactación, y eso hace de esto la forma más ligera de memoria duradera.",
    "note": "Prueba las notas en archivos antes de montar infraestructura vectorial aparte — el sobrecoste es casi nulo."
  },
  "es-419": {
    "level": {
      "pushed": "Solo empujado",
      "active": "Búsqueda activa",
      "unused": "Sin usar"
    },
    "heading": "Herramienta de memoria",
    "check": {
      "spawn": "Al iniciar",
      "file": "Al acceder a archivos",
      "search": "Buscadas"
    },
    "desc": "Separa la memoria empujada al arrancar de la que el agente fue a buscar. Las notas en archivos sobreviven a la compactación, y eso hace de esto la forma más ligera de memoria duradera.",
    "note": "Prueba las notas en archivos antes de montar infraestructura vectorial aparte — el sobrecoste es casi nulo."
  },
  "fr": {
    "level": {
      "pushed": "Poussé seulement",
      "active": "Recherche active",
      "unused": "Non utilisé"
    },
    "heading": "Outil de mémoire",
    "check": {
      "spawn": "Au démarrage",
      "file": "À l’accès fichier",
      "search": "Recherchées"
    },
    "desc": "Sépare la mémoire poussée au démarrage de celle que l’agent est allé chercher. Les notes en fichiers survivent à la compaction, ce qui en fait la forme la plus légère de mémoire durable.",
    "note": "Essayez les notes en fichiers avant de monter une infrastructure vectorielle dédiée — le surcoût est quasi nul."
  },
  "de": {
    "level": {
      "pushed": "Nur eingeschoben",
      "active": "Aktiv gesucht",
      "unused": "Nicht genutzt"
    },
    "heading": "Gedächtnis-Werkzeug",
    "check": {
      "spawn": "Beim Start",
      "file": "Bei Dateizugriff",
      "search": "Gesucht"
    },
    "desc": "Trennt Gedächtnis, das beim Start eingeschoben wurde, von Gedächtnis, das der Agent selbst gesucht hat. Notizen in Dateien überleben die Kompaktierung — das macht dies zur leichtesten Form dauerhaften Gedächtnisses.",
    "note": "Probieren Sie dateibasierte Notizen, bevor Sie eigene Vektor-Infrastruktur aufbauen — der Zusatzaufwand ist nahezu null."
  },
  "hi": {
    "level": {
      "pushed": "केवल धकेला गया",
      "active": "सक्रिय खोज",
      "unused": "उपयोग नहीं"
    },
    "heading": "स्मृति टूल",
    "check": {
      "spawn": "शुरुआत पर",
      "file": "फ़ाइल पहुँच पर",
      "search": "खोजा गया"
    },
    "desc": "शुरुआत में धकेली गई स्मृति और एजेंट द्वारा ख़ुद खोजी गई स्मृति को अलग करता है। फ़ाइल में लिखे नोट संपीड़न के पार बचते हैं, और यही उन्हें टिकाऊ स्मृति का सबसे हल्का रूप बनाता है।",
    "note": "अलग वेक्टर-ढाँचा बनाने से पहले फ़ाइल-आधारित नोट आज़माइए — उनकी अतिरिक्त लागत लगभग शून्य है।"
  },
  "id": {
    "level": {
      "pushed": "Hanya didorong",
      "active": "Dicari aktif",
      "unused": "Tidak dipakai"
    },
    "heading": "Alat memori",
    "check": {
      "spawn": "Saat mulai",
      "file": "Saat akses berkas",
      "search": "Dicari"
    },
    "desc": "Memisahkan memori yang didorong saat mulai dari memori yang dicari sendiri oleh agen. Catatan dalam berkas bertahan melewati pemadatan, dan itulah yang menjadikannya bentuk memori bertahan paling ringan.",
    "note": "Cobalah catatan berbasis berkas sebelum membangun infrastruktur vektor terpisah — biaya tambahannya nyaris nol."
  },
  "it": {
    "level": {
      "pushed": "Solo spinto",
      "active": "Ricerca attiva",
      "unused": "Non usato"
    },
    "heading": "Strumento di memoria",
    "check": {
      "spawn": "All’avvio",
      "file": "All’accesso ai file",
      "search": "Cercate"
    },
    "desc": "Separa la memoria spinta all’avvio da quella che l’agente è andato a cercare. Le note su file sopravvivono alla compattazione, ed è questo a farne la forma più leggera di memoria duratura.",
    "note": "Prova le note su file prima di montare un’infrastruttura vettoriale a parte — il costo aggiuntivo è quasi nullo."
  },
  "pt-BR": {
    "level": {
      "pushed": "Apenas empurrado",
      "active": "Busca ativa",
      "unused": "Não usado"
    },
    "heading": "Ferramenta de memória",
    "check": {
      "spawn": "Ao iniciar",
      "file": "Ao acessar arquivos",
      "search": "Buscadas"
    },
    "desc": "Separa a memória empurrada na largada da que o agente foi buscar. Notas em arquivos sobrevivem à compactação, e é isso que faz desta a forma mais leve de memória duradoura.",
    "note": "Experimente notas em arquivos antes de montar infraestrutura vetorial à parte — o custo extra é quase nulo."
  }
} as const;
