/**
 * durable-execution — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.durableExecution` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Long tasks fail from crashes in the middle more often than from lack of ability. Saving state periodically means not starting over.",
    "heading": "Durable Execution",
    "level": {
      "fresh": "Nothing to resume",
      "checkpointed": "Checkpointed"
    },
    "check": {
      "turns": "Turns",
      "sessions": "Sessions",
      "guarantee": "Guarantee"
    },
    "core": "core checkpoints",
    "note": "Vibisual guarantees this layer in the core, so an agent never has to build its own resume path."
  },
  "ko": {
    "desc": "긴 작업은 능력 부족보다 중간 크래시로 실패합니다. 상태를 주기적으로 저장해 두면 처음부터 다시 하지 않아도 됩니다.",
    "heading": "지속 실행",
    "level": {
      "fresh": "이어갈 것 없음",
      "checkpointed": "체크포인트 있음"
    },
    "check": {
      "turns": "턴",
      "sessions": "세션",
      "guarantee": "보장"
    },
    "core": "코어 체크포인트",
    "note": "Vibisual 은 이 층을 코어에서 보장하므로, 에이전트가 자기 재개 경로를 따로 만들 필요가 없습니다."
  },
  "ja": {
    "check": {
      "turns": "ターン数",
      "sessions": "セッション数",
      "guarantee": "保証"
    },
    "heading": "耐障害実行",
    "level": {
      "checkpointed": "チェックポイントあり",
      "fresh": "再開するものがない"
    },
    "core": "コア側のチェックポイント",
    "desc": "長い作業は能力不足より途中のクラッシュで失敗します。状態を定期的に保存しておけば、最初からやり直さずに済みます。",
    "note": "Vibisual はこの層をコアで保証しているので、エージェントが自前の再開経路を作る必要がありません。"
  },
  "zh-CN": {
    "check": {
      "turns": "轮次",
      "sessions": "会话数",
      "guarantee": "保障"
    },
    "heading": "持久执行",
    "level": {
      "checkpointed": "已有检查点",
      "fresh": "无可恢复内容"
    },
    "core": "内核检查点",
    "desc": "长任务失败于中途崩溃的情况，比失败于能力不足更常见。定期保存状态，就不必从头再来。",
    "note": "Vibisual 在内核层面保证了这一层，因此智能体不必自建恢复路径。"
  },
  "es": {
    "check": {
      "turns": "Turnos",
      "sessions": "Sesiones",
      "guarantee": "Garantía"
    },
    "heading": "Ejecución duradera",
    "level": {
      "checkpointed": "Con puntos de guardado",
      "fresh": "Nada que reanudar"
    },
    "core": "puntos de guardado del núcleo",
    "desc": "Las tareas largas fallan más por un cuelgue a mitad de camino que por falta de capacidad. Guardar el estado periódicamente significa no empezar de cero.",
    "note": "Vibisual garantiza esta capa en el núcleo, así que un agente nunca tiene que construir su propia vía de reanudación."
  },
  "es-419": {
    "check": {
      "turns": "Turnos",
      "sessions": "Sesiones",
      "guarantee": "Garantía"
    },
    "heading": "Ejecución duradera",
    "level": {
      "checkpointed": "Con puntos de guardado",
      "fresh": "Nada que reanudar"
    },
    "core": "puntos de guardado del núcleo",
    "desc": "Las tareas largas fallan más por un cuelgue a mitad de camino que por falta de capacidad. Guardar el estado periódicamente significa no empezar de cero.",
    "note": "Vibisual garantiza esta capa en el núcleo, así que un agente nunca tiene que construir su propia vía de reanudación."
  },
  "fr": {
    "check": {
      "turns": "Tours",
      "sessions": "Sessions",
      "guarantee": "Garantie"
    },
    "heading": "Exécution durable",
    "level": {
      "checkpointed": "Avec points de reprise",
      "fresh": "Rien à reprendre"
    },
    "core": "points de reprise du noyau",
    "desc": "Les tâches longues échouent plus souvent sur un plantage en cours de route que par manque de capacité. Sauvegarder l’état régulièrement, c’est ne pas repartir de zéro.",
    "note": "Vibisual garantit cette couche dans le cœur : un agent n’a donc jamais à construire son propre chemin de reprise."
  },
  "de": {
    "check": {
      "turns": "Züge",
      "sessions": "Sitzungen",
      "guarantee": "Garantie"
    },
    "heading": "Dauerhafte Ausführung",
    "level": {
      "checkpointed": "Mit Checkpoints",
      "fresh": "Nichts fortzusetzen"
    },
    "core": "Kern-Checkpoints",
    "desc": "Lange Aufgaben scheitern häufiger an Abstürzen mitten drin als an fehlendem Können. Den Zustand regelmäßig zu sichern heißt, nicht von vorn beginnen zu müssen.",
    "note": "Vibisual garantiert diese Schicht im Kern, ein Agent muss sich also nie einen eigenen Wiederaufnahmepfad bauen."
  },
  "hi": {
    "check": {
      "turns": "टर्न",
      "sessions": "सत्र",
      "guarantee": "गारंटी"
    },
    "heading": "टिकाऊ निष्पादन",
    "level": {
      "checkpointed": "चेकपॉइंट सहित",
      "fresh": "फिर शुरू करने को कुछ नहीं"
    },
    "core": "कोर चेकपॉइंट",
    "desc": "लंबे काम क्षमता की कमी से कम, बीच में गिर जाने से ज़्यादा विफल होते हैं। स्थिति समय-समय पर सहेजने का अर्थ है शून्य से शुरू न करना पड़ना।",
    "note": "Vibisual यह परत मूल में देता है, इसलिए किसी एजेंट को अपना पुनःप्राप्ति-रास्ता ख़ुद नहीं बनाना पड़ता।"
  },
  "id": {
    "check": {
      "turns": "Giliran",
      "sessions": "Sesi",
      "guarantee": "Jaminan"
    },
    "heading": "Eksekusi tahan gangguan",
    "level": {
      "checkpointed": "Ada checkpoint",
      "fresh": "Tak ada yang dilanjutkan"
    },
    "core": "checkpoint inti",
    "desc": "Tugas panjang lebih sering gagal karena mogok di tengah jalan daripada karena kurang mampu. Menyimpan keadaan secara berkala berarti tidak perlu mulai dari nol.",
    "note": "Vibisual menjamin lapisan ini di inti, jadi sebuah agen tak perlu membangun jalur pemulihannya sendiri."
  },
  "it": {
    "check": {
      "turns": "Turni",
      "sessions": "Sessioni",
      "guarantee": "Garanzia"
    },
    "heading": "Esecuzione durevole",
    "level": {
      "checkpointed": "Con checkpoint",
      "fresh": "Nulla da riprendere"
    },
    "core": "checkpoint del core",
    "desc": "Le attività lunghe falliscono più per un crash a metà strada che per mancanza di capacità. Salvare periodicamente lo stato significa non ricominciare da capo.",
    "note": "Vibisual garantisce questo strato nel core, quindi un agente non deve mai costruirsi un proprio percorso di ripresa."
  },
  "pt-BR": {
    "check": {
      "turns": "Turnos",
      "sessions": "Sessões",
      "guarantee": "Garantia"
    },
    "heading": "Execução durável",
    "level": {
      "checkpointed": "Com checkpoints",
      "fresh": "Nada a retomar"
    },
    "core": "checkpoints do núcleo",
    "desc": "Tarefas longas falham mais por travamento no meio do caminho do que por falta de capacidade. Salvar o estado periodicamente significa não recomeçar do zero.",
    "note": "O Vibisual garante essa camada no núcleo, então um agente nunca precisa construir o próprio caminho de retomada."
  }
} as const;
