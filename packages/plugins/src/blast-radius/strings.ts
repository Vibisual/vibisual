/**
 * blast-radius — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.blastRadius` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Lists what this agent could reach, change and send if it were fully taken over — that list is the blast radius. An isolated worktree narrows it by one step.",
    "heading": "Blast Radius",
    "level": {
      "small": "Small",
      "medium": "Medium",
      "large": "Large"
    },
    "row": {
      "read": "Can read project files",
      "write": "Can change files",
      "execute": "Can run commands",
      "send": "Can send data out"
    },
    "isolatedNote": "Isolated worktree — damage stays in the copy, so the radius counts one step smaller.",
    "narrowHint": "Read-only by default, writes to named paths only, network to an allowed list — that is how a radius shrinks.",
    "yes": "Yes",
    "no": "No"
  },
  "ko": {
    "desc": "이 에이전트가 완전히 장악되면 무엇에 닿고, 무엇을 바꾸고, 어디로 보낼 수 있는지를 열거합니다 — 그 목록이 곧 폭발 반경입니다. 격리된 worktree 는 반경을 한 단계 좁힙니다.",
    "heading": "폭발 반경",
    "level": {
      "small": "작음",
      "medium": "중간",
      "large": "큼"
    },
    "row": {
      "read": "프로젝트 파일 읽기",
      "write": "파일 변경",
      "execute": "명령 실행",
      "send": "데이터 외부 전송"
    },
    "isolatedNote": "격리된 worktree 라 피해가 사본 안에 머뭅니다 — 반경을 한 단계 작게 셉니다.",
    "narrowHint": "읽기 전용을 기본으로, 쓰기는 지정 경로만, 네트워크는 허용 목록만 — 반경은 그렇게 좁아집니다.",
    "yes": "예",
    "no": "아니오"
  },
  "ja": {
    "desc": "このエージェントが完全に乗っ取られた場合に何へ到達し、何を変え、どこへ送れるかを列挙します — それが爆発半径です。隔離された worktree は半径を一段狭めます。",
    "heading": "爆発半径",
    "level": {
      "small": "小さい",
      "medium": "中程度",
      "large": "大きい"
    },
    "row": {
      "read": "プロジェクトファイルの読み取り",
      "write": "ファイルの変更",
      "execute": "コマンドの実行",
      "send": "外部へのデータ送信"
    },
    "isolatedNote": "隔離された worktree のため被害は複製内にとどまります — 半径を一段小さく数えます。",
    "narrowHint": "読み取り専用を既定に、書き込みは指定パスのみ、ネットワークは許可リストのみ — 半径はそうして狭まります。",
    "yes": "はい",
    "no": "いいえ"
  },
  "zh-CN": {
    "desc": "列出该智能体若被完全接管，能触及什么、改动什么、发送到哪里 — 这份清单就是爆炸半径。隔离的 worktree 会将半径收窄一级。",
    "heading": "爆炸半径",
    "level": {
      "small": "较小",
      "medium": "中等",
      "large": "较大"
    },
    "row": {
      "read": "读取项目文件",
      "write": "修改文件",
      "execute": "执行命令",
      "send": "向外发送数据"
    },
    "isolatedNote": "隔离的 worktree，损害留在副本内 — 半径按低一级计算。",
    "narrowHint": "默认只读、写入仅限指定路径、网络仅限允许列表 — 半径就是这样收窄的。",
    "yes": "是",
    "no": "否"
  },
  "es": {
    "desc": "Enumera a qué podría acceder, qué cambiaría y adónde enviaría este agente si fuera tomado por completo: esa lista es el radio de explosión. Un worktree aislado lo reduce un nivel.",
    "heading": "Radio de explosión",
    "level": {
      "small": "Pequeño",
      "medium": "Medio",
      "large": "Grande"
    },
    "row": {
      "read": "Puede leer archivos",
      "write": "Puede cambiar archivos",
      "execute": "Puede ejecutar comandos",
      "send": "Puede enviar datos fuera"
    },
    "isolatedNote": "Worktree aislado: el daño se queda en la copia, así que el radio cuenta un nivel menos.",
    "narrowHint": "Solo lectura por defecto, escritura solo en rutas indicadas, red solo a una lista permitida: así se reduce el radio.",
    "yes": "Sí",
    "no": "No"
  },
  "es-419": {
    "desc": "Enumera a qué podría acceder, qué cambiaría y adónde enviaría este agente si fuera tomado por completo: esa lista es el radio de explosión. Un worktree aislado lo reduce un nivel.",
    "heading": "Radio de explosión",
    "level": {
      "small": "Pequeño",
      "medium": "Medio",
      "large": "Grande"
    },
    "row": {
      "read": "Puede leer archivos",
      "write": "Puede cambiar archivos",
      "execute": "Puede ejecutar comandos",
      "send": "Puede enviar datos fuera"
    },
    "isolatedNote": "Worktree aislado: el daño se queda en la copia, así que el radio cuenta un nivel menos.",
    "narrowHint": "Solo lectura por defecto, escritura solo en rutas indicadas, red solo a una lista permitida: así se reduce el radio.",
    "yes": "Sí",
    "no": "No"
  },
  "fr": {
    "desc": "Énumère ce que cet agent pourrait atteindre, modifier et envoyer s’il était entièrement compromis — cette liste est le rayon d’explosion. Un worktree isolé le réduit d’un cran.",
    "heading": "Rayon d’explosion",
    "level": {
      "small": "Petit",
      "medium": "Moyen",
      "large": "Grand"
    },
    "row": {
      "read": "Peut lire les fichiers",
      "write": "Peut modifier les fichiers",
      "execute": "Peut exécuter des commandes",
      "send": "Peut envoyer des données"
    },
    "isolatedNote": "Worktree isolé : les dégâts restent dans la copie, le rayon compte donc un cran de moins.",
    "narrowHint": "Lecture seule par défaut, écriture sur des chemins désignés, réseau limité à une liste — c’est ainsi qu’un rayon rétrécit.",
    "yes": "Oui",
    "no": "Non"
  },
  "de": {
    "desc": "Listet auf, worauf dieser Agent zugreifen, was er ändern und wohin er senden könnte, wenn er vollständig übernommen wäre — diese Liste ist der Explosionsradius. Ein isolierter Worktree verkleinert ihn um eine Stufe.",
    "heading": "Explosionsradius",
    "level": {
      "small": "Klein",
      "medium": "Mittel",
      "large": "Groß"
    },
    "row": {
      "read": "Kann Dateien lesen",
      "write": "Kann Dateien ändern",
      "execute": "Kann Befehle ausführen",
      "send": "Kann Daten senden"
    },
    "isolatedNote": "Isolierter Worktree — der Schaden bleibt in der Kopie, daher zählt der Radius eine Stufe kleiner.",
    "narrowHint": "Standardmäßig nur Lesen, Schreiben nur auf benannte Pfade, Netzwerk nur auf eine Erlaubnisliste — so schrumpft ein Radius.",
    "yes": "Ja",
    "no": "Nein"
  },
  "hi": {
    "desc": "यह सूचीबद्ध करता है कि यदि यह एजेंट पूरी तरह अधिकृत हो जाए तो वह क्या पहुँच सकता, बदल सकता और भेज सकता है — वही ब्लास्ट रेडियस है। अलग worktree इसे एक स्तर घटाता है।",
    "heading": "ब्लास्ट रेडियस",
    "level": {
      "small": "छोटा",
      "medium": "मध्यम",
      "large": "बड़ा"
    },
    "row": {
      "read": "फ़ाइलें पढ़ सकता है",
      "write": "फ़ाइलें बदल सकता है",
      "execute": "कमांड चला सकता है",
      "send": "डेटा बाहर भेज सकता है"
    },
    "isolatedNote": "अलग worktree — नुकसान प्रति में ही रहता है, इसलिए रेडियस एक स्तर कम गिना जाता है।",
    "narrowHint": "डिफ़ॉल्ट रूप से केवल पढ़ना, लिखना केवल निर्दिष्ट पथों पर, नेटवर्क केवल अनुमत सूची — इसी तरह रेडियस घटता है।",
    "yes": "हाँ",
    "no": "नहीं"
  },
  "id": {
    "desc": "Mendaftar apa yang bisa dijangkau, diubah, dan dikirim agen ini bila sepenuhnya dikuasai — daftar itulah radius ledaknya. Worktree terisolasi mempersempitnya satu tingkat.",
    "heading": "Radius ledak",
    "level": {
      "small": "Kecil",
      "medium": "Sedang",
      "large": "Besar"
    },
    "row": {
      "read": "Bisa membaca berkas",
      "write": "Bisa mengubah berkas",
      "execute": "Bisa menjalankan perintah",
      "send": "Bisa mengirim data keluar"
    },
    "isolatedNote": "Worktree terisolasi — kerusakan tetap di salinan, jadi radius dihitung satu tingkat lebih kecil.",
    "narrowHint": "Baca-saja sebagai default, tulis hanya ke jalur tertentu, jaringan hanya ke daftar izin — begitulah radius mengecil.",
    "yes": "Ya",
    "no": "Tidak"
  },
  "it": {
    "desc": "Elenca cosa questo agente potrebbe raggiungere, modificare e inviare se fosse completamente compromesso: quell’elenco è il raggio d’esplosione. Un worktree isolato lo riduce di un livello.",
    "heading": "Raggio d’esplosione",
    "level": {
      "small": "Piccolo",
      "medium": "Medio",
      "large": "Grande"
    },
    "row": {
      "read": "Può leggere i file",
      "write": "Può modificare i file",
      "execute": "Può eseguire comandi",
      "send": "Può inviare dati fuori"
    },
    "isolatedNote": "Worktree isolato: il danno resta nella copia, quindi il raggio conta un livello in meno.",
    "narrowHint": "Sola lettura come default, scrittura solo su percorsi indicati, rete solo verso una lista consentita: così si riduce il raggio.",
    "yes": "Sì",
    "no": "No"
  },
  "pt-BR": {
    "desc": "Lista o que este agente poderia alcançar, alterar e enviar se fosse totalmente dominado — essa lista é o raio de explosão. Um worktree isolado o reduz em um nível.",
    "heading": "Raio de explosão",
    "level": {
      "small": "Pequeno",
      "medium": "Médio",
      "large": "Grande"
    },
    "row": {
      "read": "Pode ler arquivos",
      "write": "Pode alterar arquivos",
      "execute": "Pode executar comandos",
      "send": "Pode enviar dados para fora"
    },
    "isolatedNote": "Worktree isolado — o dano fica na cópia, então o raio conta um nível a menos.",
    "narrowHint": "Somente leitura por padrão, escrita apenas em caminhos indicados, rede só para uma lista permitida — é assim que o raio encolhe.",
    "yes": "Sim",
    "no": "Não"
  }
} as const;
