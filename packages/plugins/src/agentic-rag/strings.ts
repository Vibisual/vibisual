/**
 * agentic-rag — 이 플러그인의 문자열 전량 (§5.11 v4.58 자립 규약).
 *
 * 종전에는 `packages/client/src/i18n/locales/*.json` 안에 있었다. 그래서 폴더를 복사해도 화면에는
 * 번역 키가 그대로 노출됐다 — **폴더가 자기 문자열을 안 들고 있었기 때문**이다. 이제 여기에 산다.
 * 호스트는 `panel.plugins.agenticRag` 지붕 아래로 병합한다(키 네임스페이스는 6개 규칙 그대로).
 */
export const strings = {
  "en": {
    "desc": "Separates procedures that grew out of the agent's own commands from ones that came from steps you pinned to the stage. Pinned-only means you are still choosing every time; grown-from-work means it noticed the repetition by itself.",
    "heading": "Agentic RAG",
    "level": {
      "none": "Nothing grown yet",
      "static": "From pinned steps only",
      "agentic": "Grew from its own work"
    },
    "check": {
      "searched": "From its own commands",
      "pushed": "From pinned steps"
    },
    "note": "A fixed pipeline only ever stores what you told it to; an agent notices the run it keeps repeating and writes that down itself."
  },
  "ko": {
    "desc": "에이전트가 스스로 친 명령에서 자란 절차와, 사용자가 무대에 꽂은 단계에서 자란 절차를 나눠 봅니다. 꽂은 것만 있으면 매번 사람이 고르는 것이고, 스스로 자란 것이 있으면 되풀이를 에이전트가 알아챈 것입니다.",
    "heading": "에이전틱 검색",
    "level": {
      "none": "아직 자란 것 없음",
      "static": "꽂은 단계에서만",
      "agentic": "스스로 한 일에서 자람"
    },
    "check": {
      "searched": "스스로 친 명령에서",
      "pushed": "꽂은 단계에서"
    },
    "note": "고정된 파이프라인은 시킨 것만 저장하지만, 에이전트는 자기가 되풀이하는 일을 알아채 스스로 적어 둡니다."
  },
  "ja": {
    "level": {
      "static": "押し込みのみ",
      "none": "検索なし",
      "agentic": "能動的に検索する"
    },
    "check": {
      "searched": "エージェント検索",
      "pushed": "起動時に押し込み"
    },
    "heading": "エージェンティック RAG",
    "desc": "起動時に押し込まれた記憶と、エージェントが自分で探しに行った記憶を分けます。押し込みだけなら同じ束が毎回載り、能動的な検索があれば必要な瞬間に入ってきます。",
    "note": "固定されたパイプラインは一度検索して終わりですが、エージェントは足りないと判断したときにもう一度探しに行きます。"
  },
  "zh-CN": {
    "level": {
      "static": "仅推送",
      "none": "无检索",
      "agentic": "主动检索"
    },
    "check": {
      "searched": "智能体检索",
      "pushed": "启动时推送"
    },
    "heading": "智能体式 RAG",
    "desc": "区分启动时被推送进来的记忆，和智能体自己去找回来的记忆。只有推送时同一批内容每次都会跟着载入；有主动检索时，它会在需要的那一刻才进来。",
    "note": "固定流水线只检索一次；智能体则会在判断依据不足时再回头去找。"
  },
  "es": {
    "level": {
      "static": "Solo empujado",
      "none": "Sin recuperación",
      "agentic": "Busca activamente"
    },
    "check": {
      "searched": "Búsquedas del agente",
      "pushed": "Empujadas al iniciar"
    },
    "heading": "RAG agéntico",
    "desc": "Separa la memoria empujada al arrancar de la que el agente fue a buscar. Solo empujar significa que el mismo paquete viaja siempre; la búsqueda activa significa que llega cuando hace falta.",
    "note": "Una tubería fija busca una vez; un agente decide cuándo necesita más y vuelve."
  },
  "es-419": {
    "level": {
      "static": "Solo empujado",
      "none": "Sin recuperación",
      "agentic": "Busca activamente"
    },
    "check": {
      "searched": "Búsquedas del agente",
      "pushed": "Empujadas al iniciar"
    },
    "heading": "RAG agéntico",
    "desc": "Separa la memoria empujada al arrancar de la que el agente fue a buscar. Solo empujar significa que el mismo paquete viaja siempre; la búsqueda activa significa que llega cuando hace falta.",
    "note": "Una tubería fija busca una vez; un agente decide cuándo necesita más y vuelve."
  },
  "fr": {
    "level": {
      "static": "Poussé seulement",
      "none": "Aucune récupération",
      "agentic": "Recherche activement"
    },
    "check": {
      "searched": "Recherches de l’agent",
      "pushed": "Poussées au démarrage"
    },
    "heading": "RAG agentique",
    "desc": "Sépare la mémoire poussée au démarrage de celle que l’agent est allé chercher. Le tout-poussé signifie que le même paquet voyage à chaque fois ; la recherche active signifie qu’il arrive au moment utile.",
    "note": "Un pipeline figé cherche une fois ; un agent décide quand il lui en faut davantage et y retourne."
  },
  "de": {
    "level": {
      "static": "Nur eingeschoben",
      "none": "Kein Abruf",
      "agentic": "Sucht aktiv"
    },
    "check": {
      "searched": "Agentensuchen",
      "pushed": "Beim Start eingeschoben"
    },
    "heading": "Agentisches RAG",
    "desc": "Trennt Gedächtnis, das beim Start eingeschoben wurde, von Gedächtnis, das der Agent selbst gesucht hat. Nur Einschieben heißt, dasselbe Bündel fährt jedes Mal mit; aktives Suchen heißt, es kommt an, wenn es gebraucht wird.",
    "note": "Eine feste Pipeline sucht einmal; ein Agent entscheidet, wann er mehr braucht, und geht zurück."
  },
  "hi": {
    "level": {
      "static": "केवल धकेला गया",
      "none": "कोई पुनर्प्राप्ति नहीं",
      "agentic": "सक्रिय रूप से खोजता"
    },
    "check": {
      "searched": "एजेंट खोज",
      "pushed": "शुरुआत पर धकेला"
    },
    "heading": "एजेंटिक RAG",
    "desc": "शुरुआत में धकेली गई स्मृति और एजेंट द्वारा ख़ुद खोजी गई स्मृति को अलग करता है। केवल धकेलने का अर्थ है वही पैकेट हर बार साथ; ख़ुद खोजने का अर्थ है वह तब आए जब ज़रूरत हो।",
    "note": "पाइपलाइन एक बार खोजती है; एजेंट तय करता है कि उसे और चाहिए और फिर से खोजने जाता है।"
  },
  "id": {
    "level": {
      "static": "Hanya didorong",
      "none": "Tanpa pengambilan",
      "agentic": "Mencari aktif"
    },
    "check": {
      "searched": "Pencarian agen",
      "pushed": "Didorong saat mulai"
    },
    "heading": "RAG agentik",
    "desc": "Memisahkan memori yang didorong saat mulai dari memori yang dicari sendiri oleh agen. Hanya didorong berarti paket yang sama ikut setiap kali; pencarian aktif berarti ia datang saat dibutuhkan.",
    "note": "Pipeline tetap mencari sekali; agen memutuskan kapan ia butuh lebih dan kembali mencari."
  },
  "it": {
    "level": {
      "static": "Solo spinto",
      "none": "Nessun recupero",
      "agentic": "Cerca attivamente"
    },
    "check": {
      "searched": "Ricerche dell’agente",
      "pushed": "Spinte all’avvio"
    },
    "heading": "RAG agentico",
    "desc": "Separa la memoria spinta all’avvio da quella che l’agente è andato a cercare. Solo spinta significa che lo stesso pacchetto viaggia ogni volta; la ricerca attiva significa che arriva quando serve.",
    "note": "Una pipeline fissa cerca una volta; un agente decide quando gliene serve altra e torna indietro."
  },
  "pt-BR": {
    "level": {
      "static": "Apenas empurrado",
      "none": "Sem recuperação",
      "agentic": "Busca ativamente"
    },
    "check": {
      "searched": "Buscas do agente",
      "pushed": "Empurradas ao iniciar"
    },
    "heading": "RAG agêntico",
    "desc": "Separa a memória empurrada na largada da que o agente foi buscar. Só empurrar significa que o mesmo pacote viaja sempre; busca ativa significa que chega quando é preciso.",
    "note": "Um pipeline fixo busca uma vez; um agente decide quando precisa de mais e volta."
  }
} as const;
