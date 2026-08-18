/**
 * sandboxing — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.sandboxing` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Shows whether the agent runs on an isolated copy. Filesystem isolation alone is not enough — without network isolation the last leg of a leak stays open.",
    "heading": "Sandboxing",
    "level": {
      "isolated": "Isolated worktree",
      "shared": "Shared tree"
    },
    "check": {
      "filesystem": "Filesystem",
      "network": "Network",
      "execution": "Execution mode"
    },
    "worktree": "separate worktree",
    "sameTree": "same working tree",
    "noNetworkIsolation": "not isolated",
    "note": "Vibisual isolates the filesystem through git worktree. Network is not isolated, so outbound paths stay open even in a worktree."
  },
  "ko": {
    "desc": "격리된 사본에서 도는지 보여줍니다. 파일시스템 격리만으로는 부족합니다 — 네트워크 격리가 빠지면 유출의 마지막 다리가 그대로 열려 있습니다.",
    "heading": "샌드박싱",
    "level": {
      "isolated": "격리된 worktree",
      "shared": "같은 작업 트리"
    },
    "check": {
      "filesystem": "파일시스템",
      "network": "네트워크",
      "execution": "실행 모드"
    },
    "worktree": "별도 worktree",
    "sameTree": "같은 작업 트리",
    "noNetworkIsolation": "격리되지 않음",
    "note": "Vibisual 의 격리는 git worktree(파일시스템)까지입니다. 네트워크는 격리되지 않으므로 worktree 안에서도 외부로 나가는 길은 열려 있습니다."
  },
  "ja": {
    "level": {
      "shared": "同じツリー",
      "isolated": "隔離された worktree"
    },
    "heading": "サンドボックス",
    "check": {
      "filesystem": "ファイルシステム",
      "network": "ネットワーク",
      "execution": "実行モード"
    },
    "worktree": "別の worktree",
    "sameTree": "同じ作業ツリー",
    "noNetworkIsolation": "隔離されていない",
    "desc": "隔離された複製の上で動いているかを示します。ファイルシステムの隔離だけでは足りません — ネットワークが隔離されなければ、漏洩の最後の一本は開いたままです。",
    "note": "Vibisual の隔離は git worktree（ファイルシステム）までです。ネットワークは隔離されないため、worktree の中でも外へ出る道は開いています。"
  },
  "zh-CN": {
    "level": {
      "shared": "同一工作树",
      "isolated": "隔离的 worktree"
    },
    "heading": "沙箱隔离",
    "check": {
      "filesystem": "文件系统",
      "network": "网络",
      "execution": "执行模式"
    },
    "worktree": "独立 worktree",
    "sameTree": "同一工作树",
    "noNetworkIsolation": "未隔离",
    "desc": "显示智能体是否运行在隔离副本上。仅有文件系统隔离还不够 — 没有网络隔离，泄露的最后一环依然敞开。",
    "note": "Vibisual 的隔离止于 git worktree（文件系统）。网络并未隔离，因此即使在 worktree 中，对外通路仍然开着。"
  },
  "es": {
    "level": {
      "shared": "Árbol compartido",
      "isolated": "Worktree aislado"
    },
    "heading": "Aislamiento (sandbox)",
    "check": {
      "filesystem": "Sistema de archivos",
      "network": "Red",
      "execution": "Modo de ejecución"
    },
    "worktree": "worktree separado",
    "sameTree": "mismo árbol de trabajo",
    "noNetworkIsolation": "sin aislar",
    "desc": "Muestra si el agente corre sobre una copia aislada. El aislamiento del sistema de archivos no basta — sin aislamiento de red, la última etapa de una fuga sigue abierta.",
    "note": "Vibisual aísla el sistema de archivos mediante git worktree. La red no está aislada, así que las salidas siguen abiertas incluso dentro de un worktree."
  },
  "es-419": {
    "level": {
      "shared": "Árbol compartido",
      "isolated": "Worktree aislado"
    },
    "heading": "Aislamiento (sandbox)",
    "check": {
      "filesystem": "Sistema de archivos",
      "network": "Red",
      "execution": "Modo de ejecución"
    },
    "worktree": "worktree separado",
    "sameTree": "mismo árbol de trabajo",
    "noNetworkIsolation": "sin aislar",
    "desc": "Muestra si el agente corre sobre una copia aislada. El aislamiento del sistema de archivos no basta — sin aislamiento de red, la última etapa de una fuga sigue abierta.",
    "note": "Vibisual aísla el sistema de archivos mediante git worktree. La red no está aislada, así que las salidas siguen abiertas incluso dentro de un worktree."
  },
  "fr": {
    "level": {
      "shared": "Arbre partagé",
      "isolated": "Worktree isolé"
    },
    "heading": "Bac à sable",
    "check": {
      "filesystem": "Système de fichiers",
      "network": "Réseau",
      "execution": "Mode d’exécution"
    },
    "worktree": "worktree séparé",
    "sameTree": "même arbre de travail",
    "noNetworkIsolation": "non isolé",
    "desc": "Indique si l’agent tourne sur une copie isolée. L’isolation du système de fichiers ne suffit pas — sans isolation réseau, la dernière étape d’une fuite reste ouverte.",
    "note": "Vibisual isole le système de fichiers via git worktree. Le réseau n’est pas isolé : les chemins vers l’extérieur restent ouverts même dans un worktree."
  },
  "de": {
    "level": {
      "shared": "Gemeinsamer Baum",
      "isolated": "Isolierter Worktree"
    },
    "heading": "Sandboxing",
    "check": {
      "filesystem": "Dateisystem",
      "network": "Netzwerk",
      "execution": "Ausführungsmodus"
    },
    "worktree": "separater Worktree",
    "sameTree": "gleicher Arbeitsbaum",
    "noNetworkIsolation": "nicht isoliert",
    "desc": "Zeigt, ob der Agent auf einer isolierten Kopie läuft. Dateisystem-Isolierung allein genügt nicht — ohne Netzwerk-Isolierung bleibt die letzte Etappe eines Abflusses offen.",
    "note": "Vibisual isoliert das Dateisystem über git worktree. Das Netzwerk ist nicht isoliert, also bleiben Wege nach außen auch im Worktree offen."
  },
  "hi": {
    "level": {
      "shared": "साझा ट्री",
      "isolated": "पृथक worktree"
    },
    "heading": "सैंडबॉक्सिंग",
    "check": {
      "filesystem": "फ़ाइल सिस्टम",
      "network": "नेटवर्क",
      "execution": "निष्पादन मोड"
    },
    "worktree": "अलग worktree",
    "sameTree": "वही वर्किंग ट्री",
    "noNetworkIsolation": "पृथक नहीं",
    "desc": "दिखाता है कि एजेंट अलग-थलग प्रति पर चल रहा है या नहीं। केवल फ़ाइल-अलगाव पर्याप्त नहीं — नेटवर्क अलग न हो तो रिसाव का आख़िरी चरण खुला रहता है।",
    "note": "Vibisual git worktree से फ़ाइल-तंत्र अलग करता है। नेटवर्क अलग नहीं होता, इसलिए worktree के भीतर भी बाहर जाने का रास्ता खुला रहता है।"
  },
  "id": {
    "level": {
      "shared": "Tree bersama",
      "isolated": "Worktree terisolasi"
    },
    "heading": "Sandboxing",
    "check": {
      "filesystem": "Sistem berkas",
      "network": "Jaringan",
      "execution": "Mode eksekusi"
    },
    "worktree": "worktree terpisah",
    "sameTree": "working tree yang sama",
    "noNetworkIsolation": "tidak terisolasi",
    "desc": "Menunjukkan apakah agen berjalan di atas salinan terisolasi. Isolasi berkas saja tidak cukup — tanpa isolasi jaringan, tahap terakhir kebocoran tetap terbuka.",
    "note": "Vibisual mengisolasi sistem berkas lewat git worktree. Jaringan tidak diisolasi, jadi jalan keluar tetap terbuka bahkan di dalam worktree."
  },
  "it": {
    "level": {
      "shared": "Albero condiviso",
      "isolated": "Worktree isolato"
    },
    "heading": "Sandboxing",
    "check": {
      "filesystem": "File system",
      "network": "Rete",
      "execution": "Modalità di esecuzione"
    },
    "worktree": "worktree separato",
    "sameTree": "stesso albero di lavoro",
    "noNetworkIsolation": "non isolato",
    "desc": "Mostra se l’agente gira su una copia isolata. L’isolamento del filesystem non basta — senza isolamento di rete l’ultimo tratto di una fuga resta aperto.",
    "note": "Vibisual isola il filesystem tramite git worktree. La rete non è isolata, quindi le vie verso l’esterno restano aperte anche dentro un worktree."
  },
  "pt-BR": {
    "level": {
      "shared": "Árvore compartilhada",
      "isolated": "Worktree isolado"
    },
    "heading": "Sandboxing",
    "check": {
      "filesystem": "Sistema de arquivos",
      "network": "Rede",
      "execution": "Modo de execução"
    },
    "worktree": "worktree separado",
    "sameTree": "mesma árvore de trabalho",
    "noNetworkIsolation": "não isolado",
    "desc": "Mostra se o agente roda sobre uma cópia isolada. Isolar o sistema de arquivos não basta — sem isolamento de rede, a última etapa de um vazamento segue aberta.",
    "note": "O Vibisual isola o sistema de arquivos via git worktree. A rede não é isolada, então os caminhos para fora continuam abertos mesmo dentro de um worktree."
  }
} as const;
