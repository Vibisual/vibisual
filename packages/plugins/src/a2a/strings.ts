/**
 * a2a — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.a2a` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "MCP connects an agent to the outside world; A2A is how agents work with each other. They are different layers, so “which one” is the wrong question.",
    "heading": "A2A",
    "level": {
      "solo": "Works alone",
      "internal": "Delegates internally"
    },
    "check": {
      "edges": "Task edges",
      "sessions": "Sessions",
      "crossOrg": "Cross-organisation"
    },
    "none": "none",
    "note": "For subagents inside one process this protocol is overkill — its use is collaboration across organisational boundaries."
  },
  "ko": {
    "desc": "MCP 가 에이전트를 바깥 세계에 잇는다면, A2A 는 에이전트끼리 일하는 방법입니다. 층이 다르므로 \"둘 중 뭘 쓰나\"는 잘못된 질문입니다.",
    "heading": "A2A",
    "level": {
      "solo": "혼자 일함",
      "internal": "내부 위임"
    },
    "check": {
      "edges": "Task Edge",
      "sessions": "세션 수",
      "crossOrg": "조직 경계 넘음"
    },
    "none": "없음",
    "note": "한 프로세스 안의 서브에이전트에는 이 규약이 과잉입니다 — 용도는 조직 경계를 넘는 협업입니다."
  },
  "ja": {
    "check": {
      "edges": "タスクエッジ",
      "sessions": "セッション数",
      "crossOrg": "組織をまたぐ"
    },
    "none": "なし",
    "heading": "A2A",
    "level": {
      "internal": "内部に委譲",
      "solo": "単独で作業"
    },
    "desc": "MCP がエージェントを外の世界につなぐのに対し、A2A はエージェント同士が働く方法です。層が違うので「どちらを使うか」は誤った問いです。",
    "note": "一つのプロセス内のサブエージェントにはこの規約は過剰です — 用途は組織の境界を越える協働です。"
  },
  "zh-CN": {
    "check": {
      "edges": "任务连线",
      "sessions": "会话数",
      "crossOrg": "跨组织"
    },
    "none": "无",
    "heading": "A2A",
    "level": {
      "internal": "内部委派",
      "solo": "独立工作"
    },
    "desc": "MCP 把智能体接到外部世界，而 A2A 是智能体之间协作的方式。它们处于不同层，所以「用哪个」是个错误的问题。",
    "note": "对同一进程内的子智能体来说，这套规约是过度设计 — 它的用途是跨组织边界的协作。"
  },
  "es": {
    "check": {
      "edges": "Conexiones de tarea",
      "sessions": "Sesiones",
      "crossOrg": "Entre organizaciones"
    },
    "none": "ninguno",
    "heading": "A2A",
    "level": {
      "internal": "Delega internamente",
      "solo": "Trabaja solo"
    },
    "desc": "MCP conecta un agente con el mundo exterior; A2A es cómo trabajan los agentes entre sí. Son capas distintas, así que «cuál de los dos» es la pregunta equivocada.",
    "note": "Para subagentes dentro de un mismo proceso este protocolo es excesivo — su uso es la colaboración cruzando fronteras de organización."
  },
  "es-419": {
    "check": {
      "edges": "Conexiones de tarea",
      "sessions": "Sesiones",
      "crossOrg": "Entre organizaciones"
    },
    "none": "ninguno",
    "heading": "A2A",
    "level": {
      "internal": "Delega internamente",
      "solo": "Trabaja solo"
    },
    "desc": "MCP conecta un agente con el mundo exterior; A2A es cómo trabajan los agentes entre sí. Son capas distintas, así que «cuál de los dos» es la pregunta equivocada.",
    "note": "Para subagentes dentro de un mismo proceso este protocolo es excesivo — su uso es la colaboración cruzando fronteras de organización."
  },
  "fr": {
    "check": {
      "edges": "Liens de tâche",
      "sessions": "Sessions",
      "crossOrg": "Inter-organisations"
    },
    "none": "aucun",
    "heading": "A2A",
    "level": {
      "internal": "Délègue en interne",
      "solo": "Travaille seul"
    },
    "desc": "MCP relie un agent au monde extérieur ; A2A est la façon dont les agents travaillent entre eux. Ce sont deux couches différentes, donc « lequel choisir » est la mauvaise question.",
    "note": "Pour des sous-agents au sein d’un même processus, ce protocole est surdimensionné — son usage est la collaboration au-delà des frontières organisationnelles."
  },
  "de": {
    "check": {
      "edges": "Task-Kanten",
      "sessions": "Sitzungen",
      "crossOrg": "Organisationsübergreifend"
    },
    "none": "keine",
    "heading": "A2A",
    "level": {
      "internal": "Delegiert intern",
      "solo": "Arbeitet allein"
    },
    "desc": "MCP verbindet einen Agenten mit der Außenwelt; A2A ist, wie Agenten miteinander arbeiten. Es sind verschiedene Ebenen, „welches von beiden“ ist also die falsche Frage.",
    "note": "Für Subagenten innerhalb eines Prozesses ist dieses Protokoll überdimensioniert — sein Zweck ist Zusammenarbeit über Organisationsgrenzen hinweg."
  },
  "hi": {
    "check": {
      "edges": "टास्क एज",
      "sessions": "सत्र",
      "crossOrg": "संगठनों के बीच"
    },
    "none": "कोई नहीं",
    "heading": "A2A",
    "level": {
      "internal": "आंतरिक रूप से सौंपता",
      "solo": "अकेले काम करता"
    },
    "desc": "MCP एजेंट को बाहरी दुनिया से जोड़ता है; A2A वह तरीक़ा है जिससे एजेंट आपस में काम करते हैं। ये अलग परतें हैं, इसलिए «कौन-सा चुनें» ग़लत सवाल है।",
    "note": "एक ही प्रक्रिया के भीतर उप-एजेंट के लिए यह प्रोटोकॉल ज़रूरत से ज़्यादा है — इसकी उपयोगिता संगठन की सीमाओं के पार सहयोग में है।"
  },
  "id": {
    "check": {
      "edges": "Task edge",
      "sessions": "Sesi",
      "crossOrg": "Lintas organisasi"
    },
    "none": "tidak ada",
    "heading": "A2A",
    "level": {
      "internal": "Mendelegasikan internal",
      "solo": "Bekerja sendiri"
    },
    "desc": "MCP menghubungkan agen ke dunia luar; A2A adalah cara agen bekerja satu sama lain. Keduanya lapisan berbeda, jadi «pilih yang mana» adalah pertanyaan yang keliru.",
    "note": "Untuk subagen di dalam satu proses, protokol ini berlebihan — kegunaannya adalah kolaborasi melintasi batas organisasi."
  },
  "it": {
    "check": {
      "edges": "Collegamenti attività",
      "sessions": "Sessioni",
      "crossOrg": "Tra organizzazioni"
    },
    "none": "nessuno",
    "heading": "A2A",
    "level": {
      "internal": "Delega internamente",
      "solo": "Lavora da solo"
    },
    "desc": "MCP collega un agente al mondo esterno; A2A è il modo in cui gli agenti lavorano tra loro. Sono livelli diversi, quindi «quale dei due» è la domanda sbagliata.",
    "note": "Per subagenti dentro un solo processo questo protocollo è eccessivo — il suo uso è la collaborazione oltre i confini organizzativi."
  },
  "pt-BR": {
    "check": {
      "edges": "Conexões de tarefa",
      "sessions": "Sessões",
      "crossOrg": "Entre organizações"
    },
    "none": "nenhum",
    "heading": "A2A",
    "level": {
      "internal": "Delega internamente",
      "solo": "Trabalha sozinho"
    },
    "desc": "O MCP liga um agente ao mundo externo; o A2A é como agentes trabalham entre si. São camadas diferentes, então «qual dos dois» é a pergunta errada.",
    "note": "Para subagentes dentro de um mesmo processo esse protocolo é exagero — seu uso é a colaboração cruzando fronteiras de organização."
  }
} as const;
