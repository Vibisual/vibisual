/**
 * procedural-memory — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.proceduralMemory` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Of the three memory layers this is the one where files are clearly the right answer — a procedure is needed whole when the task comes up, not retrieved piecemeal.",
    "heading": "Procedural Memory",
    "level": {
      "none": "Nothing filed",
      "filed": "Filed"
    },
    "check": {
      "skills": "Skills",
      "rules": "Standing rules"
    },
    "yes": "yes",
    "no": "no",
    "note": "Skill files and agent definitions are the physical form of procedural memory, and version control is their decisive advantage over a vector store."
  },
  "ko": {
    "desc": "기억 3층 중 파일로 두는 것이 확실한 정답인 유일한 층입니다 — 절차는 검색될 필요 없이 그 작업일 때 통째로 필요하기 때문입니다.",
    "heading": "절차 기억",
    "level": {
      "none": "정리된 것 없음",
      "filed": "파일로 있음"
    },
    "check": {
      "skills": "스킬",
      "rules": "상시 규칙"
    },
    "yes": "있음",
    "no": "없음",
    "note": "스킬 파일과 에이전트 정의가 절차 기억의 물리적 형태이며, 버전 관리가 붙는 것이 벡터 저장소 대비 결정적 이점입니다."
  },
  "ja": {
    "check": {
      "skills": "スキル",
      "rules": "常設ルール"
    },
    "yes": "はい",
    "no": "いいえ",
    "heading": "手続き記憶",
    "level": {
      "filed": "ファイル化済み",
      "none": "整理されたものなし"
    },
    "desc": "記憶三層のうち、ファイルに置くのが確実な正解である唯一の層です — 手順は検索される必要がなく、その作業のときに丸ごと必要になるからです。",
    "note": "スキルファイルとエージェント定義が手続き記憶の物理的な形であり、バージョン管理が付くことがベクトル保存に対する決定的な利点です。"
  },
  "zh-CN": {
    "check": {
      "skills": "技能",
      "rules": "常驻规则"
    },
    "yes": "是",
    "no": "否",
    "heading": "程序性记忆",
    "level": {
      "filed": "已归档为文件",
      "none": "无归档"
    },
    "desc": "记忆三层中，这是唯一「放进文件」明确正确的一层 — 流程不需要被检索，而是在该任务出现时整段被需要。",
    "note": "技能文件与智能体定义就是程序性记忆的物理形态，而附带版本管理正是相对向量存储的决定性优势。"
  },
  "es": {
    "check": {
      "skills": "Habilidades",
      "rules": "Reglas permanentes"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Memoria procedimental",
    "level": {
      "filed": "En archivos",
      "none": "Nada archivado"
    },
    "desc": "De las tres capas de memoria, esta es aquella en la que los archivos son claramente la respuesta correcta — un procedimiento no necesita buscarse, se necesita entero cuando llega la tarea.",
    "note": "Los archivos de habilidades y las definiciones de agentes son la forma física de la memoria procedimental, y el control de versiones es su ventaja decisiva frente a un almacén vectorial."
  },
  "es-419": {
    "check": {
      "skills": "Habilidades",
      "rules": "Reglas permanentes"
    },
    "yes": "sí",
    "no": "no",
    "heading": "Memoria procedimental",
    "level": {
      "filed": "En archivos",
      "none": "Nada archivado"
    },
    "desc": "De las tres capas de memoria, esta es aquella en la que los archivos son claramente la respuesta correcta — un procedimiento no necesita buscarse, se necesita entero cuando llega la tarea.",
    "note": "Los archivos de habilidades y las definiciones de agentes son la forma física de la memoria procedimental, y el control de versiones es su ventaja decisiva frente a un almacén vectorial."
  },
  "fr": {
    "check": {
      "skills": "Compétences",
      "rules": "Règles permanentes"
    },
    "yes": "oui",
    "no": "non",
    "heading": "Mémoire procédurale",
    "level": {
      "filed": "Consigné en fichiers",
      "none": "Rien de consigné"
    },
    "desc": "Des trois couches de mémoire, c’est celle où les fichiers sont clairement la bonne réponse — une procédure n’a pas besoin d’être retrouvée, elle est nécessaire d’un bloc au moment de la tâche.",
    "note": "Les fichiers de compétences et les définitions d’agents sont la forme physique de la mémoire procédurale, et la gestion de versions est leur avantage décisif sur un magasin vectoriel."
  },
  "de": {
    "check": {
      "skills": "Skills",
      "rules": "Dauerregeln"
    },
    "yes": "ja",
    "no": "nein",
    "heading": "Prozedurales Gedächtnis",
    "level": {
      "filed": "In Dateien abgelegt",
      "none": "Nichts abgelegt"
    },
    "desc": "Von den drei Gedächtnisschichten ist dies die eine, in der Dateien klar die richtige Antwort sind — ein Ablauf wird nicht gesucht, sondern bei der Aufgabe als Ganzes gebraucht.",
    "note": "Skill-Dateien und Agentendefinitionen sind die physische Form prozeduralen Gedächtnisses, und die Versionsverwaltung ist ihr entscheidender Vorteil gegenüber einem Vektorspeicher."
  },
  "hi": {
    "check": {
      "skills": "स्किल",
      "rules": "स्थायी नियम"
    },
    "yes": "हाँ",
    "no": "नहीं",
    "heading": "प्रक्रियात्मक स्मृति",
    "level": {
      "filed": "फ़ाइलों में",
      "none": "कुछ दर्ज नहीं"
    },
    "desc": "स्मृति की तीन परतों में यही वह परत है जिसका उत्तर स्पष्ट रूप से फ़ाइल है — प्रक्रिया खोजी नहीं जाती, काम आने पर पूरी की पूरी चाहिए होती है।",
    "note": "skill फ़ाइलें और एजेंट-परिभाषाएँ प्रक्रियात्मक स्मृति का भौतिक रूप हैं, और संस्करण-नियंत्रण वेक्टर-भंडार पर इसकी निर्णायक बढ़त है।"
  },
  "id": {
    "check": {
      "skills": "Skill",
      "rules": "Aturan tetap"
    },
    "yes": "ya",
    "no": "tidak",
    "heading": "Memori prosedural",
    "level": {
      "filed": "Ada di berkas",
      "none": "Tidak ada yang diarsipkan"
    },
    "desc": "Dari tiga lapis memori, inilah lapisan yang jelas jawabannya adalah berkas — sebuah prosedur tidak perlu dicari, ia dibutuhkan utuh saat tugasnya datang.",
    "note": "Berkas skill dan definisi agen adalah wujud fisik memori prosedural, dan kendali versi adalah keunggulan menentukannya atas penyimpanan vektor."
  },
  "it": {
    "check": {
      "skills": "Competenze",
      "rules": "Regole permanenti"
    },
    "yes": "sì",
    "no": "no",
    "heading": "Memoria procedurale",
    "level": {
      "filed": "Su file",
      "none": "Nulla archiviato"
    },
    "desc": "Dei tre livelli di memoria, questo è quello in cui i file sono chiaramente la risposta giusta — una procedura non va cercata, serve intera nel momento del compito.",
    "note": "I file di competenze e le definizioni degli agenti sono la forma fisica della memoria procedurale, e il controllo di versione è il loro vantaggio decisivo su un archivio vettoriale."
  },
  "pt-BR": {
    "check": {
      "skills": "Habilidades",
      "rules": "Regras permanentes"
    },
    "yes": "sim",
    "no": "não",
    "heading": "Memória procedural",
    "level": {
      "filed": "Em arquivos",
      "none": "Nada arquivado"
    },
    "desc": "Das três camadas de memória, esta é aquela em que arquivos são claramente a resposta certa — um procedimento não precisa ser recuperado, ele é necessário inteiro quando a tarefa chega.",
    "note": "Arquivos de habilidades e definições de agentes são a forma física da memória procedural, e o controle de versões é sua vantagem decisiva sobre um banco vetorial."
  }
} as const;
