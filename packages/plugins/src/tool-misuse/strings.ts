/**
 * tool-misuse — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.toolMisuse` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Scans the commands this agent actually ran for irreversible shapes. No intrusion is needed for misuse — the authority is already granted, which is why granting itself is part of the attack surface.",
    "heading": "Tool Misuse",
    "level": {
      "noCommands": "Nothing run yet",
      "clean": "Nothing flagged",
      "found": "Flagged commands"
    },
    "check": {
      "commands": "Commands run",
      "hits": "Flagged",
      "last": "Most recent"
    },
    "kind": {
      "destructive": "irreversible delete",
      "forcePush": "force push",
      "remoteExec": "remote code executed",
      "permission": "permissions opened",
      "historyRewrite": "history rewritten"
    },
    "note": "Giving one shell tool and giving five named commands are completely different risk grades. Arguments need validation too, not just the tool list.",
    "noteFound": "These already ran — this card reports, it does not block. The place that blocks is the approval prompt in front of the tool call."
  },
  "ko": {
    "desc": "이 에이전트가 실제로 실행한 명령에서 되돌릴 수 없는 형태를 찾습니다. 오·남용에는 침입이 필요 없습니다 — 권한은 이미 주어져 있고, 그래서 권한 부여 자체가 공격면이 됩니다.",
    "heading": "도구 오·남용",
    "level": {
      "noCommands": "아직 실행 없음",
      "clean": "걸린 것 없음",
      "found": "걸린 명령 있음"
    },
    "check": {
      "commands": "실행한 명령",
      "hits": "걸린 것",
      "last": "가장 최근"
    },
    "kind": {
      "destructive": "되돌릴 수 없는 삭제",
      "forcePush": "강제 푸시",
      "remoteExec": "원격 코드 실행",
      "permission": "권한 전면 개방",
      "historyRewrite": "이력 재작성"
    },
    "note": "\"쉘 실행\" 하나를 주는 것과 \"정해진 명령 5개\"를 주는 것은 완전히 다른 위험 등급입니다. 도구 목록뿐 아니라 인자에도 검증이 필요합니다.",
    "noteFound": "이미 실행된 것들입니다 — 이 카드는 알릴 뿐 막지 않습니다. 막는 자리는 도구 호출 직전의 승인 팝업입니다."
  },
  "ja": {
    "level": {
      "noCommands": "まだ実行なし",
      "clean": "指摘なし",
      "found": "該当コマンドあり"
    },
    "check": {
      "commands": "実行コマンド数",
      "last": "最新",
      "hits": "該当"
    },
    "heading": "ツールの誤用",
    "kind": {
      "destructive": "取り消せない削除",
      "forcePush": "強制プッシュ",
      "remoteExec": "外部コードを実行",
      "permission": "権限を開放",
      "historyRewrite": "履歴の書き換え"
    },
    "desc": "このエージェントが実際に実行したコマンドから、取り消せない形を探します。誤用に侵入は要りません — 権限はすでに与えられており、だからこそ権限付与そのものが攻撃面になります。",
    "note": "「シェル実行」を一つ渡すことと「決められたコマンド 5 つ」を渡すことは、まったく違う危険等級です。ツール一覧だけでなく引数にも検証が要ります。",
    "noteFound": "すでに実行されたものです — このカードは知らせるだけで止めません。止める場所はツール呼び出し直前の承認ダイアログです。"
  },
  "zh-CN": {
    "level": {
      "noCommands": "尚未执行",
      "clean": "无标记",
      "found": "存在可疑命令"
    },
    "check": {
      "commands": "已执行命令",
      "last": "最近一次",
      "hits": "已标记"
    },
    "heading": "工具滥用",
    "kind": {
      "destructive": "不可逆删除",
      "forcePush": "强制推送",
      "remoteExec": "执行了远程代码",
      "permission": "权限被放开",
      "historyRewrite": "重写历史"
    },
    "desc": "扫描这个智能体实际执行过的命令，找出不可逆的形态。滥用并不需要入侵 — 权限本来就已经给了，所以授权本身就是攻击面的一部分。",
    "note": "给一个「shell 执行」和给「指定的五条命令」，是完全不同的风险等级。不只是工具清单，参数同样需要校验。",
    "noteFound": "这些已经执行过了 — 这张卡片只是告知，并不拦截。拦截的地方是工具调用之前的审批提示。"
  },
  "es": {
    "level": {
      "noCommands": "Nada ejecutado aún",
      "clean": "Nada marcado",
      "found": "Comandos marcados"
    },
    "check": {
      "commands": "Comandos ejecutados",
      "last": "Más reciente",
      "hits": "Marcadas"
    },
    "heading": "Uso indebido de herramientas",
    "kind": {
      "destructive": "borrado irreversible",
      "forcePush": "push forzado",
      "remoteExec": "código remoto ejecutado",
      "permission": "permisos abiertos",
      "historyRewrite": "historial reescrito"
    },
    "desc": "Recorre los comandos que este agente ejecutó de verdad buscando formas irreversibles. El uso indebido no requiere intrusión — la autoridad ya está concedida, y por eso concederla forma parte de la superficie de ataque.",
    "note": "Dar una herramienta de shell y dar cinco comandos concretos son grados de riesgo completamente distintos. Los argumentos también necesitan validación, no solo la lista de herramientas.",
    "noteFound": "Estos ya se ejecutaron — esta tarjeta informa, no bloquea. Lo que bloquea es la solicitud de aprobación delante de la llamada."
  },
  "es-419": {
    "level": {
      "noCommands": "Nada ejecutado aún",
      "clean": "Nada marcado",
      "found": "Comandos marcados"
    },
    "check": {
      "commands": "Comandos ejecutados",
      "last": "Más reciente",
      "hits": "Marcadas"
    },
    "heading": "Uso indebido de herramientas",
    "kind": {
      "destructive": "borrado irreversible",
      "forcePush": "push forzado",
      "remoteExec": "código remoto ejecutado",
      "permission": "permisos abiertos",
      "historyRewrite": "historial reescrito"
    },
    "desc": "Recorre los comandos que este agente ejecutó de verdad buscando formas irreversibles. El uso indebido no requiere intrusión — la autoridad ya está concedida, y por eso concederla forma parte de la superficie de ataque.",
    "note": "Dar una herramienta de shell y dar cinco comandos concretos son grados de riesgo completamente distintos. Los argumentos también necesitan validación, no solo la lista de herramientas.",
    "noteFound": "Estos ya se ejecutaron — esta tarjeta informa, no bloquea. Lo que bloquea es la solicitud de aprobación delante de la llamada."
  },
  "fr": {
    "level": {
      "noCommands": "Rien d’exécuté",
      "clean": "Rien de signalé",
      "found": "Commandes signalées"
    },
    "check": {
      "commands": "Commandes exécutées",
      "last": "Le plus récent",
      "hits": "Signalées"
    },
    "heading": "Mésusage des outils",
    "kind": {
      "destructive": "suppression irréversible",
      "forcePush": "push forcé",
      "remoteExec": "code distant exécuté",
      "permission": "permissions ouvertes",
      "historyRewrite": "historique réécrit"
    },
    "desc": "Parcourt les commandes réellement exécutées par cet agent à la recherche de formes irréversibles. Le mésusage n’exige aucune intrusion — l’autorité est déjà accordée, et c’est pourquoi l’octroi lui-même fait partie de la surface d’attaque.",
    "note": "Donner un outil shell et donner cinq commandes nommées sont deux classes de risque totalement différentes. Les arguments aussi demandent une validation, pas seulement la liste d’outils.",
    "noteFound": "Celles-ci ont déjà tourné — cette carte signale, elle ne bloque pas. Ce qui bloque, c’est la demande d’approbation devant l’appel d’outil."
  },
  "de": {
    "level": {
      "noCommands": "Noch nichts ausgeführt",
      "clean": "Nichts markiert",
      "found": "Markierte Befehle"
    },
    "check": {
      "commands": "Ausgeführte Befehle",
      "last": "Zuletzt",
      "hits": "Markiert"
    },
    "heading": "Werkzeug-Missbrauch",
    "kind": {
      "destructive": "unumkehrbares Löschen",
      "forcePush": "Force-Push",
      "remoteExec": "Fremdcode ausgeführt",
      "permission": "Berechtigungen geöffnet",
      "historyRewrite": "Verlauf umgeschrieben"
    },
    "desc": "Durchsucht die tatsächlich ausgeführten Befehle dieses Agenten nach unumkehrbaren Formen. Für Missbrauch braucht es keinen Einbruch — die Befugnis ist bereits erteilt, weshalb das Erteilen selbst Teil der Angriffsfläche ist.",
    "note": "Ein Shell-Werkzeug zu geben und fünf benannte Befehle zu geben sind völlig verschiedene Risikoklassen. Auch Argumente brauchen Prüfung, nicht nur die Werkzeugliste.",
    "noteFound": "Diese liefen bereits — diese Karte meldet, sie blockiert nicht. Blockiert wird an der Freigabeabfrage vor dem Werkzeugaufruf."
  },
  "hi": {
    "level": {
      "noCommands": "अभी कुछ नहीं चला",
      "clean": "कुछ चिह्नित नहीं",
      "found": "चिह्नित कमांड"
    },
    "check": {
      "commands": "चले कमांड",
      "last": "सबसे हाल का",
      "hits": "चिह्नित"
    },
    "heading": "टूल दुरुपयोग",
    "kind": {
      "destructive": "अपरिवर्तनीय विलोपन",
      "forcePush": "फोर्स पुश",
      "remoteExec": "रिमोट कोड चला",
      "permission": "अनुमतियाँ खोली",
      "historyRewrite": "इतिहास पुनर्लेखित"
    },
    "desc": "इस एजेंट ने जो आदेश सचमुच चलाए, उन्हें न पलटी जा सकने वाली शक्लों के लिए छानता है। दुरुपयोग के लिए सेंध ज़रूरी नहीं — अधिकार पहले ही दिया जा चुका है, और इसीलिए वह देना ही हमले की सतह का हिस्सा है।",
    "note": "एक shell टूल देना और पाँच तय आदेश देना बिलकुल अलग जोखिम-श्रेणियाँ हैं। केवल टूल-सूची नहीं, तर्कों की भी जाँच चाहिए।",
    "noteFound": "ये चल चुके हैं — यह कार्ड रिपोर्ट करता है, रोकता नहीं। रोकने का काम टूल-कॉल के आगे बैठी अनुमति-माँग करती है।"
  },
  "id": {
    "level": {
      "noCommands": "Belum ada yang dijalankan",
      "clean": "Tidak ada tanda",
      "found": "Perintah ditandai"
    },
    "check": {
      "commands": "Perintah dijalankan",
      "last": "Terbaru",
      "hits": "Ditandai"
    },
    "heading": "Penyalahgunaan alat",
    "kind": {
      "destructive": "penghapusan tak terbalikkan",
      "forcePush": "push paksa",
      "remoteExec": "kode jarak jauh dijalankan",
      "permission": "izin dibuka",
      "historyRewrite": "riwayat ditulis ulang"
    },
    "desc": "Menyisir perintah yang benar-benar dijalankan agen ini untuk mencari bentuk yang tak terbalikkan. Penyalahgunaan tak memerlukan penyusupan — wewenangnya sudah diberikan, dan karena itu pemberian itu sendiri adalah bagian dari permukaan serangan.",
    "note": "Memberi satu alat shell dan memberi lima perintah tertentu adalah kelas risiko yang sama sekali berbeda. Argumen pun butuh validasi, bukan hanya daftar alatnya.",
    "noteFound": "Ini sudah dijalankan — kartu ini melaporkan, bukan memblokir. Yang memblokir adalah permintaan persetujuan di depan pemanggilan alat."
  },
  "it": {
    "level": {
      "noCommands": "Nulla eseguito",
      "clean": "Nulla segnalato",
      "found": "Comandi segnalati"
    },
    "check": {
      "commands": "Comandi eseguiti",
      "last": "Più recente",
      "hits": "Segnalate"
    },
    "heading": "Uso improprio degli strumenti",
    "kind": {
      "destructive": "cancellazione irreversibile",
      "forcePush": "push forzato",
      "remoteExec": "codice remoto eseguito",
      "permission": "permessi aperti",
      "historyRewrite": "storico riscritto"
    },
    "desc": "Scorre i comandi realmente eseguiti da questo agente in cerca di forme irreversibili. L’uso improprio non richiede intrusione — l’autorità è già concessa, ed è per questo che concederla fa parte della superficie di attacco.",
    "note": "Dare uno strumento shell e dare cinque comandi definiti sono classi di rischio del tutto diverse. Anche gli argomenti richiedono validazione, non solo l’elenco degli strumenti.",
    "noteFound": "Questi sono già stati eseguiti — questa scheda segnala, non blocca. A bloccare è la richiesta di approvazione davanti alla chiamata."
  },
  "pt-BR": {
    "level": {
      "noCommands": "Nada executado ainda",
      "clean": "Nada sinalizado",
      "found": "Comandos sinalizados"
    },
    "check": {
      "commands": "Comandos executados",
      "last": "Mais recente",
      "hits": "Sinalizadas"
    },
    "heading": "Uso indevido de ferramentas",
    "kind": {
      "destructive": "exclusão irreversível",
      "forcePush": "push forçado",
      "remoteExec": "código remoto executado",
      "permission": "permissões abertas",
      "historyRewrite": "histórico reescrito"
    },
    "desc": "Varre os comandos que este agente realmente executou em busca de formas irreversíveis. Uso indevido não exige invasão — a autoridade já foi concedida, e por isso conceder faz parte da superfície de ataque.",
    "note": "Dar uma ferramenta de shell e dar cinco comandos nomeados são graus de risco completamente diferentes. Os argumentos também precisam de validação, não só a lista de ferramentas.",
    "noteFound": "Estes já rodaram — este cartão relata, não bloqueia. Quem bloqueia é o pedido de aprovação diante da chamada."
  }
} as const;
