/**
 * lethal-trifecta — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.lethalTrifecta` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "heading": "Lethal Trifecta",
    "level": {
      "safe": "Path broken",
      "caution": "Gated by approval",
      "critical": "All three open"
    },
    "leg": {
      "data": "Sensitive data access",
      "untrusted": "Untrusted content",
      "egress": "Outbound communication"
    },
    "state": {
      "closed": "cut",
      "gated": "gated",
      "open": "open"
    },
    "noTool": "No tool grants this",
    "prescription": "Outbound communication is the cheapest leg to cut — add WebFetch (and Bash, if this agent can work without it) to Disallowed Tools in Agent Settings.",
    "alreadyCut": "One leg is already cut, so an injection cannot turn into a leak on this agent.",
    "isolatedNote": "Working in an isolated worktree — that narrows the damage, but it does not cut a leg.",
    "displayOnly": "Display only — this section never changes permissions.",
    "title": {
      "critical": "Lethal trifecta: all three legs open, with no approval prompt"
    },
    "isolated": "Runs in an isolated worktree",
    "desc": "Shows on every agent bubble how many of the three legs an attack needs — sensitive data access, untrusted content, outbound communication — that agent currently holds. Cutting one leg breaks the path. Display only: it never changes permissions."
  },
  "ko": {
    "heading": "치명적 3요소",
    "level": {
      "safe": "경로 끊김",
      "caution": "승인이 가로막음",
      "critical": "세 다리 모두 열림"
    },
    "leg": {
      "data": "민감 데이터 접근",
      "untrusted": "미신뢰 콘텐츠",
      "egress": "외부 통신"
    },
    "state": {
      "closed": "끊김",
      "gated": "승인 필요",
      "open": "열림"
    },
    "noTool": "이 다리를 켜는 도구가 없습니다",
    "prescription": "외부 통신이 가장 싸게 끊을 수 있는 다리입니다 — Agent Settings 의 차단 도구에 WebFetch 를 넣고, 이 에이전트가 없이도 되면 Bash 도 함께 넣으십시오.",
    "alreadyCut": "한 다리가 이미 끊겨 있어, 이 에이전트에서는 인젝션이 유출로 이어지지 않습니다.",
    "isolatedNote": "격리된 worktree 에서 작업 중입니다 — 피해 범위는 좁아지지만 다리가 끊긴 것은 아닙니다.",
    "displayOnly": "표시 전용 — 이 섹션은 권한을 바꾸지 않습니다.",
    "title": {
      "critical": "치명적 3요소: 세 다리가 모두 무확인으로 열려 있습니다"
    },
    "isolated": "격리된 worktree 에서 작업 중",
    "desc": "공격이 실제 유출로 이어지려면 필요한 세 다리 — 민감 데이터 접근·미신뢰 콘텐츠·외부 통신 — 중 몇 개를 그 에이전트가 쥐고 있는지 버블마다 보여줍니다. 한 다리만 끊어도 경로가 무너집니다. 표시 전용이라 권한을 바꾸지 않습니다."
  },
  "ja": {
    "heading": "致命的な三要素",
    "level": {
      "safe": "経路が断たれている",
      "caution": "承認が阻んでいる",
      "critical": "三つとも開いている"
    },
    "leg": {
      "data": "機密データへのアクセス",
      "untrusted": "信頼できないコンテンツ",
      "egress": "外部通信"
    },
    "state": {
      "closed": "断",
      "gated": "承認",
      "open": "開"
    },
    "noTool": "これを有効にするツールはありません",
    "prescription": "外部通信が最も安く断てる要素です — Agent Settings の禁止ツールに WebFetch を、必要なければ Bash も追加してください。",
    "alreadyCut": "一つがすでに断たれているため、このエージェントではインジェクションが漏洩につながりません。",
    "isolatedNote": "隔離された worktree で作業中です — 被害範囲は狭まりますが、要素が断たれたわけではありません。",
    "displayOnly": "表示専用 — このセクションは権限を変更しません。",
    "title": {
      "critical": "致命的な三要素: 三つとも承認なしで開いています"
    },
    "isolated": "隔離された worktree で実行中",
    "desc": "攻撃が実際の漏洩に変わるために必要な三つの条件 — 機密データへのアクセス・信頼できないコンテンツ・外部通信 — のうち、そのエージェントがいくつ持っているかをバブルごとに表示します。一つ断ち切れば経路は崩れます。表示専用で、権限は変更しません。"
  },
  "zh-CN": {
    "heading": "致命三要素",
    "level": {
      "safe": "路径已断",
      "caution": "由审批拦截",
      "critical": "三个全开"
    },
    "leg": {
      "data": "敏感数据访问",
      "untrusted": "不可信内容",
      "egress": "对外通信"
    },
    "state": {
      "closed": "已断",
      "gated": "需审批",
      "open": "开放"
    },
    "noTool": "没有工具会开启此项",
    "prescription": "对外通信是最容易切断的一环 — 在 Agent Settings 的禁用工具中加入 WebFetch，若该智能体用不到 Bash 也一并加入。",
    "alreadyCut": "已有一环被切断，因此该智能体上的注入不会变成数据外泄。",
    "isolatedNote": "正在隔离的 worktree 中工作 — 这会缩小影响范围，但并未切断任何一环。",
    "displayOnly": "仅用于显示 — 此区块不会更改权限。",
    "title": {
      "critical": "致命三要素：三个全开，且无需审批"
    },
    "isolated": "在隔离的 worktree 中运行",
    "desc": "在每个智能体气泡上显示：让攻击真正变成数据外泄所需的三个条件 — 敏感数据访问、不可信内容、对外通信 — 该智能体当前占了几个。切断其中一个，攻击路径就断了。仅用于显示，不会更改权限。"
  },
  "es": {
    "heading": "Tríada letal",
    "level": {
      "safe": "Ruta rota",
      "caution": "Frenada por aprobación",
      "critical": "Las tres abiertas"
    },
    "leg": {
      "data": "Acceso a datos sensibles",
      "untrusted": "Contenido no confiable",
      "egress": "Comunicación externa"
    },
    "state": {
      "closed": "cortada",
      "gated": "con aprobación",
      "open": "abierta"
    },
    "noTool": "Ninguna herramienta la habilita",
    "prescription": "La comunicación externa es la pata más barata de cortar: añade WebFetch (y Bash, si este agente puede prescindir de él) a las herramientas bloqueadas en Agent Settings.",
    "alreadyCut": "Ya hay una pata cortada, así que una inyección no puede convertirse en fuga en este agente.",
    "isolatedNote": "Trabaja en un worktree aislado: eso reduce el daño, pero no corta ninguna pata.",
    "displayOnly": "Solo informativo: esta sección nunca cambia permisos.",
    "title": {
      "critical": "Tríada letal: las tres patas abiertas y sin aprobación"
    },
    "isolated": "Se ejecuta en un worktree aislado",
    "desc": "Muestra en cada burbuja de agente cuántas de las tres patas que necesita un ataque — acceso a datos sensibles, contenido no confiable y comunicación externa — tiene ese agente. Cortar una pata rompe la ruta. Solo informativo: nunca cambia permisos."
  },
  "es-419": {
    "heading": "Tríada letal",
    "level": {
      "safe": "Ruta rota",
      "caution": "Frenada por aprobación",
      "critical": "Las tres abiertas"
    },
    "leg": {
      "data": "Acceso a datos sensibles",
      "untrusted": "Contenido no confiable",
      "egress": "Comunicación externa"
    },
    "state": {
      "closed": "cortada",
      "gated": "con aprobación",
      "open": "abierta"
    },
    "noTool": "Ninguna herramienta la habilita",
    "prescription": "La comunicación externa es la pata más barata de cortar: añade WebFetch (y Bash, si este agente puede prescindir de él) a las herramientas bloqueadas en Agent Settings.",
    "alreadyCut": "Ya hay una pata cortada, así que una inyección no puede convertirse en fuga en este agente.",
    "isolatedNote": "Trabaja en un worktree aislado: eso reduce el daño, pero no corta ninguna pata.",
    "displayOnly": "Solo informativo: esta sección nunca cambia permisos.",
    "title": {
      "critical": "Tríada letal: las tres patas abiertas y sin aprobación"
    },
    "isolated": "Se ejecuta en un worktree aislado",
    "desc": "Muestra en cada burbuja de agente cuántas de las tres patas que necesita un ataque — acceso a datos sensibles, contenido no confiable y comunicación externa — tiene ese agente. Cortar una pata rompe la ruta. Solo informativo: nunca cambia permisos."
  },
  "fr": {
    "heading": "Trio fatal",
    "level": {
      "safe": "Chemin rompu",
      "caution": "Bloqué par approbation",
      "critical": "Les trois ouvertes"
    },
    "leg": {
      "data": "Accès aux données sensibles",
      "untrusted": "Contenu non fiable",
      "egress": "Communication sortante"
    },
    "state": {
      "closed": "coupée",
      "gated": "approbation",
      "open": "ouverte"
    },
    "noTool": "Aucun outil ne l’active",
    "prescription": "La communication sortante est la condition la moins coûteuse à couper : ajoutez WebFetch (et Bash si cet agent peut s’en passer) aux outils interdits dans Agent Settings.",
    "alreadyCut": "Une condition est déjà coupée : une injection ne peut donc pas devenir une fuite sur cet agent.",
    "isolatedNote": "Travaille dans un worktree isolé — cela réduit les dégâts, mais ne coupe aucune condition.",
    "displayOnly": "Affichage seul — cette section ne modifie jamais les permissions.",
    "title": {
      "critical": "Trio fatal : les trois conditions ouvertes, sans approbation"
    },
    "isolated": "S’exécute dans un worktree isolé",
    "desc": "Affiche sur chaque bulle d’agent combien des trois conditions nécessaires à une fuite — accès aux données sensibles, contenu non fiable, communication sortante — cet agent réunit. Couper une seule condition brise le chemin. Affichage seul : les permissions ne sont jamais modifiées."
  },
  "de": {
    "heading": "Tödliche Dreierkette",
    "level": {
      "safe": "Pfad gebrochen",
      "caution": "Durch Freigabe gebremst",
      "critical": "Alle drei offen"
    },
    "leg": {
      "data": "Zugriff auf sensible Daten",
      "untrusted": "Nicht vertrauenswürdige Inhalte",
      "egress": "Ausgehende Kommunikation"
    },
    "state": {
      "closed": "gekappt",
      "gated": "Freigabe",
      "open": "offen"
    },
    "noTool": "Kein Werkzeug schaltet das frei",
    "prescription": "Ausgehende Kommunikation lässt sich am günstigsten kappen — tragen Sie WebFetch (und Bash, falls dieser Agent ohne auskommt) in Agent Settings unter den verbotenen Werkzeugen ein.",
    "alreadyCut": "Eine Bedingung ist bereits gekappt, daher kann eine Injection bei diesem Agenten nicht zum Abfluss werden.",
    "isolatedNote": "Arbeitet in einem isolierten Worktree — das verkleinert den Schaden, kappt aber keine Bedingung.",
    "displayOnly": "Nur Anzeige — dieser Abschnitt ändert keine Berechtigungen.",
    "title": {
      "critical": "Tödliche Dreierkette: alle drei offen, ohne Freigabe"
    },
    "isolated": "Läuft in einem isolierten Worktree",
    "desc": "Zeigt an jeder Agent-Blase, wie viele der drei Bedingungen für einen echten Datenabfluss — Zugriff auf sensible Daten, nicht vertrauenswürdige Inhalte, ausgehende Kommunikation — dieser Agent gerade erfüllt. Eine gekappte Bedingung bricht den Pfad. Nur Anzeige: Berechtigungen werden nie verändert."
  },
  "hi": {
    "heading": "घातक त्रयी",
    "level": {
      "safe": "रास्ता टूटा",
      "caution": "स्वीकृति से रुका",
      "critical": "तीनों खुली"
    },
    "leg": {
      "data": "संवेदनशील डेटा पहुँच",
      "untrusted": "अविश्वसनीय सामग्री",
      "egress": "बाहरी संचार"
    },
    "state": {
      "closed": "कटी",
      "gated": "स्वीकृति",
      "open": "खुली"
    },
    "noTool": "कोई टूल इसे सक्षम नहीं करता",
    "prescription": "बाहरी संचार सबसे सस्ती कड़ी है — Agent Settings में प्रतिबंधित टूल्स में WebFetch जोड़ें, और यदि यह एजेंट बिना काम चला ले तो Bash भी।",
    "alreadyCut": "एक कड़ी पहले ही कटी है, इसलिए इस एजेंट पर इंजेक्शन रिसाव नहीं बन सकता।",
    "isolatedNote": "अलग worktree में काम कर रहा है — इससे नुकसान सिमटता है, पर कोई कड़ी कटती नहीं।",
    "displayOnly": "केवल प्रदर्शन — यह अनुभाग अनुमतियाँ नहीं बदलता।",
    "title": {
      "critical": "घातक त्रयी: तीनों कड़ियाँ बिना स्वीकृति के खुली हैं"
    },
    "isolated": "अलग worktree में चल रहा है",
    "desc": "हर एजेंट बबल पर दिखाता है कि रिसाव के लिए ज़रूरी तीन शर्तों — संवेदनशील डेटा पहुँच, अविश्वसनीय सामग्री, बाहरी संचार — में से कितनी इस एजेंट के पास हैं। एक भी शर्त काटने पर रास्ता टूट जाता है। केवल प्रदर्शन: यह अनुमतियाँ नहीं बदलता।"
  },
  "id": {
    "heading": "Trifecta mematikan",
    "level": {
      "safe": "Jalur terputus",
      "caution": "Ditahan persetujuan",
      "critical": "Ketiganya terbuka"
    },
    "leg": {
      "data": "Akses data sensitif",
      "untrusted": "Konten tak tepercaya",
      "egress": "Komunikasi keluar"
    },
    "state": {
      "closed": "putus",
      "gated": "persetujuan",
      "open": "terbuka"
    },
    "noTool": "Tidak ada alat yang mengaktifkannya",
    "prescription": "Komunikasi keluar adalah kaki termurah untuk diputus — tambahkan WebFetch (dan Bash bila agen ini tidak memerlukannya) ke alat yang dilarang di Agent Settings.",
    "alreadyCut": "Satu kaki sudah terputus, jadi injeksi tidak bisa menjadi kebocoran pada agen ini.",
    "isolatedNote": "Bekerja di worktree terisolasi — ini mempersempit dampak, tetapi tidak memutus kaki mana pun.",
    "displayOnly": "Hanya tampilan — bagian ini tidak pernah mengubah izin.",
    "title": {
      "critical": "Trifecta mematikan: ketiga kaki terbuka tanpa persetujuan"
    },
    "isolated": "Berjalan di worktree terisolasi",
    "desc": "Menampilkan pada setiap bubble agen berapa dari tiga syarat kebocoran — akses data sensitif, konten tak tepercaya, komunikasi keluar — yang dipegang agen itu. Memutus satu syarat sudah mematahkan jalurnya. Hanya tampilan: tidak pernah mengubah izin."
  },
  "it": {
    "heading": "Trifecta letale",
    "level": {
      "safe": "Percorso spezzato",
      "caution": "Trattenuto dall’approvazione",
      "critical": "Tutte e tre aperte"
    },
    "leg": {
      "data": "Accesso a dati sensibili",
      "untrusted": "Contenuti non affidabili",
      "egress": "Comunicazione esterna"
    },
    "state": {
      "closed": "tagliata",
      "gated": "approvazione",
      "open": "aperta"
    },
    "noTool": "Nessuno strumento la attiva",
    "prescription": "La comunicazione esterna è la condizione più economica da tagliare: aggiungi WebFetch (e Bash, se questo agente può farne a meno) agli strumenti vietati in Agent Settings.",
    "alreadyCut": "Una condizione è già tagliata, quindi su questo agente un’injection non può diventare una fuga di dati.",
    "isolatedNote": "Lavora in un worktree isolato — riduce i danni, ma non taglia alcuna condizione.",
    "displayOnly": "Solo visualizzazione — questa sezione non modifica i permessi.",
    "title": {
      "critical": "Trifecta letale: tutte e tre aperte, senza approvazione"
    },
    "isolated": "Gira in un worktree isolato",
    "desc": "Mostra su ogni bolla agente quante delle tre condizioni necessarie a una fuga di dati — accesso a dati sensibili, contenuti non affidabili, comunicazione verso l’esterno — quell’agente possiede. Tagliarne una spezza il percorso. Solo visualizzazione: non modifica mai i permessi."
  },
  "pt-BR": {
    "heading": "Trifeta letal",
    "level": {
      "safe": "Caminho quebrado",
      "caution": "Segurado pela aprovação",
      "critical": "As três abertas"
    },
    "leg": {
      "data": "Acesso a dados sensíveis",
      "untrusted": "Conteúdo não confiável",
      "egress": "Comunicação externa"
    },
    "state": {
      "closed": "cortada",
      "gated": "aprovação",
      "open": "aberta"
    },
    "noTool": "Nenhuma ferramenta habilita isso",
    "prescription": "A comunicação externa é a perna mais barata de cortar — adicione WebFetch (e Bash, se este agente puder viver sem) às ferramentas bloqueadas em Agent Settings.",
    "alreadyCut": "Uma perna já está cortada, então uma injeção não vira vazamento neste agente.",
    "isolatedNote": "Trabalha em um worktree isolado — isso reduz o estrago, mas não corta nenhuma perna.",
    "displayOnly": "Apenas exibição — esta seção nunca altera permissões.",
    "title": {
      "critical": "Trifeta letal: as três pernas abertas, sem aprovação"
    },
    "isolated": "Executa em um worktree isolado",
    "desc": "Mostra em cada bolha de agente quantas das três condições necessárias para um vazamento — acesso a dados sensíveis, conteúdo não confiável e comunicação externa — aquele agente reúne. Cortar uma delas quebra o caminho. Apenas exibição: nunca altera permissões."
  }
} as const;
