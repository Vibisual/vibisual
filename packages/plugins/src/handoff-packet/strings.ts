/**
 * handoff-packet — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.handoffPacket` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Counts how work is handed over. The real bottleneck in multi-agent setups is handoff quality, not model strength — hand over as free prose and it leaks every time.",
    "heading": "Handoff",
    "level": {
      "none": "No handoffs",
      "free": "Free-form",
      "structured": "Structured"
    },
    "check": {
      "edges": "Task edges",
      "outgoing": "Outgoing",
      "templated": "From a template"
    },
    "note": "Fix the packet shape — goal, what was tried, constraints, where the output is, and what could not be confirmed."
  },
  "ko": {
    "desc": "작업이 어떻게 넘어가는지 셉니다. 멀티 에이전트의 실제 병목은 모델 성능이 아니라 인계 품질이고, 자유 서술로 넘기면 반드시 샙니다.",
    "heading": "핸드오프",
    "level": {
      "none": "인계 없음",
      "free": "자유 서술",
      "structured": "구조화됨"
    },
    "check": {
      "edges": "Task Edge",
      "outgoing": "내보내는 인계",
      "templated": "템플릿 사용"
    },
    "note": "인계 패킷의 형태를 고정하십시오 — 목표 · 이미 시도한 것 · 제약 · 산출물 위치 · 확인하지 못한 것."
  },
  "ja": {
    "level": {
      "structured": "構造化済み",
      "none": "引き継ぎなし",
      "free": "自由記述"
    },
    "check": {
      "edges": "タスクエッジ",
      "outgoing": "送出",
      "templated": "テンプレート由来"
    },
    "heading": "引き継ぎ",
    "desc": "作業がどう渡されるかを数えます。マルチエージェントの実際のボトルネックはモデル性能ではなく引き継ぎ品質で、自由記述で渡せば必ず漏れます。",
    "note": "引き継ぎパケットの形を固定してください — 目標・すでに試したこと・制約・成果物の場所・確認できなかったこと。"
  },
  "zh-CN": {
    "level": {
      "structured": "已结构化",
      "none": "无交接",
      "free": "自由格式"
    },
    "check": {
      "edges": "任务连线",
      "outgoing": "发出",
      "templated": "来自模板"
    },
    "heading": "交接",
    "desc": "统计工作是如何交接的。多智能体的真正瓶颈是交接质量而非模型性能 — 用自由叙述交接，必定会漏。",
    "note": "把交接包的格式固定下来 — 目标、已经尝试过什么、约束、产物位置、未能确认的事项。"
  },
  "es": {
    "level": {
      "structured": "Estructurado",
      "none": "Sin traspasos",
      "free": "Formato libre"
    },
    "check": {
      "edges": "Conexiones de tarea",
      "outgoing": "Salientes",
      "templated": "Desde plantilla"
    },
    "heading": "Traspaso",
    "desc": "Cuenta cómo se traspasa el trabajo. El verdadero cuello de botella de los sistemas multiagente es la calidad del traspaso, no la potencia del modelo — traspasado como prosa libre, siempre se pierde algo.",
    "note": "Fija la forma del paquete — objetivo, qué se intentó, restricciones, dónde está el resultado y qué no se pudo confirmar."
  },
  "es-419": {
    "level": {
      "structured": "Estructurado",
      "none": "Sin traspasos",
      "free": "Formato libre"
    },
    "check": {
      "edges": "Conexiones de tarea",
      "outgoing": "Salientes",
      "templated": "Desde plantilla"
    },
    "heading": "Traspaso",
    "desc": "Cuenta cómo se traspasa el trabajo. El verdadero cuello de botella de los sistemas multiagente es la calidad del traspaso, no la potencia del modelo — traspasado como prosa libre, siempre se pierde algo.",
    "note": "Fija la forma del paquete — objetivo, qué se intentó, restricciones, dónde está el resultado y qué no se pudo confirmar."
  },
  "fr": {
    "level": {
      "structured": "Structuré",
      "none": "Aucune passation",
      "free": "Format libre"
    },
    "check": {
      "edges": "Liens de tâche",
      "outgoing": "Sortants",
      "templated": "Depuis un modèle"
    },
    "heading": "Passation",
    "desc": "Compte la façon dont le travail est transmis. Le vrai goulot des systèmes multi-agents est la qualité de passation, pas la puissance du modèle — transmis en prose libre, quelque chose fuit à chaque fois.",
    "note": "Fixez la forme du paquet — objectif, ce qui a été tenté, contraintes, où se trouve le résultat et ce qui n’a pas pu être confirmé."
  },
  "de": {
    "level": {
      "structured": "Strukturiert",
      "none": "Keine Übergaben",
      "free": "Freitext"
    },
    "check": {
      "edges": "Task-Kanten",
      "outgoing": "Ausgehend",
      "templated": "Aus Vorlage"
    },
    "heading": "Übergabe",
    "desc": "Zählt, wie Arbeit übergeben wird. Der echte Engpass in Multi-Agenten-Systemen ist die Übergabequalität, nicht die Modellstärke — als freier Text übergeben, geht jedes Mal etwas verloren.",
    "note": "Legen Sie die Form des Pakets fest — Ziel, was versucht wurde, Einschränkungen, wo das Ergebnis liegt und was nicht bestätigt werden konnte."
  },
  "hi": {
    "level": {
      "structured": "संरचित",
      "none": "कोई हस्तांतरण नहीं",
      "free": "मुक्त रूप"
    },
    "check": {
      "edges": "टास्क एज",
      "outgoing": "बाहर जाने वाले",
      "templated": "टेम्पलेट से"
    },
    "heading": "हस्तांतरण",
    "desc": "गिनता है कि काम कैसे सौंपा जाता है। बहु-एजेंट तंत्र की असली अड़चन सौंपने की गुणवत्ता है, मॉडल की ताक़त नहीं — मुक्त गद्य में सौंपा जाए तो कुछ न कुछ हमेशा रिसता है।",
    "note": "पैकेट का रूप तय कीजिए — लक्ष्य, क्या-क्या आज़माया, बंदिशें, नतीजा कहाँ है, और क्या पक्का नहीं हो सका।"
  },
  "id": {
    "level": {
      "structured": "Terstruktur",
      "none": "Tanpa serah terima",
      "free": "Bentuk bebas"
    },
    "check": {
      "edges": "Task edge",
      "outgoing": "Keluar",
      "templated": "Dari templat"
    },
    "heading": "Serah terima",
    "desc": "Menghitung bagaimana pekerjaan diserahkan. Sumbatan sebenarnya pada sistem multi-agen adalah kualitas serah terima, bukan kekuatan model — diserahkan sebagai prosa bebas, selalu ada yang bocor.",
    "note": "Tetapkan bentuk paketnya — tujuan, apa yang sudah dicoba, batasan, di mana hasilnya, dan apa yang tidak bisa dipastikan."
  },
  "it": {
    "level": {
      "structured": "Strutturato",
      "none": "Nessun passaggio",
      "free": "Formato libero"
    },
    "check": {
      "edges": "Collegamenti attività",
      "outgoing": "In uscita",
      "templated": "Da modello"
    },
    "heading": "Passaggio di consegne",
    "desc": "Conta come viene passato il lavoro. Il vero collo di bottiglia nei sistemi multi-agente è la qualità del passaggio, non la potenza del modello — consegnato come prosa libera, qualcosa si perde ogni volta.",
    "note": "Fissa la forma del pacchetto — obiettivo, che cosa è stato tentato, vincoli, dove sta il risultato e che cosa non si è potuto confermare."
  },
  "pt-BR": {
    "level": {
      "structured": "Estruturado",
      "none": "Sem repasses",
      "free": "Formato livre"
    },
    "check": {
      "edges": "Conexões de tarefa",
      "outgoing": "Enviados",
      "templated": "A partir de modelo"
    },
    "heading": "Repasse",
    "desc": "Conta como o trabalho é repassado. O gargalo real em sistemas multiagente é a qualidade do repasse, não a força do modelo — repassado como prosa livre, sempre escapa algo.",
    "note": "Fixe o formato do pacote — objetivo, o que foi tentado, restrições, onde está o resultado e o que não pôde ser confirmado."
  }
} as const;
