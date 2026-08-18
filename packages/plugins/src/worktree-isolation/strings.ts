/**
 * worktree-isolation — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.worktreeIsolation` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Once several agents run at once this becomes required infrastructure — branches alone cannot be checked out twice, and two agents in one directory overwrite each other.",
    "heading": "Worktree Isolation",
    "level": {
      "shared": "Shared tree",
      "isolated": "Isolated"
    },
    "check": {
      "mode": "Isolation",
      "merge": "Merge step"
    },
    "pending": "still ahead",
    "notNeeded": "not applicable",
    "note": "Isolating is the easy half. Dependencies have to be installed per tree, conflicts pile up at merge time, and integration design is the harder part.",
    "noteIsolated": "Work is happening on a separate tree, so a merge is still ahead. That is where the conflicts arrive all at once."
  },
  "ko": {
    "desc": "여러 에이전트가 동시에 도는 순간 필수 인프라가 됩니다 — 브랜치만으로는 동시 체크아웃이 안 되고, 같은 디렉터리에서 둘이 고치면 서로의 변경을 덮어씁니다.",
    "heading": "워크트리 격리",
    "level": {
      "shared": "같은 트리",
      "isolated": "격리됨"
    },
    "check": {
      "mode": "격리",
      "merge": "병합 단계"
    },
    "pending": "남아 있음",
    "notNeeded": "해당 없음",
    "note": "격리는 쉬운 절반입니다. 의존성을 트리마다 설치해야 하고 병합 시점에 충돌이 몰리며, 통합 설계가 더 어렵습니다.",
    "noteIsolated": "별도 트리에서 작업 중이라 병합이 남아 있습니다. 충돌이 한꺼번에 몰리는 지점이 거기입니다."
  },
  "ja": {
    "level": {
      "shared": "同じツリー",
      "isolated": "隔離済み"
    },
    "check": {
      "mode": "隔離",
      "merge": "統合の段階"
    },
    "heading": "ワークツリー隔離",
    "pending": "まだ残っている",
    "notNeeded": "該当なし",
    "desc": "複数のエージェントが同時に動く瞬間、これは必須の基盤になります — ブランチだけでは同時チェックアウトができず、同じディレクトリで二つが直せば互いの変更を上書きします。",
    "note": "隔離は簡単な方の半分です。依存関係はツリーごとに入れる必要があり、併合の時点で衝突がまとまって来るので、統合の設計の方が難しいです。",
    "noteIsolated": "別のツリーで作業中なので、併合がまだ残っています。衝突が一度に来るのはその地点です。"
  },
  "zh-CN": {
    "level": {
      "shared": "同一工作树",
      "isolated": "已隔离"
    },
    "check": {
      "mode": "隔离",
      "merge": "合并环节"
    },
    "heading": "工作树隔离",
    "pending": "尚未进行",
    "notNeeded": "不适用",
    "desc": "一旦多个智能体同时运行，这就成了必需的基础设施 — 仅靠分支无法同时检出，两个智能体在同一目录里改动会互相覆盖。",
    "note": "隔离是容易的那一半。依赖要按每棵树安装，冲突会在合并时集中爆发，整合设计才是更难的部分。",
    "noteIsolated": "正在独立的树上工作，因此合并还在后面。冲突集中到来的地方就是那里。"
  },
  "es": {
    "level": {
      "shared": "Árbol compartido",
      "isolated": "Aislado"
    },
    "check": {
      "mode": "Aislamiento",
      "merge": "Paso de fusión"
    },
    "heading": "Aislamiento por worktree",
    "pending": "aún pendiente",
    "notNeeded": "no aplica",
    "desc": "En cuanto varios agentes corren a la vez, esto pasa a ser infraestructura necesaria — las ramas por sí solas no se pueden extraer dos veces, y dos agentes en un mismo directorio se pisan.",
    "note": "Aislar es la mitad fácil. Las dependencias hay que instalarlas por árbol, los conflictos se amontonan al fusionar, y el diseño de la integración es la parte más difícil.",
    "noteIsolated": "El trabajo ocurre en un árbol aparte, así que aún queda una fusión. Ahí es donde los conflictos llegan todos de golpe."
  },
  "es-419": {
    "level": {
      "shared": "Árbol compartido",
      "isolated": "Aislado"
    },
    "check": {
      "mode": "Aislamiento",
      "merge": "Paso de fusión"
    },
    "heading": "Aislamiento por worktree",
    "pending": "aún pendiente",
    "notNeeded": "no aplica",
    "desc": "En cuanto varios agentes corren a la vez, esto pasa a ser infraestructura necesaria — las ramas por sí solas no se pueden extraer dos veces, y dos agentes en un mismo directorio se pisan.",
    "note": "Aislar es la mitad fácil. Las dependencias hay que instalarlas por árbol, los conflictos se amontonan al fusionar, y el diseño de la integración es la parte más difícil.",
    "noteIsolated": "El trabajo ocurre en un árbol aparte, así que aún queda una fusión. Ahí es donde los conflictos llegan todos de golpe."
  },
  "fr": {
    "level": {
      "shared": "Arbre partagé",
      "isolated": "Isolé"
    },
    "check": {
      "mode": "Isolation",
      "merge": "Étape de fusion"
    },
    "heading": "Isolation par worktree",
    "pending": "encore à venir",
    "notNeeded": "sans objet",
    "desc": "Dès que plusieurs agents tournent en même temps, cela devient une infrastructure nécessaire — les branches seules ne se récupèrent pas deux fois, et deux agents dans un même dossier s’écrasent mutuellement.",
    "note": "Isoler est la moitié facile. Les dépendances doivent être installées par arbre, les conflits s’accumulent au moment de la fusion, et la conception de l’intégration est la partie la plus dure.",
    "noteIsolated": "Le travail se fait sur un arbre séparé : une fusion reste donc à venir. C’est là que les conflits arrivent d’un coup."
  },
  "de": {
    "level": {
      "shared": "Gemeinsamer Baum",
      "isolated": "Isoliert"
    },
    "check": {
      "mode": "Isolierung",
      "merge": "Merge-Schritt"
    },
    "heading": "Worktree-Isolierung",
    "pending": "steht noch aus",
    "notNeeded": "nicht zutreffend",
    "desc": "Sobald mehrere Agenten gleichzeitig laufen, wird das zur notwendigen Infrastruktur — Branches allein lassen sich nicht doppelt auschecken, und zwei Agenten in einem Verzeichnis überschreiben einander.",
    "note": "Isolieren ist die leichte Hälfte. Abhängigkeiten müssen je Baum installiert werden, Konflikte häufen sich beim Merge, und der schwierigere Teil ist der Integrationsentwurf.",
    "noteIsolated": "Die Arbeit läuft auf einem eigenen Baum, ein Merge steht also noch bevor. Dort treffen die Konflikte alle auf einmal ein."
  },
  "hi": {
    "level": {
      "shared": "साझा ट्री",
      "isolated": "पृथक"
    },
    "check": {
      "mode": "पृथक्करण",
      "merge": "मर्ज चरण"
    },
    "heading": "वर्कट्री पृथक्करण",
    "pending": "अभी बाकी",
    "notNeeded": "लागू नहीं",
    "desc": "जैसे ही कई एजेंट साथ चलते हैं, यह अनिवार्य ढाँचा बन जाता है — अकेली branch दो बार checkout नहीं हो सकती, और एक ही डायरेक्टरी में दो एजेंट एक-दूसरे पर लिख देते हैं।",
    "note": "अलग करना आसान आधा है। निर्भरताएँ हर tree में लगानी पड़ती हैं, विलय पर टकराव जमा होते हैं, और कठिन हिस्सा एकीकरण का डिज़ाइन है।",
    "noteIsolated": "काम अलग tree में हो रहा है, इसलिए विलय अभी बाकी है। टकराव वहीं एक साथ आते हैं।"
  },
  "id": {
    "level": {
      "shared": "Tree bersama",
      "isolated": "Terisolasi"
    },
    "check": {
      "mode": "Isolasi",
      "merge": "Tahap penggabungan"
    },
    "heading": "Isolasi worktree",
    "pending": "masih menanti",
    "notNeeded": "tidak berlaku",
    "desc": "Begitu beberapa agen berjalan bersamaan, ini menjadi infrastruktur wajib — branch saja tak bisa di-checkout dua kali, dan dua agen di satu direktori saling menimpa.",
    "note": "Mengisolasi adalah separuh yang mudah. Dependensi harus dipasang per tree, konflik menumpuk saat penggabungan, dan bagian yang lebih sulit adalah rancangan integrasinya.",
    "noteIsolated": "Pekerjaan berlangsung di tree terpisah, jadi penggabungan masih menanti. Di situlah konflik datang sekaligus."
  },
  "it": {
    "level": {
      "shared": "Albero condiviso",
      "isolated": "Isolato"
    },
    "check": {
      "mode": "Isolamento",
      "merge": "Fase di merge"
    },
    "heading": "Isolamento worktree",
    "pending": "ancora da fare",
    "notNeeded": "non applicabile",
    "desc": "Appena più agenti girano insieme, questo diventa infrastruttura necessaria — i soli branch non si possono estrarre due volte, e due agenti nella stessa cartella si sovrascrivono.",
    "note": "Isolare è la metà facile. Le dipendenze vanno installate per albero, i conflitti si accumulano al momento dell’unione, e la parte più difficile è il progetto dell’integrazione.",
    "noteIsolated": "Il lavoro avviene su un albero separato, quindi resta ancora un’unione. È lì che i conflitti arrivano tutti insieme."
  },
  "pt-BR": {
    "level": {
      "shared": "Árvore compartilhada",
      "isolated": "Isolado"
    },
    "check": {
      "mode": "Isolamento",
      "merge": "Etapa de merge"
    },
    "heading": "Isolamento por worktree",
    "pending": "ainda pendente",
    "notNeeded": "não se aplica",
    "desc": "Assim que vários agentes rodam ao mesmo tempo, isso vira infraestrutura necessária — branches sozinhos não podem ser retirados duas vezes, e dois agentes no mesmo diretório se sobrescrevem.",
    "note": "Isolar é a metade fácil. Dependências precisam ser instaladas por árvore, os conflitos se acumulam na hora da junção, e o desenho da integração é a parte mais difícil.",
    "noteIsolated": "O trabalho acontece numa árvore separada, então ainda falta uma junção. É ali que os conflitos chegam todos de uma vez."
  }
} as const;
