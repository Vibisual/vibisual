/**
 * atomic-write — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.atomicWrite` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Dying mid-write leaves a half-written file, and the quiet corruption starts the moment the next boot reads it as valid. Writing to a temp file and swapping atomically is the standard.",
    "heading": "Atomic Write",
    "level": {
      "readOnly": "Agent does not write",
      "agentWrites": "Agent writes files"
    },
    "check": {
      "agent": "Agent writes",
      "core": "Core state"
    },
    "yes": "yes",
    "no": "no",
    "guaranteed": "atomic + backups",
    "note": "The core writes its checkpoints and settings atomically with backup generations. Files the agent writes itself are not covered by that guarantee."
  },
  "ko": {
    "desc": "쓰는 도중에 죽으면 반쯤 쓰인 파일이 남고, 다음 부팅이 그것을 정상으로 읽는 순간 조용한 손상이 시작됩니다. 임시 파일에 쓰고 원자적으로 교체하는 것이 표준입니다.",
    "heading": "원자적 쓰기",
    "level": {
      "readOnly": "에이전트는 쓰지 않음",
      "agentWrites": "에이전트가 파일을 씀"
    },
    "check": {
      "agent": "에이전트 쓰기",
      "core": "코어 상태"
    },
    "yes": "함",
    "no": "안 함",
    "guaranteed": "원자적 + 백업",
    "note": "코어는 체크포인트와 설정을 원자적으로 쓰고 백업 세대를 남깁니다. 에이전트가 직접 쓰는 파일은 그 보장 대상이 아닙니다."
  },
  "ja": {
    "yes": "はい",
    "no": "いいえ",
    "heading": "アトミック書き込み",
    "check": {
      "agent": "エージェントが書く",
      "core": "コア側の状態"
    },
    "level": {
      "readOnly": "エージェントは書かない",
      "agentWrites": "エージェントが書く"
    },
    "guaranteed": "アトミック＋バックアップ",
    "desc": "書き込み途中で落ちると中途半端なファイルが残り、次の起動がそれを正常として読んだ瞬間に静かな破損が始まります。一時ファイルへ書いて原子的に差し替えるのが標準です。",
    "note": "コアはチェックポイントと設定を原子的に書き、バックアップ世代を残します。エージェント自身が書くファイルはその保証の対象ではありません。"
  },
  "zh-CN": {
    "yes": "是",
    "no": "否",
    "heading": "原子写入",
    "check": {
      "agent": "智能体写入",
      "core": "内核状态"
    },
    "level": {
      "readOnly": "智能体不写入",
      "agentWrites": "智能体写入文件"
    },
    "guaranteed": "原子写入 + 备份",
    "desc": "写到一半挂掉会留下半成品文件，而下一次启动把它当成正常内容读取的那一刻，静默损坏就开始了。写入临时文件再原子替换是标准做法。",
    "note": "内核会原子地写入检查点与设置，并保留备份世代。智能体自己写的文件不在这个保证范围内。"
  },
  "es": {
    "yes": "sí",
    "no": "no",
    "heading": "Escritura atómica",
    "check": {
      "agent": "El agente escribe",
      "core": "Estado del núcleo"
    },
    "level": {
      "readOnly": "El agente no escribe",
      "agentWrites": "El agente escribe"
    },
    "guaranteed": "atómico + copias",
    "desc": "Morir a mitad de escritura deja un archivo a medias, y la corrupción silenciosa empieza en cuanto el siguiente arranque lo lee como válido. Escribir en un temporal y permutar de forma atómica es el estándar.",
    "note": "El núcleo escribe sus puntos de guardado y ajustes de forma atómica y con generaciones de copia. Los archivos que el propio agente escribe no están cubiertos por esa garantía."
  },
  "es-419": {
    "yes": "sí",
    "no": "no",
    "heading": "Escritura atómica",
    "check": {
      "agent": "El agente escribe",
      "core": "Estado del núcleo"
    },
    "level": {
      "readOnly": "El agente no escribe",
      "agentWrites": "El agente escribe"
    },
    "guaranteed": "atómico + copias",
    "desc": "Morir a mitad de escritura deja un archivo a medias, y la corrupción silenciosa empieza en cuanto el siguiente arranque lo lee como válido. Escribir en un temporal y permutar de forma atómica es el estándar.",
    "note": "El núcleo escribe sus puntos de guardado y ajustes de forma atómica y con generaciones de copia. Los archivos que el propio agente escribe no están cubiertos por esa garantía."
  },
  "fr": {
    "yes": "oui",
    "no": "non",
    "heading": "Écriture atomique",
    "check": {
      "agent": "L’agent écrit",
      "core": "État du noyau"
    },
    "level": {
      "readOnly": "L’agent n’écrit pas",
      "agentWrites": "L’agent écrit"
    },
    "guaranteed": "atomique + sauvegardes",
    "desc": "Mourir en pleine écriture laisse un fichier à moitié écrit, et la corruption silencieuse commence dès que le démarrage suivant le lit comme valide. Écrire dans un fichier temporaire puis permuter atomiquement est le standard.",
    "note": "Le cœur écrit ses points de reprise et ses réglages de façon atomique avec des générations de sauvegarde. Les fichiers que l’agent écrit lui-même ne sont pas couverts par cette garantie."
  },
  "de": {
    "yes": "ja",
    "no": "nein",
    "heading": "Atomares Schreiben",
    "check": {
      "agent": "Agent schreibt",
      "core": "Kern-Zustand"
    },
    "level": {
      "readOnly": "Agent schreibt nicht",
      "agentWrites": "Agent schreibt Dateien"
    },
    "guaranteed": "atomar + Backups",
    "desc": "Mitten im Schreiben zu sterben hinterlässt eine halb geschriebene Datei, und die stille Beschädigung beginnt in dem Moment, in dem der nächste Start sie als gültig liest. In eine temporäre Datei schreiben und atomar tauschen ist der Standard.",
    "note": "Der Kern schreibt seine Checkpoints und Einstellungen atomar mit Backup-Generationen. Dateien, die der Agent selbst schreibt, fallen nicht unter diese Garantie."
  },
  "hi": {
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "परमाणु लेखन",
    "check": {
      "agent": "एजेंट लिखता है",
      "core": "कोर स्थिति"
    },
    "level": {
      "readOnly": "एजेंट नहीं लिखता",
      "agentWrites": "एजेंट फ़ाइलें लिखता है"
    },
    "guaranteed": "परमाणु + बैकअप",
    "desc": "लिखते-लिखते मर जाना आधी फ़ाइल छोड़ जाता है, और मौन भ्रष्टता तभी शुरू होती है जब अगला बूट उसे वैध मानकर पढ़ता है। अस्थायी फ़ाइल में लिखकर अविभाज्य रूप से बदलना ही मानक है।",
    "note": "मूल तंत्र checkpoint और सेटिंग को कई पीढ़ियों के बैकअप के साथ अविभाज्य रूप से लिखता है। एजेंट ख़ुद जो फ़ाइलें लिखता है, वे इस गारंटी में नहीं आतीं।"
  },
  "id": {
    "yes": "ya",
    "no": "tidak",
    "heading": "Penulisan atomik",
    "check": {
      "agent": "Agen menulis",
      "core": "Status inti"
    },
    "level": {
      "readOnly": "Agen tidak menulis",
      "agentWrites": "Agen menulis berkas"
    },
    "guaranteed": "atomik + cadangan",
    "desc": "Mati di tengah penulisan meninggalkan berkas separuh jadi, dan kerusakan senyap dimulai begitu boot berikutnya membacanya sebagai sah. Menulis ke berkas sementara lalu menukar secara atomik adalah standarnya.",
    "note": "Inti menulis checkpoint dan pengaturannya secara atomik dengan beberapa generasi cadangan. Berkas yang ditulis sendiri oleh agen tidak tercakup jaminan itu."
  },
  "it": {
    "yes": "sì",
    "no": "no",
    "heading": "Scrittura atomica",
    "check": {
      "agent": "L’agente scrive",
      "core": "Stato del core"
    },
    "level": {
      "readOnly": "L’agente non scrive",
      "agentWrites": "L’agente scrive file"
    },
    "guaranteed": "atomico + backup",
    "desc": "Morire a metà scrittura lascia un file a metà, e la corruzione silenziosa comincia nell’istante in cui l’avvio successivo lo legge come valido. Scrivere su un file temporaneo e scambiare in modo atomico è lo standard.",
    "note": "Il core scrive i propri checkpoint e le impostazioni in modo atomico con generazioni di backup. I file che l’agente scrive da sé non rientrano in quella garanzia."
  },
  "pt-BR": {
    "yes": "sim",
    "no": "não",
    "heading": "Escrita atômica",
    "check": {
      "agent": "O agente escreve",
      "core": "Estado do núcleo"
    },
    "level": {
      "readOnly": "O agente não escreve",
      "agentWrites": "O agente escreve"
    },
    "guaranteed": "atômico + backups",
    "desc": "Morrer no meio da escrita deixa um arquivo pela metade, e a corrupção silenciosa começa no instante em que o próximo boot o lê como válido. Escrever num temporário e trocar de forma atômica é o padrão.",
    "note": "O núcleo grava seus checkpoints e ajustes de forma atômica e com gerações de backup. Arquivos que o próprio agente escreve não estão cobertos por essa garantia."
  }
} as const;
